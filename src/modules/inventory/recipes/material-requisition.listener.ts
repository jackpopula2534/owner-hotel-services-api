import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '@/prisma/prisma.service';
import { NotificationsService } from '@/notifications/notifications.service';
import { GoodsReceiveCompletedEvent, INVENTORY_EVENTS } from '../events/inventory.events';

/**
 * Closes the loop between procurement and the kitchen.
 *
 * A requisition parked in WAITING_STOCK is waiting on exactly one thing: stock
 * landing in its source warehouse. `gr.completed` fires after the goods receipt
 * has passed inspection and its movements are committed, which is the first
 * moment the answer can have changed — so that is when every waiting document
 * for that warehouse is re-checked, and the ones now coverable are flipped to
 * READY and announced.
 */
@Injectable()
export class MaterialRequisitionListener {
  private readonly logger = new Logger(MaterialRequisitionListener.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  @OnEvent(INVENTORY_EVENTS.GR_COMPLETED, { async: true })
  async handleGoodsReceived(event: GoodsReceiveCompletedEvent): Promise<void> {
    // A fully rejected receipt puts nothing on the shelf — nothing to wake up.
    if (event.status === 'REJECTED') return;

    try {
      const waiting = await this.prisma.materialRequisition.findMany({
        where: {
          tenantId: event.tenantId,
          status: 'WAITING_STOCK',
          sourceWarehouseId: event.warehouseId,
        },
        include: { items: { select: { itemId: true, quantity: true } } },
      });
      if (waiting.length === 0) return;

      // Only documents touching an item this receipt actually delivered can have
      // changed; the rest are still waiting on something else entirely.
      const receivedItems = new Set(
        event.items.filter((i) => i.receivedQty > 0).map((i) => i.itemId),
      );
      const candidates = waiting.filter((doc) =>
        doc.items.some((line) => receivedItems.has(line.itemId)),
      );
      if (candidates.length === 0) return;

      const itemIds = [...new Set(candidates.flatMap((d) => d.items.map((l) => l.itemId)))];
      const stocks = await this.prisma.warehouseStock.findMany({
        where: { warehouseId: event.warehouseId, itemId: { in: itemIds } },
        select: { itemId: true, quantity: true },
      });
      const onHand = new Map(stocks.map((s) => [s.itemId, s.quantity]));

      // Each document is checked whole: partial coverage still leaves the kitchen
      // unable to cook, so it keeps waiting rather than raising a false alarm.
      const ready = candidates.filter((doc) =>
        doc.items.every((line) => (onHand.get(line.itemId) ?? 0) >= line.quantity),
      );
      if (ready.length === 0) {
        this.logger.debug(
          `GR ${event.grNumber}: ${candidates.length} requisition(s) touched, none fully covered yet`,
        );
        return;
      }

      const readyAt = new Date();
      await this.prisma.materialRequisition.updateMany({
        where: { id: { in: ready.map((d) => d.id) } },
        data: { status: 'READY', readyAt },
      });

      for (const doc of ready) {
        await this.notifications.create({
          userId: doc.createdBy,
          tenantId: doc.tenantId,
          title: 'ใบเบิกวัตถุดิบพร้อมเบิกแล้ว',
          message:
            `ของตามใบขอซื้อเข้าคลังเรียบร้อย (รับเข้า ${event.grNumber}) — ` +
            `ใบเบิก ${doc.reqNumber} เบิกได้แล้วทั้ง ${doc.items.length} รายการ`,
          type: 'success',
          category: 'inventory',
        });
      }

      this.logger.log(
        `GR ${event.grNumber} released ${ready.length} requisition(s): ` +
          ready.map((d) => d.reqNumber).join(', '),
      );
    } catch (error) {
      // A failure here must never roll back a goods receipt that already landed —
      // the requisition simply stays WAITING_STOCK and the next receipt retries.
      this.logger.error(
        `Failed to release requisitions for GR ${event.grNumber}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }
}
