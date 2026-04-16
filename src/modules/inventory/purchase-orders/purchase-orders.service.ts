import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { UpdatePurchaseOrderDto } from './dto/update-purchase-order.dto';
import { QueryPurchaseOrderDto, PurchaseOrderStatus } from './dto/query-purchase-order.dto';

@Injectable()
export class PurchaseOrdersService {
  private readonly logger = new Logger(PurchaseOrdersService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve user UUIDs to full names (firstName + lastName).
   * Returns a Map<userId, fullName>.
   */
  private async resolveUserNames(userIds: (string | null | undefined)[]): Promise<Map<string, string>> {
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

  async findAll(
    tenantId: string,
    query: QueryPurchaseOrderDto,
  ): Promise<{
    data: any[];
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

  async findOne(id: string, tenantId: string): Promise<any> {
    const po = await this.prisma.purchaseOrder.findUnique({
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
            taxRate: true,
            totalPrice: true,
            notes: true,
          },
        },
        supplier: {
          select: {
            id: true,
            name: true,
            contactPerson: true,
            email: true,
            phone: true,
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

    if (!po || po.tenantId !== tenantId) {
      throw new NotFoundException('Purchase order not found');
    }

    // Resolve user names for approvedBy and requestedBy
    const userNameMap = await this.resolveUserNames([
      po.approvedBy,
      po.requestedBy,
    ]);

    return {
      id: po.id,
      poNumber: po.poNumber,
      status: po.status,
      propertyId: po.propertyId,
      supplierId: po.supplierId,
      supplierName: po.supplier?.name,
      supplier: po.supplier,
      warehouseId: po.warehouseId,
      expectedDate: po.expectedDate,
      notes: po.notes,
      internalNotes: po.internalNotes,
      subtotal: po.subtotal,
      taxAmount: po.taxAmount,
      totalAmount: po.totalAmount,
      items: po.items.map((item) => ({
        id: item.id,
        itemId: item.itemId,
        itemName: (item as any).item?.name,
        itemSku: (item as any).item?.sku,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        discount: item.discount,
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

  async create(dto: CreatePurchaseOrderDto, userId: string, tenantId: string): Promise<any> {
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

    // Calculate totals
    let subtotal = 0;
    let taxAmount = 0;

    dto.items.forEach((item) => {
      const linePrice = item.quantity * item.unitPrice;
      const discountAmount = linePrice * ((item.discount || 0) / 100);
      const discountedPrice = linePrice - discountAmount;
      const itemTax = discountedPrice * ((item.taxRate || 0) / 100);

      subtotal += discountedPrice;
      taxAmount += itemTax;
    });

    const totalAmount = subtotal + taxAmount;

    // Create in transaction: generate PO number, create PO and items
    const po = await this.prisma.$transaction(async (tx) => {
      // Generate PO number
      const poNumber = await this.generateDocNumber(tenantId, 'PURCHASE_ORDER', 'PO', tx);

      // Create purchase order
      const newPo = await tx.purchaseOrder.create({
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
          subtotal,
          taxAmount,
          totalAmount,
          requestedBy: userId,
        },
      });

      // Create PO items
      await tx.purchaseOrderItem.createMany({
        data: dto.items.map((item) => {
          const linePrice = item.quantity * item.unitPrice;
          const discountAmount = linePrice * ((item.discount || 0) / 100);
          const discountedPrice = linePrice - discountAmount;

          return {
            purchaseOrderId: newPo.id,
            itemId: item.itemId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            discount: item.discount || 0,
            taxRate: item.taxRate || 0,
            totalPrice: discountedPrice,
            notes: item.notes || null,
          };
        }),
      });

      // Update PR status to PO_CREATED if linked to a purchase requisition
      if (dto.purchaseRequisitionId) {
        await tx.purchaseRequisition.update({
          where: { id: dto.purchaseRequisitionId },
          data: { status: 'PO_CREATED' },
        });
        this.logger.log(
          `PR ${dto.purchaseRequisitionId} status updated to PO_CREATED`,
        );
      }

      return newPo;
    });

    this.logger.log(`Purchase order created: ${po.id} (${po.poNumber})`);
    return this.findOne(po.id, tenantId);
  }

  async update(id: string, dto: UpdatePurchaseOrderDto, tenantId: string): Promise<any> {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id },
    });

    if (!po || po.tenantId !== tenantId) {
      throw new NotFoundException('Purchase order not found');
    }

    // Only allow update if status is DRAFT or PENDING_APPROVAL
    if (
      ![PurchaseOrderStatus.DRAFT, PurchaseOrderStatus.PENDING_APPROVAL].includes(
        po.status as PurchaseOrderStatus,
      )
    ) {
      throw new BadRequestException(
        'Purchase order can only be updated in DRAFT or PENDING_APPROVAL status',
      );
    }

    // Prepare update data
    const updateData: Prisma.PurchaseOrderUpdateInput = {
      expectedDate: dto.expectedDate ? new Date(dto.expectedDate) : undefined,
      notes: dto.notes,
      internalNotes: dto.internalNotes,
      updatedAt: new Date(),
    };

    // If items are being updated, recalculate totals
    if (dto.items && dto.items.length > 0) {
      // Verify all items exist
      const itemIds = dto.items.map((item) => item.itemId);
      const existingItems = await this.prisma.inventoryItem.findMany({
        where: { id: { in: itemIds }, tenantId },
        select: { id: true },
      });

      if (existingItems.length !== itemIds.length) {
        throw new NotFoundException('One or more inventory items not found');
      }

      // Calculate new totals
      let subtotal = 0;
      let taxAmount = 0;

      dto.items.forEach((item) => {
        const linePrice = item.quantity * item.unitPrice;
        const discountAmount = linePrice * ((item.discount || 0) / 100);
        const discountedPrice = linePrice - discountAmount;
        const itemTax = discountedPrice * ((item.taxRate || 0) / 100);

        subtotal += discountedPrice;
        taxAmount += itemTax;
      });

      const totalAmount = subtotal + taxAmount;

      updateData.subtotal = subtotal;
      updateData.taxAmount = taxAmount;
      updateData.totalAmount = totalAmount;
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      // Update PO
      const updatedPo = await tx.purchaseOrder.update({
        where: { id },
        data: updateData,
      });

      // If items are being updated, replace them
      if (dto.items && dto.items.length > 0) {
        // Delete old items
        await tx.purchaseOrderItem.deleteMany({
          where: { purchaseOrderId: id },
        });

        // Create new items
        await tx.purchaseOrderItem.createMany({
          data: dto.items.map((item) => {
            const linePrice = item.quantity * item.unitPrice;
            const discountAmount = linePrice * ((item.discount || 0) / 100);
            const discountedPrice = linePrice - discountAmount;

            return {
              purchaseOrderId: id,
              itemId: item.itemId,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              discount: item.discount || 0,
              taxRate: item.taxRate || 0,
              totalPrice: discountedPrice,
              notes: item.notes || null,
            };
          }),
        });
      }

      return updatedPo;
    });

    this.logger.log(`Purchase order updated: ${id}`);
    return this.findOne(updated.id, tenantId);
  }

  async submitForApproval(id: string, tenantId: string): Promise<any> {
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

  async approve(id: string, userId: string, tenantId: string): Promise<any> {
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

  async cancel(id: string, userId: string, reason: string, tenantId: string): Promise<any> {
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

  async close(id: string, tenantId: string): Promise<any> {
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
