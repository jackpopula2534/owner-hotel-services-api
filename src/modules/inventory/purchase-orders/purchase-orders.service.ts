import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import {
  calculatePurchaseOrderTotals,
  CalculationBreakdown,
  DiscountMode,
  DiscountType,
  LineBreakdown,
} from '@/common/purchase-order/po-calculation';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { UpdatePurchaseOrderDto } from './dto/update-purchase-order.dto';
import { QueryPurchaseOrderDto, PurchaseOrderStatus } from './dto/query-purchase-order.dto';

type PurchaseOrderItemInput = {
  itemId: string;
  quantity: number;
  unitPrice: number;
  discount?: number;
  discountType?: DiscountType;
  taxRate?: number;
  notes?: string;
};

/**
 * Row shape of a persisted PurchaseOrder after the 20260417 migration adds
 * `discountMode`, `headerDiscount`, `headerDiscountType`, and
 * `calculationBreakdown`. Used by this service to read the new columns
 * without waiting for a local `prisma generate` — the runtime client
 * returns them as soon as the migration is applied.
 */
type PurchaseOrderWithDiscount = Prisma.PurchaseOrderGetPayload<Record<string, never>> & {
  discountMode: DiscountMode;
  headerDiscount: Prisma.Decimal | number | null;
  headerDiscountType: DiscountType;
  calculationBreakdown: Prisma.JsonValue | null;
};

/**
 * Row shape of a PurchaseOrderItem after the migration adds `discountType`.
 */
type PurchaseOrderItemWithDiscountType = Prisma.PurchaseOrderItemGetPayload<
  Record<string, never>
> & {
  discountType: DiscountType;
};

@Injectable()
export class PurchaseOrdersService {
  private readonly logger = new Logger(PurchaseOrdersService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve user UUIDs to full names (firstName + lastName).
   * Returns a Map<userId, fullName>.
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

    const map = new Map<string, string>();
    for (const user of users) {
      const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email;
      map.set(user.id, fullName);
    }
    return map;
  }

  /**
   * Compute totals + breakdown from a DTO's items + header discount.
   * Shared helper used by create() and update() so the math lives
   * in exactly one place.
   */
  private computeTotals(
    items: PurchaseOrderItemInput[],
    headerDiscount: number,
    headerDiscountType: DiscountType,
    discountMode: DiscountMode,
  ): CalculationBreakdown {
    return calculatePurchaseOrderTotals({
      discountMode,
      headerDiscount: {
        value: headerDiscount,
        type: headerDiscountType,
      },
      lines: items.map((item) => ({
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        discountValue: item.discount ?? 0,
        discountType: item.discountType ?? 'PERCENT',
        taxRate: item.taxRate ?? 0,
      })),
    });
  }

  async findAll(
    tenantId: string,
    query: QueryPurchaseOrderDto,
  ): Promise<{
    data: Array<{
      id: string;
      poNumber: string;
      status: string;
      supplierId: string;
      supplierName: string;
      propertyId: string;
      warehouseId: string;
      expectedDate: Date | null;
      createdAt: Date;
      totalAmount: Prisma.Decimal;
      itemCount: number;
    }>;
    meta: { page: number; limit: number; total: number };
  }> {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const where: Prisma.PurchaseOrderWhereInput = {
      tenantId,
      ...(query.propertyId && { propertyId: query.propertyId }),
      ...(query.supplierId && { supplierId: query.supplierId }),
      ...(query.status && { status: query.status }),
      ...(query.startDate && {
        createdAt: { gte: new Date(query.startDate) },
      }),
      ...(query.endDate && {
        createdAt: { lte: new Date(query.endDate) },
      }),
      ...(query.search && {
        poNumber: { contains: query.search },
      }),
    };

    const [data, total] = await Promise.all([
      this.prisma.purchaseOrder.findMany({
        where,
        skip,
        take: limit,
        select: {
          id: true,
          poNumber: true,
          status: true,
          supplierId: true,
          supplier: {
            select: { name: true },
          },
          propertyId: true,
          warehouseId: true,
          expectedDate: true,
          createdAt: true,
          totalAmount: true,
          _count: {
            select: { items: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.purchaseOrder.count({ where }),
    ]);

    return {
      data: data.map((po) => ({
        id: po.id,
        poNumber: po.poNumber,
        status: po.status,
        supplierId: po.supplierId,
        supplierName: po.supplier?.name || 'Unknown',
        propertyId: po.propertyId,
        warehouseId: po.warehouseId,
        expectedDate: po.expectedDate,
        createdAt: po.createdAt,
        totalAmount: po.totalAmount,
        itemCount: po._count.items,
      })),
      meta: { page, limit, total },
    };
  }

  async findOne(id: string, tenantId: string): Promise<Record<string, unknown>> {
    // `discountType` on items and `discountMode`/`headerDiscount*`/`calculationBreakdown`
    // on the PO are newly-added columns (see migration 20260417). They are cast via
    // the widened row types below until `prisma generate` runs against the updated schema.
    const poRaw = await this.prisma.purchaseOrder.findUnique({
      where: { id },
      include: {
        items: {
          select: {
            id: true,
            itemId: true,
            item: {
              select: {
                name: true,
                sku: true,
              },
            },
            quantity: true,
            unitPrice: true,
            discount: true,
            discountType: true,
            taxRate: true,
            totalPrice: true,
            notes: true,
          } as unknown as Prisma.PurchaseOrderItemSelect,
        },
        supplier: {
          select: {
            id: true,
            name: true,
            code: true,
            contactPerson: true,
            email: true,
            phone: true,
            address: true,
            taxId: true,
            paymentTerms: true,
          },
        },
        goodsReceives: {
          select: {
            id: true,
            grNumber: true,
            status: true,
            receiveDate: true,
          },
        },
      },
    });

    if (!poRaw || poRaw.tenantId !== tenantId) {
      throw new NotFoundException('Purchase order not found');
    }

    const po = poRaw as unknown as PurchaseOrderWithDiscount & {
      items: (PurchaseOrderItemWithDiscountType & {
        item?: { name: string; sku: string } | null;
      })[];
      supplier: {
        id: string;
        name: string;
        code: string | null;
        contactPerson: string | null;
        email: string | null;
        phone: string | null;
        address: string | null;
        taxId: string | null;
        paymentTerms: string | null;
      } | null;
      goodsReceives: Array<{ id: string; grNumber: string; status: string; receiveDate: Date }>;
    };

    // Resolve user names for approvedBy and requestedBy
    const userNameMap = await this.resolveUserNames([po.approvedBy, po.requestedBy]);

    return {
      id: po.id,
      poNumber: po.poNumber,
      status: po.status,
      propertyId: po.propertyId,
      supplierId: po.supplierId,
      supplierName: po.supplier?.name,
      supplier: po.supplier,
      warehouseId: po.warehouseId,
      orderDate: po.orderDate,
      expectedDate: po.expectedDate,
      notes: po.notes,
      internalNotes: po.internalNotes,
      subtotal: po.subtotal,
      discountAmount: po.discountAmount,
      discountMode: po.discountMode,
      headerDiscount: po.headerDiscount,
      headerDiscountType: po.headerDiscountType,
      calculationBreakdown: po.calculationBreakdown,
      taxAmount: po.taxAmount,
      totalAmount: po.totalAmount,
      currency: po.currency,
      cancelReason: po.cancelReason,
      cancelledAt: po.cancelledAt,
      items: po.items.map((item) => ({
        id: item.id,
        itemId: item.itemId,
        itemName: item.item?.name,
        itemSku: item.item?.sku,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        discount: item.discount,
        discountType: item.discountType,
        taxRate: item.taxRate,
        lineTotal: item.totalPrice,
        notes: item.notes,
      })),
      goodsReceives: po.goodsReceives,
      approvedBy: po.approvedBy || null,
      approvedByName: po.approvedBy ? userNameMap.get(po.approvedBy) || null : null,
      approvedAt: po.approvedAt,
      requestedBy: po.requestedBy,
      requestedByName: po.requestedBy ? userNameMap.get(po.requestedBy) || null : null,
      createdAt: po.createdAt,
      updatedAt: po.updatedAt,
    };
  }

  async create(
    dto: CreatePurchaseOrderDto,
    userId: string,
    tenantId: string,
  ): Promise<Record<string, unknown>> {
    // Auto-resolve propertyId if not provided — use tenant's first property
    let propertyId = dto.propertyId;
    if (!propertyId) {
      const defaultProperty = await this.prisma.property.findFirst({
        where: { tenantId },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
      });
      if (!defaultProperty) {
        throw new NotFoundException(
          'No property found for this tenant. Please create a property first.',
        );
      }
      propertyId = defaultProperty.id;
    }

    // Validate that property, supplier, warehouse, and items exist
    const [property, supplier, warehouse] = await Promise.all([
      this.prisma.property.findUnique({
        where: { id: propertyId },
      }),
      this.prisma.supplier.findUnique({
        where: { id: dto.supplierId },
      }),
      this.prisma.warehouse.findUnique({
        where: { id: dto.warehouseId },
      }),
    ]);

    if (!property || property.tenantId !== tenantId) {
      throw new NotFoundException('Property not found');
    }
    if (!supplier || supplier.tenantId !== tenantId) {
      throw new NotFoundException('Supplier not found');
    }
    if (!warehouse || warehouse.tenantId !== tenantId) {
      throw new NotFoundException('Warehouse not found');
    }

    // Verify all items exist
    const itemIds = dto.items.map((item) => item.itemId);
    const existingItems = await this.prisma.inventoryItem.findMany({
      where: { id: { in: itemIds }, tenantId },
      select: { id: true },
    });

    if (existingItems.length !== itemIds.length) {
      throw new NotFoundException('One or more inventory items not found');
    }

    // Calculate totals using shared module
    const discountMode: DiscountMode = dto.discountMode ?? 'BEFORE_VAT';
    const headerDiscountType: DiscountType = dto.headerDiscountType ?? 'AMOUNT';
    const breakdown = this.computeTotals(
      dto.items,
      dto.headerDiscount ?? 0,
      headerDiscountType,
      discountMode,
    );

    // Create in transaction: generate PO number, create PO and items
    const po = await this.prisma.$transaction(async (tx) => {
      const poNumber = await this.generateDocNumber(tenantId, 'PURCHASE_ORDER', 'PO', tx);

      const newPo = await tx.purchaseOrder.create({
        // `discountMode`, `headerDiscount`, `headerDiscountType`, and
        // `calculationBreakdown` are new columns (migration 20260417). Once
        // `prisma generate` runs in CI/deploy against the updated schema the
        // cast below becomes a no-op.
        data: {
          tenantId,
          poNumber,
          propertyId,
          supplierId: dto.supplierId,
          warehouseId: dto.warehouseId,
          expectedDate: dto.expectedDate ? new Date(dto.expectedDate) : null,
          notes: dto.notes || null,
          internalNotes: dto.internalNotes || null,
          quotationNumber: dto.quotationNumber || null,
          quotationDate: dto.quotationDate ? new Date(dto.quotationDate) : null,
          purchaseRequisitionId: dto.purchaseRequisitionId || null,
          status: PurchaseOrderStatus.DRAFT,
          subtotal: breakdown.subtotal,
          discountAmount: breakdown.totalLineDiscount + breakdown.headerDiscountAmount,
          discountMode,
          headerDiscount: breakdown.headerDiscountAmount,
          headerDiscountType,
          calculationBreakdown: breakdown as unknown as Prisma.InputJsonValue,
          taxAmount: breakdown.vatAmount,
          totalAmount: breakdown.grandTotal,
          requestedBy: userId,
        } as unknown as Prisma.PurchaseOrderUncheckedCreateInput,
      });

      await tx.purchaseOrderItem.createMany({
        data: dto.items.map((item, idx) => this.buildItemRow(newPo.id, item, breakdown.lines[idx])),
      });

      if (dto.purchaseRequisitionId) {
        await tx.purchaseRequisition.update({
          where: { id: dto.purchaseRequisitionId },
          data: { status: 'PO_CREATED' },
        });
        this.logger.log(`PR ${dto.purchaseRequisitionId} status updated to PO_CREATED`);
      }

      return newPo;
    });

    this.logger.log(`Purchase order created: ${po.id} (${po.poNumber})`);
    return this.findOne(po.id, tenantId);
  }

  async update(
    id: string,
    dto: UpdatePurchaseOrderDto,
    tenantId: string,
  ): Promise<Record<string, unknown>> {
    const poRaw = await this.prisma.purchaseOrder.findUnique({
      where: { id },
    });

    if (!poRaw || poRaw.tenantId !== tenantId) {
      throw new NotFoundException('Purchase order not found');
    }

    // See note on PurchaseOrderWithDiscount at the top of this file.
    const po = poRaw as unknown as PurchaseOrderWithDiscount;

    if (
      ![PurchaseOrderStatus.DRAFT, PurchaseOrderStatus.PENDING_APPROVAL].includes(
        po.status as PurchaseOrderStatus,
      )
    ) {
      throw new BadRequestException(
        'Purchase order can only be updated in DRAFT or PENDING_APPROVAL status',
      );
    }

    // Using a widened record here because discount fields are new (see migration
    // 20260417); we still cast to Prisma's input type at the boundary below.
    const updateData: Record<string, unknown> = {
      expectedDate: dto.expectedDate ? new Date(dto.expectedDate) : undefined,
      notes: dto.notes,
      internalNotes: dto.internalNotes,
      updatedAt: new Date(),
    };

    // If items or discount fields are being updated, recalculate totals
    const willRecalculate =
      (dto.items && dto.items.length > 0) ||
      dto.discountMode !== undefined ||
      dto.headerDiscount !== undefined ||
      dto.headerDiscountType !== undefined;

    let breakdown: CalculationBreakdown | null = null;
    const discountMode: DiscountMode =
      dto.discountMode ?? (po.discountMode as DiscountMode) ?? 'BEFORE_VAT';
    const headerDiscountType: DiscountType =
      dto.headerDiscountType ?? (po.headerDiscountType as DiscountType) ?? 'AMOUNT';
    const headerDiscountValue =
      dto.headerDiscount ?? (po.headerDiscount ? Number(po.headerDiscount) : 0);

    if (willRecalculate) {
      let items: PurchaseOrderItemInput[] = [];
      if (dto.items && dto.items.length > 0) {
        const itemIds = dto.items.map((item) => item.itemId);
        const existingItems = await this.prisma.inventoryItem.findMany({
          where: { id: { in: itemIds }, tenantId },
          select: { id: true },
        });
        if (existingItems.length !== itemIds.length) {
          throw new NotFoundException('One or more inventory items not found');
        }
        items = dto.items;
      } else {
        // No new items — reuse existing items from DB for recalc
        const existingRaw = await this.prisma.purchaseOrderItem.findMany({
          where: { purchaseOrderId: id },
        });
        const existing = existingRaw as unknown as PurchaseOrderItemWithDiscountType[];
        items = existing.map((i) => ({
          itemId: i.itemId,
          quantity: i.quantity,
          unitPrice: Number(i.unitPrice),
          discount: Number(i.discount),
          discountType: (i.discountType ?? 'PERCENT') as DiscountType,
          taxRate: Number(i.taxRate),
          notes: i.notes ?? undefined,
        }));
      }

      breakdown = this.computeTotals(items, headerDiscountValue, headerDiscountType, discountMode);

      updateData.subtotal = breakdown.subtotal;
      updateData.discountAmount = breakdown.totalLineDiscount + breakdown.headerDiscountAmount;
      updateData.discountMode = discountMode;
      updateData.headerDiscount = breakdown.headerDiscountAmount;
      updateData.headerDiscountType = headerDiscountType;
      updateData.calculationBreakdown = breakdown as unknown as Prisma.InputJsonValue;
      updateData.taxAmount = breakdown.vatAmount;
      updateData.totalAmount = breakdown.grandTotal;
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const updatedPo = await tx.purchaseOrder.update({
        where: { id },
        data: updateData as unknown as Prisma.PurchaseOrderUncheckedUpdateInput,
      });

      if (dto.items && dto.items.length > 0 && breakdown) {
        await tx.purchaseOrderItem.deleteMany({
          where: { purchaseOrderId: id },
        });

        await tx.purchaseOrderItem.createMany({
          data: dto.items.map((item, idx) => this.buildItemRow(id, item, breakdown!.lines[idx])),
        });
      }

      return updatedPo;
    });

    this.logger.log(`Purchase order updated: ${id}`);
    return this.findOne(updated.id, tenantId);
  }

  async submitForApproval(id: string, tenantId: string): Promise<Record<string, unknown>> {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id },
    });

    if (!po || po.tenantId !== tenantId) {
      throw new NotFoundException('Purchase order not found');
    }

    if (po.status !== PurchaseOrderStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT purchase orders can be submitted for approval');
    }

    const updated = await this.prisma.purchaseOrder.update({
      where: { id },
      data: {
        status: PurchaseOrderStatus.PENDING_APPROVAL,
        updatedAt: new Date(),
      },
    });

    this.logger.log(`Purchase order submitted for approval: ${id} (${updated.poNumber})`);
    return this.findOne(updated.id, tenantId);
  }

  async approve(id: string, userId: string, tenantId: string): Promise<Record<string, unknown>> {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id },
    });

    if (!po || po.tenantId !== tenantId) {
      throw new NotFoundException('Purchase order not found');
    }

    if (po.status !== PurchaseOrderStatus.PENDING_APPROVAL) {
      throw new BadRequestException('Only PENDING_APPROVAL purchase orders can be approved');
    }

    const updated = await this.prisma.purchaseOrder.update({
      where: { id },
      data: {
        status: PurchaseOrderStatus.APPROVED,
        approvedBy: userId,
        approvedAt: new Date(),
        updatedAt: new Date(),
      },
    });

    this.logger.log(`Purchase order approved: ${id} (${updated.poNumber}) by user ${userId}`);
    return this.findOne(updated.id, tenantId);
  }

  async cancel(
    id: string,
    userId: string,
    reason: string,
    tenantId: string,
  ): Promise<Record<string, unknown>> {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id },
    });

    if (!po || po.tenantId !== tenantId) {
      throw new NotFoundException('Purchase order not found');
    }

    const nonCancellableStatuses = [PurchaseOrderStatus.FULLY_RECEIVED, PurchaseOrderStatus.CLOSED];

    if (nonCancellableStatuses.includes(po.status as PurchaseOrderStatus)) {
      throw new BadRequestException('Cannot cancel a FULLY_RECEIVED or CLOSED purchase order');
    }

    const updated = await this.prisma.purchaseOrder.update({
      where: { id },
      data: {
        status: PurchaseOrderStatus.CANCELLED,
        cancelReason: reason,
        cancelledBy: userId,
        cancelledAt: new Date(),
      },
    });

    this.logger.log(`Purchase order cancelled: ${id} (${updated.poNumber})`);
    return this.findOne(updated.id, tenantId);
  }

  async close(id: string, tenantId: string): Promise<Record<string, unknown>> {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id },
    });

    if (!po || po.tenantId !== tenantId) {
      throw new NotFoundException('Purchase order not found');
    }

    if (po.status !== PurchaseOrderStatus.FULLY_RECEIVED) {
      throw new BadRequestException('Only FULLY_RECEIVED purchase orders can be closed');
    }

    const updated = await this.prisma.purchaseOrder.update({
      where: { id },
      data: {
        status: PurchaseOrderStatus.CLOSED,
      },
    });

    this.logger.log(`Purchase order closed: ${id} (${updated.poNumber})`);
    return this.findOne(updated.id, tenantId);
  }

  /**
   * Build a single PurchaseOrderItem row from DTO + computed line breakdown.
   * `discountType` is a new column (migration 20260417) and is not yet in the
   * generated input type until `prisma generate` runs — cast at the boundary.
   */
  private buildItemRow(
    purchaseOrderId: string,
    item: PurchaseOrderItemInput,
    lineBreakdown: LineBreakdown,
  ): Prisma.PurchaseOrderItemCreateManyInput {
    return {
      purchaseOrderId,
      itemId: item.itemId,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      discount: item.discount ?? 0,
      discountType: (item.discountType ?? 'PERCENT') as DiscountType,
      taxRate: item.taxRate ?? 0,
      totalPrice: lineBreakdown.lineTotal,
      notes: item.notes || null,
    } as unknown as Prisma.PurchaseOrderItemCreateManyInput;
  }

  private async generateDocNumber(
    tenantId: string,
    docType: string,
    prefix: string,
    prismaTransaction: Prisma.TransactionClient,
  ): Promise<string> {
    const now = new Date();
    const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;

    const seq = await prismaTransaction.documentSequence.upsert({
      where: { tenantId_docType_yearMonth: { tenantId, docType, yearMonth } },
      create: { tenantId, docType, prefix, yearMonth, lastNumber: 1 },
      update: { lastNumber: { increment: 1 } },
    });

    return `${prefix}-${yearMonth}-${String(seq.lastNumber).padStart(4, '0')}`;
  }
}
