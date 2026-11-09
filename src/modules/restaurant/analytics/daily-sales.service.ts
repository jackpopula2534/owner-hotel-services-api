import { Injectable, NotFoundException } from '@nestjs/common';
import { RevenueSourceModule } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { RevenueQueryService } from '../../revenue/revenue-query.service';
import {
  ORDER_DIMENSION_SELECT,
  SOLD_ITEM_SELECT,
  type LedgerOrderRow,
  type SalesBreakdownRow,
  type SalesOperations,
  type SalesTopItem,
  type SalesTotals,
  bangkokDayRange,
  bangkokHour,
  breakdown,
  countOperations,
  joinLedgerOrders,
  rankTopItems,
  round2,
  shiftDate,
  sumTotals,
  toBangkokDate,
} from './sales-shared';

/** Re-exported under their original names — the daily report was the first consumer. */
export type DailySalesTotals = SalesTotals;
export type DailySalesBreakdownRow = SalesBreakdownRow;

export interface DailySalesReport {
  restaurant: { id: string; name: string };
  /** Bangkok calendar day this report covers, 'YYYY-MM-DD'. */
  date: string;
  /** The exact UTC instants queried — lets the UI prove which window it is showing. */
  range: { start: string; end: string };
  totals: DailySalesTotals;
  comparison: {
    previousDate: string;
    totalCollected: number;
    changeAmount: number;
    /** null when the previous day took nothing — growth from zero is undefined, not 100%. */
    changePct: number | null;
  };
  paymentBreakdown: DailySalesBreakdownRow[];
  orderTypeBreakdown: DailySalesBreakdownRow[];
  /** Always 24 rows, hour 0–23 in Bangkok time, so the chart never has gaps. */
  hourly: { hour: number; orders: number; amount: number }[];
  topItems: SalesTopItem[];
  operations: SalesOperations;
}

/**
 * Daily revenue report for a single outlet — the day drill-down of the
 * "สรุปรายได้ร้านอาหาร" screen in the main system.
 *
 * Kept apart from RestaurantAnalyticsService for two reasons. It is the only
 * analytic that must reconcile line-for-line with the printed receipt, so its
 * bill set is deliberately fixed rather than varying per metric the way the older
 * endpoints do. And it works in Bangkok calendar days rather than server-local
 * ones, so a report pulled from a UTC container matches one pulled from a Thai
 * laptop.
 *
 * Every money figure comes from the revenue ledger, keyed on the business date
 * the bill was filed under. The orders table is still read — but only for what
 * the ledger does not store (party size, order type, payment method, the hour the
 * bill closed) and only for the bills the ledger already listed. That way this
 * screen, the Command Center and accounting cannot drift apart: a bill that
 * failed to post is missing from all three at once instead of from one.
 */
@Injectable()
export class RestaurantDailySalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly revenue: RevenueQueryService,
  ) {}

  /**
   * Resolve the requested day to a Bangkok calendar date.
   *
   * Accepts a plain 'YYYY-MM-DD' (what the date picker sends) and treats it as a
   * Bangkok date verbatim — parsing it as an instant first would shift it a day
   * backwards for anyone east of UTC. Anything else falls back to today.
   */
  private resolveDate(date?: string): string {
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      const probe = new Date(`${date}T00:00:00.000Z`);
      if (!Number.isNaN(probe.getTime())) return date;
    }
    return toBangkokDate(new Date());
  }

  async getDailySales(
    restaurantId: string,
    tenantId: string,
    date?: string,
  ): Promise<DailySalesReport> {
    // findFirst + tenantId, never findUnique by id — an outlet id from another
    // tenant must read as "not found", not as an empty report.
    const restaurant = await this.prisma.restaurant.findFirst({
      where: { id: restaurantId, tenantId },
      select: { id: true, name: true },
    });
    if (!restaurant) {
      throw new NotFoundException(`Restaurant ${restaurantId} not found`);
    }

    const targetDate = this.resolveDate(date);
    const { start: dayStart, end: dayEnd } = bangkokDayRange(targetDate);
    const previousDate = shiftDate(targetDate, -1);

    const scope = {
      tenantId,
      outletId: restaurantId,
      sourceModule: RevenueSourceModule.RESTAURANT,
    };

    const [documents, previousTotals, openedOrders] = await Promise.all([
      this.revenue.documents({ ...scope, from: targetDate, to: targetDate }),
      this.revenue.totals({ ...scope, from: previousDate, to: previousDate }),
      // Operational counters key on createdAt: an order opened today but still
      // unpaid has no ledger row, and would otherwise be invisible.
      this.prisma.order.findMany({
        where: { restaurantId, tenantId, createdAt: { gte: dayStart, lt: dayEnd } },
        select: { status: true },
      }),
    ]);

    // Only the bills the ledger filed under this day — no second opinion about
    // which orders count as sold.
    const orderIds = [...new Set(documents.map((doc) => doc.sourceId))];

    const [dimensions, items] = await Promise.all([
      orderIds.length > 0
        ? this.prisma.order.findMany({
            where: { id: { in: orderIds }, tenantId },
            select: ORDER_DIMENSION_SELECT,
          })
        : Promise.resolve([]),
      orderIds.length > 0
        ? this.prisma.orderItem.findMany({
            where: { status: { not: 'CANCELLED' }, order: { id: { in: orderIds }, tenantId } },
            select: SOLD_ITEM_SELECT,
          })
        : Promise.resolve([]),
    ]);

    const today = joinLedgerOrders(documents, dimensions);

    const totals = sumTotals(today);
    const previousCollected = previousTotals.total;
    const changeAmount = round2(totals.totalCollected - previousCollected);

    return {
      restaurant,
      date: targetDate,
      range: { start: dayStart.toISOString(), end: dayEnd.toISOString() },
      totals,
      comparison: {
        previousDate,
        totalCollected: previousCollected,
        changeAmount,
        changePct:
          previousCollected > 0 ? round2((changeAmount / previousCollected) * 100) : null,
      },
      paymentBreakdown: breakdown(today, (o) => o.paymentMethod ?? 'UNKNOWN', totals),
      orderTypeBreakdown: breakdown(today, (o) => o.orderType, totals),
      hourly: this.hourly(today),
      topItems: rankTopItems(items, 10),
      operations: countOperations(openedOrders),
    };
  }

  /**
   * The bill's own closing time decides its column — a bill the ledger filed
   * under today but whose order row is gone has no hour to stand in, so it is
   * left out of the chart rather than parked in hour 0. Its money still counts
   * in the totals above.
   */
  private hourly(orders: LedgerOrderRow[]): DailySalesReport['hourly'] {
    const grid = Array.from({ length: 24 }, (_, hour) => ({ hour, orders: 0, amount: 0 }));

    for (const order of orders) {
      if (!order.completedAt) continue;
      const cell = grid[bangkokHour(order.completedAt)];
      cell.orders += 1;
      cell.amount += Number(order.total);
    }

    return grid.map((cell) => ({ ...cell, amount: round2(cell.amount) }));
  }
}
