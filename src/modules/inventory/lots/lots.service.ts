import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateLotDto } from './dto/create-lot.dto';
import { QueryLotDto } from './dto/query-lot.dto';
import { QuarantineLotDto, ReleaseLotDto, DisposeLotDto } from './dto/quarantine-lot.dto';
import { InventoryLotStatus } from '@prisma/client';

export interface PaginatedResponse<T> {
  data: T[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

@Injectable()
export class LotsService {
  private readonly logger = new Logger(LotsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── Generate lot number LOT-YYYYMM-NNNN ────────────────────────────────────
  async generateLotNumber(tenantId: string, tx?: any): Promise<string> {
    const db = tx ?? this.prisma;
    const now = new Date();
    const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;

    const seq = await db.documentSequence.upsert({
      where: { tenantId_docType_yearMonth: { tenantId, docType: 'LOT', yearMonth } },
      update: { currentNumber: { increment: 1 } },
      create: { tenantId, docType: 'LOT', yearMonth, currentNumber: 1 },
    });

    return `LOT-${yearMonth}-${String(seq.currentNumber).padStart(4, '0')}`;
  }

  // ─── Create lot ──────────────────────────────────────────────────────────────
  async create(tenantId: string, dto: CreateLotDto) {
    // Validate item exists in tenant
    const item = await this.prisma.inventoryItem.findFirst({
      where: { id: dto.itemId, tenantId, deletedAt: null },
    });
    if (!item) throw new NotFoundException('ไม่พบสินค้าในระบบ');

    const warehouse = await this.prisma.warehouse.findFirst({
      where: { id: dto.warehouseId, tenantId, deletedAt: null },
    });
    if (!warehouse) throw new NotFoundException('ไม่พบคลังสินค้าในระบบ');

    return this.prisma.$transaction(async (tx) => {
      const lotNumber = await this.generateLotNumber(tenantId, tx);

      // Calculate expiry from shelf life if not provided
      let expiryDate: Date | undefined;
      if (dto.expiryDate) {
        expiryDate = new Date(dto.expiryDate);
      } else if (item.isPerishable && item.defaultShelfLifeDays) {
        expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + item.defaultShelfLifeDays);
      }

      return tx.inventoryLot.create({
        data: {
          tenantId,
          itemId: dto.itemId,
          warehouseId: dto.warehouseId,
          lotNumber,
          batchNumber: dto.batchNumber,
          grItemId: dto.grItemId,
          supplierId: dto.supplierId,
          initialQty: dto.initialQty,
          remainingQty: dto.initialQty,
          unitCost: dto.unitCost,
          manufactureDate: dto.manufactureDate ? new Date(dto.manufactureDate) : undefined,
          expiryDate,
          notes: dto.notes,
          status: InventoryLotStatus.ACTIVE,
        },
        include: { item: { select: { id: true, name: true, sku: true } }, warehouse: { select: { id: true, name: true } } },
      });
    });
  }

  // ─── List lots with filters ──────────────────────────────────────────────────
  async findAll(tenantId: string, query: QueryLotDto): Promise<PaginatedResponse<any>> {
    const { page = 1, limit = 20, itemId, warehouseId, status, nearExpiryDays, expiredOnly, expiryFrom, expiryTo } = query;
    const skip = (page - 1) * limit;

    const where: any = { tenantId };
    if (itemId) where.itemId = itemId;
    if (warehouseId) where.warehouseId = warehouseId;
    if (status) where.status = status;

    if (expiredOnly) {
      where.status = InventoryLotStatus.EXPIRED;
    } else if (nearExpiryDays) {
      const today = new Date();
      const future = new Date();
      future.setDate(today.getDate() + nearExpiryDays);
      where.expiryDate = { gte: today, lte: future };
      where.status = { in: [InventoryLotStatus.ACTIVE, InventoryLotStatus.QUARANTINED] };
    }

    if (expiryFrom || expiryTo) {
      where.expiryDate = {
        ...(expiryFrom ? { gte: new Date(expiryFrom) } : {}),
        ...(expiryTo ? { lte: new Date(expiryTo) } : {}),
      };
    }

    const [data, total] = await Promise.all([
      this.prisma.inventoryLot.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ expiryDate: 'asc' }, { createdAt: 'asc' }],
        include: {
          item: { select: { id: true, name: true, sku: true, unit: true } },
          warehouse: { select: { id: true, name: true } },
        },
      }),
      this.prisma.inventoryLot.count({ where }),
    ]);

    return { data, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  // ─── Find one lot by ID ──────────────────────────────────────────────────────
  async findOne(tenantId: string, id: string) {
    const lot = await this.prisma.inventoryLot.findFirst({
      where: { id, tenantId },
      include: {
        item: true,
        warehouse: { select: { id: true, name: true, code: true } },
        stockMovements: {
          orderBy: { createdAt: 'desc' },
          take: 50,
          select: {
            id: true, type: true, quantity: true, unitCost: true,
            notes: true, createdBy: true, createdAt: true,
          },
        },
        qcRecords: {
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: { id: true, status: true, inspectedBy: true, inspectedAt: true },
        },
      },
    });

    if (!lot) throw new NotFoundException(`ไม่พบ lot ID: ${id}`);
    return lot;
  }

  // ─── Near-expiry lots ────────────────────────────────────────────────────────
  async findNearExpiry(tenantId: string, days: number) {
    const today = new Date();
    const future = new Date();
    future.setDate(today.getDate() + days);

    return this.prisma.inventoryLot.findMany({
      where: {
        tenantId,
        status: { in: [InventoryLotStatus.ACTIVE, InventoryLotStatus.QUARANTINED] },
        expiryDate: { gte: today, lte: future },
      },
      orderBy: { expiryDate: 'asc' },
      include: {
        item: { select: { id: true, name: true, sku: true, unit: true } },
        warehouse: { select: { id: true, name: true } },
      },
    });
  }

  // ─── Expired lots ────────────────────────────────────────────────────────────
  async findExpired(tenantId: string) {
    return this.prisma.inventoryLot.findMany({
      where: { tenantId, status: InventoryLotStatus.EXPIRED },
      orderBy: { expiryDate: 'asc' },
      include: {
        item: { select: { id: true, name: true, sku: true, unit: true } },
        warehouse: { select: { id: true, name: true } },
      },
    });
  }

  // ─── Get all lots for specific item ─────────────────────────────────────────
  async findByItem(tenantId: string, itemId: string) {
    const item = await this.prisma.inventoryItem.findFirst({
      where: { id: itemId, tenantId, deletedAt: null },
    });
    if (!item) throw new NotFoundException('ไม่พบสินค้า');

    return this.prisma.inventoryLot.findMany({
      where: { tenantId, itemId },
      orderBy: [{ expiryDate: 'asc' }, { receivedDate: 'asc' }],
      include: { warehouse: { select: { id: true, name: true } } },
    });
  }

  // ─── Quarantine lot ──────────────────────────────────────────────────────────
  async quarantine(tenantId: string, id: string, dto: QuarantineLotDto) {
    const lot = await this.findOne(tenantId, id);
    if (lot.status !== InventoryLotStatus.ACTIVE) {
      throw new BadRequestException(`Lot status ปัจจุบันคือ ${lot.status} ไม่สามารถกักกันได้`);
    }

    return this.prisma.inventoryLot.update({
      where: { id },
      data: {
        status: InventoryLotStatus.QUARANTINED,
        notes: `[QUARANTINED] ${dto.reason}${lot.notes ? `\n${lot.notes}` : ''}`,
      },
    });
  }

  // ─── Release lot from quarantine ─────────────────────────────────────────────
  async release(tenantId: string, id: string, dto: ReleaseLotDto) {
    const lot = await this.findOne(tenantId, id);
    if (lot.status !== InventoryLotStatus.QUARANTINED) {
      throw new BadRequestException('Lot ต้องอยู่ในสถานะ QUARANTINED จึงจะ release ได้');
    }

    return this.prisma.inventoryLot.update({
      where: { id },
      data: {
        status: InventoryLotStatus.ACTIVE,
        notes: `[RELEASED]${dto.notes ? ` ${dto.notes}` : ''}${lot.notes ? `\n${lot.notes}` : ''}`,
      },
    });
  }

  // ─── Dispose lot (creates WASTE movement) ───────────────────────────────────
  async dispose(tenantId: string, id: string, dto: DisposeLotDto, userId: string) {
    const lot = await this.findOne(tenantId, id);
    if (lot.status === InventoryLotStatus.DISPOSED) {
      throw new ConflictException('Lot ถูก dispose ไปแล้ว');
    }
    if (lot.status === InventoryLotStatus.EXHAUSTED) {
      throw new BadRequestException('Lot หมดสต็อกแล้ว ไม่จำเป็นต้อง dispose');
    }

    return this.prisma.$transaction(async (tx) => {
      // Update lot status
      const updatedLot = await tx.inventoryLot.update({
        where: { id },
        data: {
          status: InventoryLotStatus.DISPOSED,
          notes: `[DISPOSED: ${dto.reason}]${dto.notes ? ` ${dto.notes}` : ''}${lot.notes ? `\n${lot.notes}` : ''}`,
        },
      });

      // Create WASTE stock movement if remainingQty > 0
      if (lot.remainingQty > 0) {
        await tx.stockMovement.create({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data: {
            id: crypto.randomUUID(),
            tenantId,
            warehouseId: lot.warehouseId,
            itemId: lot.itemId,
            type: 'WASTE',
            quantity: lot.remainingQty,
            unitCost: lot.unitCost,
            totalCost: Number(lot.unitCost) * lot.remainingQty,
            lotId: id, // field added after last prisma generate
            notes: `Lot disposed: ${dto.reason}${dto.notes ? ` — ${dto.notes}` : ''}`,
            createdBy: userId,
          } as any,
        });

        // Update warehouse stock
        await tx.warehouseStock.updateMany({
          where: { warehouseId: lot.warehouseId, itemId: lot.itemId },
          data: { quantity: { decrement: lot.remainingQty } },
        });

        // Mark lot remainingQty as 0
        await tx.inventoryLot.update({
          where: { id },
          data: { remainingQty: 0 },
        });
      }

      return updatedLot;
    });
  }

  // ─── FEFO pick for stock issue ───────────────────────────────────────────────
  async pickLotsForIssue(
    tenantId: string,
    itemId: string,
    warehouseId: string,
    qty: number,
  ): Promise<Array<{ lotId: string; qty: number; unitCost: number }>> {
    const lots = await this.prisma.inventoryLot.findMany({
      where: {
        tenantId,
        itemId,
        warehouseId,
        status: InventoryLotStatus.ACTIVE,
        remainingQty: { gt: 0 },
      },
      orderBy: [{ expiryDate: 'asc' }, { receivedDate: 'asc' }],
    });

    const totalAvailable = lots.reduce((sum, l) => sum + l.remainingQty, 0);
    if (totalAvailable < qty) {
      throw new BadRequestException(
        `สต็อก lot ไม่เพียงพอ ต้องการ ${qty} แต่มีอยู่ ${totalAvailable}`,
      );
    }

    const result: Array<{ lotId: string; qty: number; unitCost: number }> = [];
    let remaining = qty;

    for (const lot of lots) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, lot.remainingQty);
      result.push({ lotId: lot.id, qty: take, unitCost: Number(lot.unitCost) });
      remaining -= take;
    }

    return result;
  }

  // ─── Auto expire lots (called by cron) ──────────────────────────────────────
  async autoExpireLots(tenantId?: string): Promise<number> {
    const where: any = {
      status: { in: [InventoryLotStatus.ACTIVE, InventoryLotStatus.QUARANTINED] },
      expiryDate: { lt: new Date() },
    };
    if (tenantId) where.tenantId = tenantId;

    const result = await this.prisma.inventoryLot.updateMany({
      where,
      data: { status: InventoryLotStatus.EXPIRED },
    });

    this.logger.log(`Auto-expired ${result.count} lots`);
    return result.count;
  }
}
