import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  forwardRef,
  Inject,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { SubmitQuoteDto, QuerySupplierQuoteDto } from './dto';
import { RfqsService } from '../rfqs/rfqs.service';

@Injectable()
export class SupplierQuotesService {
  private readonly logger = new Logger(SupplierQuotesService.name);

  constructor(
    private readonly prisma: PrismaService,
    // forwardRef matches supplier-quotes.module.ts — RfqsModule is
    // forward-ref'd to break the 3-module cycle with SupplierPortalModule.
    @Inject(forwardRef(() => RfqsService))
    private readonly rfqsService: RfqsService,
  ) {}

  async findAll(
    tenantId: string,
    query: QuerySupplierQuoteDto,
  ): Promise<{
    data: any[];
    meta: { page: number; limit: number; total: number };
  }> {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const where: Prisma.SupplierQuoteWhereInput = {
      tenantId,
      ...(query.supplierId && { supplierId: query.supplierId }),
      ...(query.purchaseRequisitionId && {
        purchaseRequisitionId: query.purchaseRequisitionId,
      }),
      ...(query.requestForQuotationId && {
        requestForQuotationId: query.requestForQuotationId,
      }),
      ...(query.status && { status: query.status }),
    };

    const [data, total] = await Promise.all([
      this.prisma.supplierQuote.findMany({
        where,
        skip,
        take: limit,
        select: {
          id: true,
          quoteNumber: true,
          status: true,
          quotedDate: true,
          paymentTerms: true,
          attachmentUrl: true,
          requestForQuotationId: true,
          supplierId: true,
          supplier: {
            select: { id: true, name: true, code: true, email: true },
          },
          purchaseRequisitionId: true,
          purchaseRequisition: {
            select: { id: true, prNumber: true },
          },
          totalAmount: true,
          deliveryDays: true,
          validUntil: true,
          receivedAt: true,
          selectedAt: true,
          createdAt: true,
          _count: {
            select: { items: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.supplierQuote.count({ where }),
    ]);

    return {
      data: data.map((quote) => ({
        id: quote.id,
        quoteNumber: quote.quoteNumber,
        status: quote.status,
        quotedDate: quote.quotedDate,
        paymentTerms: quote.paymentTerms,
        attachmentUrl: quote.attachmentUrl,
        requestForQuotationId: quote.requestForQuotationId,
        supplierId: quote.supplierId,
        // Flat (legacy compat) + nested (Inbox UI uses .supplier.name / .supplier.code)
        supplierName: quote.supplier?.name || 'Unknown',
        supplier: quote.supplier
          ? {
              id: quote.supplier.id,
              name: quote.supplier.name,
              code: quote.supplier.code,
              email: quote.supplier.email,
            }
          : null,
        purchaseRequisitionId: quote.purchaseRequisitionId,
        purchaseRequisition: quote.purchaseRequisition
          ? {
              id: quote.purchaseRequisition.id,
              prNumber: quote.purchaseRequisition.prNumber,
            }
          : null,
        totalAmount: quote.totalAmount,
        deliveryDays: quote.deliveryDays,
        validUntil: quote.validUntil,
        receivedAt: quote.receivedAt,
        selectedAt: quote.selectedAt,
        createdAt: quote.createdAt,
        itemCount: quote._count.items,
      })),
      meta: { page, limit, total },
    };
  }

  async findOne(id: string, tenantId: string): Promise<any> {
    const quote = await this.prisma.supplierQuote.findUnique({
      where: { id },
      include: {
        items: {
          select: {
            id: true,
            itemId: true,
            item: {
              select: {
                id: true,
                name: true,
                sku: true,
              },
            },
            quantity: true,
            unitPrice: true,
            discount: true,
            taxRate: true,
            totalPrice: true,
            leadTimeDays: true,
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
        purchaseRequisition: {
          select: {
            id: true,
            prNumber: true,
            status: true,
          },
        },
      },
    });

    if (!quote || quote.tenantId !== tenantId) {
      throw new NotFoundException('Supplier quote not found');
    }

    return {
      id: quote.id,
      quoteNumber: quote.quoteNumber,
      status: quote.status,
      supplierId: quote.supplierId,
      supplier: quote.supplier,
      purchaseRequisitionId: quote.purchaseRequisitionId,
      purchaseRequisition: quote.purchaseRequisition,
      quotedDate: quote.quotedDate,
      validUntil: quote.validUntil,
      deliveryDays: quote.deliveryDays,
      paymentTerms: quote.paymentTerms,
      subtotal: quote.subtotal,
      taxAmount: quote.taxAmount,
      discountAmount: quote.discountAmount,
      totalAmount: quote.totalAmount,
      currency: quote.currency,
      notes: quote.notes,
      attachmentUrl: quote.attachmentUrl,
      requestedAt: quote.requestedAt,
      receivedAt: quote.receivedAt,
      selectedAt: quote.selectedAt,
      rejectedAt: quote.rejectedAt,
      rejectionReason: quote.rejectionReason,
      items: quote.items.map((item) => ({
        id: item.id,
        itemId: item.itemId,
        itemName: item.item?.name,
        itemSku: item.item?.sku,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        discount: item.discount,
        taxRate: item.taxRate,
        totalPrice: item.totalPrice,
        leadTimeDays: item.leadTimeDays,
        notes: item.notes,
      })),
      createdAt: quote.createdAt,
      updatedAt: quote.updatedAt,
    };
  }

  async submitQuote(id: string, dto: SubmitQuoteDto, tenantId: string): Promise<any> {
    const quote = await this.prisma.supplierQuote.findUnique({
      where: { id },
    });

    if (!quote || quote.tenantId !== tenantId) {
      throw new NotFoundException('Supplier quote not found');
    }

    if (quote.status !== 'REQUESTED') {
      throw new BadRequestException(`Cannot submit quote with status ${quote.status}`);
    }

    // Validate all items exist
    const itemIds = dto.items.map((item) => item.itemId);
    const existingItems = await this.prisma.inventoryItem.findMany({
      where: { id: { in: itemIds } },
      select: { id: true },
    });

    if (existingItems.length !== itemIds.length) {
      throw new BadRequestException('One or more items do not exist');
    }

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        // Calculate totals
        let subtotal = 0;
        let taxAmount = 0;
        let discountAmount = 0;

        const itemsToCreate = dto.items.map((item) => {
          const discount = item.discount || 0;
          const taxRate = item.taxRate || 7;

          const basePrice = item.quantity * item.unitPrice;
          const discountedPrice = basePrice * ((100 - discount) / 100);
          const itemTax = discountedPrice * (taxRate / 100);
          const itemTotal = discountedPrice + itemTax;

          subtotal += basePrice - (basePrice * discount) / 100;
          taxAmount += itemTax;
          discountAmount += (basePrice * discount) / 100;

          return {
            itemId: item.itemId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            discount,
            taxRate,
            totalPrice: itemTotal,
            leadTimeDays: item.leadTimeDays,
            notes: item.notes,
          };
        });

        const totalAmount = subtotal + taxAmount;

        // Delete existing items if any
        await tx.supplierQuoteItem.deleteMany({
          where: { supplierQuoteId: id },
        });

        // Update quote with new data
        const updatedQuote = await tx.supplierQuote.update({
          where: { id },
          data: {
            status: 'RECEIVED',
            quoteNumber: dto.quoteNumber,
            quotedDate: dto.quotedDate ? new Date(dto.quotedDate) : null,
            validUntil: dto.validUntil ? new Date(dto.validUntil) : null,
            deliveryDays: dto.deliveryDays,
            paymentTerms: dto.paymentTerms,
            notes: dto.notes,
            attachmentUrl: dto.attachmentUrl,
            subtotal,
            taxAmount,
            discountAmount,
            totalAmount,
            receivedAt: new Date(),
            items: {
              createMany: {
                data: itemsToCreate,
              },
            },
          },
          include: {
            items: true,
            supplier: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        });

        this.logger.log(`Quote ${id} submitted with status RECEIVED. Total: ${totalAmount}`);

        return updatedQuote;
      });

      // After commit: roll up RFQ status if this quote is linked to an RFQ
      if (quote.requestForQuotationId) {
        try {
          await this.rfqsService.markResponseReceived(
            tenantId,
            quote.requestForQuotationId,
            quote.supplierId,
          );
        } catch (err) {
          this.logger.warn(
            `Failed to roll up RFQ status for quote ${id}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }

      return result;
    } catch (error) {
      this.logger.error(`Error submitting quote: ${error}`);
      throw new BadRequestException('Failed to submit quote');
    }
  }

  async selectQuote(id: string, userId: string, tenantId: string): Promise<any> {
    const quote = await this.prisma.supplierQuote.findUnique({
      where: { id },
      include: {
        purchaseRequisition: true,
      },
    });

    if (!quote || quote.tenantId !== tenantId) {
      throw new NotFoundException('Supplier quote not found');
    }

    if (quote.status !== 'RECEIVED') {
      throw new BadRequestException(`Cannot select quote with status ${quote.status}`);
    }

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        // Update selected quote
        const selectedQuote = await tx.supplierQuote.update({
          where: { id },
          data: {
            status: 'SELECTED',
            selectedAt: new Date(),
          },
          include: {
            items: true,
            supplier: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        });

        // Reject other quotes for the same PR
        await tx.supplierQuote.updateMany({
          where: {
            purchaseRequisitionId: quote.purchaseRequisitionId,
            id: { not: id },
            status: { in: ['RECEIVED', 'REQUESTED'] },
          },
          data: {
            status: 'REJECTED',
            rejectedAt: new Date(),
            rejectionReason: 'Another supplier quote was selected',
          },
        });

        // Update PR status to QUOTES_RECEIVED
        await tx.purchaseRequisition.update({
          where: { id: quote.purchaseRequisitionId },
          data: { status: 'QUOTES_RECEIVED' },
        });

        this.logger.log(
          `Quote ${id} selected and PR ${quote.purchaseRequisitionId} updated to QUOTES_RECEIVED`,
        );

        return selectedQuote;
      });

      return result;
    } catch (error) {
      this.logger.error(`Error selecting quote: ${error}`);
      throw new BadRequestException('Failed to select quote');
    }
  }

  async rejectQuote(id: string, reason: string, tenantId: string): Promise<any> {
    const quote = await this.prisma.supplierQuote.findUnique({
      where: { id },
    });

    if (!quote || quote.tenantId !== tenantId) {
      throw new NotFoundException('Supplier quote not found');
    }

    if (!['RECEIVED', 'REQUESTED'].includes(quote.status)) {
      throw new BadRequestException(`Cannot reject quote with status ${quote.status}`);
    }

    const result = await this.prisma.supplierQuote.update({
      where: { id },
      data: {
        status: 'REJECTED',
        rejectedAt: new Date(),
        rejectionReason: reason,
      },
      include: {
        items: true,
        supplier: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    this.logger.log(`Quote ${id} rejected. Reason: ${reason}`);

    return result;
  }

  async findByPR(prId: string, tenantId: string): Promise<any> {
    const quotes = await this.prisma.supplierQuote.findMany({
      where: {
        purchaseRequisitionId: prId,
        tenantId,
      },
      include: {
        items: {
          include: {
            item: {
              select: {
                id: true,
                name: true,
                sku: true,
              },
            },
          },
        },
        supplier: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    if (quotes.length === 0) {
      throw new NotFoundException(`No supplier quotes found for PR ${prId}`);
    }

    return quotes.map((quote) => ({
      id: quote.id,
      quoteNumber: quote.quoteNumber,
      status: quote.status,
      supplierId: quote.supplierId,
      supplier: quote.supplier,
      quotedDate: quote.quotedDate,
      validUntil: quote.validUntil,
      totalAmount: quote.totalAmount,
      subtotal: quote.subtotal,
      taxAmount: quote.taxAmount,
      discountAmount: quote.discountAmount,
      deliveryDays: quote.deliveryDays,
      paymentTerms: quote.paymentTerms,
      notes: quote.notes,
      attachmentUrl: quote.attachmentUrl,
      items: quote.items.map((item) => ({
        id: item.id,
        itemId: item.itemId,
        itemName: item.item?.name,
        itemSku: item.item?.sku,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        discount: item.discount,
        taxRate: item.taxRate,
        totalPrice: item.totalPrice,
        leadTimeDays: item.leadTimeDays,
      })),
      createdAt: quote.createdAt,
      updatedAt: quote.updatedAt,
    }));
  }

  async updateAttachment(id: string, attachmentUrl: string, tenantId: string): Promise<unknown> {
    const quote = await this.prisma.supplierQuote.findFirst({
      where: { id, tenantId },
    });

    if (!quote) {
      throw new NotFoundException(`Supplier quote ${id} not found`);
    }

    return this.prisma.supplierQuote.update({
      where: { id },
      data: { attachmentUrl },
    });
  }

  /**
   * Update quote data (prices, items, details) — allows editing RECEIVED quotes
   */
  async updateQuote(id: string, dto: SubmitQuoteDto, tenantId: string): Promise<unknown> {
    const quote = await this.prisma.supplierQuote.findFirst({
      where: { id, tenantId },
    });

    if (!quote) {
      this.logger.warn(`Supplier quote ${id} not found for tenant ${tenantId}`);
      throw new NotFoundException(`Supplier quote ${id} not found`);
    }

    if (!['REQUESTED', 'RECEIVED', 'SELECTED'].includes(quote.status)) {
      throw new BadRequestException(
        `Cannot edit quote with status ${quote.status}. Only REQUESTED, RECEIVED, and SELECTED quotes can be edited.`,
      );
    }

    // Validate all items exist
    const itemIds = dto.items.map((item) => item.itemId);
    const existingItems = await this.prisma.inventoryItem.findMany({
      where: { id: { in: itemIds } },
      select: { id: true },
    });

    if (existingItems.length !== itemIds.length) {
      throw new BadRequestException('One or more items do not exist');
    }

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        let subtotal = 0;
        let taxAmount = 0;
        let discountAmount = 0;

        const itemsToCreate = dto.items.map((item) => {
          const discount = item.discount || 0;
          const taxRate = item.taxRate || 7;
          const basePrice = item.quantity * item.unitPrice;
          const discountedPrice = basePrice * ((100 - discount) / 100);
          const itemTax = discountedPrice * (taxRate / 100);
          const itemTotal = discountedPrice + itemTax;

          subtotal += basePrice - (basePrice * discount) / 100;
          taxAmount += itemTax;
          discountAmount += (basePrice * discount) / 100;

          return {
            itemId: item.itemId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            discount,
            taxRate,
            totalPrice: itemTotal,
            leadTimeDays: item.leadTimeDays,
            notes: item.notes,
          };
        });

        const totalAmount = subtotal + taxAmount;

        // Delete existing items
        await tx.supplierQuoteItem.deleteMany({
          where: { supplierQuoteId: id },
        });

        // Update quote — keep current status, update data only
        const updatedQuote = await tx.supplierQuote.update({
          where: { id },
          data: {
            status: quote.status === 'REQUESTED' ? 'RECEIVED' : quote.status, // Keep RECEIVED/SELECTED as-is
            quoteNumber: dto.quoteNumber,
            quotedDate: dto.quotedDate ? new Date(dto.quotedDate) : null,
            validUntil: dto.validUntil ? new Date(dto.validUntil) : null,
            deliveryDays: dto.deliveryDays,
            paymentTerms: dto.paymentTerms,
            notes: dto.notes,
            attachmentUrl: dto.attachmentUrl,
            subtotal,
            taxAmount,
            discountAmount,
            totalAmount,
            receivedAt: quote.receivedAt || new Date(),
            items: {
              createMany: { data: itemsToCreate },
            },
          },
          include: {
            items: true,
            supplier: { select: { id: true, name: true } },
          },
        });

        this.logger.log(`Quote ${id} updated. New total: ${totalAmount}`);
        return updatedQuote;
      });

      // Only roll up when this is the FIRST transition REQUESTED → RECEIVED
      const didJustReceive = quote.status === 'REQUESTED';
      if (didJustReceive && quote.requestForQuotationId) {
        try {
          await this.rfqsService.markResponseReceived(
            tenantId,
            quote.requestForQuotationId,
            quote.supplierId,
          );
        } catch (err) {
          this.logger.warn(
            `Failed to roll up RFQ status for quote ${id}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }

      return result;
    } catch (error) {
      this.logger.error(`Error updating quote: ${error}`);
      throw new BadRequestException('Failed to update quote');
    }
  }

  /**
   * Update quote status manually
   */
  async updateStatus(id: string, status: string, tenantId: string): Promise<unknown> {
    const validStatuses = ['REQUESTED', 'RECEIVED', 'SELECTED', 'REJECTED', 'EXPIRED'];
    if (!validStatuses.includes(status)) {
      throw new BadRequestException(
        `Invalid status "${status}". Valid statuses: ${validStatuses.join(', ')}`,
      );
    }

    const quote = await this.prisma.supplierQuote.findFirst({
      where: { id, tenantId },
    });

    if (!quote) {
      throw new NotFoundException(`Supplier quote ${id} not found`);
    }

    const timestampUpdates: Record<string, unknown> = {};
    if (status === 'RECEIVED' && !quote.receivedAt) {
      timestampUpdates.receivedAt = new Date();
    }
    if (status === 'SELECTED') {
      timestampUpdates.selectedAt = new Date();
    }
    if (status === 'REJECTED') {
      timestampUpdates.rejectedAt = new Date();
    }

    const result = await this.prisma.supplierQuote.update({
      where: { id },
      data: {
        status: status as any,
        ...timestampUpdates,
      },
      include: {
        supplier: { select: { id: true, name: true } },
      },
    });

    this.logger.log(`Quote ${id} status changed: ${quote.status} → ${status}`);
    return result;
  }

  /**
   * Reopen a submitted quote so the supplier can edit and resubmit.
   *
   * Allowed only from status RECEIVED (supplier has submitted but we haven't
   * selected a winner yet). Not allowed from SELECTED or REJECTED — those
   * are terminal and require explicit admin action to reset.
   *
   * Flow:
   *   1. Validate current status
   *   2. Revert status RECEIVED → REQUESTED inside a tx, revoking any
   *      still-active magic-link tokens for this quote
   *   3. Clear the submitted timestamps so the quote looks "fresh" to the
   *      supplier portal
   *   4. Regenerate a new token + resend the invitation email via
   *      RfqsService.resendInvitation
   */
  async reopenQuote(
    id: string,
    tenantId: string,
  ): Promise<{ quoteId: string; resent: number; skipped: number }> {
    const quote = await this.prisma.supplierQuote.findFirst({
      where: { id, tenantId },
      select: {
        id: true,
        status: true,
        supplierId: true,
        requestForQuotationId: true,
      },
    });

    if (!quote) {
      throw new NotFoundException('Supplier quote not found');
    }
    if (!quote.requestForQuotationId) {
      throw new BadRequestException('Cannot reopen a quote that is not attached to an RFQ');
    }
    if (quote.status !== 'RECEIVED') {
      throw new BadRequestException(
        `Cannot reopen quote with status ${quote.status} (only RECEIVED can be reopened)`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.supplierQuote.update({
        where: { id },
        data: {
          status: 'REQUESTED',
          receivedAt: null,
        },
      });

      // Also clear the RFQ recipient's respondedAt so remind() and roll-up
      // counters see this supplier as "not responded yet" again.
      await tx.rfqSupplierRecipient.updateMany({
        where: {
          requestForQuotationId: quote.requestForQuotationId!,
          supplierId: quote.supplierId,
        },
        data: { respondedAt: null },
      });

      // Revoke any tokens still alive for this quote so the previous link
      // stops working. The new token is minted by resendInvitation below.
      await tx.supplierQuoteToken.updateMany({
        where: {
          supplierQuoteId: id,
          usedAt: null,
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      });
    });

    this.logger.log(`Quote ${id} reopened (RECEIVED → REQUESTED)`);

    // Regenerate token + send fresh invite email to this supplier only.
    const mail = await this.rfqsService.resendInvitation(
      quote.requestForQuotationId,
      tenantId,
      quote.supplierId,
    );

    return { quoteId: id, resent: mail.resent, skipped: mail.skipped };
  }
}
