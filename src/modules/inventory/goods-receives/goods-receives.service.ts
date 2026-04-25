import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateGoodsReceiveDto } from './dto/create-goods-receive.dto';
import { QueryGoodsReceiveDto } from './dto/query-goods-receive.dto';
import { InventoryLotStatus } from '@prisma/client';
import {
  INVENTORY_EVENTS,
  GoodsReceiveCompletedEvent,
  PurchaseOrderReceivedEvent,
} from '../events/inventory.events';

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface GoodsReceiveDetail {
  id: string;
  tenantId: string;
  grNumber: string;
  purchaseOrderId?: string;
  poNumber?: string;
  // Extended PO snapshot (only set when GR is linked to a PO)
  poSnapshot?: {
    id: string;
    poNumber: string;
    orderDate: string;
    expectedDate: string | null;
    currency: string;
    paymentTerms: string | null;
  };
  // Supplier details copied from the PO at view time. We don't denormalize
  // onto GR since the supplier master rarely changes during a GR's lifetime
  // and a join cost is acceptable.
  supplier?: {
    id: string;
    name: string;
    code: string | null;
    contactPerson: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
    taxId: string | null;
  };
  warehouseId: string;
  warehouseName?: string;
  warehouseCode?: string | null;
  warehouseLocation?: string | null;
  invoiceNumber?: string;
  invoiceDate?: string;
  status: string;
  /**
   * True when at least one item in this GR has `requiresQC=true` on its
   * master record. Drives the "รอตรวจ QC" banner in the UI even though the
   * GR header status may already read ACCEPTED (see flow-debt note in create).
   */
  requiresQC: boolean;
  qcPending: boolean; // requiresQC && !inspectedAt — convenience for UI
  itemCount: number;
  totalReceivedQty: number;
  totalRejectedQty: number;
  totalOrderedQty?: number;
  varianceQty?: number;
  varianceAmount?: number;
  subtotal: number;
  totalAmount: number;
  notes?: string;
  createdBy: string;
  createdByName?: string | null;
  inspectedByName?: string | null;
  createdAt: Date;
  updatedAt: Date;
  inspectedBy?: string;
  inspectedAt?: Date;
  items?: any[];
}

@Injectable()
export class GoodsReceivesService {
  private readonly logger = new Logger(GoodsReceivesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Generate Goods Receive document number (GR-YYYYMM-NNNN)
   */
  // ─── Generate Lot Number (LOT-YYYYMM-NNNN) ─────────────────────────────────
  // NOTE: DocumentSequence uses `lastNumber` + required `prefix` (see
  // prisma/schema.prisma › model DocumentSequence). An earlier version of this
  // method referenced a non-existent `currentNumber` field and omitted
  // `prefix`, which caused Prisma to throw PrismaClientValidationError (which
  // the global filter surfaces as "VALIDATION_ERROR: ข้อมูลไม่ถูกต้องตามโครงสร้าง
  // ฐานข้อมูล") whenever a perishable / lot-tracked item was received.
  private async generateLotNumber(tenantId: string, tx: any): Promise<string> {
    const now = new Date();
    const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const seq = await tx.documentSequence.upsert({
      where: { tenantId_docType_yearMonth: { tenantId, docType: 'LOT', yearMonth } },
      update: { lastNumber: { increment: 1 } },
      create: { tenantId, docType: 'LOT', prefix: 'LOT', yearMonth, lastNumber: 1 },
    });
    return `LOT-${yearMonth}-${String(seq.lastNumber).padStart(4, '0')}`;
  }

  private async generateGRNumber(tenantId: string, tx: any): Promise<string> {
    const now = new Date();
    const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;

    const seq = await tx.documentSequence.upsert({
      where: {
        tenantId_docType_yearMonth: {
          tenantId,
          docType: 'GOODS_RECEIVE',
          yearMonth,
        },
      },
      create: {
        tenantId,
        docType: 'GOODS_RECEIVE',
        prefix: 'GR',
        yearMonth,
        lastNumber: 1,
      },
      update: { lastNumber: { increment: 1 } },
    });

    return `GR-${yearMonth}-${String(seq.lastNumber).padStart(4, '0')}`;
  }

  /**
   * Find all goods receives with pagination and filters
   */
  async findAll(
    tenantId: string,
    query: QueryGoodsReceiveDto,
  ): Promise<PaginatedResponse<GoodsReceiveDetail>> {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;
    const sort = query.sort || 'createdAt';
    const order = query.order || 'desc';

    const where: Record<string, any> = { tenantId };

    if (query.warehouseId) {
      where.warehouseId = query.warehouseId;
    }

    if (query.purchaseOrderId) {
      where.purchaseOrderId = query.purchaseOrderId;
    }

    if (query.status) {
      where.status = query.status;
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

    const [receives, total] = await Promise.all([
      this.prisma.goodsReceive.findMany({
        where,
        include: {
          warehouse: { select: { id: true, name: true } },
          purchaseOrder: { select: { id: true, poNumber: true } },
          items: true,
        },
        orderBy: { [sort]: order },
        skip,
        take: limit,
      }),
      this.prisma.goodsReceive.count({ where }),
    ]);

    const data = receives.map((gr) => this.mapToDetail(gr));

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
   * Find a single goods receive by ID with full details
   */
  async findOne(id: string, tenantId: string): Promise<GoodsReceiveDetail> {
    // Pull everything the detail view needs in a single round-trip:
    //   - warehouse (name, code, location)
    //   - PO header (number, dates, supplier, terms)
    //   - PO items (so we can compute per-line ordered/received variance)
    //   - GR items + their inventory item master (sku, name, unit) + linked lot
    const receive = await this.prisma.goodsReceive.findUnique({
      where: { id },
      include: {
        warehouse: { select: { id: true, name: true, code: true, location: true } },
        purchaseOrder: {
          select: {
            id: true,
            poNumber: true,
            orderDate: true,
            expectedDate: true,
            currency: true,
            paymentTerms: true,
            supplier: {
              select: {
                id: true,
                name: true,
                code: true,
                contactPerson: true,
                phone: true,
                email: true,
                address: true,
                taxId: true,
              },
            },
            items: {
              select: { itemId: true, quantity: true, unitPrice: true },
            },
          },
        },
        items: {
          include: {
            // requiresQC drives the "pending QC" banner — must be fetched here.
            item: {
              select: { id: true, name: true, sku: true, unit: true, requiresQC: true },
            },
          },
        },
      },
    });

    if (!receive) {
      throw new NotFoundException(`Goods receive with ID ${id} not found`);
    }

    if (receive.tenantId !== tenantId) {
      throw new NotFoundException(`Goods receive with ID ${id} not found`);
    }

    // Resolve lot details for any GR items that have lotId set. One batched
    // query keyed by the unique set of lotIds beats N findUnique round-trips.
    const lotIds = Array.from(
      new Set(
        receive.items
          .map((it: any) => it.lotId)
          .filter((id: string | null): id is string => !!id),
      ),
    );
    const lots = lotIds.length
      ? await this.prisma.inventoryLot.findMany({
          where: { id: { in: lotIds } },
          select: {
            id: true,
            lotNumber: true,
            batchNumber: true,
            manufactureDate: true,
            expiryDate: true,
            remainingQty: true,
            initialQty: true,
            status: true,
          },
        })
      : [];
    const lotMap = new Map(lots.map((l) => [l.id, l]));

    // Resolve receiver + inspector display names so the UI doesn't render bare UUIDs.
    const userMap = await this.resolveUserNames([
      receive.receivedBy,
      receive.inspectedBy,
    ]);

    return this.mapToDetail(receive, { lotMap, userMap });
  }

  /**
   * Internal — resolve user UUIDs to display names (mirrors PurchaseOrdersService).
   */
  private async resolveUserNames(
    userIds: (string | null | undefined)[],
  ): Promise<Map<string, string>> {
    const validIds = userIds.filter((id): id is string => !!id);
    if (validIds.length === 0) return new Map();

    const users = await this.prisma.user.findMany({
      where: { id: { in: validIds } },
      select: { id: true, firstName: true, lastName: true, email: true },
    });

    return new Map(
      users.map((u) => [
        u.id,
        [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email,
      ]),
    );
  }

  /**
   * Create goods receive — international GRN flow.
   *
   * Behavior split based on whether ANY received item has requiresQC=true:
   *   • No QC needed  → create GR + items, then immediately call
   *     `_applyAcceptance()` in the same tx so behavior matches the legacy
   *     fast-path (stock written, PO updated, events emitted).
   *   • QC needed     → create GR with status='DRAFT' + items only.
   *     Stock/lot/PO updates do NOT happen yet. Caller must invoke
   *     POST /:id/accept (or /:id/reject) once QC is done.
   *
   * This finally makes status truthful: DRAFT means "physically captured but
   * not yet booked into inventory", ACCEPTED means "QC passed and live in
   * stock".
   */
  async create(
    dto: CreateGoodsReceiveDto,
    userId: string,
    tenantId: string,
  ): Promise<GoodsReceiveDetail> {
    if (!userId) {
      throw new BadRequestException('Authenticated user ID is required to create a goods receive');
    }
    if (!tenantId) {
      throw new BadRequestException('Tenant context is required to create a goods receive');
    }

    let poStatusTransition: PurchaseOrderReceivedEvent | null = null;
    let grEventPayload: GoodsReceiveCompletedEvent | null = null;

    const detail = await this.prisma.$transaction(async (tx) => {
      // 1. Validate warehouse
      const warehouse = await tx.warehouse.findUnique({
        where: { id: dto.warehouseId },
      });

      if (!warehouse) {
        throw new NotFoundException(`Warehouse with ID ${dto.warehouseId} not found`);
      }

      if (warehouse.tenantId !== tenantId) {
        throw new NotFoundException(`Warehouse with ID ${dto.warehouseId} not found`);
      }

      // 2. Validate PO if provided
      let po: any = null;
      if (dto.purchaseOrderId) {
        po = await tx.purchaseOrder.findUnique({
          where: { id: dto.purchaseOrderId },
          include: { items: true },
        });

        if (!po) {
          throw new NotFoundException(`Purchase Order with ID ${dto.purchaseOrderId} not found`);
        }

        if (po.tenantId !== tenantId) {
          throw new NotFoundException(`Purchase Order with ID ${dto.purchaseOrderId} not found`);
        }

        if (po.status !== 'APPROVED' && po.status !== 'PARTIALLY_RECEIVED') {
          throw new ConflictException(
            `Purchase Order must be in APPROVED or PARTIALLY_RECEIVED status`,
          );
        }
      }

      // 3. Pre-flight: load all inventory items so we know their requiresQC
      // upfront and can decide whether to create as DRAFT or fast-path to ACCEPTED.
      const itemIds = dto.items.map((i) => i.itemId);
      const invItems = await tx.inventoryItem.findMany({
        where: { id: { in: itemIds }, tenantId },
      });
      if (invItems.length !== new Set(itemIds).size) {
        throw new NotFoundException('One or more inventory items not found');
      }
      const invItemMap = new Map(invItems.map((i: any) => [i.id, i]));
      const requiresQC = invItems.some((i: any) => i.requiresQC === true);

      // 4. Generate GR number
      const grNumber = await this.generateGRNumber(tenantId, tx);

      // 5. Create GR header — DRAFT first; fast-path to ACCEPTED below if no QC.
      const goodsReceive = await tx.goodsReceive.create({
        data: {
          tenantId,
          grNumber,
          purchaseOrderId: dto.purchaseOrderId,
          warehouseId: dto.warehouseId,
          invoiceNumber: dto.invoiceNumber,
          invoiceDate: dto.invoiceDate ? new Date(dto.invoiceDate) : null,
          status: 'DRAFT',
          notes: dto.notes,
          receivedBy: userId,
        },
      });

      // 6. Insert GR items (always — captures what was physically received).
      // Stock-writing side effects are deferred to `_applyAcceptance()`.
      const grItems: any[] = [];
      for (const item of dto.items) {
        const acceptedQtyForCost = item.receivedQty - (item.rejectedQty || 0);
        const grItem = await tx.goodsReceiveItem.create({
          data: {
            goodsReceiveId: goodsReceive.id,
            itemId: item.itemId,
            receivedQty: item.receivedQty,
            rejectedQty: item.rejectedQty || 0,
            unitCost: item.unitCost,
            totalCost: acceptedQtyForCost * item.unitCost,
            batchNumber: item.batchNumber,
            expiryDate: item.expiryDate ? new Date(item.expiryDate) : null,
            rejectReason: item.rejectReason,
            notes: item.notes,
          },
        });
        grItems.push(grItem);
      }

      // 7. Always persist GR monetary totals — buyers expect to see the value
      // even on a DRAFT GR.
      const computedTotal = grItems.reduce(
        (sum: number, it: any) => sum + Number(it.totalCost ?? 0),
        0,
      );
      if (computedTotal > 0) {
        await tx.goodsReceive.update({
          where: { id: goodsReceive.id },
          data: { subtotal: computedTotal, totalAmount: computedTotal },
        });
        goodsReceive.subtotal = computedTotal as any;
        goodsReceive.totalAmount = computedTotal as any;
      }

      // 8. Fast-path: if NO item requires QC, run acceptance immediately
      //    so behavior matches the legacy auto-accept flow for items where
      //    QC is not required by the master record.
      if (!requiresQC) {
        const result = await this._applyAcceptance(
          tx,
          goodsReceive,
          grItems,
          dto.items,
          invItemMap,
          po,
          warehouse,
          userId,
          tenantId,
        );
        // Mutate locals so the response reflects the post-acceptance state.
        goodsReceive.status = 'ACCEPTED' as any;
        Object.assign(goodsReceive, { inspectedAt: result.inspectedAt, inspectedBy: userId });
        poStatusTransition = result.poStatusTransition;
        grEventPayload = result.grEventPayload;
        // grItems were updated in-place inside _applyAcceptance to carry lotId.
      } else {
        // QC-pending path: build a basic gr.completed event so consumers know a
        // GR was registered (status will be DRAFT in the payload). PO progress
        // is NOT emitted yet — it'll fire when the user explicitly accepts.
        grEventPayload = {
          grId: goodsReceive.id,
          grNumber: goodsReceive.grNumber,
          tenantId,
          warehouseId: goodsReceive.warehouseId,
          purchaseOrderId: goodsReceive.purchaseOrderId ?? null,
          status: 'DRAFT',
          items: grItems.map((it: any) => ({
            itemId: it.itemId,
            receivedQty: it.receivedQty,
            rejectedQty: it.rejectedQty ?? 0,
            lotId: it.lotId ?? null,
            expiryDate: it.expiryDate ? new Date(it.expiryDate).toISOString() : null,
          })),
          receivedBy: userId,
        };
      }

      // 9. Return full details
      return this.mapToDetail({
        ...goodsReceive,
        warehouse: { id: warehouse.id, name: warehouse.name },
        purchaseOrder: po ? { id: po.id, poNumber: po.poNumber } : null,
        items: grItems,
      });
    });

    // Post-commit emissions. Wrapped so a misbehaving listener can never roll
    // back the transaction or block the API response.
    try {
      if (grEventPayload) {
        this.eventEmitter.emit(INVENTORY_EVENTS.GR_COMPLETED, grEventPayload);
      }
      if (poStatusTransition) {
        this.eventEmitter.emit(INVENTORY_EVENTS.PO_RECEIVED, poStatusTransition);
      }
    } catch (err) {
      this.logger.error(
        `Failed to emit GR/PO event for ${detail.grNumber}: ${(err as Error).message}`,
      );
    }

    return detail;
  }

  /**
   * Mark goods receive as inspected
   */
  async inspect(
    id: string,
    userId: string,
    tenantId: string,
    status: 'INSPECTING' | 'REJECTED',
  ): Promise<GoodsReceiveDetail> {
    const receive = await this.prisma.goodsReceive.findUnique({
      where: { id },
    });

    if (!receive) {
      throw new NotFoundException(`Goods receive with ID ${id} not found`);
    }

    if (receive.tenantId !== tenantId) {
      throw new NotFoundException(`Goods receive with ID ${id} not found`);
    }

    if (receive.status !== 'ACCEPTED') {
      throw new ConflictException('Goods receive must be in ACCEPTED status to inspect');
    }

    const updated = await this.prisma.goodsReceive.update({
      where: { id },
      data: {
        status,
        inspectedBy: userId,
        inspectedAt: new Date(),
      },
      include: {
        warehouse: { select: { id: true, name: true } },
        purchaseOrder: { select: { id: true, poNumber: true } },
        items: {
          include: {
            item: { select: { id: true, name: true, sku: true } },
          },
        },
      },
    });

    return this.mapToDetail(updated);
  }

  /**
   * Internal — apply QC acceptance to a GR within an open transaction.
   * Writes lots, stock movements, warehouse stock, PO item rollups; updates
   * PO status if applicable; returns event payloads for post-commit emission.
   *
   * Used by:
   *   1. `create()` fast-path when no items require QC
   *   2. `accept()` endpoint after explicit QC pass
   */
  private async _applyAcceptance(
    tx: any,
    goodsReceive: any,
    grItems: any[],
    sourceItems: Array<{
      itemId: string;
      receivedQty: number;
      rejectedQty?: number;
      unitCost: number;
      batchNumber?: string;
      expiryDate?: string;
      notes?: string;
    }>,
    invItemMap: Map<string, any>,
    po: any,
    warehouse: any,
    userId: string,
    tenantId: string,
  ): Promise<{
    inspectedAt: Date;
    poStatusTransition: PurchaseOrderReceivedEvent | null;
    grEventPayload: GoodsReceiveCompletedEvent;
  }> {
    let poStatusTransition: PurchaseOrderReceivedEvent | null = null;

    // Process each line: create lot if needed, write stock movement, update
    // warehouse stock with weighted-average cost, update PO line receivedQty.
    for (let i = 0; i < sourceItems.length; i++) {
      const item = sourceItems[i];
      const grItem = grItems[i];
      const invItem = invItemMap.get(item.itemId);
      if (!invItem) continue;
      const acceptedQty = item.receivedQty - (item.rejectedQty || 0);
      if (acceptedQty <= 0) continue;

      // Lot creation for perishable / lot-tracked items
      let lotId: string | undefined;
      if (invItem.isPerishable || invItem.requiresLotTracking) {
        const lotNumber = await this.generateLotNumber(tenantId, tx);
        let expiryDate: Date | undefined;
        if (item.expiryDate) {
          expiryDate = new Date(item.expiryDate);
        } else if (invItem.isPerishable && invItem.defaultShelfLifeDays) {
          expiryDate = new Date();
          expiryDate.setDate(expiryDate.getDate() + invItem.defaultShelfLifeDays);
        }

        const lot = await tx.inventoryLot.create({
          data: {
            tenantId,
            itemId: item.itemId,
            warehouseId: goodsReceive.warehouseId,
            lotNumber,
            batchNumber: item.batchNumber,
            grItemId: grItem.id,
            supplierId: po?.supplierId,
            initialQty: acceptedQty,
            remainingQty: acceptedQty,
            unitCost: item.unitCost,
            expiryDate,
            status: InventoryLotStatus.ACTIVE,
          },
        });
        lotId = lot.id;
        await tx.goodsReceiveItem.update({
          where: { id: grItem.id },
          data: { lotId: lot.id } as any,
        });
        // Mutate the local copy so callers see the lotId in the event payload.
        grItem.lotId = lot.id;
      }

      // Stock movement (relation-form for `lot` — see lotId regression test)
      await tx.stockMovement.create({
        data: {
          id: crypto.randomUUID(),
          tenantId,
          warehouse: { connect: { id: goodsReceive.warehouseId } },
          item: { connect: { id: item.itemId } },
          type: 'GOODS_RECEIVE',
          quantity: acceptedQty,
          unitCost: item.unitCost,
          totalCost: acceptedQty * item.unitCost,
          referenceType: 'GOODS_RECEIVE',
          referenceId: goodsReceive.id,
          batchNumber: item.batchNumber,
          expiryDate: item.expiryDate ? new Date(item.expiryDate) : null,
          ...(lotId ? { lot: { connect: { id: lotId } } } : {}),
          notes: item.notes,
          createdBy: userId,
        } as any,
      });

      // Warehouse stock with weighted-average cost
      const existingStock = await tx.warehouseStock.findUnique({
        where: {
          warehouseId_itemId: {
            warehouseId: goodsReceive.warehouseId,
            itemId: item.itemId,
          },
        },
      });
      if (existingStock) {
        const newTotalQty = existingStock.quantity + acceptedQty;
        const newAvgCost =
          (existingStock.quantity * Number(existingStock.avgCost) +
            acceptedQty * item.unitCost) /
          newTotalQty;
        await tx.warehouseStock.update({
          where: {
            warehouseId_itemId: {
              warehouseId: goodsReceive.warehouseId,
              itemId: item.itemId,
            },
          },
          data: {
            quantity: newTotalQty,
            avgCost: newAvgCost,
            totalValue: newTotalQty * newAvgCost,
          },
        });
      } else {
        await tx.warehouseStock.create({
          data: {
            warehouseId: goodsReceive.warehouseId,
            itemId: item.itemId,
            quantity: acceptedQty,
            avgCost: item.unitCost,
            totalValue: acceptedQty * item.unitCost,
          },
        });
      }

      // PO line rollup
      if (po) {
        const poItem = po.items.find((pi: any) => pi.itemId === item.itemId);
        if (poItem) {
          const newReceivedQty = (poItem.receivedQty || 0) + acceptedQty;
          await tx.purchaseOrderItem.update({
            where: { id: poItem.id },
            data: { receivedQty: newReceivedQty },
          });
          // Local mirror so the PO recalc below sees fresh data.
          poItem.receivedQty = newReceivedQty;
        }
      }
    }

    // PO header status recalc
    if (po) {
      const poItems = await tx.purchaseOrderItem.findMany({
        where: { purchaseOrderId: po.id },
      });
      const allFullyReceived = poItems.every((pi: any) => pi.receivedQty >= pi.quantity);
      const anyPartiallyReceived = poItems.some(
        (pi: any) => pi.receivedQty > 0 && pi.receivedQty < pi.quantity,
      );
      const newPoStatus = allFullyReceived
        ? 'FULLY_RECEIVED'
        : anyPartiallyReceived
          ? 'PARTIALLY_RECEIVED'
          : po.status;
      if (newPoStatus !== po.status) {
        await tx.purchaseOrder.update({
          where: { id: po.id },
          data: { status: newPoStatus },
        });
        const orderedQty = poItems.reduce(
          (s: number, p: any) => s + (p.quantity ?? 0),
          0,
        );
        const receivedQty = poItems.reduce(
          (s: number, p: any) => s + (p.receivedQty ?? 0),
          0,
        );
        poStatusTransition = {
          purchaseOrderId: po.id,
          poNumber: po.poNumber,
          tenantId,
          oldStatus: po.status,
          newStatus: newPoStatus as 'PARTIALLY_RECEIVED' | 'FULLY_RECEIVED',
          percent: orderedQty > 0 ? Math.round((receivedQty / orderedQty) * 100) : 0,
          orderedQty,
          receivedQty,
          triggeredByGrId: goodsReceive.id,
        };
      }
    }

    // Mark GR as ACCEPTED + record QC stamp
    const inspectedAt = new Date();
    await tx.goodsReceive.update({
      where: { id: goodsReceive.id },
      data: {
        status: 'ACCEPTED',
        inspectedBy: userId,
        inspectedAt,
      },
    });

    return {
      inspectedAt,
      poStatusTransition,
      grEventPayload: {
        grId: goodsReceive.id,
        grNumber: goodsReceive.grNumber,
        tenantId,
        warehouseId: goodsReceive.warehouseId,
        purchaseOrderId: goodsReceive.purchaseOrderId ?? null,
        status: 'ACCEPTED',
        items: grItems.map((it: any) => ({
          itemId: it.itemId,
          receivedQty: it.receivedQty,
          rejectedQty: it.rejectedQty ?? 0,
          lotId: it.lotId ?? null,
          expiryDate: it.expiryDate ? new Date(it.expiryDate).toISOString() : null,
        })),
        receivedBy: userId,
      },
    };
  }

  /**
   * Accept a DRAFT or INSPECTING GR — writes stock, creates lots, updates PO.
   * This is the "QC passed" action.
   */
  async accept(
    id: string,
    userId: string,
    tenantId: string,
  ): Promise<GoodsReceiveDetail> {
    let poStatusTransition: PurchaseOrderReceivedEvent | null = null;
    let grEventPayload: GoodsReceiveCompletedEvent | null = null;

    const result = await this.prisma.$transaction(async (tx) => {
      const gr = await tx.goodsReceive.findUnique({
        where: { id },
        include: {
          items: true,
          warehouse: true,
          purchaseOrder: { include: { items: true } },
        },
      });
      if (!gr || gr.tenantId !== tenantId) {
        throw new NotFoundException('Goods receive not found');
      }
      if (gr.status !== 'DRAFT' && gr.status !== 'INSPECTING') {
        throw new ConflictException(
          'Only DRAFT or INSPECTING goods receives can be accepted',
        );
      }

      // Re-fetch inventoryItem master so _applyAcceptance has the same shape
      // it does in create().
      const itemIds = Array.from(new Set(gr.items.map((it: any) => it.itemId)));
      const invItems = await tx.inventoryItem.findMany({
        where: { id: { in: itemIds }, tenantId },
      });
      const invItemMap = new Map(invItems.map((i: any) => [i.id, i]));

      // The DTO-shape that _applyAcceptance expects — we re-derive it from
      // the persisted GR items so we can reuse the helper unchanged.
      const sourceItems = gr.items.map((it: any) => ({
        itemId: it.itemId,
        receivedQty: it.receivedQty,
        rejectedQty: it.rejectedQty,
        unitCost: Number(it.unitCost),
        batchNumber: it.batchNumber ?? undefined,
        expiryDate: it.expiryDate ? it.expiryDate.toISOString() : undefined,
        notes: it.notes ?? undefined,
      }));

      const acceptResult = await this._applyAcceptance(
        tx,
        gr,
        gr.items,
        sourceItems,
        invItemMap,
        gr.purchaseOrder,
        gr.warehouse,
        userId,
        tenantId,
      );

      poStatusTransition = acceptResult.poStatusTransition;
      grEventPayload = acceptResult.grEventPayload;

      const fresh = await tx.goodsReceive.findUnique({
        where: { id },
        include: {
          warehouse: { select: { id: true, name: true, code: true, location: true } },
          purchaseOrder: {
            select: {
              id: true,
              poNumber: true,
              orderDate: true,
              expectedDate: true,
              currency: true,
              paymentTerms: true,
              supplier: {
                select: {
                  id: true,
                  name: true,
                  code: true,
                  contactPerson: true,
                  phone: true,
                  email: true,
                  address: true,
                  taxId: true,
                },
              },
              items: { select: { itemId: true, quantity: true, unitPrice: true } },
            },
          },
          items: {
            include: {
              item: { select: { id: true, name: true, sku: true, unit: true, requiresQC: true } },
            },
          },
        },
      });
      return fresh;
    });

    try {
      if (grEventPayload) this.eventEmitter.emit(INVENTORY_EVENTS.GR_COMPLETED, grEventPayload);
      if (poStatusTransition) this.eventEmitter.emit(INVENTORY_EVENTS.PO_RECEIVED, poStatusTransition);
    } catch (err) {
      this.logger.error(`Failed to emit accept event: ${(err as Error).message}`);
    }

    return this.mapToDetail(result);
  }

  /**
   * Reject a DRAFT or INSPECTING GR — no stock writes, no PO updates.
   * Records who rejected and why.
   */
  async reject(
    id: string,
    userId: string,
    reason: string,
    tenantId: string,
  ): Promise<GoodsReceiveDetail> {
    if (!reason || reason.trim().length < 5) {
      throw new BadRequestException(
        'A reason of at least 5 characters is required to reject a goods receive',
      );
    }

    const gr = await this.prisma.goodsReceive.findUnique({ where: { id } });
    if (!gr || gr.tenantId !== tenantId) {
      throw new NotFoundException('Goods receive not found');
    }
    if (gr.status !== 'DRAFT' && gr.status !== 'INSPECTING') {
      throw new ConflictException(
        'Only DRAFT or INSPECTING goods receives can be rejected',
      );
    }

    await this.prisma.goodsReceive.update({
      where: { id },
      data: {
        status: 'REJECTED',
        inspectedBy: userId,
        inspectedAt: new Date(),
        notes: gr.notes
          ? `${gr.notes}\n\n[REJECTED ${new Date().toISOString()}] ${reason.trim()}`
          : `[REJECTED ${new Date().toISOString()}] ${reason.trim()}`,
      },
    });

    this.logger.log(
      `Goods receive rejected: ${id} by ${userId} — "${reason.slice(0, 60)}"`,
    );

    return this.findOne(id, tenantId);
  }

  /**
   * Map raw database record to response DTO.
   * Optional `enrich` argument carries pre-fetched lot + user lookups so we
   * don't issue per-row queries here. When omitted (e.g. from `create()`'s
   * return path) the mapper falls back to ID-only output.
   */
  private mapToDetail(
    receive: any,
    enrich?: {
      lotMap?: Map<string, any>;
      userMap?: Map<string, string>;
    },
  ): GoodsReceiveDetail {
    const items = receive.items || [];
    const totalReceivedQty = items.reduce(
      (sum: number, item: any) => sum + item.receivedQty,
      0,
    );
    const totalRejectedQty = items.reduce(
      (sum: number, item: any) => sum + (item.rejectedQty || 0),
      0,
    );

    // Build a lookup of orderedQty per itemId from the linked PO so each
    // GR line can show "ordered vs received". A PO can have multiple lines
    // per item in theory; we sum across them.
    const poItems: Array<{ itemId: string; quantity: number; unitPrice: any }> =
      receive.purchaseOrder?.items ?? [];
    const orderedByItem = new Map<string, number>();
    for (const pi of poItems) {
      orderedByItem.set(pi.itemId, (orderedByItem.get(pi.itemId) ?? 0) + (pi.quantity ?? 0));
    }
    const totalOrderedQty = poItems.length
      ? Array.from(orderedByItem.values()).reduce((s, q) => s + q, 0)
      : undefined;

    const lotMap = enrich?.lotMap ?? new Map();
    const userMap = enrich?.userMap ?? new Map();

    const mappedItems = items.map((item: any) => {
      const lot = item.lotId ? lotMap.get(item.lotId) : null;
      const orderedQty = orderedByItem.get(item.itemId) ?? null;
      const acceptedQty = item.receivedQty - (item.rejectedQty || 0);
      return {
        id: item.id,
        itemId: item.itemId,
        itemName: item.item?.name,
        itemSku: item.item?.sku,
        itemUnit: item.item?.unit,
        // PO-vs-GR variance per line. Negative = under-delivered, positive = over.
        orderedQty,
        receivedQty: item.receivedQty,
        rejectedQty: item.rejectedQty || 0,
        acceptedQty,
        varianceQty: orderedQty != null ? item.receivedQty - orderedQty : null,
        unitCost: Number(item.unitCost),
        // lineTotal uses ACCEPTED qty (rejected items aren't paid for)
        lineTotal: acceptedQty * Number(item.unitCost),
        batchNumber: item.batchNumber,
        expiryDate: item.expiryDate?.toISOString() ?? null,
        rejectReason: item.rejectReason,
        notes: item.notes,
        // Lot info (only when linked + lookup hit)
        lotId: item.lotId ?? null,
        lotNumber: lot?.lotNumber ?? null,
        lotStatus: lot?.status ?? null,
        manufactureDate: lot?.manufactureDate?.toISOString() ?? null,
      };
    });

    const varianceQty =
      totalOrderedQty != null ? totalReceivedQty - totalOrderedQty : undefined;

    return {
      id: receive.id,
      tenantId: receive.tenantId,
      grNumber: receive.grNumber,
      purchaseOrderId: receive.purchaseOrderId,
      poNumber: receive.purchaseOrder?.poNumber,
      poSnapshot: receive.purchaseOrder
        ? {
            id: receive.purchaseOrder.id,
            poNumber: receive.purchaseOrder.poNumber,
            orderDate: receive.purchaseOrder.orderDate?.toISOString(),
            expectedDate:
              receive.purchaseOrder.expectedDate?.toISOString() ?? null,
            currency: receive.purchaseOrder.currency ?? 'THB',
            paymentTerms: receive.purchaseOrder.paymentTerms ?? null,
          }
        : undefined,
      supplier: receive.purchaseOrder?.supplier
        ? {
            id: receive.purchaseOrder.supplier.id,
            name: receive.purchaseOrder.supplier.name,
            code: receive.purchaseOrder.supplier.code,
            contactPerson: receive.purchaseOrder.supplier.contactPerson,
            phone: receive.purchaseOrder.supplier.phone,
            email: receive.purchaseOrder.supplier.email,
            address: receive.purchaseOrder.supplier.address,
            taxId: receive.purchaseOrder.supplier.taxId,
          }
        : undefined,
      warehouseId: receive.warehouseId,
      warehouseName: receive.warehouse?.name,
      warehouseCode: receive.warehouse?.code ?? null,
      warehouseLocation: receive.warehouse?.location ?? null,
      invoiceNumber: receive.invoiceNumber,
      invoiceDate: receive.invoiceDate?.toISOString(),
      status: receive.status,
      // Aggregate requiresQC across the GR lines so the UI can show the
      // pending-QC banner without doing its own join.
      requiresQC: items.some((it: any) => it.item?.requiresQC === true),
      qcPending:
        items.some((it: any) => it.item?.requiresQC === true) && !receive.inspectedAt,
      itemCount: items.length,
      totalReceivedQty,
      totalRejectedQty,
      totalOrderedQty,
      varianceQty,
      // Variance value uses unit costs from the GR (what we agreed to pay)
      // rather than PO unit prices, so it reflects the cash impact of
      // missing or extra goods.
      varianceAmount: items.reduce((sum: number, it: any, idx: number) => {
        const m = mappedItems[idx];
        return m.varianceQty != null
          ? sum + m.varianceQty * m.unitCost
          : sum;
      }, 0),
      subtotal: Number(receive.subtotal ?? 0),
      totalAmount: Number(receive.totalAmount ?? 0),
      notes: receive.notes,
      createdBy: receive.receivedBy,
      createdByName: userMap.get(receive.receivedBy) ?? null,
      inspectedByName: receive.inspectedBy
        ? userMap.get(receive.inspectedBy) ?? null
        : null,
      createdAt: receive.createdAt,
      updatedAt: receive.updatedAt,
      inspectedBy: receive.inspectedBy,
      inspectedAt: receive.inspectedAt,
      items: items.length > 0 ? mappedItems : undefined,
    };
  }
}
