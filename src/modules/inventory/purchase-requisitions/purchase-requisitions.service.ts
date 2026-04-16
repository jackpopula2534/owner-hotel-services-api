import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { CreatePurchaseRequisitionDto } from './dto/create-purchase-requisition.dto';
import { UpdatePurchaseRequisitionDto } from './dto/update-purchase-requisition.dto';
import {
  QueryPurchaseRequisitionDto,
  PurchaseRequisitionStatus,
} from './dto/query-purchase-requisition.dto';

@Injectable()
export class PurchaseRequisitionsService {
  private readonly logger = new Logger(PurchaseRequisitionsService.name);

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
    query: QueryPurchaseRequisitionDto,
  ): Promise<{
    data: unknown[];
    meta: { page: number; limit: number; total: number };
  }> {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const where: Prisma.PurchaseRequisitionWhereInput = {
      tenantId,
      ...(query.propertyId && { propertyId: query.propertyId }),
      ...(query.status && { status: query.status }),
      ...(query.priority && { priority: query.priority }),
      ...(query.requestedBy && { requestedBy: query.requestedBy }),
      ...(query.startDate && {
        createdAt: { gte: new Date(query.startDate) },
      }),
      ...(query.endDate && {
        createdAt: { lte: new Date(query.endDate) },
      }),
      ...(query.search && {
        prNumber: { contains: query.search },
      }),
    };

    const [data, total] = await Promise.all([
      this.prisma.purchaseRequisition.findMany({
        where,
        skip,
        take: limit,
        select: {
          id: true,
          prNumber: true,
          status: true,
          priority: true,
          propertyId: true,
          purpose: true,
          department: true,
          requiredDate: true,
          createdAt: true,
          requestedBy: true,
          approvedBy: true,
          approvedAt: true,
          _count: {
            select: { items: true, supplierQuotes: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.purchaseRequisition.count({ where }),
    ]);

    // Resolve user names for approvedBy and requestedBy
    const userIds = data.flatMap((pr) => [pr.requestedBy, pr.approvedBy]);
    const userNameMap = await this.resolveUserNames(userIds);

    return {
      data: data.map((pr) => ({
        id: pr.id,
        prNumber: pr.prNumber,
        status: pr.status,
        priority: pr.priority,
        propertyId: pr.propertyId,
        purpose: pr.purpose,
        department: pr.department,
        requiredDate: pr.requiredDate,
        createdAt: pr.createdAt,
        requestedBy: pr.requestedBy,
        requestedByName: pr.requestedBy ? userNameMap.get(pr.requestedBy) || null : null,
        approvedBy: pr.approvedBy,
        approvedByName: pr.approvedBy ? userNameMap.get(pr.approvedBy) || null : null,
        approvedAt: pr.approvedAt,
        itemCount: pr._count.items,
        _count: {
          items: pr._count.items,
          supplierQuotes: pr._count.supplierQuotes,
        },
      })),
      meta: { page, limit, total },
    };
  }

  async findOne(id: string, tenantId: string): Promise<unknown> {
    const pr = await this.prisma.purchaseRequisition.findUnique({
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
            estimatedUnitPrice: true,
            specifications: true,
            preferredSupplierId: true,
            notes: true,
          },
        },
        supplierQuotes: {
          select: {
            id: true,
            supplierId: true,
            supplier: {
              select: {
                id: true,
                name: true,
              },
            },
            quotedDate: true,
            totalAmount: true,
            items: {
              select: {
                id: true,
                quantity: true,
                unitPrice: true,
                totalPrice: true,
              },
            },
          },
        },
      },
    });

    if (!pr || pr.tenantId !== tenantId) {
      throw new NotFoundException('Purchase requisition not found');
    }

    // Resolve user names for requestedBy, approvedBy, cancelledBy
    const userNameMap = await this.resolveUserNames([
      pr.requestedBy,
      pr.approvedBy,
      pr.cancelledBy,
    ]);

    return {
      id: pr.id,
      prNumber: pr.prNumber,
      status: pr.status,
      priority: pr.priority,
      propertyId: pr.propertyId,
      purpose: pr.purpose,
      department: pr.department,
      requiredDate: pr.requiredDate,
      notes: pr.notes,
      internalNotes: pr.internalNotes,
      requestedBy: pr.requestedBy,
      requestedByName: pr.requestedBy ? userNameMap.get(pr.requestedBy) || null : null,
      approvedBy: pr.approvedBy,
      approvedByName: pr.approvedBy ? userNameMap.get(pr.approvedBy) || null : null,
      approvedAt: pr.approvedAt,
      cancelReason: pr.cancelReason,
      cancelledBy: pr.cancelledBy,
      cancelledByName: pr.cancelledBy ? userNameMap.get(pr.cancelledBy) || null : null,
      cancelledAt: pr.cancelledAt,
      createdAt: pr.createdAt,
      updatedAt: pr.updatedAt,
      items: pr.items.map((item) => ({
        id: item.id,
        itemId: item.itemId,
        itemName: (item as any).item?.name,
        itemSku: (item as any).item?.sku,
        quantity: item.quantity,
        estimatedUnitPrice: item.estimatedUnitPrice,
        specifications: item.specifications,
        preferredSupplierId: item.preferredSupplierId,
        notes: item.notes,
      })),
      supplierQuotes: pr.supplierQuotes.map((quote) => ({
        id: quote.id,
        supplierId: quote.supplierId,
        supplierName: (quote as any).supplier?.name,
        quotedDate: quote.quotedDate,
        totalAmount: quote.totalAmount,
        itemCount: quote.items.length,
      })),
    };
  }

  async create(
    dto: CreatePurchaseRequisitionDto,
    userId: string,
    tenantId: string,
  ): Promise<unknown> {
    // Validate that property exists
    const property = await this.prisma.property.findUnique({
      where: { id: dto.propertyId },
    });

    if (!property || property.tenantId !== tenantId) {
      throw new NotFoundException('Property not found');
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

    // Verify preferred suppliers if provided
    const preferredSupplierIds = dto.items
      .map((item) => item.preferredSupplierId)
      .filter((id): id is string => !!id && id.trim().length > 0);

    if (preferredSupplierIds.length > 0) {
      const uniqueSupplierIds = [...new Set(preferredSupplierIds)];
      const existingSuppliers = await this.prisma.supplier.findMany({
        where: { id: { in: uniqueSupplierIds }, tenantId },
        select: { id: true },
      });

      if (existingSuppliers.length !== uniqueSupplierIds.length) {
        const foundIds = new Set(existingSuppliers.map((s) => s.id));
        const missingIds = uniqueSupplierIds.filter((id) => !foundIds.has(id));
        this.logger.warn(
          `Preferred suppliers not found: ${missingIds.join(', ')} for tenant ${tenantId}`,
        );
        throw new NotFoundException('One or more preferred suppliers not found');
      }
    }

    // Create in transaction: generate PR number, create PR and items
    const pr = await this.prisma.$transaction(async (tx) => {
      // Generate PR number
      const prNumber = await this.generateDocNumber(
        tenantId,
        'PURCHASE_REQUISITION',
        'PR',
        tx,
      );

      // Create purchase requisition
      const newPr = await tx.purchaseRequisition.create({
        data: {
          tenantId,
          prNumber,
          propertyId: dto.propertyId,
          requiredDate: dto.requiredDate ? new Date(dto.requiredDate) : null,
          priority: dto.priority || 'NORMAL',
          purpose: dto.purpose || null,
          department: dto.department || null,
          notes: dto.notes || null,
          internalNotes: dto.internalNotes || null,
          status: PurchaseRequisitionStatus.DRAFT,
          requestedBy: userId,
        },
      });

      // Create PR items
      await tx.purchaseRequisitionItem.createMany({
        data: dto.items.map((item) => ({
          purchaseRequisitionId: newPr.id,
          itemId: item.itemId,
          quantity: item.quantity,
          estimatedUnitPrice: item.estimatedUnitPrice || null,
          specifications: item.specifications || null,
          preferredSupplierId: item.preferredSupplierId || null,
          notes: item.notes || null,
        })),
      });

      return newPr;
    });

    this.logger.log(
      `Purchase requisition created: ${pr.id} (${pr.prNumber}) by user ${userId}`,
    );
    return this.findOne(pr.id, tenantId);
  }

  async update(
    id: string,
    dto: UpdatePurchaseRequisitionDto,
    tenantId: string,
  ): Promise<unknown> {
    const pr = await this.prisma.purchaseRequisition.findUnique({
      where: { id },
    });

    if (!pr || pr.tenantId !== tenantId) {
      throw new NotFoundException('Purchase requisition not found');
    }

    // Only allow update if status is DRAFT or PENDING_APPROVAL
    if (
      ![PurchaseRequisitionStatus.DRAFT, PurchaseRequisitionStatus.PENDING_APPROVAL].includes(
        pr.status as PurchaseRequisitionStatus,
      )
    ) {
      throw new BadRequestException(
        'Purchase requisition can only be updated in DRAFT or PENDING_APPROVAL status',
      );
    }

    // Prepare update data
    const updateData: Prisma.PurchaseRequisitionUpdateInput = {
      propertyId: dto.propertyId,
      requiredDate: dto.requiredDate ? new Date(dto.requiredDate) : undefined,
      priority: dto.priority,
      purpose: dto.purpose,
      department: dto.department,
      notes: dto.notes,
      internalNotes: dto.internalNotes,
      updatedAt: new Date(),
    };

    // If items are being updated, validate them
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

      // Verify preferred suppliers if provided
      const preferredSupplierIds = dto.items
        .map((item) => item.preferredSupplierId)
        .filter((id): id is string => !!id && id.trim().length > 0);

      if (preferredSupplierIds.length > 0) {
        const uniqueSupplierIds = [...new Set(preferredSupplierIds)];
        const existingSuppliers = await this.prisma.supplier.findMany({
          where: { id: { in: uniqueSupplierIds }, tenantId },
          select: { id: true },
        });

        if (existingSuppliers.length !== uniqueSupplierIds.length) {
          throw new NotFoundException(
            'One or more preferred suppliers not found',
          );
        }
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      // Update PR
      const updatedPr = await tx.purchaseRequisition.update({
        where: { id },
        data: updateData,
      });

      // If items are being updated, replace them
      if (dto.items && dto.items.length > 0) {
        // Delete old items
        await tx.purchaseRequisitionItem.deleteMany({
          where: { purchaseRequisitionId: id },
        });

        // Create new items
        await tx.purchaseRequisitionItem.createMany({
          data: dto.items.map((item) => ({
            purchaseRequisitionId: id,
            itemId: item.itemId,
            quantity: item.quantity,
            estimatedUnitPrice: item.estimatedUnitPrice || null,
            specifications: item.specifications || null,
            preferredSupplierId: item.preferredSupplierId || null,
            notes: item.notes || null,
          })),
        });
      }

      return updatedPr;
    });

    this.logger.log(`Purchase requisition updated: ${id}`);
    return this.findOne(updated.id, tenantId);
  }

  async submit(id: string, tenantId: string): Promise<unknown> {
    const pr = await this.prisma.purchaseRequisition.findUnique({
      where: { id },
    });

    if (!pr || pr.tenantId !== tenantId) {
      throw new NotFoundException('Purchase requisition not found');
    }

    if (pr.status !== PurchaseRequisitionStatus.DRAFT) {
      throw new BadRequestException(
        'Only DRAFT purchase requisitions can be submitted for approval',
      );
    }

    const updated = await this.prisma.purchaseRequisition.update({
      where: { id },
      data: {
        status: PurchaseRequisitionStatus.PENDING_APPROVAL,
        updatedAt: new Date(),
      },
    });

    this.logger.log(
      `Purchase requisition submitted for approval: ${id} (${updated.prNumber})`,
    );
    return this.findOne(updated.id, tenantId);
  }

  async approve(
    id: string,
    userId: string,
    tenantId: string,
  ): Promise<unknown> {
    const pr = await this.prisma.purchaseRequisition.findUnique({
      where: { id },
    });

    if (!pr || pr.tenantId !== tenantId) {
      throw new NotFoundException('Purchase requisition not found');
    }

    if (pr.status !== PurchaseRequisitionStatus.PENDING_APPROVAL) {
      throw new BadRequestException(
        'Only PENDING_APPROVAL purchase requisitions can be approved',
      );
    }

    const updated = await this.prisma.purchaseRequisition.update({
      where: { id },
      data: {
        status: PurchaseRequisitionStatus.APPROVED,
        approvedBy: userId,
        approvedAt: new Date(),
        updatedAt: new Date(),
      },
    });

    this.logger.log(
      `Purchase requisition approved: ${id} (${updated.prNumber}) by user ${userId}`,
    );
    return this.findOne(updated.id, tenantId);
  }

  async requestQuotes(
    id: string,
    supplierIds: string[],
    tenantId: string,
  ): Promise<unknown> {
    const pr = await this.prisma.purchaseRequisition.findUnique({
      where: { id },
    });

    if (!pr || pr.tenantId !== tenantId) {
      throw new NotFoundException('Purchase requisition not found');
    }

    if (pr.status !== PurchaseRequisitionStatus.APPROVED) {
      throw new BadRequestException(
        'Only APPROVED purchase requisitions can request quotes',
      );
    }

    if (!supplierIds || supplierIds.length === 0) {
      throw new BadRequestException('At least one supplier ID is required');
    }

    // Verify all suppliers exist
    const existingSuppliers = await this.prisma.supplier.findMany({
      where: { id: { in: supplierIds }, tenantId },
      select: { id: true },
    });

    if (existingSuppliers.length !== supplierIds.length) {
      throw new NotFoundException('One or more suppliers not found');
    }

    // Create SupplierQuote records for each supplier in transaction
    const updated = await this.prisma.$transaction(async (tx) => {
      // Create supplier quotes
      for (const supplierId of supplierIds) {
        await tx.supplierQuote.create({
          data: {
            tenantId,
            purchaseRequisitionId: id,
            supplierId,
            quotedDate: new Date(),
          },
        });
      }

      // Update PR status
      const updatedPr = await tx.purchaseRequisition.update({
        where: { id },
        data: {
          status: PurchaseRequisitionStatus.PENDING_QUOTES,
          updatedAt: new Date(),
        },
      });

      return updatedPr;
    });

    this.logger.log(
      `Quotes requested for PR: ${id} (${updated.prNumber}) from ${supplierIds.length} suppliers`,
    );
    return this.findOne(updated.id, tenantId);
  }

  async cancel(
    id: string,
    reason: string,
    userId: string,
    tenantId: string,
  ): Promise<unknown> {
    const pr = await this.prisma.purchaseRequisition.findUnique({
      where: { id },
    });

    if (!pr || pr.tenantId !== tenantId) {
      throw new NotFoundException('Purchase requisition not found');
    }

    const nonCancellableStatuses = [PurchaseRequisitionStatus.PO_CREATED];

    if (nonCancellableStatuses.includes(pr.status as PurchaseRequisitionStatus)) {
      throw new BadRequestException(
        'Cannot cancel a purchase requisition that already has a PO created',
      );
    }

    const updated = await this.prisma.purchaseRequisition.update({
      where: { id },
      data: {
        status: PurchaseRequisitionStatus.CANCELLED,
        cancelReason: reason,
        cancelledBy: userId,
        cancelledAt: new Date(),
      },
    });

    this.logger.log(
      `Purchase requisition cancelled: ${id} (${updated.prNumber}) by user ${userId}`,
    );
    return this.findOne(updated.id, tenantId);
  }

  async createPOFromPR(
    prId: string,
    selectedQuoteId: string,
    warehouseId: string,
    userId: string,
    tenantId: string,
  ): Promise<unknown> {
    const pr = await this.prisma.purchaseRequisition.findUnique({
      where: { id: prId },
      include: {
        items: true,
        supplierQuotes: {
          include: {
            items: true,
          },
        },
      },
    });

    if (!pr || pr.tenantId !== tenantId) {
      throw new NotFoundException('Purchase requisition not found');
    }

    if (pr.status !== PurchaseRequisitionStatus.PENDING_QUOTES) {
      throw new BadRequestException(
        'Only PENDING_QUOTES purchase requisitions can create POs',
      );
    }

    // Verify selected quote exists and belongs to this PR
    const selectedQuote = pr.supplierQuotes.find(
      (quote) => quote.id === selectedQuoteId,
    );

    if (!selectedQuote) {
      throw new NotFoundException('Selected quote not found for this PR');
    }

    // Verify warehouse exists
    const warehouse = await this.prisma.warehouse.findUnique({
      where: { id: warehouseId },
    });

    if (!warehouse || warehouse.tenantId !== tenantId) {
      throw new NotFoundException('Warehouse not found');
    }

    // Create PO in transaction
    const result = await this.prisma.$transaction(async (tx) => {
      // Generate PO number
      const poNumber = await this.generateDocNumber(
        tenantId,
        'PURCHASE_ORDER',
        'PO',
        tx,
      );

      // Calculate totals from quote items
      let subtotal = 0;
      let taxAmount = 0;

      selectedQuote.items.forEach((item) => {
        subtotal += Number(item.totalPrice) || 0;
      });

      const totalAmount = subtotal + taxAmount;

      // Create purchase order
      const po = await tx.purchaseOrder.create({
        data: {
          tenantId,
          poNumber,
          propertyId: pr.propertyId,
          supplierId: selectedQuote.supplierId,
          warehouseId,
          status: 'DRAFT',
          subtotal,
          taxAmount,
          totalAmount,
          notes: pr.notes,
          internalNotes: pr.internalNotes,
          requestedBy: userId,
          purchaseRequisitionId: prId,
        },
      });

      // Create PO items from PR items
      const poItems = pr.items.map((prItem, index) => {
        const quoteItem = selectedQuote.items.find(
          (qi) => qi.itemId === prItem.itemId,
        );

        return {
          purchaseOrderId: po.id,
          itemId: prItem.itemId,
          quantity: prItem.quantity,
          unitPrice: quoteItem?.unitPrice || prItem.estimatedUnitPrice || 0,
          discount: 0,
          taxRate: 0,
          totalPrice: quoteItem?.totalPrice || 0,
          notes: prItem.notes,
        };
      });

      await tx.purchaseOrderItem.createMany({
        data: poItems,
      });

      // Update PR status
      await tx.purchaseRequisition.update({
        where: { id: prId },
        data: {
          status: PurchaseRequisitionStatus.PO_CREATED,
          updatedAt: new Date(),
        },
      });

      return po;
    });

    this.logger.log(
      `Purchase order created from PR: ${prId} (${pr.prNumber}) → PO ${result.poNumber} by user ${userId}`,
    );

    // Return the PO details
    return this.prisma.purchaseOrder.findUnique({
      where: { id: result.id },
      include: {
        items: true,
        supplier: true,
      },
    });
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
