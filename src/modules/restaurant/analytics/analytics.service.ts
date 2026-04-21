import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class RestaurantAnalyticsService {
  private readonly logger = new Logger(RestaurantAnalyticsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── Revenue Summary ─────────────────────────────────────────────────────

  async getRevenueSummary(
    restaurantId: string,
    tenantId: string,
    query: { from?: string; to?: string; groupBy?: 'day' | 'week' | 'month' },
  ) {
    const { from, to, groupBy = 'day' } = query;

    const fromDate = from
      ? new Date(from)
      : new Date(new Date().setDate(new Date().getDate() - 30));
    const toDate = to ? new Date(to) : new Date();
    toDate.setHours(23, 59, 59, 999);

    const completedOrders = await this.prisma.order.findMany({
      where: {
        restaurantId,
        tenantId,
        status: 'COMPLETED',
        paymentStatus: 'PAID',
        completedAt: { gte: fromDate, lte: toDate },
      },
      select: {
        total: true,
        subtotal: true,
        taxAmount: true,
        serviceCharge: true,
        discount: true,
        paymentMethod: true,
        completedAt: true,
        orderType: true,
      },
      orderBy: { completedAt: 'asc' },
    });

    // Group by date period
    const grouped = new Map<
      string,
      {
        date: string;
        revenue: number;
        orders: number;
        tax: number;
        serviceCharge: number;
        discount: number;
      }
    >();

    for (const order of completedOrders) {
      const date = order.completedAt!;
      let key: string;

      if (groupBy === 'month') {
        key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      } else if (groupBy === 'week') {
        const weekStart = new Date(date);
        weekStart.setDate(date.getDate() - date.getDay());
        key = weekStart.toISOString().split('T')[0];
      } else {
        key = date.toISOString().split('T')[0];
      }

      const existing = grouped.get(key) ?? {
        date: key,
        revenue: 0,
        orders: 0,
        tax: 0,
        serviceCharge: 0,
        discount: 0,
      };

      existing.revenue += Number(order.total);
      existing.orders += 1;
      existing.tax += Number(order.taxAmount ?? 0);
      existing.serviceCharge += Number(order.serviceCharge ?? 0);
      existing.discount += Number(order.discount ?? 0);

      grouped.set(key, existing);
    }

    const timeline = Array.from(grouped.values()).map((item) => ({
      ...item,
      revenue: Math.round(item.revenue * 100) / 100,
      tax: Math.round(item.tax * 100) / 100,
      serviceCharge: Math.round(item.serviceCharge * 100) / 100,
      discount: Math.round(item.discount * 100) / 100,
    }));

    // Payment method breakdown
    const paymentBreakdown: Record<string, { count: number; total: number }> = {};
    for (const order of completedOrders) {
      const method = order.paymentMethod ?? 'UNKNOWN';
      if (!paymentBreakdown[method]) paymentBreakdown[method] = { count: 0, total: 0 };
      paymentBreakdown[method].count += 1;
      paymentBreakdown[method].total += Number(order.total);
    }

    // Order type breakdown
    const typeBreakdown: Record<string, { count: number; total: number }> = {};
    for (const order of completedOrders) {
      const type = order.orderType;
      if (!typeBreakdown[type]) typeBreakdown[type] = { count: 0, total: 0 };
      typeBreakdown[type].count += 1;
      typeBreakdown[type].total += Number(order.total);
    }

    const totalRevenue = completedOrders.reduce((sum, o) => sum + Number(o.total), 0);
    const totalOrders = completedOrders.length;

    return {
      summary: {
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        totalOrders,
        averageOrderValue:
          totalOrders > 0 ? Math.round((totalRevenue / totalOrders) * 100) / 100 : 0,
        period: { from: fromDate.toISOString(), to: toDate.toISOString(), groupBy },
      },
      timeline,
      paymentBreakdown,
      orderTypeBreakdown: typeBreakdown,
    };
  }

  // ─── Daily Summary ────────────────────────────────────────────────────────

  async getDailySummary(restaurantId: string, tenantId: string, date?: string) {
    const targetDate = date ? new Date(date) : new Date();
    const dayStart = new Date(targetDate);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(targetDate);
    dayEnd.setHours(23, 59, 59, 999);

    const [orders, kitchenStats, tableStats] = await Promise.all([
      this.prisma.order.findMany({
        where: {
          restaurantId,
          tenantId,
          createdAt: { gte: dayStart, lte: dayEnd },
        },
        select: {
          status: true,
          paymentStatus: true,
          total: true,
          orderType: true,
          partySize: true,
          paymentMethod: true,
        },
      }),
      // Kitchen performance
      this.prisma.kitchenOrder.findMany({
        where: {
          tenantId,
          status: 'READY',
          completedAt: { gte: dayStart, lte: dayEnd },
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

    const completedOrders = orders.filter(
      (o) => o.status === 'COMPLETED' && o.paymentStatus === 'PAID',
    );
    const cancelledOrders = orders.filter((o) => o.status === 'CANCELLED');
    const activeOrders = orders.filter((o) => !['COMPLETED', 'CANCELLED'].includes(o.status));

    const totalRevenue = completedOrders.reduce((sum, o) => sum + Number(o.total), 0);
    const totalGuests = completedOrders.reduce((sum, o) => sum + (o.partySize ?? 1), 0);

    const avgPrepSeconds =
      kitchenStats.length > 0
        ? kitchenStats.reduce((sum, k) => {
            if (!k.startedAt || !k.completedAt) return sum;
            return sum + (k.completedAt.getTime() - k.startedAt.getTime()) / 1000;
          }, 0) / kitchenStats.length
        : 0;

    return {
      date: targetDate.toISOString().split('T')[0],
      revenue: {
        total: Math.round(totalRevenue * 100) / 100,
        averageOrderValue:
          completedOrders.length > 0
            ? Math.round((totalRevenue / completedOrders.length) * 100) / 100
            : 0,
      },
      orders: {
        total: orders.length,
        completed: completedOrders.length,
        cancelled: cancelledOrders.length,
        active: activeOrders.length,
      },
      guests: {
        total: totalGuests,
        averagePartySize:
          completedOrders.length > 0
            ? Math.round((totalGuests / completedOrders.length) * 10) / 10
            : 0,
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

  async getTopMenuItems(
    restaurantId: string,
    tenantId: string,
    query: { from?: string; to?: string; limit?: number },
  ) {
    const { from, to, limit = 10 } = query;

    const fromDate = from
      ? new Date(from)
      : new Date(new Date().setDate(new Date().getDate() - 30));
    const toDate = to ? new Date(to) : new Date();
    toDate.setHours(23, 59, 59, 999);

    const items = await this.prisma.orderItem.findMany({
      where: {
        order: {
          restaurantId,
          tenantId,
          status: 'COMPLETED',
          completedAt: { gte: fromDate, lte: toDate },
        },
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
      .map((item) => ({
        ...item,
        revenue: Math.round(item.revenue * 100) / 100,
      }));
  }

  // ─── Table Utilization ────────────────────────────────────────────────────

  async getTableUtilization(
    restaurantId: string,
    tenantId: string,
    query: { from?: string; to?: string },
  ) {
    const { from, to } = query;

    const fromDate = from ? new Date(from) : new Date(new Date().setDate(new Date().getDate() - 7));
    const toDate = to ? new Date(to) : new Date();
    toDate.setHours(23, 59, 59, 999);

    const [tables, completedOrders] = await Promise.all([
      this.prisma.restaurantTable.findMany({
        where: { restaurantId, tenantId, isActive: true },
        select: { id: true, tableNumber: true, capacity: true, zone: true },
        orderBy: { tableNumber: 'asc' },
      }),
      this.prisma.order.findMany({
        where: {
          restaurantId,
          tenantId,
          status: 'COMPLETED',
          tableId: { not: null },
          completedAt: { gte: fromDate, lte: toDate },
        },
        select: {
          tableId: true,
          total: true,
          partySize: true,
          createdAt: true,
          completedAt: true,
        },
      }),
    ]);

    const tableStats = tables.map((table) => {
      const tableOrders = completedOrders.filter((o) => o.tableId === table.id);
      const totalRevenue = tableOrders.reduce((sum, o) => sum + Number(o.total), 0);
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
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        totalGuests,
        avgTurnoverMinutes: Math.round(avgTurnoverMinutes),
        revenuePerSeat:
          table.capacity > 0 ? Math.round((totalRevenue / table.capacity) * 100) / 100 : 0,
      };
    });

    return {
      period: { from: fromDate.toISOString(), to: toDate.toISOString() },
      tables: tableStats,
      totals: {
        totalTables: tables.length,
        totalOrders: completedOrders.length,
        totalRevenue:
          Math.round(completedOrders.reduce((s, o) => s + Number(o.total), 0) * 100) / 100,
      },
    };
  }

  // ─── Hourly Heatmap ───────────────────────────────────────────────────────

  async getHourlyHeatmap(
    restaurantId: string,
    tenantId: string,
    query: { from?: string; to?: string },
  ) {
    const { from, to } = query;

    const fromDate = from
      ? new Date(from)
      : new Date(new Date().setDate(new Date().getDate() - 14));
    const toDate = to ? new Date(to) : new Date();
    toDate.setHours(23, 59, 59, 999);

    const orders = await this.prisma.order.findMany({
      where: {
        restaurantId,
        tenantId,
        status: 'COMPLETED',
        completedAt: { gte: fromDate, lte: toDate },
      },
      select: { completedAt: true, total: true },
    });

    // Build 7x24 grid: [dayOfWeek][hour]
    const grid: { day: number; hour: number; orders: number; revenue: number }[] = [];

    for (let day = 0; day < 7; day++) {
      for (let hour = 0; hour < 24; hour++) {
        grid.push({ day, hour, orders: 0, revenue: 0 });
      }
    }

    for (const order of orders) {
      if (!order.completedAt) continue;
      const day = order.completedAt.getDay();
      const hour = order.completedAt.getHours();
      const cell = grid.find((c) => c.day === day && c.hour === hour);
      if (cell) {
        cell.orders += 1;
        cell.revenue += Number(order.total);
      }
    }

    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    return {
      period: { from: fromDate.toISOString(), to: toDate.toISOString() },
      heatmap: grid
        .filter((c) => c.orders > 0)
        .map((c) => ({
          ...c,
          dayName: dayNames[c.day],
          revenue: Math.round(c.revenue * 100) / 100,
        })),
    };
  }
}
