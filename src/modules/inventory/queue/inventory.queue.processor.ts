import { Processor, Process, OnQueueError } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { PrismaService } from '@/prisma/prisma.service';
import { LotsService } from '../lots/lots.service';
import { InventoryLotStatus } from '@prisma/client';

export const INVENTORY_QUEUE = 'inventory';

export const INVENTORY_JOBS = {
  CHECK_NEAR_EXPIRY: 'check-near-expiry',
  AUTO_EXPIRE_LOTS: 'auto-expire-lots',
  AUTO_WASTE_EXPIRED: 'auto-waste-expired',
  QC_REMINDER: 'qc-reminder',
};

@Processor(INVENTORY_QUEUE)
export class InventoryQueueProcessor {
  private readonly logger = new Logger(InventoryQueueProcessor.name);

  /** Debounce repeated connection errors — log at most once per 30 s */
  private lastQueueErrorLog = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly lotsService: LotsService,
  ) {}

  @OnQueueError()
  onError(error: Error) {
    const now = Date.now();
    // AggregateError / ECONNREFUSED = Redis unavailable — suppress repeat floods.
    const isConnectionError =
      error.name === 'AggregateError' ||
      (error as NodeJS.ErrnoException).code === 'ECONNREFUSED';

    if (isConnectionError) {
      if (now - this.lastQueueErrorLog < 30_000) return; // suppress within 30 s window
      this.lastQueueErrorLog = now;
      this.logger.warn(
        'Inventory queue: Redis unavailable — jobs will be processed once Redis reconnects.',
      );
      return;
    }

    this.logger.error(`Queue error: ${error.message}`, error.stack);
  }

  // ─── Daily 06:00 — Check near-expiry lots and send notifications ────────────
  @Process(INVENTORY_JOBS.CHECK_NEAR_EXPIRY)
  async handleCheckNearExpiry(job: Job) {
    this.logger.log('Running near-expiry check');
    const { tenantId, daysBefore } = job.data as {
      tenantId?: string;
      daysBefore: number[];
    };

    const whereBase: any = {
      status: { in: [InventoryLotStatus.ACTIVE, InventoryLotStatus.QUARANTINED] },
      expiryDate: { not: null },
    };
    if (tenantId) whereBase.tenantId = tenantId;

    for (const days of daysBefore) {
      const today = new Date();
      const future = new Date();
      future.setDate(today.getDate() + days);
      // Add 1 day buffer to avoid re-alerting next iteration
      const dayStart = new Date();
      dayStart.setDate(today.getDate() + days - 1);

      const lots = await this.prisma.inventoryLot.findMany({
        where: {
          ...whereBase,
          expiryDate: { gte: dayStart, lte: future },
        },
        include: {
          item: { select: { id: true, name: true, sku: true, unit: true } },
          warehouse: { select: { id: true, name: true } },
        },
        take: 100, // Batch limit
      });

      if (lots.length === 0) continue;

      this.logger.log(`Found ${lots.length} lots expiring in ${days} days`);

      // Group by tenant for notification dispatch
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const byTenant = (lots as any[]).reduce((acc: Record<string, any[]>, lot: any) => {
        acc[lot.tenantId] = acc[lot.tenantId] ?? [];
        acc[lot.tenantId].push(lot);
        return acc;
      }, {} as Record<string, any[]>);

      for (const [tid, tenantLots] of Object.entries(byTenant) as [string, any[]][]) {
        try {
          await this.prisma.notification.createMany({
            data: tenantLots.map((lot: any) => ({
              tenantId: tid,
              type: 'INVENTORY_NEAR_EXPIRY',
              title: `สินค้าใกล้หมดอายุใน ${days} วัน`,
              message: `${lot.item.name} (Lot: ${lot.lotNumber}) — คงเหลือ ${lot.remainingQty} ${lot.item.unit}`,
              referenceId: lot.id,
              referenceType: 'inventory_lot',
              isRead: false,
            })),
            skipDuplicates: true,
          });
        } catch (e) {
          this.logger.error(`Failed to create notifications for tenant ${tid}: ${e}`);
        }
      }
    }
  }

  // ─── Daily 00:05 — Mark expired lots ────────────────────────────────────────
  @Process(INVENTORY_JOBS.AUTO_EXPIRE_LOTS)
  async handleAutoExpireLots(job: Job) {
    this.logger.log('Running auto-expire lots job');
    const count = await this.lotsService.autoExpireLots(job.data?.tenantId);
    this.logger.log(`Auto-expired ${count} lots`);
    return { count };
  }

  // ─── Configurable — Auto-waste expired lots ──────────────────────────────────
  @Process(INVENTORY_JOBS.AUTO_WASTE_EXPIRED)
  async handleAutoWasteExpired(job: Job) {
    const { tenantId, graceDays = 7 } = job.data as {
      tenantId?: string;
      graceDays?: number;
    };

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - graceDays);

    const where: any = {
      status: InventoryLotStatus.EXPIRED,
      expiryDate: { lt: cutoff },
      remainingQty: { gt: 0 },
    };
    if (tenantId) where.tenantId = tenantId;

    const lots = await this.prisma.inventoryLot.findMany({ where, take: 100 });

    let wasted = 0;
    for (const lot of lots) {
      try {
        await this.prisma.$transaction(async (tx) => {
          await tx.stockMovement.create({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            data: {
              id: crypto.randomUUID(),
              tenantId: lot.tenantId,
              warehouseId: lot.warehouseId,
              itemId: lot.itemId,
              type: 'WASTE',
              quantity: lot.remainingQty,
              unitCost: lot.unitCost,
              totalCost: Number(lot.unitCost) * lot.remainingQty,
              lotId: lot.id, // field added after last prisma generate
              notes: `Auto-waste: lot expired ${graceDays}+ days ago`,
              createdBy: 'system',
            } as any,
          });

          await tx.inventoryLot.update({
            where: { id: lot.id },
            data: { status: InventoryLotStatus.DISPOSED, remainingQty: 0 },
          });

          await tx.warehouseStock.updateMany({
            where: { warehouseId: lot.warehouseId, itemId: lot.itemId },
            data: { quantity: { decrement: lot.remainingQty } },
          });
        });
        wasted++;
      } catch (e) {
        this.logger.error(`Failed to auto-waste lot ${lot.id}: ${e}`);
      }
    }

    this.logger.log(`Auto-wasted ${wasted} lots`);
    return { wasted };
  }

  // ─── Every 4h — QC stale reminder ──────────────────────────────────────────
  @Process(INVENTORY_JOBS.QC_REMINDER)
  async handleQCReminder(job: Job) {
    const cutoff = new Date();
    cutoff.setHours(cutoff.getHours() - 24);

    const stale = await this.prisma.qCRecord.findMany({
      where: {
        status: 'PENDING',
        createdAt: { lt: cutoff },
      },
      include: { template: { select: { name: true } } },
      take: 50,
    });

    if (stale.length === 0) return;
    this.logger.log(`Found ${stale.length} stale QC records`);

    // Group by tenant and create notifications
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const byTenant = (stale as any[]).reduce((acc: Record<string, any[]>, r: any) => {
      acc[r.tenantId] = acc[r.tenantId] ?? [];
      acc[r.tenantId].push(r);
      return acc;
    }, {} as Record<string, any[]>);

    for (const [tid, records] of Object.entries(byTenant) as [string, any[]][]) {
      try {
        await this.prisma.notification.createMany({
          data: records.map((r: any) => ({
            tenantId: tid,
            type: 'QC_REMINDER',
            title: 'มี QC ค้างรออยู่',
            message: `QC "${r.template.name}" ยังไม่ได้ submit มากกว่า 24 ชั่วโมงแล้ว`,
            referenceId: r.id,
            referenceType: 'qc_record',
            isRead: false,
          })),
          skipDuplicates: true,
        });
      } catch (e) {
        this.logger.error(`QC reminder notification error for tenant ${tid}: ${e}`);
      }
    }
  }
}
