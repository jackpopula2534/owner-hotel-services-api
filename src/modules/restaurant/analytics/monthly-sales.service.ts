import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  PAID_ORDER_SELECT,
  SOLD_ITEM_SELECT,
  type PaidOrderRow,
  type SalesBreakdownRow,
  type SalesOperations,
  type SalesTopItem,
  type SalesTotals,
  bangkokMonthRange,
  breakdown,
  countOperations,
  daysOfMonth,
  rankTopItems,
  round2,
  shiftMonth,
  sumTotals,
  toBangkokDate,
  toBangkokMonth,
} from './sales-shared';

export interface MonthlySalesDay {
  /** Bangkok calendar day, 'YYYY-MM-DD' — the key the day drill-down is opened with. */
  date: string;
  orders: number;
  guests: number;
  netSales: number;
  totalCollected: number;
}

export interface MonthlySalesReport {
  restaurant: { id: string; name: string };
  /** Bangkok calendar month this report covers, 'YYYY-MM'. */
  month: string;
  /** The exact UTC instants queried — lets the UI prove which window it is showing. */
  range: { start: string; end: string };
  totals: SalesTotals;
  pace: {
    /** Days in the month that actually took money — the divisor for a fair daily average. */
    activeDays: number;
    /** Calendar days in the month, so the UI can say "12 จาก 31 วัน". */
    calendarDays: number;
    averageDailySales: number;
    bestDay: { date: string; totalCollected: number } | null;
  };
  comparison: {
    previousMonth: string;
    totalCollected: number;
    changeAmount: number;
    /** null when the previous month took nothing — growth from zero is undefined, not 100%. */
    changePct: number | null;
  };
  /** One row per calendar day of the month, zeros included — a quiet Tuesday is information. */
  days: MonthlySalesDay[];
  paymentBreakdown: SalesBreakdownRow[];
  orderTypeBreakdown: SalesBreakdownRow[];
  topItems: SalesTopItem[];
  operations: SalesOperations;
}

/**
 * Monthly revenue report for a single outlet — the default overview of the
 * "สรุปรายได้ร้านอาหาร" screen, from which a manager clicks a day to drill into
 * RestaurantDailySalesService.
 *
 * Same filters as the daily report (COMPLETED **and** PAID, keyed on
 * `completedAt`, Bangkok calendar) so that the sum of the day rows shown here is
 * exactly what each day's drill-down reports — an overview that did not add up
 * to its own detail would be worse than no overview.
 */
@Injectable()
export class RestaurantMonthlySalesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve the requested month to a Bangkok calendar month.
   *
   * Accepts 'YYYY-MM' (what `<input type="month">` sends) and, for convenience,
   * a full 'YYYY-MM-DD' whose month is used. Anything else falls back to the
   * current Bangkok month.
   */
  private resolveMonth(month?: string): string {
    if (month && /^\d{4}-(0[1-9]|1[0-2])(-\d{2})?$/.test(month)) {
      return month.slice(0, 7);
    }
    return toBangkokMonth(new Date());
  }

  async getMonthlySales(
    restaurantId: string,
    tenantId: string,
    month?: string,
  ): Promise<MonthlySalesReport> {
    // findFirst + tenantId, never findUnique by id — an outlet id from another
    // tenant must read as "not found", not as an empty report.
    const restaurant = await this.prisma.restaurant.findFirst({
      where: { id: restaurantId, tenantId },
      select: { id: true, name: true },
    });
    if (!restaurant) {
      throw new NotFoundException(`Restaurant ${restaurantId} not found`);
    }

    const targetMonth = this.resolveMonth(month);
    const { start: monthStart, end: monthEnd } = bangkokMonthRange(targetMonth);
    const previousMonth = shiftMonth(targetMonth, -1);
    const { start: previousStart } = bangkokMonthRange(previousMonth);

    const [paidOrders, openedOrders, items] = await Promise.all([
      // This month and the one before it in one pass, split in memory — the
      // comparison figure is one number and does not deserve a second round trip.
      this.prisma.order.findMany({
        where: {
          restaurantId,
          tenantId,
          status: 'COMPLETED',
          paymentStatus: 'PAID',
          completedAt: { gte: previousStart, lt: monthEnd },
        },
        select: PAID_ORDER_SELECT,
      }),
      // Operational counters key on createdAt: an order opened but still unpaid
      // has no completedAt, and would otherwise be invisible.
      this.prisma.order.findMany({
        where: { restaurantId, tenantId, createdAt: { gte: monthStart, lt: monthEnd } },
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
            completedAt: { gte: monthStart, lt: monthEnd },
          },
        },
        select: SOLD_ITEM_SELECT,
      }),
    ]);

    const current = paidOrders.filter((o) => o.completedAt && o.completedAt >= monthStart);
    const previous = paidOrders.filter((o) => o.completedAt && o.completedAt < monthStart);

    const totals = sumTotals(current);
    const previousCollected = round2(previous.reduce((sum, o) => sum + Number(o.total), 0));
    const changeAmount = round2(totals.totalCollected - previousCollected);

    const days = this.daily(current, targetMonth);
    const active = days.filter((day) => day.orders > 0);
    const bestDay = active.reduce<MonthlySalesDay | null>(
      (best, day) => (!best || day.totalCollected > best.totalCollected ? day : best),
      null,
    );

    return {
      restaurant,
      month: targetMonth,
      range: { start: monthStart.toISOString(), end: monthEnd.toISOString() },
      totals,
      pace: {
        activeDays: active.length,
        calendarDays: days.length,
        // Divided by trading days, not calendar days: a month that is half over
        // (or an outlet closed on Mondays) would otherwise read as a slump.
        averageDailySales:
          active.length > 0 ? round2(totals.totalCollected / active.length) : 0,
        bestDay: bestDay
          ? { date: bestDay.date, totalCollected: bestDay.totalCollected }
          : null,
      },
      comparison: {
        previousMonth,
        totalCollected: previousCollected,
        changeAmount,
        changePct:
          previousCollected > 0 ? round2((changeAmount / previousCollected) * 100) : null,
      },
      days,
      paymentBreakdown: breakdown(current, (o) => o.paymentMethod ?? 'UNKNOWN', totals),
      orderTypeBreakdown: breakdown(current, (o) => o.orderType, totals),
      topItems: rankTopItems(items, 10),
      operations: countOperations(openedOrders),
    };
  }

  /**
   * One row per calendar day, pre-seeded with zeros. A day with no sales must
   * still be present and clickable — the drill-down explaining "no bills were
   * settled" is a real answer, and a gap-free axis keeps months comparable.
   */
  private daily(orders: PaidOrderRow[], month: string): MonthlySalesDay[] {
    const grid = new Map<string, MonthlySalesDay>(
      daysOfMonth(month).map((date) => [
        date,
        { date, orders: 0, guests: 0, netSales: 0, totalCollected: 0 },
      ]),
    );

    for (const order of orders) {
      if (!order.completedAt) continue;
      const row = grid.get(toBangkokDate(order.completedAt));
      if (!row) continue;
      row.orders += 1;
      row.guests += order.partySize ?? 1;
      row.netSales += Number(order.subtotal) - Number(order.discount ?? 0);
      row.totalCollected += Number(order.total);
    }

    return Array.from(grid.values()).map((row) => ({
      ...row,
      netSales: round2(row.netSales),
      totalCollected: round2(row.totalCollected),
    }));
  }
}
