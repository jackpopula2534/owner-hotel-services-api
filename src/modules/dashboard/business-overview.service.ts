import { Injectable, Logger } from '@nestjs/common';
import { RevenueSourceModule } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AddonService, ProductSystem } from '../addons/addon.service';
import { RevenueQueryService } from '../revenue/revenue-query.service';
import {
  bangkokDayRange,
  bangkokMonthRange,
  round2,
  shiftDate,
  toBangkokDate,
  toBangkokMonth,
} from '../../common/utils/bangkok-day.util';
import { RECOGNIZED_ORDER_PAYMENT_STATUSES } from '../../common/constants/revenue-recognition.const';

/**
 * Cross-system overview for the Command Center home screen.
 *
 * StaySync is not only a PMS: a tenant may also run F&B, stock, purchasing,
 * accounting, cost accounting and HR. The admin landing page used to report the
 * hotel alone, so the moment a tenant switched on another module, the one screen
 * that claims to be "ภาพรวมผู้ดูแลระบบ" stopped telling the whole truth.
 *
 * This service answers, for every module on the page: what did it earn today,
 * and what is waiting for someone. Which modules are on the page is decided by
 * one rule with three states:
 *
 *   owned  — entitled right now: the live tile, money and operations both.
 *   lapsed — not entitled any more, but the ledger holds money this module
 *            earned inside the window on screen. The money is reported — it was
 *            genuinely earned and the day has to add up — while the operational
 *            half is left off, so the page never offers an action the tenant can
 *            no longer take.
 *   never  — no entitlement and no money: not on the page at all, the same gate
 *            the sidebar uses, so nothing behind a paywall is advertised.
 *
 * `lapsed` is the state that was missing. The headline used to be built by
 * adding up the tiles, so a tenant who let F&B go — a downgrade, a trial that
 * ran out at noon — quietly lost that day's restaurant takings from "revenue
 * today", while the revenue report, which never asks about entitlements, went on
 * counting them. The two screens disagreed about the same day. The headline is
 * now the ledger's own total for the tenant, and every baht in it belongs to a
 * module named in `sources`.
 *
 * Every money figure on this page comes from the revenue ledger
 * (`RevenueQueryService`), never from counting source rows here — and now from a
 * single reading of it per day, handed to the tiles, so a tile cannot disagree
 * with the headline above it. The counts beside them — bills closed, orders
 * still open, rooms to clean — stay with the modules that own those documents,
 * because they are operational facts rather than revenue.
 */

export type OverviewModuleCode =
  | 'HOTEL'
  | 'RESTAURANT_MODULE'
  | 'INVENTORY_MODULE'
  | 'PROCUREMENT'
  | 'ACCOUNTING_MODULE'
  | 'COST_ACCOUNTING_MODULE'
  | 'HR_MODULE'
  | 'CAMP_MODULE';

/**
 * How a module stands with the tenant's entitlements.
 *
 * `never` is a state of the rule, not of the response: those modules are left
 * out of `modules` entirely, so only the other two are ever serialised.
 */
export type OverviewEntitlement = 'owned' | 'lapsed' | 'never';

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
  /** `owned` or `lapsed` — a `never` module is not in the list at all. */
  entitlement: OverviewEntitlement;
  state: OverviewModuleState;
  metrics: OverviewMetric[];
  /** Items a human still has to act on inside this module. Always 0 when lapsed. */
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

/**
 * What a module knows about itself. Money is deliberately not in here: it comes
 * from one reading of the ledger, so no tile can invent its own figure.
 */
interface ModuleFacts {
  state: OverviewModuleState;
  metrics: OverviewMetric[];
  openItems: number;
}

/** The two Bangkok calendar days this page compares, as 'YYYY-MM-DD'. */
interface OverviewDays {
  today: string;
  yesterday: string;
}

/** Net revenue of one Bangkok day, keyed by the tile the money belongs to. */
type RevenueByTile = Map<OverviewModuleCode, number>;

interface LedgerDays {
  today: RevenueByTile;
  yesterday: RevenueByTile;
}

/**
 * Which tile each kind of ledger row belongs to. Typed as a total map over the
 * enum on purpose: add a fifth business to `RevenueSourceModule` and this stops
 * compiling until someone says where its money shows up, instead of quietly
 * dropping it out of the day's total.
 */
const TILE_OF_LEDGER_MODULE: Record<RevenueSourceModule, OverviewModuleCode> = {
  [RevenueSourceModule.HOTEL]: 'HOTEL',
  [RevenueSourceModule.RESTAURANT]: 'RESTAURANT_MODULE',
  [RevenueSourceModule.RETAIL]: 'INVENTORY_MODULE',
  [RevenueSourceModule.CAMP]: 'CAMP_MODULE',
};

/**
 * Businesses that sit inside one property, and businesses that do not. A
 * warehouse serves every hotel the tenant owns and a campground is a different
 * address altogether — their rows carry no property, so narrowing them by the
 * property on screen would file their takings under nobody.
 */
const PROPERTY_BOUND_MODULES = [RevenueSourceModule.HOTEL, RevenueSourceModule.RESTAURANT];
const TENANT_WIDE_MODULES = [RevenueSourceModule.RETAIL, RevenueSourceModule.CAMP];

const EMPTY_FACTS: ModuleFacts = { state: 'setup', metrics: [], openItems: 0 };

/**
 * A module the tenant no longer holds. Its money stands — that is a financial
 * record, not a feature — but nothing operational is reported, so the page never
 * shows a queue behind a lock.
 */
const LAPSED_FACTS = (revenueToday: number): ModuleFacts => ({
  state: 'ok',
  openItems: 0,
  metrics: [{ key: 'revenueToday', value: revenueToday, format: 'currency' }],
});

@Injectable()
export class BusinessOverviewService {
  private readonly logger = new Logger(BusinessOverviewService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly addonService: AddonService,
    private readonly revenue: RevenueQueryService,
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

    const yesterdayDate = shiftDate(date, -1);
    // The tiles count operational rows inside today's Bangkok window; the ledger
    // is asked by calendar day, which is how revenue is filed.
    const today = bangkokDayRange(date);
    const days: OverviewDays = { today: date, yesterday: yesterdayDate };

    const [owned, ledger] = await Promise.all([
      this.ownedModules(tenantId),
      this.ledgerRevenue(tenantId, propertyId, days),
    ]);

    // The hotel PMS is the product itself, never an add-on, so it is always in.
    // Every module that can hold ledger money has a builder here — that is what
    // makes "each baht belongs to a tile" true rather than hopeful.
    const builders: Array<[OverviewModuleCode, (revenueToday: number) => Promise<ModuleFacts>]> = [
      ['HOTEL', (money) => this.hotel(tenantId, propertyId, today, money)],
      ['RESTAURANT_MODULE', (money) => this.restaurant(tenantId, propertyId, today, money)],
      ['INVENTORY_MODULE', (money) => this.inventory(tenantId, now, money)],
      ['PROCUREMENT', () => this.procurement(tenantId)],
      ['ACCOUNTING_MODULE', () => this.accounting(tenantId, date)],
      ['COST_ACCOUNTING_MODULE', () => this.costAccounting(tenantId, now)],
      ['HR_MODULE', () => this.hr(tenantId, propertyId, date)],
      ['CAMP_MODULE', (money) => this.camp(tenantId, today, money)],
    ];

    const modules = await Promise.all(
      builders
        .map(([code, build]) => ({ code, build, entitlement: this.entitlementOf(code, owned, ledger) }))
        .filter(({ entitlement }) => entitlement !== 'never')
        .map(async ({ code, build, entitlement }): Promise<OverviewModule> => {
          const revenueToday = ledger.today.get(code) ?? 0;
          // A lapsed module is never asked its operational questions: those
          // tables belong to a system the tenant cannot open any more.
          const facts =
            entitlement === 'owned'
              ? await this.safe(code, () => build(revenueToday))
              : LAPSED_FACTS(revenueToday);
          return { code, entitlement, revenueToday, ...facts };
        }),
    );

    const revenueToday = this.dayTotal(ledger.today);
    const revenueYesterday = this.dayTotal(ledger.yesterday);

    return {
      date,
      revenue: {
        today: revenueToday,
        yesterday: revenueYesterday,
        changePct:
          revenueYesterday > 0
            ? round2(((revenueToday - revenueYesterday) / revenueYesterday) * 100)
            : null,
        // Listed in tile order so the breakdown reads down the page, and cut at
        // "took nothing" rather than "took something positive": a day whose only
        // restaurant row is a reversal is a negative figure, and dropping it
        // would leave the sources short of the headline they explain.
        sources: builders
          .map(([code]) => ({ code, amount: ledger.today.get(code) ?? 0 }))
          .filter((source) => source.amount !== 0),
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
    const owned = new Set<OverviewModuleCode>();

    // Hotel and Campground are separate products, not add-ons of one another.
    // The PMS is the product itself for a hotel tenant — never bought, always
    // in — but a campground sells pitches, and an empty "โรงแรม" tile telling
    // them to go set up rooms is not an overview of their business.
    if ((await this.productLine(tenantId)) !== 'CAMP') owned.add('HOTEL');

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
      if (active.has('CAMP_MODULE')) owned.add('CAMP_MODULE');
    } catch (error) {
      // Entitlements unreadable → show the tenant's own product line only.
      // Better a smaller true page than one that guesses a tenant into a module
      // they never bought.
      this.logger.warn(`Add-on lookup failed for tenant ${tenantId}: ${this.reason(error)}`);
    }
    return owned;
  }

  /**
   * The tenant's product line, falling back to HOTEL when it cannot be read —
   * the same default the add-on service uses. Asked separately from the add-ons
   * on purpose: folding the two together would mean an unreadable product line
   * costs the tenant every other module on the page as well.
   */
  private async productLine(tenantId: string): Promise<ProductSystem> {
    try {
      return await this.addonService.getTenantSystem(tenantId);
    } catch (error) {
      this.logger.warn(`Product line lookup failed for tenant ${tenantId}: ${this.reason(error)}`);
      return 'HOTEL';
    }
  }

  /**
   * owned / lapsed / never for one module.
   *
   * "Lapsed" is judged from the money on this screen, not from expired
   * subscription rows: a downgrade overwrites the plan on the subscription and
   * leaves no history to read at all, and a trial that ran out two years ago is
   * not something this page should keep advertising. What earns a module its
   * place here is the money the page would otherwise hide.
   */
  private entitlementOf(
    code: OverviewModuleCode,
    owned: Set<OverviewModuleCode>,
    ledger: LedgerDays,
  ): OverviewEntitlement {
    if (owned.has(code)) return 'owned';
    const earned = (ledger.today.get(code) ?? 0) !== 0 || (ledger.yesterday.get(code) ?? 0) !== 0;
    return earned ? 'lapsed' : 'never';
  }

  /**
   * The whole tenant's revenue for both days, split by tile — the one reading of
   * the ledger this page makes. Asking per module, as this used to, meant the
   * page could only ever see the modules it had already decided to show.
   */
  private async ledgerRevenue(
    tenantId: string,
    propertyId: string | undefined,
    days: OverviewDays,
  ): Promise<LedgerDays> {
    const [today, yesterday] = await Promise.all([
      this.revenueOfDay(tenantId, propertyId, days.today),
      this.revenueOfDay(tenantId, propertyId, days.yesterday),
    ]);
    return { today, yesterday };
  }

  private async revenueOfDay(
    tenantId: string,
    propertyId: string | undefined,
    day: string,
  ): Promise<RevenueByTile> {
    const window = { tenantId, from: day, to: day };

    const [bound, wide] = await Promise.all([
      this.revenue.byModule({ ...window, propertyId, sourceModule: PROPERTY_BOUND_MODULES }),
      this.revenue.byModule({ ...window, sourceModule: TENANT_WIDE_MODULES }),
    ]);

    const byTile: RevenueByTile = new Map();
    for (const group of [...bound, ...wide]) {
      const tile = TILE_OF_LEDGER_MODULE[group.key as RevenueSourceModule];
      // `key` is an enum column and the map above covers every value of it. The
      // guard is for a database holding a module this build does not know yet:
      // better left out of the page than filed under the wrong business.
      if (!tile) {
        this.logger.warn(`Ledger holds an unknown source module: ${group.key}`);
        continue;
      }
      byTile.set(tile, round2((byTile.get(tile) ?? 0) + group.net));
    }
    return byTile;
  }

  private dayTotal(byTile: RevenueByTile): number {
    return round2([...byTile.values()].reduce((sum, amount) => sum + amount, 0));
  }

  /**
   * One module failing must not blank the whole Command Center: a tenant whose
   * accounting tables are mid-migration should still see their rooms. Its money
   * survives the failure too — that came from the ledger, not from the tile.
   */
  private async safe(
    code: OverviewModuleCode,
    build: () => Promise<ModuleFacts>,
  ): Promise<ModuleFacts> {
    try {
      return await build();
    } catch (error) {
      this.logger.error(`Overview for ${code} failed: ${this.reason(error)}`);
      return EMPTY_FACTS;
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
    revenueToday: number,
  ): Promise<ModuleFacts> {
    const scope: Record<string, unknown> = { tenantId };
    if (propertyId) scope.propertyId = propertyId;

    // Room revenue is recognised when the folio closes at checkout — that is the
    // day the ledger files it under, and this tile reports the ledger rather
    // than re-deriving a figure from bookings. It used to sum the arrival day's
    // bookings, which counted money the hotel had not yet earned and disagreed
    // with the revenue report by a whole stay's length.
    const [totalRooms, occupied, arrivals, departures, toClean, pendingPayments] = await Promise.all(
      [
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
      ],
    );

    const openItems = arrivals + departures + toClean + pendingPayments;

    return {
      state: this.state(totalRooms > 0, openItems),
      openItems,
      metrics: [
        {
          key: 'occupancy',
          value: totalRooms > 0 ? Math.round((occupied / totalRooms) * 100) : 0,
          format: 'percent',
        },
        { key: 'revenueToday', value: revenueToday, format: 'currency' },
        { key: 'rooms', value: totalRooms, format: 'number' },
        { key: 'arrivals', value: arrivals, format: 'number' },
        { key: 'departures', value: departures, format: 'number' },
        { key: 'roomsToClean', value: toClean, format: 'number' },
      ],
    };
  }

  // ─── F&B ─────────────────────────────────────────────────────────────────

  private async restaurant(
    tenantId: string,
    propertyId: string | undefined,
    today: { start: Date; end: Date },
    revenueToday: number,
  ): Promise<ModuleFacts> {
    const outletScope: Record<string, unknown> = { tenantId };
    if (propertyId) outletScope.propertyId = propertyId;
    const orderScope: Record<string, unknown> = { tenantId };
    if (propertyId) orderScope.restaurant = { propertyId };

    // The bill count still comes from the orders table: how many bills closed is
    // an operational fact, and one bill can produce three ledger rows (food,
    // drink, service charge), so counting ledger rows would inflate it.
    const [outlets, billsToday, openOrders] = await Promise.all([
      this.prisma.restaurant.count({ where: { ...outletScope, isActive: true } }),
      this.prisma.order.count({
        where: {
          ...orderScope,
          status: 'COMPLETED',
          paymentStatus: { in: RECOGNIZED_ORDER_PAYMENT_STATUSES },
          completedAt: { gte: today.start, lt: today.end },
        },
      }),
      this.prisma.order.count({
        where: {
          ...orderScope,
          status: { in: ['PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'SERVED'] },
        },
      }),
    ]);

    return {
      state: this.state(outlets > 0, openOrders),
      openItems: openOrders,
      metrics: [
        { key: 'revenueToday', value: revenueToday, format: 'currency' },
        { key: 'billsToday', value: billsToday, format: 'number' },
        { key: 'openOrders', value: openOrders, format: 'number' },
        { key: 'outlets', value: outlets, format: 'number' },
      ],
    };
  }

  // ─── Stock ───────────────────────────────────────────────────────────────

  private async inventory(
    tenantId: string,
    now: Date,
    revenueToday: number,
  ): Promise<ModuleFacts> {
    const expiryHorizon = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const [items, expiring] = await Promise.all([
      this.prisma.inventoryItem.findMany({
        where: { tenantId, isActive: true, deletedAt: null },
        select: {
          minStock: true,
          reorderPoint: true,
          warehouseStocks: { select: { quantity: true, reservedQty: true } },
        },
      }),
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

    const openItems = lowStock + expiring;

    return {
      state: this.state(items.length > 0, openItems),
      openItems,
      metrics: [
        { key: 'items', value: items.length, format: 'number' },
        { key: 'lowStock', value: lowStock, format: 'number' },
        { key: 'expiringLots', value: expiring, format: 'number' },
        { key: 'retailSalesToday', value: revenueToday, format: 'currency' },
      ],
    };
  }

  // ─── Purchasing ──────────────────────────────────────────────────────────

  private async procurement(tenantId: string): Promise<ModuleFacts> {
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
      state: this.state(everRaised > 0 || ordersOpen > 0, openItems),
      openItems,
      metrics: [
        { key: 'requisitionsPending', value: requisitions, format: 'number' },
        { key: 'ordersPending', value: ordersPending, format: 'number' },
        { key: 'ordersOpen', value: ordersOpen, format: 'number' },
        { key: 'receivingInspection', value: receiving, format: 'number' },
      ],
    };
  }

  // ─── Accounting ──────────────────────────────────────────────────────────

  private async accounting(tenantId: string, date: string): Promise<ModuleFacts> {
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
      state: this.state(accounts > 0, openItems),
      openItems,
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
    };
  }

  // ─── Cost accounting ─────────────────────────────────────────────────────

  private async costAccounting(tenantId: string, now: Date): Promise<ModuleFacts> {
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
      state: this.state(everRecorded > 0, draft),
      openItems: draft,
      metrics: [
        {
          key: 'costThisMonth',
          value: round2(Number(posted._sum.amount ?? 0)),
          format: 'currency',
        },
        { key: 'draftEntries', value: draft, format: 'number' },
        { key: 'entriesTotal', value: everRecorded, format: 'number' },
      ],
    };
  }

  // ─── HR ──────────────────────────────────────────────────────────────────

  private async hr(
    tenantId: string,
    propertyId: string | undefined,
    date: string,
  ): Promise<ModuleFacts> {
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
      state: this.state(headcount > 0, pendingLeave),
      openItems: pendingLeave,
      metrics: [
        { key: 'headcount', value: headcount, format: 'number' },
        { key: 'pendingLeave', value: pendingLeave, format: 'number' },
        { key: 'onLeaveToday', value: onLeaveToday, format: 'number' },
      ],
    };
  }

  // ─── Campground ──────────────────────────────────────────────────────────

  /**
   * Campgrounds are their own business line: pitches instead of rooms, and no
   * property to sit inside. Without a tile of its own, camp takings were the one
   * kind of ledger money the Command Center could not name — counted nowhere, or
   * (worse) quietly left out of the day.
   *
   * Only the shape every tile shares is reported here; the campground's own
   * dashboard is where its operations are run.
   */
  private async camp(
    tenantId: string,
    today: { start: Date; end: Date },
    revenueToday: number,
  ): Promise<ModuleFacts> {
    const [pitches, staying, arrivals, unpaid] = await Promise.all([
      this.prisma.campPitch.count({ where: { tenantId } }),
      this.prisma.campReservation.count({ where: { tenantId, status: 'checked_in' } }),
      this.prisma.campReservation.count({
        where: {
          tenantId,
          checkIn: { gte: today.start, lt: today.end },
          status: { in: ['pending', 'confirmed'] },
        },
      }),
      // Money owed, not money earned: a stay can be over and still unpaid, which
      // is a debt for someone to chase rather than a revenue figure.
      this.prisma.campReservation.count({
        where: {
          tenantId,
          status: { in: ['confirmed', 'checked_in', 'checked_out'] },
          NOT: { paymentStatus: 'paid' },
        },
      }),
    ]);

    const openItems = arrivals + unpaid;

    return {
      state: this.state(pitches > 0, openItems),
      openItems,
      metrics: [
        { key: 'revenueToday', value: revenueToday, format: 'currency' },
        { key: 'pitches', value: pitches, format: 'number' },
        { key: 'staying', value: staying, format: 'number' },
        { key: 'arrivals', value: arrivals, format: 'number' },
        { key: 'unpaidReservations', value: unpaid, format: 'number' },
      ],
    };
  }
}
