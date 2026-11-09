import { Injectable, NotFoundException, BadRequestException, Logger, Optional } from '@nestjs/common';
import { KitchenGateway } from './kitchen.gateway';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogService } from '../../../audit-log/audit-log.service';
import { OrderItemStatus, KitchenPriority } from '@prisma/client';
import { MenuStockService } from '../menu/menu-stock.service';
import { ORDER_ITEM_MENU_SELECT } from '../order/order.service';
import type { RecallReason } from './dto/recall-bill.dto';

/** KitchenOrder.stationName of a ticket opened by ดึงกลับ; its notes hold the reason code. */
export const RECALL_STATION = 'RECALL';

@Injectable()
export class KitchenService {
  private readonly logger = new Logger(KitchenService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
    private readonly menuStockService: MenuStockService,
    @Optional() private readonly kitchenGateway?: KitchenGateway,
  ) {}

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

  async startOrder(
    restaurantId: string,
    kitchenOrderId: string,
    tenantId: string,
    userId?: string,
  ) {
    const kitchenOrder = await this.findKitchenOrderOrFail(kitchenOrderId, restaurantId, tenantId);

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

    this.auditLogService.log({
      action: 'update' as any,
      resource: 'order' as any,
      category: 'restaurant' as any,
      resourceId: kitchenOrderId,
      userId,
      tenantId,
      description: 'เริ่มทำออเดอร์ครัว',
    });

    return updated;
  }

  async completeOrder(
    restaurantId: string,
    kitchenOrderId: string,
    tenantId: string,
    userId?: string,
  ) {
    const kitchenOrder = await this.findKitchenOrderOrFail(kitchenOrderId, restaurantId, tenantId);

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

    this.auditLogService.log({
      action: 'update' as any,
      resource: 'order' as any,
      category: 'restaurant' as any,
      resourceId: kitchenOrderId,
      userId,
      tenantId,
      description: 'ออเดอร์ครัวเสร็จสิ้น',
    });

    return this.prisma.kitchenOrder.findFirst({ where: { id: kitchenOrderId } });
  }

  async updateItemStatus(
    restaurantId: string,
    itemId: string,
    status: OrderItemStatus,
    tenantId: string,
    userId?: string,
  ) {
    const item = await this.prisma.orderItem.findFirst({
      where: { id: itemId },
      include: { order: true },
    });

    if (!item || item.order.restaurantId !== restaurantId || item.order.tenantId !== tenantId) {
      throw new NotFoundException(`Order item ${itemId} not found`);
    }

    // SENT = back to "waiting" (a tap undone on the display)
    const validStatuses = ['SENT', 'PREPARING', 'READY', 'SERVED', 'CANCELLED'];
    if (!validStatuses.includes(status)) {
      throw new BadRequestException(`Invalid item status: ${status}`);
    }

    if (status === 'SENT' && !['PREPARING', 'READY'].includes(item.status)) {
      throw new BadRequestException(`Cannot move a ${item.status} item back to waiting`);
    }

    const now = new Date();
    const timestamps: Record<string, Date | null> = {};
    if (status === 'READY') timestamps.preparedAt = now;
    if (status === 'SERVED') timestamps.servedAt = now;
    if (status === 'SENT' || status === 'PREPARING') timestamps.preparedAt = null;

    const updated = await this.prisma.$transaction(async (tx) => {
      // ครัวยกเลิกรายการที่ของถูกหยิบออกไปแล้ว (ของสำเร็จรูปหักตอนสั่ง) ต้องคืนเข้าสต๊อก
      // ไม่งั้นยอดหายทั้งที่ของไม่เคยออกจากร้าน
      if (status === 'CANCELLED') {
        await this.menuStockService.returnPlacedLines(tx, {
          tenantId,
          restaurantId,
          orderId: item.orderId,
          orderItemIds: [itemId],
          userId,
        });
      }
      const row = await tx.orderItem.update({
        where: { id: itemId },
        data: { status, ...timestamps },
      });
      await this.syncOrderStatus(tx, item.orderId, now);
      return row;
    });
    this.kitchenGateway?.emitItemStatusChanged(tenantId, restaurantId, { id: itemId, orderId: item.orderId, status });

    this.auditLogService.log({
      action: 'update' as any,
      resource: 'order' as any,
      category: 'restaurant' as any,
      resourceId: itemId,
      userId,
      tenantId,
      description: 'อัพเดทสถานะรายการอาหาร',
    });

    return updated;
  }

  async setPriority(
    restaurantId: string,
    kitchenOrderId: string,
    priority: KitchenPriority,
    tenantId: string,
    userId?: string,
  ) {
    await this.findKitchenOrderOrFail(kitchenOrderId, restaurantId, tenantId);

    const updated = await this.prisma.kitchenOrder.update({
      where: { id: kitchenOrderId },
      data: { priority },
    });

    this.auditLogService.log({
      action: 'update' as any,
      resource: 'order' as any,
      category: 'restaurant' as any,
      resourceId: kitchenOrderId,
      userId,
      tenantId,
      description: 'เปลี่ยนความสำคัญออเดอร์',
    });

    return updated;
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

  /**
   * รับออเดอร์ — the line has seen the new round. Opens its kitchen tickets
   * (SENT → PREPARING) without touching the items: each dish is still started
   * by its own station.
   */
  async acceptBill(restaurantId: string, orderId: string, tenantId: string, userId?: string) {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, restaurantId, tenantId }, select: { id: true } });
    if (!order) throw new NotFoundException(`Order ${orderId} not found`);
    const res = await this.prisma.kitchenOrder.updateMany({
      where: { orderId, tenantId, status: 'SENT' },
      data: { status: 'PREPARING', startedAt: new Date() },
    });
    this.auditLogService.log({
      action: 'update' as any,
      resource: 'order' as any,
      category: 'restaurant' as any,
      resourceId: orderId,
      userId,
      tenantId,
      description: 'ครัวรับออเดอร์',
    });
    this.kitchenGateway?.emitOrderUpdated(tenantId, restaurantId, { orderId, accepted: true });
    return { orderId, accepted: res.count };
  }

  /**
   * ส่งเสิร์ฟ — hand ready items to the floor. With `itemIds`, only those (the
   * "send what is ready first" button); without, every READY item of the bill.
   * Only READY items can be served: a dish still cooking is never marked served.
   */
  async serveItems(
    restaurantId: string,
    orderId: string,
    itemIds: string[] | undefined,
    tenantId: string,
    userId?: string,
  ) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, restaurantId, tenantId },
      include: { items: { select: { id: true, status: true } }, table: { select: { tableNumber: true } } },
    });
    if (!order) throw new NotFoundException(`Order ${orderId} not found`);

    const ready = order.items.filter((i) => i.status === 'READY');
    const targets = itemIds?.length ? ready.filter((i) => itemIds.includes(i.id)) : ready;
    if (itemIds?.length && targets.length !== itemIds.length) {
      throw new BadRequestException('ส่งเสิร์ฟได้เฉพาะรายการที่พร้อมแล้ว');
    }
    if (targets.length === 0) {
      throw new BadRequestException('ยังไม่มีรายการที่พร้อมเสิร์ฟ');
    }

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.orderItem.updateMany({
        where: { id: { in: targets.map((i) => i.id) } },
        data: { status: 'SERVED', servedAt: now },
      });
      await this.syncOrderStatus(tx, orderId, now);
    });

    this.auditLogService.log({
      action: 'update' as any,
      resource: 'order' as any,
      category: 'restaurant' as any,
      resourceId: orderId,
      userId,
      tenantId,
      description: `ส่งเสิร์ฟ ${targets.length} รายการ${order.table?.tableNumber ? ` โต๊ะ ${order.table.tableNumber}` : ''}`,
    });
    this.kitchenGateway?.emitOrderUpdated(tenantId, restaurantId, { orderId, served: targets.map((i) => i.id) });

    return { orderId, servedItemIds: targets.map((i) => i.id) };
  }

  /**
   * ประวัติวันนี้ — bills the kitchen has fully handed over since `since`
   * (default: start of today). A bill counts once every item it sent is served
   * (or cancelled); paid bills stay in the list. Each row carries when it was
   * served and every ดึงกลับ it went through.
   */
  async getHistory(restaurantId: string, tenantId: string, since?: Date) {
    const from = since ?? new Date(new Date().setHours(0, 0, 0, 0));
    const orders = await this.prisma.order.findMany({
      where: {
        restaurantId,
        tenantId,
        status: { not: 'CANCELLED' },
        AND: [
          { items: { some: { sentToKitchen: true, servedAt: { gte: from } } } },
          { items: { none: { sentToKitchen: true, status: { in: ['SENT', 'PREPARING', 'READY'] } } } },
        ],
      },
      orderBy: { updatedAt: 'desc' },
      take: 300,
      include: {
        table: { select: { id: true, tableNumber: true } },
        items: {
          where: { sentToKitchen: true, status: 'SERVED' },
          include: { menuItem: { select: ORDER_ITEM_MENU_SELECT as never } },
          orderBy: { createdAt: 'asc' },
        },
        kitchenOrders: {
          select: { id: true, status: true, createdAt: true, stationName: true, notes: true },
          orderBy: { createdAt: 'asc' },
        },
        reservation: { select: { guestName: true, partySize: true, specialRequests: true } },
      },
    });

    return orders
      .map((o) => {
        const servedAt = o.items.reduce<Date | null>(
          (max, i) => (i.servedAt && (!max || i.servedAt > max) ? i.servedAt : max),
          null,
        );
        return {
          ...o,
          servedAt,
          closed: o.status === 'COMPLETED' || ['PAID', 'CHARGED_TO_ROOM', 'REFUNDED'].includes(o.paymentStatus),
          recalls: o.kitchenOrders
            .filter((k) => k.stationName === RECALL_STATION)
            .map((k) => ({ at: k.createdAt, reason: k.notes })),
        };
      })
      .sort((a, b) => (b.servedAt?.getTime() ?? 0) - (a.servedAt?.getTime() ?? 0));
  }

  /**
   * ดึงกลับเข้าครัว — a served bill comes back to the line. Remake / wrong dish:
   * the items wait to be cooked again. Served by mistake: they wait at the pass.
   * The bill gets a RUSH ticket that records the reason; a closed (paid) bill
   * cannot come back.
   */
  async recallBill(
    restaurantId: string,
    orderId: string,
    dto: { reason: RecallReason; itemIds?: string[] },
    tenantId: string,
    userId?: string,
  ) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, restaurantId, tenantId },
      include: {
        items: { select: { id: true, status: true, sentToKitchen: true } },
        table: { select: { tableNumber: true } },
      },
    });
    if (!order) throw new NotFoundException(`Order ${orderId} not found`);
    if (
      ['COMPLETED', 'CANCELLED'].includes(order.status) ||
      ['PAID', 'CHARGED_TO_ROOM', 'REFUNDED'].includes(order.paymentStatus)
    ) {
      throw new BadRequestException('บิลนี้ปิดแล้ว ดึงกลับเข้าครัวไม่ได้');
    }

    const served = order.items.filter((i) => i.status === 'SERVED' && i.sentToKitchen);
    const targets = dto.itemIds?.length ? served.filter((i) => dto.itemIds!.includes(i.id)) : served;
    if (dto.itemIds?.length && targets.length !== dto.itemIds.length) {
      throw new BadRequestException('ดึงกลับได้เฉพาะรายการที่เสิร์ฟแล้ว');
    }
    if (targets.length === 0) {
      throw new BadRequestException('ไม่มีรายการที่เสิร์ฟแล้วให้ดึงกลับ');
    }

    const backToPass = dto.reason === 'MISSED_SERVE';
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.orderItem.updateMany({
        where: { id: { in: targets.map((i) => i.id) } },
        data: backToPass
          ? { status: 'READY', servedAt: null }
          : { status: 'SENT', servedAt: null, preparedAt: null },
      });
      await tx.kitchenOrder.create({
        data: {
          tenantId,
          orderId,
          priority: 'RUSH',
          status: backToPass ? 'READY' : 'PREPARING',
          stationName: RECALL_STATION,
          notes: dto.reason,
          startedAt: now,
          completedAt: backToPass ? now : null,
        },
      });
      await this.syncOrderStatus(tx, orderId, now);
    });

    this.auditLogService.log({
      action: 'update' as any,
      resource: 'order' as any,
      category: 'restaurant' as any,
      resourceId: orderId,
      userId,
      tenantId,
      description: `ดึงกลับเข้าครัว ${targets.length} รายการ (${dto.reason})${order.table?.tableNumber ? ` โต๊ะ ${order.table.tableNumber}` : ''}`,
    });
    this.kitchenGateway?.emitOrderUpdated(tenantId, restaurantId, { orderId, recalled: targets.map((i) => i.id) });

    return { orderId, recalledItemIds: targets.map((i) => i.id), reason: dto.reason };
  }

  /**
   * Keep the bill and its kitchen tickets in step with its items:
   *   anything waiting / cooking → PREPARING
   *   everything READY or SERVED (some READY) → READY, tickets closed
   *   everything SERVED → SERVED
   * Paid / cancelled bills are left alone.
   */
  private async syncOrderStatus(tx: Pick<PrismaService, 'order' | 'orderItem' | 'kitchenOrder'>, orderId: string, now: Date) {
    const order = await tx.order.findFirst({ where: { id: orderId }, select: { status: true } });
    if (!order || ['COMPLETED', 'CANCELLED'].includes(order.status)) return;
    const items = await tx.orderItem.findMany({
      where: { orderId, status: { not: 'CANCELLED' }, sentToKitchen: true },
      select: { status: true },
    });
    if (items.length === 0) return;
    const working = items.some((i) => i.status === 'SENT' || i.status === 'PREPARING' || i.status === 'PENDING');
    const allServed = items.every((i) => i.status === 'SERVED');
    const next = working ? 'PREPARING' : allServed ? 'SERVED' : 'READY';
    if (next !== order.status) {
      await tx.order.update({ where: { id: orderId }, data: { status: next as never } });
    }
    if (!working) {
      await tx.kitchenOrder.updateMany({
        where: { orderId, status: { in: ['SENT', 'PREPARING'] } },
        data: { status: 'READY', completedAt: now },
      });
    } else if (items.some((i) => i.status === 'PREPARING' || i.status === 'READY')) {
      await tx.kitchenOrder.updateMany({
        where: { orderId, status: 'SENT' },
        data: { status: 'PREPARING', startedAt: now },
      });
    }
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
