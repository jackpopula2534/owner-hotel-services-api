import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '@/prisma/prisma.service';
import {
  COST_EVENTS,
  StockMovementCreatedEvent,
} from '../../cost-accounting/events/cost-accounting.events';
import { CreateStockMovementDto, StockMovementTypeDto } from './dto/create-stock-movement.dto';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { QueryStockMovementDto } from './dto/query-stock-movement.dto';

interface PaginatedResponse<T> {
  data: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

interface StockMovementDetail {
  id: string;
  tenantId: string;
  warehouseId: string;
  /** @deprecated kept for backward compat; prefer `warehouse.name` */
  warehouseName?: string;
  warehouse?: { id: string; name: string };
  itemId: string;
  /** @deprecated kept for backward compat; prefer `item.name` */
  itemName?: string;
  /** @deprecated kept for backward compat; prefer `item.sku` */
  itemSku?: string;
  item?: { id: string; name: string; sku: string };
  type: string;
  quantity: number;
  unitCost: number;
  /** Total movement cost (qty * unitCost). Mirrors DB `totalCost` field. */
  totalCost: number;
  /** @deprecated alias of `totalCost` for backward compat */
  totalValue: number;
  referenceType?: string;
  referenceId?: string;
  transferWarehouseId?: string;
  notes?: string;
  batchNumber?: string;
  expiryDate?: string | Date | null;
  lotId?: string | null;
  lot?: { id: string; lotNumber: string; expiryDate?: Date | null; status: string } | null;
  /** Raw user id of the actor (kept for backward compat). */
  createdBy: string;
  /** Display name resolved from User table. */
  createdByName?: string;
  /** Populated user record for the actor (firstName/lastName/email). */
  createdByUser?: { id: string; firstName: string | null; lastName: string | null; email: string } | null;
  createdAt: Date;
  updatedAt?: Date;
}

@Injectable()
export class StockMovementsService {
  private readonly logger = new Logger(StockMovementsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Find all stock movements with pagination and filters
   */
  async findAll(
    tenantId: string,
    query: QueryStockMovementDto,
  ): Promise<PaginatedResponse<StockMovementDetail>> {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;
    const sort = query.sort || 'createdAt';
    const order = query.order || 'desc';

    const where: Record<string, any> = { tenantId };

    if (query.warehouseId) {
      where.warehouseId = query.warehouseId;
    }

    if (query.itemId) {
      where.itemId = query.itemId;
    }

    if (query.type) {
      where.type = query.type;
    }

    if (query.startDate || query.endDate) {
      where.createdAt = {};
      if (query.startDate) {
        where.createdAt.gte = new Date(query.startDate);
      }
      if (query.endDate) {
        where.createdAt.lte = new Date(query.endDate);
      }
    }

    const [movements, total] = await Promise.all([
      this.prisma.stockMovement.findMany({
        where,
        include: {
          warehouse: { select: { id: true, name: true } },
          item: { select: { id: true, name: true, sku: true } },
          lot: { select: { id: true, lotNumber: true, expiryDate: true, status: true } },
        },
        orderBy: { [sort]: order },
        skip,
        take: limit,
      }),
      this.prisma.stockMovement.count({ where }),
    ]);

    // Resolve actor names in a single batch query.
    // StockMovement.createdBy is a plain UUID string (no FK relation in schema),
    // so we fetch the matching users separately and stitch them in.
    const userIds = Array.from(
      new Set(movements.map((m) => m.createdBy).filter((id): id is string => Boolean(id))),
    );
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, firstName: true, lastName: true, email: true },
        })
      : [];
    const userMap = new Map(users.map((u) => [u.id, u]));

    const data = movements.map((m) => this.mapToDetail(m, userMap.get(m.createdBy) ?? null));

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Find a single stock movement by ID
   */
  async findOne(id: string, tenantId: string): Promise<StockMovementDetail> {
    const movement = await this.prisma.stockMovement.findUnique({
      where: { id },
      include: {
        warehouse: { select: { id: true, name: true } },
        item: { select: { id: true, name: true, sku: true } },
        lot: { select: { id: true, lotNumber: true, expiryDate: true, status: true } },
      },
    });

    if (!movement) {
      throw new NotFoundException(`Stock movement with ID ${id} not found`);
    }

    if (movement.tenantId !== tenantId) {
      throw new NotFoundException(`Stock movement with ID ${id} not found`);
    }

    const user = movement.createdBy
      ? await this.prisma.user.findUnique({
          where: { id: movement.createdBy },
          select: { id: true, firstName: true, lastName: true, email: true },
        })
      : null;

    return this.mapToDetail(movement, user);
  }

  /**
   * Create a stock movement (core method with transaction handling)
   * Handles all types: goods receive, goods issue, transfers, adjustments, etc.
   */
  async createMovement(
    dto: CreateStockMovementDto,
    userId: string,
    tenantId: string,
  ): Promise<StockMovementDetail> {
    // Validate warehouse belongs to tenant
    const warehouse = await this.prisma.warehouse.findFirst({
      where: { id: dto.warehouseId, tenantId },
    });

    if (!warehouse) {
      throw new BadRequestException(
        `Warehouse ${dto.warehouseId} not found or does not belong to your organization`,
      );
    }

    // Validate item belongs to tenant
    const item = await this.prisma.inventoryItem.findFirst({
      where: { id: dto.itemId, tenantId },
    });

    if (!item) {
      throw new BadRequestException(
        `Inventory item ${dto.itemId} not found or does not belong to your organization`,
      );
    }

    // For transfer types, validate transfer warehouse
    if ([StockMovementTypeDto.TRANSFER_OUT, StockMovementTypeDto.TRANSFER_IN].includes(dto.type)) {
      if (!dto.transferWarehouseId) {
        throw new BadRequestException('transferWarehouseId is required for transfer movements');
      }

      const transferWarehouse = await this.prisma.warehouse.findFirst({
        where: { id: dto.transferWarehouseId, tenantId },
      });

      if (!transferWarehouse) {
        throw new BadRequestException(`Transfer warehouse ${dto.transferWarehouseId} not found`);
      }
    }

    // Execute transaction for atomicity
    const result = await this.prisma.$transaction(async (tx) => {
      // Create the stock movement record
      const movement = await tx.stockMovement.create({
        data: {
          id: this.generateUUID(),
          tenantId,
          warehouseId: dto.warehouseId,
          itemId: dto.itemId,
          type: dto.type,
          quantity: dto.quantity,
          unitCost: dto.unitCost,
          totalCost: dto.quantity * dto.unitCost,
          referenceType: dto.referenceType,
          referenceId: dto.referenceId,
          transferWarehouseId: dto.transferWarehouseId,
          notes: dto.notes,
          batchNumber: dto.batchNumber,
          expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : null,
          createdBy: userId,
        },
        include: {
          warehouse: { select: { id: true, name: true } },
          item: { select: { id: true, name: true, sku: true } },
        },
      });

      // Update warehouse stock balance
      await this.updateWarehouseStock(
        tx,
        tenantId,
        dto.warehouseId,
        dto.itemId,
        dto.type,
        dto.quantity,
        dto.unitCost,
      );

      // For TRANSFER_OUT, automatically create TRANSFER_IN in target warehouse
      if (dto.type === StockMovementTypeDto.TRANSFER_OUT) {
        const counterMovement = await tx.stockMovement.create({
          data: {
            id: this.generateUUID(),
            tenantId,
            warehouseId: dto.transferWarehouseId,
            itemId: dto.itemId,
            type: StockMovementTypeDto.TRANSFER_IN,
            quantity: dto.quantity,
            unitCost: dto.unitCost,
            totalCost: dto.quantity * dto.unitCost,
            referenceType: dto.referenceType,
            referenceId: dto.referenceId,
            transferWarehouseId: dto.warehouseId,
            notes: dto.notes || 'Auto-generated counter-transfer',
            batchNumber: dto.batchNumber,
            expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : null,
            createdBy: userId,
          },
        });

        // Update target warehouse stock
        await this.updateWarehouseStock(
          tx,
          tenantId,
          dto.transferWarehouseId,
          dto.itemId,
          StockMovementTypeDto.TRANSFER_IN,
          dto.quantity,
          dto.unitCost,
        );
      }

      // For TRANSFER_IN, automatically create TRANSFER_OUT in source warehouse
      if (dto.type === StockMovementTypeDto.TRANSFER_IN) {
        const counterMovement = await tx.stockMovement.create({
          data: {
            id: this.generateUUID(),
            tenantId,
            warehouseId: dto.transferWarehouseId,
            itemId: dto.itemId,
            type: StockMovementTypeDto.TRANSFER_OUT,
            quantity: dto.quantity,
            unitCost: dto.unitCost,
            totalCost: dto.quantity * dto.unitCost,
            referenceType: dto.referenceType,
            referenceId: dto.referenceId,
            transferWarehouseId: dto.warehouseId,
            notes: dto.notes || 'Auto-generated counter-transfer',
            batchNumber: dto.batchNumber,
            expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : null,
            createdBy: userId,
          },
        });

        // Update source warehouse stock
        await this.updateWarehouseStock(
          tx,
          tenantId,
          dto.transferWarehouseId,
          dto.itemId,
          StockMovementTypeDto.TRANSFER_OUT,
          dto.quantity,
          dto.unitCost,
        );
      }

      return movement;
    });

    // Emit event for cost accounting integration (after transaction succeeds)
    try {
      const costEvent: StockMovementCreatedEvent = {
        movementId: result.id,
        tenantId,
        propertyId: warehouse.propertyId,
        warehouseId: dto.warehouseId,
        itemId: dto.itemId,
        itemName: (result as any).item?.name || item.name,
        type: dto.type,
        quantity: dto.quantity,
        totalCost: dto.quantity * dto.unitCost,
        referenceType: dto.referenceType,
        referenceId: dto.referenceId,
        createdBy: userId,
      };
      this.eventEmitter.emit(COST_EVENTS.STOCK_MOVEMENT_CREATED, costEvent);
    } catch (eventError) {
      this.logger.warn(`Failed to emit stock movement event: ${(eventError as Error).message}`);
    }

    return this.mapToDetail(result);
  }

  /**
   * Create a transfer between warehouses (convenience method)
   */
  async createTransfer(
    dto: CreateTransferDto,
    userId: string,
    tenantId: string,
  ): Promise<{ from: StockMovementDetail; to: StockMovementDetail }> {
    // Validate source warehouse exists
    const sourceWarehouse = await this.prisma.warehouse.findFirst({
      where: { id: dto.fromWarehouseId, tenantId },
    });

    if (!sourceWarehouse) {
      throw new BadRequestException(`Source warehouse ${dto.fromWarehouseId} not found`);
    }

    // Validate target warehouse exists
    const targetWarehouse = await this.prisma.warehouse.findFirst({
      where: { id: dto.toWarehouseId, tenantId },
    });

    if (!targetWarehouse) {
      throw new BadRequestException(`Target warehouse ${dto.toWarehouseId} not found`);
    }

    // Validate item exists
    const item = await this.prisma.inventoryItem.findFirst({
      where: { id: dto.itemId, tenantId },
    });

    if (!item) {
      throw new BadRequestException(`Inventory item ${dto.itemId} not found`);
    }

    // Get current average cost from source warehouse stock
    const sourceStock = await this.prisma.warehouseStock.findFirst({
      where: {
        warehouseId: dto.fromWarehouseId,
        itemId: dto.itemId,
      },
    });

    if (!sourceStock || sourceStock.quantity < dto.quantity) {
      throw new BadRequestException('Insufficient stock in source warehouse for transfer');
    }

    const avgCost = Number(sourceStock.avgCost) || 0;

    // Create TRANSFER_OUT movement (which auto-creates TRANSFER_IN)
    const fromMovement = await this.createMovement(
      {
        warehouseId: dto.fromWarehouseId,
        itemId: dto.itemId,
        type: StockMovementTypeDto.TRANSFER_OUT,
        quantity: dto.quantity,
        unitCost: avgCost,
        transferWarehouseId: dto.toWarehouseId,
        notes: dto.notes,
      },
      userId,
      tenantId,
    );

    // Fetch the auto-created TRANSFER_IN movement
    const toMovement = await this.prisma.stockMovement.findFirst({
      where: {
        tenantId,
        warehouseId: dto.toWarehouseId,
        itemId: dto.itemId,
        type: StockMovementTypeDto.TRANSFER_IN,
        referenceId: fromMovement.referenceId || null,
      },
      include: {
        warehouse: { select: { id: true, name: true } },
        item: { select: { id: true, name: true, sku: true } },
        lot: { select: { id: true, lotNumber: true, expiryDate: true, status: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const transferUser = toMovement?.createdBy
      ? await this.prisma.user.findUnique({
          where: { id: toMovement.createdBy },
          select: { id: true, firstName: true, lastName: true, email: true },
        })
      : null;

    return {
      from: fromMovement,
      to: toMovement ? this.mapToDetail(toMovement, transferUser) : fromMovement,
    };
  }

  /**
   * Get movement history for a specific item
   */
  async getMovementsByItem(
    itemId: string,
    tenantId: string,
    page?: number,
    limit?: number,
  ): Promise<PaginatedResponse<StockMovementDetail>> {
    const query: QueryStockMovementDto = {
      page: page || 1,
      limit: limit || 20,
      itemId,
      sort: 'createdAt',
      order: 'desc',
    };

    return this.findAll(tenantId, query);
  }

  /**
   * Get movement history for a specific warehouse
   */
  async getMovementsByWarehouse(
    warehouseId: string,
    tenantId: string,
    page?: number,
    limit?: number,
  ): Promise<PaginatedResponse<StockMovementDetail>> {
    const query: QueryStockMovementDto = {
      page: page || 1,
      limit: limit || 20,
      warehouseId,
      sort: 'createdAt',
      order: 'desc',
    };

    return this.findAll(tenantId, query);
  }

  /**
   * Private: Update warehouse stock balance based on movement type
   * CRITICAL METHOD: Handles all stock calculation logic
   */
  private async updateWarehouseStock(
    tx: any,
    tenantId: string,
    warehouseId: string,
    itemId: string,
    movementType: StockMovementTypeDto,
    quantity: number,
    unitCost: number,
  ): Promise<void> {
    // Determine if this is an inbound or outbound movement
    const inboundTypes = [
      StockMovementTypeDto.GOODS_RECEIVE,
      StockMovementTypeDto.TRANSFER_IN,
      StockMovementTypeDto.ADJUSTMENT_IN,
    ];

    const outboundTypes = [
      StockMovementTypeDto.GOODS_ISSUE,
      StockMovementTypeDto.TRANSFER_OUT,
      StockMovementTypeDto.ADJUSTMENT_OUT,
      StockMovementTypeDto.RETURN_SUPPLIER,
      StockMovementTypeDto.WASTE,
    ];

    const isInbound = inboundTypes.includes(movementType);
    const isOutbound = outboundTypes.includes(movementType);

    if (!isInbound && !isOutbound) {
      throw new BadRequestException(`Unknown movement type: ${movementType}`);
    }

    // Get or create warehouse stock
    let warehouseStock = await tx.warehouseStock.findFirst({
      where: {
        warehouseId,
        itemId,
      },
    });

    if (!warehouseStock) {
      // Create new warehouse stock entry
      if (isOutbound) {
        throw new BadRequestException(
          `Cannot issue items: no stock record for item ${itemId} in warehouse ${warehouseId}`,
        );
      }

      warehouseStock = await tx.warehouseStock.create({
        data: {
          id: this.generateUUID(),
          warehouseId,
          itemId,
          quantity,
          avgCost: unitCost,
          totalValue: quantity * unitCost,
          tenantId,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      return;
    }

    let newQuantity: number;
    let newAvgCost: number;
    let newTotalValue: number;

    if (isInbound) {
      // Inbound movement: increase quantity and recalculate average cost
      const oldQuantity = warehouseStock.quantity;
      const oldAvgCost = warehouseStock.avgCost || 0;

      newQuantity = oldQuantity + quantity;

      // Weighted average cost formula:
      // newAvgCost = ((oldQty * oldAvgCost) + (newQty * unitCost)) / (oldQty + newQty)
      newAvgCost = (oldQuantity * oldAvgCost + quantity * unitCost) / newQuantity;

      newTotalValue = newQuantity * newAvgCost;
    } else {
      // Outbound movement: decrease quantity, validate sufficient stock
      if (warehouseStock.quantity < quantity) {
        throw new BadRequestException(
          `Insufficient stock: warehouse has ${warehouseStock.quantity} units but trying to issue ${quantity} units`,
        );
      }

      newQuantity = warehouseStock.quantity - quantity;
      const avgCost = warehouseStock.avgCost || 0;
      newTotalValue = newQuantity * avgCost;

      // Average cost remains the same for outbound movements
      newAvgCost = warehouseStock.avgCost;
    }

    // Update warehouse stock
    await tx.warehouseStock.update({
      where: { id: warehouseStock.id },
      data: {
        quantity: newQuantity,
        avgCost: newAvgCost,
        totalValue: newTotalValue,
        updatedAt: new Date(),
      },
    });
  }

  /**
   * Private: Map database record to detail response.
   *
   * Resolves the following display issues that show up in the UI:
   *  - Prisma Decimal fields (`unitCost`, `totalCost`) are coerced to plain
   *    numbers so the frontend's `formatCurrency` does not produce `NaN`.
   *  - The DB column is `totalCost`; we expose it under both `totalCost`
   *    (preferred) and `totalValue` (legacy alias) for backward compatibility.
   *  - Nested `item` / `warehouse` objects are forwarded so the frontend can
   *    read `movement.item.name`, `movement.warehouse.name`, etc.
   *  - The actor record (looked up separately because `createdBy` has no FK
   *    relation in the Prisma schema) is attached as `createdByUser` and a
   *    pre-formatted `createdByName` for direct rendering.
   */
  private mapToDetail(
    movement: any,
    user: { id: string; firstName: string | null; lastName: string | null; email: string } | null = null,
  ): StockMovementDetail {
    const unitCost = this.toNumber(movement.unitCost);
    const totalCost = this.toNumber(movement.totalCost);

    const createdByName = user
      ? [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || user.email
      : undefined;

    return {
      id: movement.id,
      tenantId: movement.tenantId,
      warehouseId: movement.warehouseId,
      warehouseName: movement.warehouse?.name,
      warehouse: movement.warehouse
        ? { id: movement.warehouse.id, name: movement.warehouse.name }
        : undefined,
      itemId: movement.itemId,
      itemName: movement.item?.name,
      itemSku: movement.item?.sku,
      item: movement.item
        ? { id: movement.item.id, name: movement.item.name, sku: movement.item.sku }
        : undefined,
      type: movement.type,
      quantity: movement.quantity,
      unitCost,
      totalCost,
      totalValue: totalCost,
      referenceType: movement.referenceType ?? undefined,
      referenceId: movement.referenceId ?? undefined,
      transferWarehouseId: movement.transferWarehouseId ?? undefined,
      notes: movement.notes ?? undefined,
      batchNumber: movement.batchNumber ?? undefined,
      expiryDate: movement.expiryDate ?? null,
      lotId: movement.lotId ?? null,
      lot: movement.lot
        ? {
            id: movement.lot.id,
            lotNumber: movement.lot.lotNumber,
            expiryDate: movement.lot.expiryDate ?? null,
            status: movement.lot.status,
          }
        : null,
      createdBy: movement.createdBy,
      createdByName,
      createdByUser: user,
      createdAt: movement.createdAt,
      updatedAt: movement.updatedAt,
    };
  }

  /**
   * Coerce a Prisma `Decimal` (or anything number-ish) into a plain JS number.
   * Returns 0 for null/undefined/non-finite inputs so the frontend never
   * receives `NaN` for the value column.
   */
  private toNumber(value: unknown): number {
    if (value === null || value === undefined) return 0;
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    if (typeof value === 'string') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    // Prisma Decimal exposes a `.toNumber()` helper.
    if (typeof (value as { toNumber?: () => number }).toNumber === 'function') {
      const parsed = (value as { toNumber: () => number }).toNumber();
      return Number.isFinite(parsed) ? parsed : 0;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  /**
   * Private: Generate UUID v4 — uses crypto.randomUUID() (secure, no Math.random)
   */
  private generateUUID(): string {
    return crypto.randomUUID();
  }

  // ─── FEFO lot picker: returns lots in First-Expiry-First-Out order ────────────
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
        status: 'ACTIVE',
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

  // ─── Create outbound movement with FEFO auto-pick ─────────────────────────────
  async createWithFEFO(
    dto: CreateStockMovementDto & { lotId?: string },
    userId: string,
    tenantId: string,
  ) {
    const OUTBOUND_TYPES = ['GOODS_ISSUE', 'TRANSFER_OUT', 'WASTE', 'ADJUSTMENT_OUT', 'RETURN_SUPPLIER'];

    if (!OUTBOUND_TYPES.includes(dto.type)) {
      // Not outbound — use normal create
      return this.createMovement(dto, userId, tenantId);
    }

    const item = await this.prisma.inventoryItem.findFirst({
      where: { id: dto.itemId, tenantId, deletedAt: null },
    });

    if (!item || !(item.isPerishable || (item as any).requiresLotTracking)) {
      // Not a tracked item — normal flow
      return this.createMovement(dto, userId, tenantId);
    }

    if (dto.lotId) {
      // Explicit lot provided — validate and deduct
      return this.createMovement(dto as any, userId, tenantId);
    }

    // Auto FEFO pick
    const lots = await this.pickLotsForIssue(tenantId, dto.itemId, dto.warehouseId, dto.quantity);

    if (lots.length === 1) {
      return this.createMovement({ ...dto, lotId: lots[0].lotId } as any, userId, tenantId);
    }

    // Multiple lots — create multiple movements
    const movements = [];
    for (const pick of lots) {
      const mv = await this.createMovement(
        { ...dto, quantity: pick.qty, unitCost: pick.unitCost, lotId: pick.lotId } as any,
        userId,
        tenantId,
      );
      movements.push(mv);
    }
    return { consumedLots: movements };
  }
}
