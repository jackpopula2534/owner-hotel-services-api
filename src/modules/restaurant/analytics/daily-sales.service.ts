import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  DAY_MS,
  PAID_ORDER_SELECT,
  SOLD_ITEM_SELECT,
  type SalesBreakdownRow,
  type SalesOperations,
  type SalesTopItem,
  type SalesTotals,
  bangkokDayRange,
  bangkokHour,
  breakdown,
  countOperations,
  rankTopItems,
  round2,
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
 * filters are deliberately fixed (COMPLETED **and** PAID, keyed on `completedAt`)
 * rather than varying per metric the way the older endpoints do. And it works in
 * Bangkok calendar days rather than server-local ones, so a report pulled from a
 * UTC container matches one pulled from a Thai laptop.
 */
@Injectable()
export class RestaurantDailySalesService {
  constructor(private readonly prisma: PrismaService) {}

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
    const previousDate = toBangkokDate(new Date(dayStart.getTime() - 1));
    const previousStart = new Date(dayStart.getTime() - DAY_MS);

    const [paidOrders, openedOrders, items] = await Promise.all([
      // Both days in one pass, split in memory — the comparison figure is one
      // number and does not deserve a second round trip.
      this.prisma.order.findMany({
        where: {
          restaurantId,
          tenantId,
          status: 'COMPLETED',
          paymentStatus: 'PAID',
          completedAt: { gte: previousStart, lt: dayEnd },
        },
        select: PAID_ORDER_SELECT,
      }),
      // Operational counters key on createdAt: an order opened today but still
      // unpaid has no completedAt, and would otherwise be invisible.
      this.prisma.order.findMany({
        where: { restaurantId, tenantId, createdAt: { gte: dayStart, lt: dayEnd } },
        select: { status: true },
      }),
      this.prisma.orderItem.findMany({
        where: {
          status: { not: 'CANCELLED' },
          order: {
            restaurantId,
            tenantId,
            status: 'COMPLETED',
            paymentStatus: 'PAID',
            completedAt: { gte: dayStart, lt: dayEnd },
          },
        },
        select: SOLD_ITEM_SELECT,
      }),
    ]);

    const today = paidOrders.filter((o) => o.completedAt && o.completedAt >= dayStart);
    const previous = paidOrders.filter((o) => o.completedAt && o.completedAt < dayStart);

    const totals = sumTotals(today);
    const previousCollected = round2(previous.reduce((sum, o) => sum + Number(o.total), 0));
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

  private hourly(
    orders: { total: unknown; completedAt: Date | null }[],
  ): DailySalesReport['hourly'] {
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
