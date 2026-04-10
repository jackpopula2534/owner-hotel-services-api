import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { OrderItemStatus, KitchenPriority } from '@prisma/client';

@Injectable()
export class KitchenService {
  private readonly logger = new Logger(KitchenService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── Kitchen Queue ────────────────────────────────────────────────────────

  async getActiveOrders(restaurantId: string, tenantId: string) {
    const kitchenOrders = await this.prisma.kitchenOrder.findMany({
      where: {
        tenantId,
        status: { in: ['SENT', 'PREPARING'] },
        order: { restaurantId },
      },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
      include: {
        order: {
          include: {
            table: { select: { tableNumber: true, zone: true } },
            items: {
              where: { status: { in: ['SENT', 'PREPARING', 'READY'] } },
              include: {
                menuItem: {
                  select: { id: true, name: true, preparationTime: true, image: true },
                },
              },
              orderBy: { createdAt: 'asc' },
            },
          },
        },
      },
    });

    return kitchenOrders.map((ko) => ({
      kitchenOrderId: ko.id,
      orderId: ko.orderId,
      orderNumber: ko.order.orderNumber,
      orderType: ko.order.orderType,
      tableNumber: ko.order.table?.tableNumber,
      zone: ko.order.table?.zone,
      guestName: ko.order.guestName,
      guestRoom: ko.order.guestRoom,
      priority: ko.priority,
      status: ko.status,
      stationName: ko.stationName,
      notes: ko.notes,
      items: ko.order.items,
      createdAt: ko.createdAt,
      startedAt: ko.startedAt,
      elapsedSeconds: ko.startedAt
        ? Math.floor((Date.now() - ko.startedAt.getTime()) / 1000)
        : Math.floor((Date.now() - ko.createdAt.getTime()) / 1000),
    }));
  }

  async startOrder(restaurantId: string, kitchenOrderId: string, tenantId: string) {
    const kitchenOrder = await this.findKitchenOrderOrFail(
      kitchenOrderId,
      restaurantId,
      tenantId,
    );

    if (kitchenOrder.status !== 'SENT') {
      throw new BadRequestException(`Kitchen order is already ${kitchenOrder.status}`);
    }

    const [updated] = await this.prisma.$transaction([
      this.prisma.kitchenOrder.update({
        where: { id: kitchenOrderId },
        data: { status: 'PREPARING', startedAt: new Date() },
      }),
      this.prisma.orderItem.updateMany({
        where: { orderId: kitchenOrder.orderId, status: 'SENT' },
        data: { status: 'PREPARING' },
      }),
    ]);

    return updated;
  }

  async completeOrder(restaurantId: string, kitchenOrderId: string, tenantId: string) {
    const kitchenOrder = await this.findKitchenOrderOrFail(
      kitchenOrderId,
      restaurantId,
      tenantId,
    );

    if (!['SENT', 'PREPARING'].includes(kitchenOrder.status)) {
      throw new BadRequestException(`Kitchen order is already ${kitchenOrder.status}`);
    }

    const now = new Date();

    await this.prisma.$transaction([
      this.prisma.kitchenOrder.update({
        where: { id: kitchenOrderId },
        data: { status: 'READY', completedAt: now },
      }),
      this.prisma.orderItem.updateMany({
        where: { orderId: kitchenOrder.orderId, status: { in: ['SENT', 'PREPARING'] } },
        data: { status: 'READY', preparedAt: now },
      }),
      this.prisma.order.update({
        where: { id: kitchenOrder.orderId },
        data: { status: 'READY' },
      }),
    ]);

    return this.prisma.kitchenOrder.findUnique({ where: { id: kitchenOrderId } });
  }

  async updateItemStatus(
    restaurantId: string,
    itemId: string,
    status: OrderItemStatus,
    tenantId: string,
  ) {
    const item = await this.prisma.orderItem.findFirst({
      where: { id: itemId },
      include: { order: true },
    });

    if (!item || item.order.restaurantId !== restaurantId || item.order.tenantId !== tenantId) {
      throw new NotFoundException(`Order item ${itemId} not found`);
    }

    const validStatuses = ['PREPARING', 'READY', 'SERVED', 'CANCELLED'];
    if (!validStatuses.includes(status)) {
      throw new BadRequestException(`Invalid item status: ${status}`);
    }

    const now = new Date();
    const timestamps: Record<string, Date> = {};
    if (status === 'READY') timestamps.preparedAt = now;
    if (status === 'SERVED') timestamps.servedAt = now;

    return this.prisma.orderItem.update({
      where: { id: itemId },
      data: { status, ...timestamps },
    });
  }

  async setPriority(
    restaurantId: string,
    kitchenOrderId: string,
    priority: KitchenPriority,
    tenantId: string,
  ) {
    await this.findKitchenOrderOrFail(kitchenOrderId, restaurantId, tenantId);

    return this.prisma.kitchenOrder.update({
      where: { id: kitchenOrderId },
      data: { priority },
    });
  }

  async getStats(restaurantId: string, tenantId: string) {
    const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000);

    const [inQueue, completedToday, avgPrepData] = await Promise.all([
      // Items currently in kitchen queue
      this.prisma.kitchenOrder.count({
        where: {
          tenantId,
          status: { in: ['SENT', 'PREPARING'] },
          order: { restaurantId },
        },
      }),
      // Orders completed today
      this.prisma.kitchenOrder.count({
        where: {
          tenantId,
          status: 'READY',
          completedAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
          order: { restaurantId },
        },
      }),
      // Average prep time (last 4 hours, completed only)
      this.prisma.kitchenOrder.findMany({
        where: {
          tenantId,
          status: 'READY',
          startedAt: { not: null },
          completedAt: { gte: fourHoursAgo },
          order: { restaurantId },
        },
        select: { startedAt: true, completedAt: true },
      }),
    ]);

    const avgPrepSeconds =
      avgPrepData.length > 0
        ? avgPrepData.reduce((sum, o) => {
            if (!o.startedAt || !o.completedAt) return sum;
            return sum + (o.completedAt.getTime() - o.startedAt.getTime()) / 1000;
          }, 0) / avgPrepData.length
        : 0;

    return {
      inQueue,
      completedToday,
      avgPrepTimeSeconds: Math.round(avgPrepSeconds),
      avgPrepTimeMinutes: Math.round(avgPrepSeconds / 60),
      sampleSize: avgPrepData.length,
    };
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────

  private async findKitchenOrderOrFail(
    kitchenOrderId: string,
    restaurantId: string,
    tenantId: string,
  ) {
    const ko = await this.prisma.kitchenOrder.findFirst({
      where: { id: kitchenOrderId, tenantId },
      include: { order: { select: { restaurantId: true } } },
    });

    if (!ko || ko.order.restaurantId !== restaurantId) {
      throw new NotFoundException(`Kitchen order ${kitchenOrderId} not found`);
    }

    return ko;
  }
}
