import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AddonService } from '../addons/addon.service';
import {
  bangkokDayRange,
  bangkokMonthRange,
  round2,
  shiftDate,
  toBangkokDate,
  toBangkokMonth,
} from '../../common/utils/bangkok-day.util';

/**
 * Cross-system overview for the Command Center home screen.
 *
 * StaySync is not only a PMS: a tenant may also run F&B, stock, purchasing,
 * accounting, cost accounting and HR. The admin landing page used to report the
 * hotel alone, so the moment a tenant switched on another module, the one screen
 * that claims to be "ภาพรวมผู้ดูแลระบบ" stopped telling the whole truth.
 *
 * This service answers, for every module the tenant is actually entitled to:
 * what did it earn today, and what is waiting for someone. Modules the tenant
 * has not bought are omitted entirely — the same gate the sidebar uses — so the
 * page never advertises a system behind a paywall.
 */

export type OverviewModuleCode =
  | 'HOTEL'
  | 'RESTAURANT_MODULE'
  | 'INVENTORY_MODULE'
  | 'PROCUREMENT'
  | 'ACCOUNTING_MODULE'
  | 'COST_ACCOUNTING_MODULE'
  | 'HR_MODULE';

/** How the frontend should render a figure; the label itself is the client's job (i18n). */
export type OverviewMetricFormat = 'number' | 'currency' | 'percent';

export interface OverviewMetric {
  key: string;
  value: number;
  format: OverviewMetricFormat;
}

/**
 * - `setup`     — the module is owned but has no data yet (no rooms, no outlet, empty catalog)
 * - `attention` — something is waiting for a human
 * - `ok`        — nothing outstanding
 */
export type OverviewModuleState = 'setup' | 'attention' | 'ok';

export interface OverviewModule {
  code: OverviewModuleCode;
  state: OverviewModuleState;
  metrics: OverviewMetric[];
  /** Items a human still has to act on inside this module. */
  openItems: number;
  /** Money this module took today (0 for modules that do not sell). */
  revenueToday: number;
}

export interface BusinessOverview {
  /** Bangkok calendar day the figures cover. */
  date: string;
  revenue: {
    today: number;
    yesterday: number;
    /** null when yesterday took nothing — a percentage off zero is meaningless, not infinite. */
    changePct: number | null;
    sources: Array<{ code: OverviewModuleCode; amount: number }>;
  };
  /** Sum of every module's open items — the one number that says "how much is waiting". */
  openItems: number;
  modules: OverviewModule[];
}

interface ModuleResult {
  module: OverviewModule;
  revenueYesterday: number;
}

const EMPTY_RESULT = (code: OverviewModuleCode): ModuleResult => ({
  module: { code, state: 'setup', metrics: [], openItems: 0, revenueToday: 0 },
  revenueYesterday: 0,
});

@Injectable()
export class BusinessOverviewService {
  private readonly logger = new Logger(BusinessOverviewService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly addonService: AddonService,
  ) {}

  async getBusinessOverview(tenantId?: string, propertyId?: string): Promise<BusinessOverview> {
    const now = new Date();
    const date = toBangkokDate(now);

    // Same contract as the rest of this module: a caller with no tenant (a
    // platform account, say) gets an empty overview rather than another
    // tenant's numbers.
    if (!tenantId) {
      return { date, revenue: { today: 0, yesterday: 0, changePct: null, sources: [] }, openItems: 0, modules: [] };
    }

    const today = bangkokDayRange(date);
    const yesterday = bangkokDayRange(shiftDate(date, -1));

    const owned = await this.ownedModules(tenantId);

    // The hotel PMS is the product itself, never an add-on, so it is always in.
    const builders: Array<[OverviewModuleCode, () => Promise<ModuleResult>]> = [
      ['HOTEL', () => this.hotel(tenantId, propertyId, today, yesterday)],
      ['RESTAURANT_MODULE', () => this.restaurant(tenantId, propertyId, today, yesterday)],
      ['INVENTORY_MODULE', () => this.inventory(tenantId, today, yesterday, now)],
      ['PROCUREMENT', () => this.procurement(tenantId)],
      ['ACCOUNTING_MODULE', () => this.accounting(tenantId, date)],
      ['COST_ACCOUNTING_MODULE', () => this.costAccounting(tenantId, now)],
      ['HR_MODULE', () => this.hr(tenantId, propertyId, date)],
    ];

    const results = await Promise.all(
      builders
        .filter(([code]) => owned.has(code))
        .map(([code, build]) => this.safe(code, build)),
    );

    const modules = results.map((r) => r.module);
    const revenueToday = round2(modules.reduce((sum, m) => sum + m.revenueToday, 0));
    const revenueYesterday = round2(results.reduce((sum, r) => sum + r.revenueYesterday, 0));

    return {
      date,
      revenue: {
        today: revenueToday,
        yesterday: revenueYesterday,
        changePct:
          revenueYesterday > 0
            ? round2(((revenueToday - revenueYesterday) / revenueYesterday) * 100)
            : null,
        sources: modules
          .filter((m) => m.revenueToday > 0)
          .map((m) => ({ code: m.code, amount: m.revenueToday })),
      },
      openItems: modules.reduce((sum, m) => sum + m.openItems, 0),
      modules,
    };
  }

  /**
   * Which systems this tenant may see. `PROCUREMENT` has no add-on of its own —
   * purchasing ships with the stock module, exactly as the sidebar gates it.
   */
  private async ownedModules(tenantId: string): Promise<Set<OverviewModuleCode>> {
    const owned = new Set<OverviewModuleCode>(['HOTEL']);
    try {
      const addons = await this.addonService.getActiveAddons(tenantId);
      const active = new Set(addons.filter((a) => a.isActive).map((a) => a.code));

      if (active.has('RESTAURANT_MODULE')) owned.add('RESTAURANT_MODULE');
      if (active.has('INVENTORY_MODULE')) {
        owned.add('INVENTORY_MODULE');
        owned.add('PROCUREMENT');
      }
      if (active.has('ACCOUNTING_MODULE')) owned.add('ACCOUNTING_MODULE');
      if (active.has('COST_ACCOUNTING_MODULE')) owned.add('COST_ACCOUNTING_MODULE');
      if (active.has('HR_MODULE')) owned.add('HR_MODULE');
    } catch (error) {
      // Entitlements unreadable → show the hotel only. Better a smaller true
      // page than one that guesses a tenant into a module they never bought.
      this.logger.warn(`Add-on lookup failed for tenant ${tenantId}: ${this.reason(error)}`);
    }
    return owned;
  }

  /**
   * One module failing must not blank the whole Command Center: a tenant whose
   * accounting tables are mid-migration should still see their rooms.
   */
  private async safe(code: OverviewModuleCode, build: () => Promise<ModuleResult>): Promise<ModuleResult> {
    try {
      return await build();
    } catch (error) {
      this.logger.error(`Overview for ${code} failed: ${this.reason(error)}`);
      return EMPTY_RESULT(code);
    }
  }

  private reason(error: unknown): string {
    return error instanceof Error ? error.message : 'Unknown error';
  }

  private state(hasData: boolean, openItems: number): OverviewModuleState {
    if (!hasData) return 'setup';
    return openItems > 0 ? 'attention' : 'ok';
  }

  // ─── Hotel (PMS) ─────────────────────────────────────────────────────────

  private async hotel(
    tenantId: string,
    propertyId: string | undefined,
    today: { start: Date; end: Date },
    yesterday: { start: Date; end: Date },
  ): Promise<ModuleResult> {
    const scope: Record<string, unknown> = { tenantId };
    if (propertyId) scope.propertyId = propertyId;

    // Revenue is recognised on the arrival date, matching /dashboard/metrics —
    // two "รายได้วันนี้" on one screen that disagree would be worse than either.
    const revenueOf = async (window: { start: Date; end: Date }): Promise<number> => {
      const bookings = await this.prisma.booking.findMany({
        where: {
          ...scope,
          status: { in: ['confirmed', 'checked_in', 'checked_out'] },
          checkIn: { gte: window.start, lt: window.end },
        },
        select: { grandTotal: true, totalPrice: true, addOns: { select: { amount: true } } },
      });
      return bookings.reduce(
        (sum, b) =>
          sum +
          Number(b.grandTotal ?? b.totalPrice ?? 0) +
          b.addOns.reduce((s, a) => s + Number(a.amount ?? 0), 0),
        0,
      );
    };

    const [totalRooms, occupied, arrivals, departures, toClean, pendingPayments, revenueToday, revenueYesterday] =
      await Promise.all([
        this.prisma.room.count({ where: { ...scope, status: { not: 'out_of_order' } } }),
        this.prisma.booking.count({
          where: {
            ...scope,
            status: 'checked_in',
            checkIn: { lt: today.end },
            checkOut: { gte: today.start },
          },
        }),
        this.prisma.booking.count({
          where: {
            ...scope,
            checkIn: { gte: today.start, lt: today.end },
            status: { in: ['confirmed', 'pending'] },
          },
        }),
        this.prisma.booking.count({
          where: { ...scope, checkOut: { gte: today.start, lt: today.end }, status: 'checked_in' },
        }),
        this.prisma.room.count({
          where: { ...scope, status: { in: ['dirty', 'cleaning', 'occupied_dirty'] } },
        }),
        this.prisma.payments.count({ where: { tenant_id: tenantId, status: 'pending' } }),
        revenueOf(today),
        revenueOf(yesterday),
      ]);

    const openItems = arrivals + departures + toClean + pendingPayments;

    return {
      module: {
        code: 'HOTEL',
        state: this.state(totalRooms > 0, openItems),
        openItems,
        revenueToday: round2(revenueToday),
        metrics: [
          {
            key: 'occupancy',
            value: totalRooms > 0 ? Math.round((occupied / totalRooms) * 100) : 0,
            format: 'percent',
          },
          { key: 'revenueToday', value: round2(revenueToday), format: 'currency' },
          { key: 'rooms', value: totalRooms, format: 'number' },
          { key: 'arrivals', value: arrivals, format: 'number' },
          { key: 'departures', value: departures, format: 'number' },
          { key: 'roomsToClean', value: toClean, format: 'number' },
        ],
      },
      revenueYesterday: round2(revenueYesterday),
    };
  }

  // ─── F&B ─────────────────────────────────────────────────────────────────

  private async restaurant(
    tenantId: string,
    propertyId: string | undefined,
    today: { start: Date; end: Date },
    yesterday: { start: Date; end: Date },
  ): Promise<ModuleResult> {
    const outletScope: Record<string, unknown> = { tenantId };
    if (propertyId) outletScope.propertyId = propertyId;
    const orderScope: Record<string, unknown> = { tenantId };
    if (propertyId) orderScope.restaurant = { propertyId };

    // Same filter as the F&B sales report (COMPLETED + PAID on completedAt), so
    // this tile and สรุปรายได้ร้านอาหาร can never quote different numbers.
    const settled = async (window: { start: Date; end: Date }) =>
      this.prisma.order.aggregate({
        where: {
          ...orderScope,
          status: 'COMPLETED',
          paymentStatus: 'PAID',
          completedAt: { gte: window.start, lt: window.end },
        },
        _sum: { total: true },
        _count: { _all: true },
      });

    const [outlets, todaySales, yesterdaySales, openOrders] = await Promise.all([
      this.prisma.restaurant.count({ where: { ...outletScope, isActive: true } }),
      settled(today),
      settled(yesterday),
      this.prisma.order.count({
        where: {
          ...orderScope,
          status: { in: ['PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'SERVED'] },
        },
      }),
    ]);

    const revenueToday = round2(Number(todaySales._sum.total ?? 0));

    return {
      module: {
        code: 'RESTAURANT_MODULE',
        state: this.state(outlets > 0, openOrders),
        openItems: openOrders,
        revenueToday,
        metrics: [
          { key: 'revenueToday', value: revenueToday, format: 'currency' },
          { key: 'billsToday', value: todaySales._count._all, format: 'number' },
          { key: 'openOrders', value: openOrders, format: 'number' },
          { key: 'outlets', value: outlets, format: 'number' },
        ],
      },
      revenueYesterday: round2(Number(yesterdaySales._sum.total ?? 0)),
    };
  }

  // ─── Stock ───────────────────────────────────────────────────────────────

  private async inventory(
    tenantId: string,
    today: { start: Date; end: Date },
    yesterday: { start: Date; end: Date },
    now: Date,
  ): Promise<ModuleResult> {
    const retail = async (window: { start: Date; end: Date }) =>
      this.prisma.retailSale.aggregate({
        where: { tenantId, status: 'COMPLETED', soldAt: { gte: window.start, lt: window.end } },
        _sum: { grandTotal: true },
      });

    const expiryHorizon = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const [items, todayRetail, yesterdayRetail, expiring] = await Promise.all([
      this.prisma.inventoryItem.findMany({
        where: { tenantId, isActive: true, deletedAt: null },
        select: {
          minStock: true,
          reorderPoint: true,
          warehouseStocks: { select: { quantity: true, reservedQty: true } },
        },
      }),
      retail(today),
      retail(yesterday),
      // `lte` on a nullable column already excludes lots with no expiry date,
      // so items that never spoil are not counted as spoiling.
      this.prisma.inventoryLot.count({
        where: { tenantId, status: 'ACTIVE', expiryDate: { lte: expiryHorizon } },
      }),
    ]);

    // An item is "low" against its reorder point, or against its minimum when no
    // reorder point is set. With neither configured, only actually running out counts.
    const lowStock = items.filter((item) => {
      const available = item.warehouseStocks.reduce(
        (sum, s) => sum + (s.quantity - s.reservedQty),
        0,
      );
      const threshold = item.reorderPoint > 0 ? item.reorderPoint : item.minStock;
      return threshold > 0 ? available <= threshold : available <= 0;
    }).length;

    const revenueToday = round2(Number(todayRetail._sum.grandTotal ?? 0));
    const openItems = lowStock + expiring;

    return {
      module: {
        code: 'INVENTORY_MODULE',
        state: this.state(items.length > 0, openItems),
        openItems,
        revenueToday,
        metrics: [
          { key: 'items', value: items.length, format: 'number' },
          { key: 'lowStock', value: lowStock, format: 'number' },
          { key: 'expiringLots', value: expiring, format: 'number' },
          { key: 'retailSalesToday', value: revenueToday, format: 'currency' },
        ],
      },
      revenueYesterday: round2(Number(yesterdayRetail._sum.grandTotal ?? 0)),
    };
  }

  // ─── Purchasing ──────────────────────────────────────────────────────────

  private async procurement(tenantId: string): Promise<ModuleResult> {
    const [requisitions, ordersPending, ordersOpen, receiving, everRaised] = await Promise.all([
      this.prisma.purchaseRequisition.count({ where: { tenantId, status: 'PENDING_APPROVAL' } }),
      this.prisma.purchaseOrder.count({ where: { tenantId, status: 'PENDING_APPROVAL' } }),
      this.prisma.purchaseOrder.count({
        where: { tenantId, status: { in: ['APPROVED', 'PARTIALLY_RECEIVED'] } },
      }),
      this.prisma.goodsReceive.count({ where: { tenantId, status: 'INSPECTING' } }),
      this.prisma.purchaseRequisition.count({ where: { tenantId } }),
    ]);

    const openItems = requisitions + ordersPending + receiving;

    return {
      module: {
        code: 'PROCUREMENT',
        state: this.state(everRaised > 0 || ordersOpen > 0, openItems),
        openItems,
        revenueToday: 0,
        metrics: [
          { key: 'requisitionsPending', value: requisitions, format: 'number' },
          { key: 'ordersPending', value: ordersPending, format: 'number' },
          { key: 'ordersOpen', value: ordersOpen, format: 'number' },
          { key: 'receivingInspection', value: receiving, format: 'number' },
        ],
      },
      revenueYesterday: 0,
    };
  }

  // ─── Accounting ──────────────────────────────────────────────────────────

  private async accounting(tenantId: string, date: string): Promise<ModuleResult> {
    // `dueDate` is a @db.Date column, stored as UTC midnight of the calendar day,
    // so it must be compared against UTC midnight — not against the Bangkok
    // day's UTC window, which starts at 17:00 the day before and shifts
    // everything due today into "overdue".
    const dayStamp = new Date(`${date}T00:00:00.000Z`);

    const [accounts, receivable, payable, arOverdue, apOverdue, draftEntries] = await Promise.all([
      this.prisma.accountChart.count({ where: { tenantId } }),
      this.prisma.arInvoice.aggregate({
        where: { tenantId, status: { in: ['ISSUED', 'PARTIAL', 'OVERDUE'] } },
        _sum: { balance: true },
      }),
      this.prisma.apInvoice.aggregate({
        where: { tenantId, status: { in: ['PENDING', 'APPROVED', 'PARTIAL', 'OVERDUE'] } },
        _sum: { balance: true },
      }),
      // Judged by the due date rather than by the status column: nothing flips a
      // row to OVERDUE at midnight, so counting the status alone under-reports.
      this.prisma.arInvoice.count({
        where: {
          tenantId,
          status: { in: ['ISSUED', 'PARTIAL', 'OVERDUE'] },
          dueDate: { lt: dayStamp },
        },
      }),
      this.prisma.apInvoice.count({
        where: {
          tenantId,
          status: { in: ['PENDING', 'APPROVED', 'PARTIAL', 'OVERDUE'] },
          dueDate: { lt: dayStamp },
        },
      }),
      this.prisma.journalEntry.count({ where: { tenantId, status: 'DRAFT' } }),
    ]);

    const openItems = arOverdue + apOverdue + draftEntries;

    return {
      module: {
        code: 'ACCOUNTING_MODULE',
        state: this.state(accounts > 0, openItems),
        openItems,
        revenueToday: 0,
        metrics: [
          {
            key: 'receivable',
            value: round2(Number(receivable._sum.balance ?? 0)),
            format: 'currency',
          },
          { key: 'payable', value: round2(Number(payable._sum.balance ?? 0)), format: 'currency' },
          { key: 'overdueInvoices', value: arOverdue + apOverdue, format: 'number' },
          { key: 'draftEntries', value: draftEntries, format: 'number' },
        ],
      },
      revenueYesterday: 0,
    };
  }

  // ─── Cost accounting ─────────────────────────────────────────────────────

  private async costAccounting(tenantId: string, now: Date): Promise<ModuleResult> {
    const month = bangkokMonthRange(toBangkokMonth(now));

    const [posted, draft, everRecorded] = await Promise.all([
      this.prisma.costEntry.aggregate({
        where: { tenantId, status: 'posted', entryDate: { gte: month.start, lt: month.end } },
        _sum: { amount: true },
      }),
      this.prisma.costEntry.count({ where: { tenantId, status: 'draft' } }),
      this.prisma.costEntry.count({ where: { tenantId } }),
    ]);

    return {
      module: {
        code: 'COST_ACCOUNTING_MODULE',
        state: this.state(everRecorded > 0, draft),
        openItems: draft,
        revenueToday: 0,
        metrics: [
          {
            key: 'costThisMonth',
            value: round2(Number(posted._sum.amount ?? 0)),
            format: 'currency',
          },
          { key: 'draftEntries', value: draft, format: 'number' },
          { key: 'entriesTotal', value: everRecorded, format: 'number' },
        ],
      },
      revenueYesterday: 0,
    };
  }

  // ─── HR ──────────────────────────────────────────────────────────────────

  private async hr(
    tenantId: string,
    propertyId: string | undefined,
    date: string,
  ): Promise<ModuleResult> {
    const scope: Record<string, unknown> = { tenantId, status: 'ACTIVE' };
    if (propertyId) scope.propertyId = propertyId;

    // Leave dates are @db.Date columns — compare them against UTC midnight of the
    // Bangkok day, which is how they are stored.
    const dayStamp = new Date(`${date}T00:00:00.000Z`);

    const [headcount, pendingLeave, onLeaveToday] = await Promise.all([
      this.prisma.employee.count({ where: scope }),
      this.prisma.hrLeaveRequest.count({ where: { tenantId, status: 'pending' } }),
      this.prisma.hrLeaveRequest.count({
        where: {
          tenantId,
          status: 'approved',
          startDate: { lte: dayStamp },
          endDate: { gte: dayStamp },
        },
      }),
    ]);

    return {
      module: {
        code: 'HR_MODULE',
        state: this.state(headcount > 0, pendingLeave),
        openItems: pendingLeave,
        revenueToday: 0,
        metrics: [
          { key: 'headcount', value: headcount, format: 'number' },
          { key: 'pendingLeave', value: pendingLeave, format: 'number' },
          { key: 'onLeaveToday', value: onLeaveToday, format: 'number' },
        ],
      },
      revenueYesterday: 0,
    };
  }
}
