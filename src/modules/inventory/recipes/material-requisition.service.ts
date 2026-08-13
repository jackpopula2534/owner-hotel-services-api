import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { IntegrationsService } from '../../integrations/integrations.service';
import { StockMovementsService } from '../stock-movements/stock-movements.service';
import { StockMovementTypeDto } from '../stock-movements/dto/create-stock-movement.dto';
import {
  ItemPriceEstimateService,
  PRICE_SOURCE_LABEL,
} from '../pricing/item-price-estimate.service';
import {
  CancelMaterialRequisitionDto,
  ListMaterialRequisitionsDto,
  SubmitRecipeRequisitionDto,
} from './dto/recipe-requisition.dto';
import {
  REQUISITION_DOC_PREFIX,
  REQUISITION_DOC_TYPE,
  REQUISITION_INTEGRATION_KEY,
  REQUISITION_OFF_MESSAGE,
  REQUISITION_REF_TYPE,
} from './requisition.types';

/** A line after duplicates are merged and stock has been read. */
interface ResolvedLine {
  itemId: string;
  itemName: string;
  quantity: number;
  requiredQty: number;
  available: number;
  shortage: number;
  avgCost: number;
}

/** A stored document with the joins both read paths need before decorating. */
type RequisitionRow = Prisma.MaterialRequisitionGetPayload<{
  include: {
    items: { include: { item: { select: { name: true; sku: true; unit: true } } } };
    purchaseRequisition: { select: { id: true; prNumber: true; status: true } };
  };
}>;

export interface RequisitionSummary {
  id: string;
  reqNumber: string;
  status: string;
  mode: string;
  createdAt: Date;
  readyAt: Date | null;
  issuedAt: Date | null;
  sourceWarehouse: { id: string; name: string } | null;
  toWarehouse: { id: string; name: string } | null;
  purchaseRequisition: { id: string; prNumber: string; status: string } | null;
  notes: string | null;
  lines: {
    itemId: string;
    itemName: string;
    sku: string;
    unit: string;
    quantity: number;
    requiredQty: number;
    shortageQty: number;
    /** Live stock at the source — what makes the document issuable right now. */
    availableQty: number;
    enough: boolean;
  }[];
  /** Every line can be covered by the source warehouse as things stand. */
  fulfillable: boolean;
}

/**
 * The requisition as a document.
 *
 * A requisition used to be a fire-and-forget action: check stock, move stock,
 * done. That breaks the moment the warehouse is short — the kitchen still needs
 * the food, and someone has to buy it. So the document persists: it parks in
 * WAITING_STOCK (optionally carrying the purchase requisition it raised), and a
 * goods receipt landing in its source warehouse flips it to READY.
 */
@Injectable()
export class MaterialRequisitionService {
  private readonly logger = new Logger(MaterialRequisitionService.name);

  constructor(
    private prisma: PrismaService,
    private integrations: IntegrationsService,
    private stockMovements: StockMovementsService,
    private priceEstimates: ItemPriceEstimateService,
  ) {}

  /**
   * Turns the edited draft into a document. `action: 'issue'` demands the stock
   * be there and moves it; `action: 'reserve'` parks the document and — if asked —
   * opens a purchase requisition for whatever is missing.
   */
  async create(
    tenantId: string,
    userId: string,
    dto: SubmitRecipeRequisitionDto,
  ): Promise<{
    id: string;
    requisitionNo: string;
    status: string;
    mode: 'transfer' | 'issue';
    lineCount: number;
    totalQty: number;
    shortLines: { itemName: string; missing: number }[];
    purchaseRequisition: { id: string; prNumber: string } | null;
  }> {
    await this.assertConnected(tenantId);

    const source = await this.prisma.warehouse.findFirst({
      where: { id: dto.sourceWarehouseId, tenantId, deletedAt: null },
      select: { id: true, name: true, propertyId: true },
    });
    if (!source) throw new BadRequestException('ไม่พบคลังต้นทาง');

    let dest: { id: string; name: string } | null = null;
    if (dto.mode === 'transfer') {
      if (!dto.toWarehouseId) {
        throw new BadRequestException('โหมดโอนต้องระบุคลังปลายทาง');
      }
      if (dto.toWarehouseId === dto.sourceWarehouseId) {
        throw new BadRequestException('คลังต้นทางและปลายทางต้องไม่ใช่คลังเดียวกัน');
      }
      dest = await this.prisma.warehouse.findFirst({
        where: { id: dto.toWarehouseId, tenantId, deletedAt: null },
        select: { id: true, name: true },
      });
      if (!dest) throw new BadRequestException('ไม่พบคลังปลายทาง');
    }

    const lines = await this.resolveLines(tenantId, source.id, dto.lines);
    const short = lines.filter((l) => l.shortage > 0);
    const action = dto.action ?? 'issue';

    // Issuing is all-or-nothing: the caller asked to move stock, so refusing up
    // front is kinder than half a requisition landing in the kitchen.
    if (action === 'issue' && short.length > 0) {
      const first = short[0];
      throw new BadRequestException(
        `สต็อกในคลัง "${source.name}" ไม่พอสำหรับ "${first.itemName}" ` +
          `(มี ${first.available} ต้องการ ${first.quantity})` +
          (short.length > 1 ? ` และอีก ${short.length - 1} รายการ` : ''),
      );
    }

    const reqNumber = await this.nextDocNumber(tenantId);
    const status =
      action === 'issue' ? 'ISSUED' : short.length > 0 ? 'WAITING_STOCK' : 'READY';

    // The purchase requisition is raised first so the document can point at it
    // from the moment it exists — a waiting requisition with no visible reason
    // is exactly the dead end this feature is meant to remove.
    let pr: { id: string; prNumber: string } | null = null;
    if (action === 'reserve' && dto.createPurchaseRequisition && short.length > 0) {
      pr = await this.raisePurchaseRequisition(
        tenantId,
        userId,
        source.propertyId,
        reqNumber,
        short,
        dto.requiredDate,
      );
    }

    const doc = await this.prisma.materialRequisition.create({
      data: {
        tenantId,
        propertyId: source.propertyId,
        restaurantId: dto.restaurantId ?? null,
        reqNumber,
        status: status as any,
        mode: dto.mode === 'transfer' ? 'TRANSFER' : 'ISSUE',
        sourceWarehouseId: source.id,
        toWarehouseId: dest?.id ?? null,
        purchaseRequisitionId: pr?.id ?? null,
        notes: dto.notes ?? null,
        createdBy: userId,
        readyAt: status === 'READY' ? new Date() : null,
        issuedBy: status === 'ISSUED' ? userId : null,
        issuedAt: status === 'ISSUED' ? new Date() : null,
        items: {
          create: lines.map((l) => ({
            itemId: l.itemId,
            quantity: l.quantity,
            requiredQty: new Prisma.Decimal(l.requiredQty || l.quantity),
            shortageQty: l.shortage,
          })),
        },
      },
      select: { id: true },
    });

    if (action === 'issue') {
      await this.applyMovements(tenantId, userId, reqNumber, source, dest, lines, dto.notes);
    }

    this.logger.log(
      `Material requisition ${reqNumber} created (${lines.length} lines, ${status}` +
        `${pr ? `, PR ${pr.prNumber}` : ''})`,
    );

    return {
      id: doc.id,
      requisitionNo: reqNumber,
      status,
      mode: dto.mode,
      lineCount: lines.length,
      totalQty: lines.reduce((sum, l) => sum + l.quantity, 0),
      shortLines: short.map((l) => ({ itemName: l.itemName, missing: l.shortage })),
      purchaseRequisition: pr,
    };
  }

  /** Open requisitions with live source stock, so the UI can say what is issuable. */
  async list(tenantId: string, query: ListMaterialRequisitionsDto): Promise<RequisitionSummary[]> {
    const where: Prisma.MaterialRequisitionWhereInput = { tenantId };
    // No status filter means "what is still on my plate" — issued and cancelled
    // documents are history and would bury the two rows that need action.
    // 'ALL' is the explicit opt-in to that history, used by the full list page.
    if (query.status && query.status !== 'ALL') {
      where.status = query.status as any;
    } else if (!query.status) {
      where.status = { in: ['WAITING_STOCK', 'READY'] as any };
    }
    if (query.restaurantId) where.restaurantId = query.restaurantId;
    if (query.search?.trim()) {
      const search = query.search.trim();
      where.OR = [
        { reqNumber: { contains: search } },
        { purchaseRequisition: { prNumber: { contains: search } } },
      ];
    }

    const rows = await this.prisma.materialRequisition.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: query.limit ?? 50,
      include: {
        items: { include: { item: { select: { name: true, sku: true, unit: true } } } },
        purchaseRequisition: { select: { id: true, prNumber: true, status: true } },
      },
    });

    return this.decorate(tenantId, rows);
  }

  /**
   * One document, same shape as a list row — what the detail modal opens on,
   * including when it is deep-linked from a purchase requisition.
   */
  async findOne(tenantId: string, id: string): Promise<RequisitionSummary> {
    const row = await this.prisma.materialRequisition.findFirst({
      where: { id, tenantId },
      include: {
        items: { include: { item: { select: { name: true, sku: true, unit: true } } } },
        purchaseRequisition: { select: { id: true, prNumber: true, status: true } },
      },
    });
    if (!row) throw new NotFoundException('ไม่พบใบเบิกนี้');

    const [summary] = await this.decorate(tenantId, [row]);
    return summary;
  }

  /**
   * Joins live warehouse stock onto stored documents. Availability is never
   * stored on the row — a document that was READY an hour ago may not be now.
   */
  private async decorate(
    tenantId: string,
    rows: RequisitionRow[],
  ): Promise<RequisitionSummary[]> {
    if (rows.length === 0) return [];

    const warehouseIds = [
      ...new Set(rows.flatMap((r) => [r.sourceWarehouseId, r.toWarehouseId].filter(Boolean))),
    ] as string[];
    const warehouses = await this.prisma.warehouse.findMany({
      where: { id: { in: warehouseIds }, tenantId },
      select: { id: true, name: true },
    });
    const whById = new Map(warehouses.map((w) => [w.id, w]));

    const stocks = await this.prisma.warehouseStock.findMany({
      where: {
        warehouseId: { in: [...new Set(rows.map((r) => r.sourceWarehouseId))] },
        itemId: { in: [...new Set(rows.flatMap((r) => r.items.map((i) => i.itemId)))] },
      },
      select: { warehouseId: true, itemId: true, quantity: true },
    });
    const stockMap = new Map(stocks.map((s) => [`${s.warehouseId}:${s.itemId}`, s.quantity]));

    return rows.map((r) => {
      const lines = r.items.map((i) => {
        const availableQty = stockMap.get(`${r.sourceWarehouseId}:${i.itemId}`) ?? 0;
        return {
          itemId: i.itemId,
          itemName: i.item.name,
          sku: i.item.sku,
          unit: String(i.item.unit),
          quantity: i.quantity,
          requiredQty: Number(i.requiredQty),
          shortageQty: i.shortageQty,
          availableQty,
          enough: availableQty >= i.quantity,
        };
      });
      return {
        id: r.id,
        reqNumber: r.reqNumber,
        status: String(r.status),
        mode: String(r.mode),
        createdAt: r.createdAt,
        readyAt: r.readyAt,
        issuedAt: r.issuedAt,
        sourceWarehouse: whById.get(r.sourceWarehouseId) ?? null,
        toWarehouse: r.toWarehouseId ? (whById.get(r.toWarehouseId) ?? null) : null,
        purchaseRequisition: r.purchaseRequisition
          ? {
              id: r.purchaseRequisition.id,
              prNumber: r.purchaseRequisition.prNumber,
              status: String(r.purchaseRequisition.status),
            }
          : null,
        notes: r.notes,
        lines,
        fulfillable: lines.every((l) => l.enough),
      };
    });
  }

  /** Moves the stock a parked requisition was waiting for. */
  async issue(
    tenantId: string,
    userId: string,
    id: string,
  ): Promise<{ id: string; requisitionNo: string; status: string; totalQty: number }> {
    await this.assertConnected(tenantId);

    const doc = await this.prisma.materialRequisition.findFirst({
      where: { id, tenantId },
      include: { items: true },
    });
    if (!doc) throw new NotFoundException('ไม่พบใบเบิกนี้');
    if (doc.status === 'ISSUED') throw new BadRequestException('ใบเบิกนี้เบิกไปแล้ว');
    if (doc.status === 'CANCELLED') throw new BadRequestException('ใบเบิกนี้ถูกยกเลิกไปแล้ว');

    const source = await this.prisma.warehouse.findFirst({
      where: { id: doc.sourceWarehouseId, tenantId, deletedAt: null },
      select: { id: true, name: true, propertyId: true },
    });
    if (!source) throw new BadRequestException('ไม่พบคลังต้นทางของใบเบิกนี้');

    let dest: { id: string; name: string } | null = null;
    if (doc.mode === 'TRANSFER' && doc.toWarehouseId) {
      dest = await this.prisma.warehouse.findFirst({
        where: { id: doc.toWarehouseId, tenantId, deletedAt: null },
        select: { id: true, name: true },
      });
      if (!dest) throw new BadRequestException('ไม่พบคลังปลายทางของใบเบิกนี้');
    }

    // Stock is re-checked at issue time, never trusted from when READY was set —
    // anything could have drawn the same items down in between.
    const lines = await this.resolveLines(
      tenantId,
      source.id,
      doc.items.map((i) => ({
        itemId: i.itemId,
        quantity: i.quantity,
        requiredQty: Number(i.requiredQty),
      })),
    );
    const short = lines.filter((l) => l.shortage > 0);
    if (short.length > 0) {
      throw new BadRequestException(
        `สต็อกในคลัง "${source.name}" ยังไม่พอสำหรับ "${short[0].itemName}" ` +
          `(มี ${short[0].available} ต้องการ ${short[0].quantity})`,
      );
    }

    await this.applyMovements(
      tenantId,
      userId,
      doc.reqNumber,
      source,
      dest,
      lines,
      doc.notes ?? undefined,
    );

    await this.prisma.materialRequisition.update({
      where: { id: doc.id },
      data: { status: 'ISSUED', issuedBy: userId, issuedAt: new Date() },
    });

    this.logger.log(`Material requisition ${doc.reqNumber} issued by user ${userId}`);
    return {
      id: doc.id,
      requisitionNo: doc.reqNumber,
      status: 'ISSUED',
      totalQty: lines.reduce((sum, l) => sum + l.quantity, 0),
    };
  }

  async cancel(
    tenantId: string,
    userId: string,
    id: string,
    dto: CancelMaterialRequisitionDto,
  ): Promise<{ id: string; status: string }> {
    const doc = await this.prisma.materialRequisition.findFirst({
      where: { id, tenantId },
      select: { id: true, status: true, notes: true, reqNumber: true },
    });
    if (!doc) throw new NotFoundException('ไม่พบใบเบิกนี้');
    if (doc.status === 'ISSUED') {
      throw new BadRequestException('ใบเบิกที่เบิกของไปแล้วยกเลิกไม่ได้ — ใช้การโอนคืนแทน');
    }

    await this.prisma.materialRequisition.update({
      where: { id: doc.id },
      data: {
        status: 'CANCELLED',
        cancelledBy: userId,
        cancelledAt: new Date(),
        notes: dto.reason ? `${doc.notes ? `${doc.notes} · ` : ''}ยกเลิก: ${dto.reason}` : doc.notes,
      },
    });

    this.logger.log(`Material requisition ${doc.reqNumber} cancelled by user ${userId}`);
    return { id: doc.id, status: 'CANCELLED' };
  }

  // ─── internals ──────────────────────────────────────────────────────────────

  private async assertConnected(tenantId: string): Promise<void> {
    const connected = await this.integrations.isEnabled(tenantId, REQUISITION_INTEGRATION_KEY);
    if (!connected) throw new BadRequestException(REQUISITION_OFF_MESSAGE);
  }

  /** Merges duplicate lines, checks the items belong here, and reads source stock. */
  private async resolveLines(
    tenantId: string,
    sourceWarehouseId: string,
    input: { itemId: string; quantity: number; requiredQty?: number }[],
  ): Promise<ResolvedLine[]> {
    const merged = new Map<string, { quantity: number; requiredQty: number }>();
    for (const line of input) {
      const prev = merged.get(line.itemId) ?? { quantity: 0, requiredQty: 0 };
      merged.set(line.itemId, {
        quantity: prev.quantity + line.quantity,
        requiredQty: prev.requiredQty + (line.requiredQty ?? 0),
      });
    }

    const itemIds = [...merged.keys()];
    const items = await this.prisma.inventoryItem.findMany({
      where: { id: { in: itemIds }, tenantId, deletedAt: null },
      select: { id: true, name: true },
    });
    const nameById = new Map(items.map((i) => [i.id, i.name]));
    const missing = itemIds.filter((id) => !nameById.has(id));
    if (missing.length > 0) {
      throw new BadRequestException(`มีสินค้า ${missing.length} รายการที่ไม่พบในคลังของกิจการนี้`);
    }

    const stocks = await this.prisma.warehouseStock.findMany({
      where: { warehouseId: sourceWarehouseId, itemId: { in: itemIds } },
      select: { itemId: true, quantity: true, avgCost: true },
    });
    const stockByItem = new Map(stocks.map((s) => [s.itemId, s]));

    return itemIds.map((itemId) => {
      const { quantity, requiredQty } = merged.get(itemId)!;
      const stock = stockByItem.get(itemId);
      const available = stock?.quantity ?? 0;
      return {
        itemId,
        itemName: nameById.get(itemId)!,
        quantity,
        requiredQty,
        available,
        shortage: Math.max(0, quantity - available),
        avgCost: Number(stock?.avgCost ?? 0),
      };
    });
  }

  /**
   * Writes the stock movements. Callers pre-check every line first, so this only
   * runs once the whole requisition is known to be coverable.
   */
  private async applyMovements(
    tenantId: string,
    userId: string,
    reqNumber: string,
    source: { id: string; name: string },
    dest: { id: string; name: string } | null,
    lines: ResolvedLine[],
    notes?: string,
  ): Promise<void> {
    const label = dest
      ? `ใบเบิกวัตถุดิบตามสูตร ${reqNumber} → ${dest.name}`
      : `ใบเบิกวัตถุดิบตามสูตร ${reqNumber}`;
    const movementNotes = notes ? `${label} · ${notes}` : label;

    for (const line of lines) {
      if (dest) {
        await this.stockMovements.createTransfer(
          {
            fromWarehouseId: source.id,
            toWarehouseId: dest.id,
            itemId: line.itemId,
            quantity: line.quantity,
            referenceType: REQUISITION_REF_TYPE,
            referenceId: reqNumber,
            notes: movementNotes,
          },
          userId,
          tenantId,
        );
      } else {
        await this.stockMovements.createMovement(
          {
            warehouseId: source.id,
            itemId: line.itemId,
            type: StockMovementTypeDto.GOODS_ISSUE,
            quantity: line.quantity,
            unitCost: line.avgCost,
            referenceType: REQUISITION_REF_TYPE,
            referenceId: reqNumber,
            notes: movementNotes,
          },
          userId,
          tenantId,
        );
      }
    }
  }

  /**
   * Opens a DRAFT purchase requisition for the shortfall. DRAFT rather than
   * submitted, because approval is procurement's call, not the kitchen's — this
   * only puts the request on their desk.
   *
   * Every line carries a price estimate where one can be justified. The kitchen
   * has no price to type in, and a requisition that reaches procurement with a
   * column of dashes gives an approver nothing to weigh — so the estimate is
   * looked up here, with a note saying where it came from.
   */
  private async raisePurchaseRequisition(
    tenantId: string,
    userId: string,
    propertyId: string,
    reqNumber: string,
    short: ResolvedLine[],
    requiredDate?: string,
  ): Promise<{ id: string; prNumber: string }> {
    const estimates = await this.priceEstimates.estimateMany(
      tenantId,
      short.map((l) => l.itemId),
    );

    return this.prisma.$transaction(async (tx) => {
      const prNumber = await this.nextDocNumber(tenantId, 'PURCHASE_REQUISITION', 'PR', tx);
      const pr = await tx.purchaseRequisition.create({
        data: {
          tenantId,
          propertyId,
          prNumber,
          status: 'DRAFT',
          priority: 'NORMAL',
          requiredDate: requiredDate ? new Date(requiredDate) : null,
          purpose: `เติมวัตถุดิบให้ใบเบิก ${reqNumber} (คำนวณจากสูตรอาหาร)`,
          department: 'ครัว / F&B',
          requestedBy: userId,
          items: {
            create: short.map((l) => {
              const estimate = estimates.get(l.itemId);
              if (!estimate) {
                return { itemId: l.itemId, quantity: l.shortage };
              }
              return {
                itemId: l.itemId,
                quantity: l.shortage,
                estimatedUnitPrice: new Prisma.Decimal(estimate.unitPrice),
                estimatedTotalPrice: new Prisma.Decimal(estimate.unitPrice * l.shortage),
                preferredSupplierId: estimate.supplierId,
                notes: PRICE_SOURCE_LABEL[estimate.source],
              };
            }),
          },
        },
        select: { id: true, prNumber: true },
      });
      return pr;
    });
  }

  /**
   * `RCP-YYYYMM-0001` via the shared DocumentSequence table, so two people
   * submitting at the same moment cannot land on the same number.
   */
  private async nextDocNumber(
    tenantId: string,
    docType: string = REQUISITION_DOC_TYPE,
    prefix: string = REQUISITION_DOC_PREFIX,
    tx?: Prisma.TransactionClient,
  ): Promise<string> {
    const client = tx ?? this.prisma;
    const now = new Date();
    const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const seq = await client.documentSequence.upsert({
      where: { tenantId_docType_yearMonth: { tenantId, docType, yearMonth } },
      create: { tenantId, docType, prefix, yearMonth, lastNumber: 1 },
      update: { lastNumber: { increment: 1 } },
    });
    return `${prefix}-${yearMonth}-${String(seq.lastNumber).padStart(4, '0')}`;
  }
}
