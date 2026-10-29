import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ItemUnit } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import {
  FieldChange,
  ProcurementFieldKey,
  ProcurementSnapshot,
  getFieldDef,
  normalizeValue,
} from './product-change-fields';
import type { NewItemProposalDto } from './dto/create-product-request.dto';
import type { WarehouseDataDto } from './dto/review-product-request.dto';

type Tx = Prisma.TransactionClient;

export interface StockImpact {
  onHand: number;
  stockValue: number;
  avgCost: number;
  unit: string | null;
  minStock: number;
  maxStock: number | null;
  openPurchaseOrders: Array<{
    id: string;
    poNumber: string;
    status: string;
    orderedQty: number;
    receivedQty: number;
    unitPrice: number;
  }>;
}

export interface DuplicateCandidate {
  id: string;
  sku: string;
  name: string;
  brand: string | null;
  barcode: string | null;
  unit: string;
  reason: 'NAME' | 'BARCODE';
}

const OPEN_PO_STATUSES = ['PENDING_APPROVAL', 'APPROVED', 'PARTIALLY_RECEIVED'] as const;

const toNumber = (v: Prisma.Decimal | number | null | undefined): number | null =>
  v === null || v === undefined ? null : Number(v);

/**
 * อ่านค่าปัจจุบัน / เขียนค่าใหม่ของข้อมูลฝั่งจัดซื้อลง inventory_items + item_suppliers
 *
 * แยกจาก service หลักเพื่อให้ทั้ง "อนุมัติแล้วมีผลทันที" และ cron "ถึงวันมีผล"
 * ใช้เส้นทางเขียนเดียวกัน
 */
@Injectable()
export class ProductChangeApplyService {
  private readonly logger = new Logger(ProductChangeApplyService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** ค่าปัจจุบันของข้อมูลฝั่งจัดซื้อ — supplier fields มาจาก supplier หลัก (isPreferred ก่อน แล้วค่อยตัวแรก) */
  async readSnapshot(
    tenantId: string,
    itemId: string,
    tx: Tx | PrismaService = this.prisma,
  ): Promise<ProcurementSnapshot> {
    const item = await tx.inventoryItem.findFirst({
      where: { id: itemId, tenantId, deletedAt: null },
      select: {
        name: true,
        description: true,
        brand: true,
        purchaseUnit: true,
        purchaseUnitFactor: true,
        itemSuppliers: {
          orderBy: [{ isPreferred: 'desc' }, { createdAt: 'asc' }],
          take: 1,
          select: { supplierId: true, unitPrice: true, minOrderQty: true, leadDays: true },
        },
      },
    });
    if (!item) throw new NotFoundException(`ไม่พบสินค้า ${itemId}`);
    const primary = item.itemSuppliers[0];
    return {
      name: item.name,
      description: item.description,
      brand: item.brand,
      preferredSupplierId: primary?.supplierId ?? null,
      unitPrice: toNumber(primary?.unitPrice),
      minOrderQty: primary?.minOrderQty ?? null,
      leadDays: primary?.leadDays ?? null,
      purchaseUnit: item.purchaseUnit,
      purchaseUnitFactor: toNumber(item.purchaseUnitFactor),
    };
  }

  async assertSupplier(tenantId: string, supplierId: string): Promise<void> {
    const supplier = await this.prisma.supplier.findFirst({
      where: { id: supplierId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!supplier) throw new BadRequestException('ไม่พบ Supplier ที่เลือก');
  }

  async assertCategory(
    tenantId: string,
    categoryId: string,
    tx: Tx | PrismaService = this.prisma,
  ): Promise<void> {
    const category = await tx.itemCategory.findFirst({
      where: { id: categoryId, tenantId },
      select: { id: true },
    });
    if (!category) throw new BadRequestException('ไม่พบหมวดหมู่ที่เลือก');
  }

  /** เขียนเฉพาะฟิลด์ที่คลังให้ผ่าน */
  async applyUpdate(
    tx: Tx,
    tenantId: string,
    itemId: string,
    changes: readonly FieldChange[],
  ): Promise<void> {
    const approved = changes.filter((c) => c.decision === 'APPROVED');
    if (approved.length === 0) return;

    const value = (key: ProcurementFieldKey): unknown => approved.find((c) => c.field === key)?.to;
    const has = (key: ProcurementFieldKey): boolean => approved.some((c) => c.field === key);

    const itemData: Prisma.InventoryItemUpdateInput = {
      ...(has('name') ? { name: String(value('name')) } : {}),
      ...(has('description')
        ? { description: (value('description') as string | null) ?? null }
        : {}),
      ...(has('brand') ? { brand: (value('brand') as string | null) ?? null } : {}),
      ...(has('purchaseUnit')
        ? { purchaseUnit: (value('purchaseUnit') as ItemUnit | null) ?? null }
        : {}),
      ...(has('purchaseUnitFactor')
        ? { purchaseUnitFactor: (value('purchaseUnitFactor') as number | null) ?? null }
        : {}),
    };
    if (Object.keys(itemData).length > 0) {
      await tx.inventoryItem.update({ where: { id: itemId }, data: itemData });
    }

    const supplierKeys: ProcurementFieldKey[] = [
      'preferredSupplierId',
      'unitPrice',
      'minOrderQty',
      'leadDays',
    ];
    if (!supplierKeys.some(has)) return;

    const current = await this.readSnapshot(tenantId, itemId, tx);
    const supplierId = (
      has('preferredSupplierId') ? value('preferredSupplierId') : current.preferredSupplierId
    ) as string | null;
    if (!supplierId) {
      throw new BadRequestException(
        'สินค้านี้ยังไม่มี Supplier หลัก — ต้องเลือก Supplier ก่อนตั้งราคา/MOQ/Lead time',
      );
    }

    // ค่าเงื่อนไขซื้อที่ไม่ได้ขอเปลี่ยน ยกมาจาก supplier หลักเดิม (กรณีเปลี่ยน supplier)
    const pick = (key: 'unitPrice' | 'minOrderQty' | 'leadDays'): number | null =>
      (has(key) ? (value(key) as number | null) : (current[key] as number | null)) ?? null;
    const terms = {
      unitPrice: pick('unitPrice') ?? 0,
      minOrderQty: pick('minOrderQty'),
      leadDays: pick('leadDays'),
    };

    await tx.itemSupplier.updateMany({
      where: { itemId, supplierId: { not: supplierId }, isPreferred: true },
      data: { isPreferred: false },
    });
    await tx.itemSupplier.upsert({
      where: { itemId_supplierId: { itemId, supplierId } },
      create: { itemId, supplierId, isPreferred: true, ...terms },
      update: { isPreferred: true, ...terms },
    });
  }

  /** สร้างสินค้าจริงตอนคลังอนุมัติคำขอสร้างใหม่ — คืน id สินค้าใหม่ */
  async applyCreate(
    tx: Tx,
    tenantId: string,
    proposal: NewItemProposalDto,
    warehouse: WarehouseDataDto,
  ): Promise<string> {
    const sku = warehouse.sku.trim();
    const skuTaken = await tx.inventoryItem.findFirst({
      where: { tenantId, sku },
      select: { id: true, deletedAt: true },
    });
    if (skuTaken) {
      throw new ConflictException(
        skuTaken.deletedAt
          ? `SKU ${sku} เคยถูกใช้กับสินค้าที่ลบไปแล้ว — ใช้ SKU อื่น`
          : `SKU ${sku} มีอยู่แล้ว`,
      );
    }
    if (proposal.barcode) {
      const barcodeTaken = await tx.inventoryItem.findFirst({
        where: { tenantId, barcode: proposal.barcode, deletedAt: null },
        select: { sku: true },
      });
      if (barcodeTaken)
        throw new ConflictException(`บาร์โค้ดนี้ผูกกับ ${barcodeTaken.sku} อยู่แล้ว`);
    }
    if (warehouse.categoryId) await this.assertCategory(tenantId, warehouse.categoryId, tx);
    if (
      warehouse.maxStock !== undefined &&
      warehouse.minStock !== undefined &&
      warehouse.maxStock < warehouse.minStock
    ) {
      throw new BadRequestException('Max stock ต้องไม่น้อยกว่า Min stock');
    }

    const item = await tx.inventoryItem.create({
      data: {
        tenantId,
        sku,
        name: proposal.name.trim(),
        description: normalizeValue(getFieldDef('description'), proposal.description) as
          | string
          | null,
        brand: normalizeValue(getFieldDef('brand'), proposal.brand) as string | null,
        barcode: proposal.barcode?.trim() || null,
        itemType: proposal.itemType ?? 'RAW_MATERIAL',
        categoryId: warehouse.categoryId ?? null,
        unit: warehouse.unit,
        costMethod: warehouse.costMethod ?? 'WEIGHTED_AVG',
        minStock: warehouse.minStock ?? 0,
        maxStock: warehouse.maxStock ?? null,
        reorderPoint: warehouse.reorderPoint ?? 0,
        reorderQty: warehouse.reorderQty ?? 0,
        isPerishable: warehouse.isPerishable ?? false,
        defaultShelfLifeDays: warehouse.defaultShelfLifeDays ?? null,
        requiresLotTracking: warehouse.requiresLotTracking ?? false,
        requiresQC: warehouse.requiresQC ?? false,
        purchaseUnit: proposal.purchaseUnit ?? null,
        purchaseUnitFactor: proposal.purchaseUnitFactor ?? null,
        isActive: true,
      },
      select: { id: true },
    });

    if (proposal.supplierId) {
      await tx.itemSupplier.create({
        data: {
          itemId: item.id,
          supplierId: proposal.supplierId,
          unitPrice: proposal.unitPrice ?? 0,
          minOrderQty: proposal.minOrderQty ?? null,
          leadDays: proposal.leadDays ?? null,
          isPreferred: true,
        },
      });
    }

    this.logger.log(`Item ${sku} created from product change request (tenant=${tenantId})`);
    return item.id;
  }

  async stockImpact(tenantId: string, itemId: string): Promise<StockImpact | null> {
    const item = await this.prisma.inventoryItem.findFirst({
      where: { id: itemId, tenantId },
      select: { unit: true, minStock: true, maxStock: true },
    });
    if (!item) return null;

    const [stocks, poLines] = await Promise.all([
      this.prisma.warehouseStock.findMany({
        where: { itemId, warehouse: { tenantId } },
        select: { quantity: true, totalValue: true },
      }),
      this.prisma.purchaseOrderItem.findMany({
        where: {
          itemId,
          purchaseOrder: { tenantId, status: { in: [...OPEN_PO_STATUSES] } },
        },
        select: {
          quantity: true,
          receivedQty: true,
          unitPrice: true,
          purchaseOrder: { select: { id: true, poNumber: true, status: true } },
        },
        take: 20,
      }),
    ]);

    const onHand = stocks.reduce((sum, s) => sum + s.quantity, 0);
    const stockValue = stocks.reduce((sum, s) => sum + Number(s.totalValue), 0);
    return {
      onHand,
      stockValue,
      avgCost: onHand > 0 ? stockValue / onHand : 0,
      unit: item.unit,
      minStock: item.minStock,
      maxStock: item.maxStock,
      openPurchaseOrders: poLines.map((l) => ({
        id: l.purchaseOrder.id,
        poNumber: l.purchaseOrder.poNumber,
        status: l.purchaseOrder.status,
        orderedQty: l.quantity,
        receivedQty: l.receivedQty,
        unitPrice: Number(l.unitPrice),
      })),
    };
  }

  /** สต๊อก + จำนวน PO ค้าง ของหลายสินค้าในทีเดียว (สำหรับหน้ารายการ) */
  async stockBrief(
    tenantId: string,
    itemIds: string[],
  ): Promise<Map<string, { onHand: number; openPoCount: number }>> {
    const result = new Map<string, { onHand: number; openPoCount: number }>();
    if (itemIds.length === 0) return result;
    const [stocks, poLines] = await Promise.all([
      this.prisma.warehouseStock.groupBy({
        by: ['itemId'],
        where: { itemId: { in: itemIds }, warehouse: { tenantId } },
        _sum: { quantity: true },
      }),
      this.prisma.purchaseOrderItem.findMany({
        where: {
          itemId: { in: itemIds },
          purchaseOrder: { tenantId, status: { in: [...OPEN_PO_STATUSES] } },
        },
        select: { itemId: true, purchaseOrderId: true },
      }),
    ]);
    for (const id of itemIds) {
      const onHand = stocks.find((s) => s.itemId === id)?._sum.quantity ?? 0;
      const openPoCount = new Set(
        poLines.filter((l) => l.itemId === id).map((l) => l.purchaseOrderId),
      ).size;
      result.set(id, { onHand, openPoCount });
    }
    return result;
  }

  /** หาสินค้าที่อาจซ้ำ — ชื่อมีคำเดียวกัน หรือบาร์โค้ดตรงกัน */
  async findDuplicates(
    tenantId: string,
    name?: string,
    barcode?: string,
  ): Promise<DuplicateCandidate[]> {
    const tokens = (name ?? '')
      .split(/[\s,/()]+/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 3)
      .slice(0, 4);
    const or: Prisma.InventoryItemWhereInput[] = [
      ...tokens.map((t) => ({ name: { contains: t } })),
      ...(barcode?.trim() ? [{ barcode: barcode.trim() }] : []),
    ];
    if (or.length === 0) return [];

    const rows = await this.prisma.inventoryItem.findMany({
      where: { tenantId, deletedAt: null, OR: or },
      select: { id: true, sku: true, name: true, brand: true, barcode: true, unit: true },
      take: 20,
    });
    const lowerTokens = tokens.map((t) => t.toLowerCase());
    return rows
      .map((r) => {
        const byBarcode = !!barcode?.trim() && r.barcode === barcode.trim();
        const score =
          (byBarcode ? 100 : 0) +
          lowerTokens.filter((t) => r.name.toLowerCase().includes(t)).length;
        return { row: r, byBarcode, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(({ row, byBarcode }) => ({
        ...row,
        reason: byBarcode ? ('BARCODE' as const) : ('NAME' as const),
      }));
  }

  /** SKU แนะนำ: <รหัสหมวด>-NNNN (ไม่มีหมวด = ITEM-NNNN) ที่ยังไม่มีใครใช้ */
  async suggestSku(tenantId: string, categoryId?: string): Promise<string> {
    let prefix = 'ITEM';
    if (categoryId) {
      const category = await this.prisma.itemCategory.findFirst({
        where: { id: categoryId, tenantId },
        select: { code: true },
      });
      const code = category?.code
        ?.toUpperCase()
        .replace(/[^A-Z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
      if (code) prefix = code;
    }
    const used = await this.prisma.inventoryItem.findMany({
      where: { tenantId, sku: { startsWith: `${prefix}-` } },
      select: { sku: true },
    });
    const taken = new Set(used.map((u) => u.sku));
    const maxN = used.reduce((max, u) => {
      const n = Number(u.sku.slice(prefix.length + 1));
      return Number.isInteger(n) && n > max ? n : max;
    }, 0);
    let n = maxN + 1;
    while (taken.has(`${prefix}-${String(n).padStart(4, '0')}`)) n += 1;
    return `${prefix}-${String(n).padStart(4, '0')}`;
  }
}
