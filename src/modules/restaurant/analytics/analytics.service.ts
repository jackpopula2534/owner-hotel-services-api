import { Injectable, Logger } from '@nestjs/common';
import { RevenueSourceModule } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  RevenueQueryService,
  type RevenueDocument,
} from '../../revenue/revenue-query.service';
import {
  ORDER_DIMENSION_SELECT,
  type DayGrouping,
  bangkokDayRange,
  bangkokHour,
  bucketOfDay,
  businessDateOf,
  joinLedgerOrders,
  moneyBySource,
  round2,
  shiftDate,
  sumTotals,
  toBangkokDate,
} from './sales-shared';

/**
 * The older, broader outlet analytics — revenue timeline, day overview, menu mix,
 * table utilisation and the hourly heatmap.
 *
 * Every money figure here now comes from the revenue ledger, the same rows the
 * daily/monthly sales reports and the Command Center read. The orders table is
 * still queried, but only for the two things the ledger deliberately does not
 * store: operational counts (an order opened and never paid has no ledger row,
 * and a kitchen that is behind must still be visible) and per-bill dimensions
 * (table, party size, payment method, closing time). Money and dimensions are
 * then joined on `sourceId`, so every breakdown on this screen re-totals exactly
 * to its own headline.
 *
 * Days are Bangkok calendar days throughout. The previous version cut them with
 * `setHours`/`getDay`, i.e. wherever the server happened to be, so the same
 * request answered differently from a UTC container than from a Thai laptop.
 */
@Injectable()
export class RestaurantAnalyticsService {
  private readonly logger = new Logger(RestaurantAnalyticsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly revenue: RevenueQueryService,
  ) {}

  // ─── Shared plumbing ──────────────────────────────────────────────────────

  /** Ledger scope for one outlet — outletId is the restaurant id for F&B rows. */
  private scopeOf(restaurantId: string, tenantId: string) {
    return {
      tenantId,
      outletId: restaurantId,
      sourceModule: RevenueSourceModule.RESTAURANT,
    };
  }

  /**
   * Resolve a `?from=&to=` pair to an inclusive Bangkok business-date range.
   *
   * A plain 'YYYY-MM-DD' is taken verbatim — parsing it as an instant first would
   * shift it a day backwards for anyone east of UTC. A full ISO timestamp is
   * converted to the Bangkok day that contains it. Anything unparseable falls
   * back to the default window rather than throwing: these are overview widgets,
   * and a garbled query string is not worth a 500.
   */
  private resolveRange(from: string | undefined, to: string | undefined, defaultDays: number) {
    const parse = (value?: string): string | null => {
      if (!value) return null;
      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
      const at = new Date(value);
      return Number.isNaN(at.getTime()) ? null : toBangkokDate(at);
    };

    const end = parse(to) ?? toBangkokDate(new Date());
    const start = parse(from) ?? shiftDate(end, -(defaultDays - 1));

    // A range typed backwards is an operator slip, not an empty report.
    return start <= end ? { from: start, to: end } : { from: end, to: start };
  }

  /** The UTC instants an inclusive business-date range covers — for `period` echoes. */
  private windowOf(range: { from: string; to: string }) {
    return {
      from: bangkokDayRange(range.from).start.toISOString(),
      to: bangkokDayRange(range.to).end.toISOString(),
      businessDates: { from: range.from, to: range.to },
    };
  }

  /**
   * The bills the ledger filed in this range, with the dimensions the ledger does
   * not carry attached. One round-trip to the ledger, one to the orders table.
   */
  private async billsOf(restaurantId: string, tenantId: string, range: { from: string; to: string }) {
    const documents = await this.revenue.documents({
      ...this.scopeOf(restaurantId, tenantId),
      ...range,
    });

    const orderIds = [...new Set(documents.map((doc) => doc.sourceId))];
    const dimensions =
      orderIds.length > 0
        ? await this.prisma.order.findMany({
            where: { id: { in: orderIds }, tenantId },
            select: ORDER_DIMENSION_SELECT,
          })
        : [];

    return { documents, orderIds, bills: joinLedgerOrders(documents, dimensions) };
  }

  // ─── Revenue Summary ─────────────────────────────────────────────────────

  async getRevenueSummary(
    restaurantId: string,
    tenantId: string,
    query: { from?: string; to?: string; groupBy?: DayGrouping },
  ) {
    const { groupBy = 'day' } = query;
    const range = this.resolveRange(query.from, query.to, 30);
    const { documents, orderIds, bills } = await this.billsOf(restaurantId, tenantId, range);

    // The ledger already knows which business day each bill belongs to, so the
    // timeline buckets by that rather than re-deriving a day from `completedAt`.
    const grouped = new Map<
      string,
      {
        date: string;
        revenue: number;
        netRevenue: number;
        orders: number;
        tax: number;
        serviceCharge: number;
        discount: number;
      }
    >();

    for (const doc of documents) {
      const key = bucketOfDay(doc.businessDate, groupBy);
      const bucket = grouped.get(key) ?? {
        date: key,
        revenue: 0,
        netRevenue: 0,
        orders: 0,
        tax: 0,
        serviceCharge: 0,
        discount: 0,
      };

      bucket.revenue += doc.total;
      bucket.netRevenue += doc.net;
      bucket.orders += 1;
      bucket.tax += doc.tax;
      bucket.serviceCharge += doc.serviceCharge;
      bucket.discount += doc.discount;

      grouped.set(key, bucket);
    }

    const timeline = Array.from(grouped.values())
      .map((item) => ({
        ...item,
        revenue: round2(item.revenue),
        netRevenue: round2(item.netRevenue),
        tax: round2(item.tax),
        serviceCharge: round2(item.serviceCharge),
        discount: round2(item.discount),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const totals = sumTotals(bills);
    const totalRevenue = totals.totalCollected;
    // Distinct bills, not ledger rows: one reversed across days appears twice.
    const totalOrders = orderIds.length;

    const tally = (keyOf: (bill: (typeof bills)[number]) => string) => {
      const rows: Record<string, { count: number; total: number }> = {};
      for (const bill of bills) {
        const key = keyOf(bill);
        const row = (rows[key] ??= { count: 0, total: 0 });
        row.count += 1;
        row.total += Number(bill.total);
      }
      for (const key of Object.keys(rows)) rows[key].total = round2(rows[key].total);
      return rows;
    };

    return {
      summary: {
        totalRevenue,
        /** gross − discount: the figure accounting recognises, service charge and VAT excluded. */
        netRevenue: totals.netSales,
        totalOrders,
        averageOrderValue:
          totalOrders > 0 ? round2(totalRevenue / totalOrders) : 0,
        period: { ...this.windowOf(range), groupBy },
      },
      timeline,
      paymentBreakdown: tally((bill) => bill.paymentMethod ?? 'UNKNOWN'),
      orderTypeBreakdown: tally((bill) => bill.orderType),
    };
  }

  // ─── Daily Summary ────────────────────────────────────────────────────────

  /** Zeroed daily-summary payload — returned for empty days and as a safe fallback. */
  private emptyDailySummary(date: string) {
    return {
      date,
      revenue: { total: 0, netTotal: 0, averageOrderValue: 0 },
      orders: { total: 0, completed: 0, cancelled: 0, active: 0, billed: 0 },
      guests: { total: 0, averagePartySize: 0 },
      kitchen: { ordersCompleted: 0, avgPrepTimeSeconds: 0, avgPrepTimeMinutes: 0 },
      tables: { total: 0, occupied: 0, available: 0, cleaning: 0, totalCapacity: 0 },
    };
  }

  async getDailySummary(restaurantId: string, tenantId: string, date?: string) {
    // Guard against an invalid ?date= string — the old code fed it straight to
    // `toISOString()`, which throws a RangeError and surfaced as a 500.
    const targetDate = this.resolveRange(date, date, 1).to;

    try {
      return await this.buildDailySummary(restaurantId, tenantId, targetDate);
    } catch (error) {
      // This is a best-effort overview widget — never fail the whole page with a 500.
      this.logger.error(
        `getDailySummary failed for restaurant ${restaurantId} (tenant ${tenantId}): ${
          error instanceof Error ? error.message : error
        }`,
        error instanceof Error ? error.stack : undefined,
      );
      return this.emptyDailySummary(targetDate);
    }
  }

  private async buildDailySummary(restaurantId: string, tenantId: string, targetDate: string) {
    const { start: dayStart, end: dayEnd } = bangkokDayRange(targetDate);

    const [billed, openedOrders, kitchenStats, tableStats] = await Promise.all([
      this.billsOf(restaurantId, tenantId, { from: targetDate, to: targetDate }),
      // Operational counters key on createdAt: an order opened today and still
      // unpaid has no ledger row, and would otherwise be invisible on a screen
      // whose whole job is to show what is happening right now.
      this.prisma.order.findMany({
        where: { restaurantId, tenantId, createdAt: { gte: dayStart, lt: dayEnd } },
        select: { status: true },
      }),
      // Kitchen performance
      this.prisma.kitchenOrder.findMany({
        where: {
          tenantId,
          status: 'READY',
          completedAt: { gte: dayStart, lt: dayEnd },
          startedAt: { not: null },
          order: { restaurantId },
        },
        select: { startedAt: true, completedAt: true },
      }),
      // Table utilization
      this.prisma.restaurantTable.findMany({
        where: { restaurantId, tenantId, isActive: true },
        select: { id: true, capacity: true, status: true },
      }),
    ]);

    const totals = sumTotals(billed.bills);

    const avgPrepSeconds =
      kitchenStats.length > 0
        ? kitchenStats.reduce((sum, k) => {
            if (!k.startedAt || !k.completedAt) return sum;
            return sum + (k.completedAt.getTime() - k.startedAt.getTime()) / 1000;
          }, 0) / kitchenStats.length
        : 0;

    return {
      date: targetDate,
      revenue: {
        total: totals.totalCollected,
        /** gross − discount — what the ledger recognises as revenue. */
        netTotal: totals.netSales,
        averageOrderValue: totals.averageOrderValue,
      },
      orders: {
        total: openedOrders.length,
        completed: openedOrders.filter((o) => o.status === 'COMPLETED').length,
        cancelled: openedOrders.filter((o) => o.status === 'CANCELLED').length,
        active: openedOrders.filter((o) => !['COMPLETED', 'CANCELLED'].includes(o.status)).length,
        /** Bills the ledger filed under this day — may include one opened yesterday. */
        billed: billed.orderIds.length,
      },
      guests: {
        total: totals.guests,
        averagePartySize: totals.averagePartySize,
      },
      kitchen: {
        ordersCompleted: kitchenStats.length,
        avgPrepTimeSeconds: Math.round(avgPrepSeconds),
        avgPrepTimeMinutes: Math.round(avgPrepSeconds / 60),
      },
      tables: {
        total: tableStats.length,
        occupied: tableStats.filter((t) => t.status === 'OCCUPIED').length,
        available: tableStats.filter((t) => t.status === 'AVAILABLE').length,
        cleaning: tableStats.filter((t) => t.status === 'CLEANING').length,
        totalCapacity: tableStats.reduce((sum, t) => sum + t.capacity, 0),
      },
    };
  }

  // ─── Top Menu Items ───────────────────────────────────────────────────────

  /**
   * What sold, by menu item.
   *
   * `revenue` here is the sum of the order lines, which is a menu-mix figure and
   * deliberately NOT the ledger's revenue: a bill-level discount belongs to the
   * bill, not to any one dish, so the lines add up to more than the ledger
   * recognised. The bill set is still the ledger's, so the same day's dishes and
   * takings are drawn from the same receipts.
   */
  async getTopMenuItems(
    restaurantId: string,
    tenantId: string,
    query: { from?: string; to?: string; limit?: number },
  ) {
    const { limit = 10 } = query;
    const range = this.resolveRange(query.from, query.to, 30);

    const documents = await this.revenue.documents({
      ...this.scopeOf(restaurantId, tenantId),
      ...range,
    });
    const orderIds = [...new Set(documents.map((doc) => doc.sourceId))];
    if (orderIds.length === 0) return [];

    const items = await this.prisma.orderItem.findMany({
      where: {
        order: { id: { in: orderIds }, tenantId },
        status: { not: 'CANCELLED' },
      },
      select: {
        quantity: true,
        unitPrice: true,
        totalPrice: true,
        menuItem: {
          select: {
            id: true,
            name: true,
            category: { select: { id: true, name: true } },
          },
        },
      },
    });

    // Aggregate by menu item
    const itemMap = new Map<
      string,
      {
        menuItemId: string;
        name: string;
        category: string;
        quantity: number;
        revenue: number;
        orderCount: number;
      }
    >();

    for (const item of items) {
      const key = item.menuItem.id;
      const existing = itemMap.get(key) ?? {
        menuItemId: key,
        name: item.menuItem.name,
        category: item.menuItem.category?.name ?? 'Uncategorized',
        quantity: 0,
        revenue: 0,
        orderCount: 0,
      };

      existing.quantity += item.quantity;
      existing.revenue += Number(item.totalPrice);
      existing.orderCount += 1;
      itemMap.set(key, existing);
    }

    return Array.from(itemMap.values())
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, limit)
      .map((item) => ({ ...item, revenue: round2(item.revenue) }));
  }

  // ─── Table Utilization ────────────────────────────────────────────────────

  async getTableUtilization(
    restaurantId: string,
    tenantId: string,
    query: { from?: string; to?: string },
  ) {
    const range = this.resolveRange(query.from, query.to, 7);

    const documents = await this.revenue.documents({
      ...this.scopeOf(restaurantId, tenantId),
      ...range,
    });
    // One row per bill even when it was reversed on a later day, or a table's
    // takings would count the same receipt twice.
    const money = moneyBySource(documents);
    const orderIds = [...money.keys()];

    const [tables, billedOrders] = await Promise.all([
      this.prisma.restaurantTable.findMany({
        where: { restaurantId, tenantId, isActive: true },
        select: { id: true, tableNumber: true, capacity: true, zone: true },
        orderBy: { tableNumber: 'asc' },
      }),
      orderIds.length > 0
        ? this.prisma.order.findMany({
            where: { id: { in: orderIds }, tenantId, tableId: { not: null } },
            select: {
              id: true,
              tableId: true,
              partySize: true,
              createdAt: true,
              completedAt: true,
            },
          })
        : Promise.resolve([]),
    ]);

    const tableStats = tables.map((table) => {
      const tableOrders = billedOrders.filter((o) => o.tableId === table.id);
      const totalRevenue = tableOrders.reduce((sum, o) => sum + (money.get(o.id)?.total ?? 0), 0);
      const totalGuests = tableOrders.reduce((sum, o) => sum + (o.partySize ?? 1), 0);

      const avgTurnoverMinutes =
        tableOrders.length > 0
          ? tableOrders.reduce((sum, o) => {
              if (!o.completedAt) return sum;
              return sum + (o.completedAt.getTime() - o.createdAt.getTime()) / 60000;
            }, 0) / tableOrders.length
          : 0;

      return {
        tableId: table.id,
        tableNumber: table.tableNumber,
        zone: table.zone,
        capacity: table.capacity,
        ordersServed: tableOrders.length,
        totalRevenue: round2(totalRevenue),
        totalGuests,
        avgTurnoverMinutes: Math.round(avgTurnoverMinutes),
        revenuePerSeat: table.capacity > 0 ? round2(totalRevenue / table.capacity) : 0,
      };
    });

    return {
      period: this.windowOf(range),
      tables: tableStats,
      totals: {
        totalTables: tables.length,
        // Every billed order in the range, including takeaway ones that never
        // sat at a table — the per-table rows above will not add up to this.
        totalOrders: orderIds.length,
        totalRevenue: round2(
          [...money.values()].reduce((sum, bill) => sum + bill.total, 0),
        ),
      },
    };
  }

  // ─── Hourly Heatmap ───────────────────────────────────────────────────────

  async getHourlyHeatmap(
    restaurantId: string,
    tenantId: string,
    query: { from?: string; to?: string },
  ) {
    const range = this.resolveRange(query.from, query.to, 14);
    const { bills } = await this.billsOf(restaurantId, tenantId, range);

    // Build 7x24 grid: [dayOfWeek][hour]
    const grid = new Map<string, { day: number; hour: number; orders: number; revenue: number }>();
    for (let day = 0; day < 7; day++) {
      for (let hour = 0; hour < 24; hour++) {
        grid.set(`${day}:${hour}`, { day, hour, orders: 0, revenue: 0 });
      }
    }

    for (const bill of bills) {
      // The weekday comes from the business date the bill was filed under, the
      // hour from the Bangkok clock when it closed. A bill closed after midnight
      // but belonging to the previous trading day therefore stays on that day.
      if (!bill.completedAt) continue;
      const cell = grid.get(
        `${businessDateOf(bill.businessDate).getUTCDay()}:${bangkokHour(bill.completedAt)}`,
      );
      if (!cell) continue;
      cell.orders += 1;
      cell.revenue += Number(bill.total);
    }

    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    return {
      period: this.windowOf(range),
      heatmap: [...grid.values()]
        .filter((c) => c.orders > 0)
        .map((c) => ({
          ...c,
          dayName: dayNames[c.day],
          revenue: round2(c.revenue),
        })),
    };
  }
}
