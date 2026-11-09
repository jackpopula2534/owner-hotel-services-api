import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PrismaService } from '../prisma/prisma.service';
import { Invoice, InvoiceStatus } from '../invoices/entities/invoice.entity';
import { InvoiceAdjustment, AdjustmentType } from '../invoices/entities/invoice-adjustment.entity';
import { InvoiceItem } from '../invoice-items/entities/invoice-item.entity';
import {
  AdjustInvoiceDto,
  VoidInvoiceDto,
  UpdateInvoiceItemDto,
  AdjustmentTypeDto,
  InvoiceAdjustmentsListDto,
  AdjustInvoiceResponseDto,
  VoidInvoiceResponseDto,
  UpdateInvoiceItemResponseDto,
  InvoiceWithItemsDto,
  AdjustmentItemDto,
  InvoiceItemDetailDto,
} from './dto/admin-invoice-adjustments.dto';

@Injectable()
export class AdminInvoiceAdjustmentsService {
  private readonly logger = new Logger(AdminInvoiceAdjustmentsService.name);

  constructor(
    @InjectRepository(Invoice)
    private invoicesRepository: Repository<Invoice>,
    @InjectRepository(InvoiceAdjustment)
    private adjustmentsRepository: Repository<InvoiceAdjustment>,
    @InjectRepository(InvoiceItem)
    private invoiceItemsRepository: Repository<InvoiceItem>,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * POST /api/v1/admin/invoices/:id/adjust
   * Adjust invoice amount (discount, credit, surcharge, proration)
   */
  async adjustInvoice(
    invoiceId: string,
    dto: AdjustInvoiceDto,
    adminId?: string,
  ): Promise<AdjustInvoiceResponseDto> {
    // Read via Prisma (system's primary ORM) so the write below is visible
    // everywhere the invoice is read (admin breakdown + customer print).
    const invoice = await this.prisma.invoices.findFirst({
      where: { OR: [{ id: invoiceId }, { invoice_no: invoiceId }] },
    });
    if (!invoice) {
      throw new NotFoundException(`Invoice with ID "${invoiceId}" not found`);
    }

    // Can't adjust voided invoices
    if (String(invoice.status) === 'voided') {
      throw new BadRequestException('Cannot adjust a voided invoice');
    }

    const originalAmount = Number(invoice.amount);
    let adjustmentAmount = dto.amount;

    // For discount/credit, subtract; for surcharge, add
    if (dto.type === AdjustmentTypeDto.DISCOUNT || dto.type === AdjustmentTypeDto.CREDIT) {
      adjustmentAmount = -Math.abs(dto.amount);
    } else {
      adjustmentAmount = Math.abs(dto.amount);
    }

    const newAmount = originalAmount + adjustmentAmount;

    if (newAmount < 0) {
      throw new BadRequestException(
        `Adjustment would result in negative amount. Current: ${originalAmount}, Adjustment: ${adjustmentAmount}`,
      );
    }

    // Generate Credit Memo reference if requested
    let creditMemoNo: string | undefined;
    if (
      dto.generateCreditMemo &&
      (dto.type === AdjustmentTypeDto.DISCOUNT || dto.type === AdjustmentTypeDto.CREDIT)
    ) {
      creditMemoNo = `CM-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
    }

    // Atomically record the adjustment AND update the invoice amount via Prisma.
    // The previous TypeORM path wrote to a parallel layer and the update never
    // reflected in the Prisma-backed reads, so the invoice looked unchanged.
    await this.prisma.$transaction([
      this.prisma.invoice_adjustments.create({
        data: {
          invoice_id: invoice.id,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          type: dto.type as any,
          amount: Math.abs(dto.amount),
          original_amount: originalAmount,
          new_amount: newAmount,
          reason: dto.reason,
          notes: dto.notes,
          adjustment_reference: creditMemoNo,
          created_by: adminId,
        },
      }),
      this.prisma.invoices.update({
        where: { id: invoice.id },
        data: {
          amount: newAmount,
          adjusted_amount: newAmount,
          original_amount: invoice.original_amount ?? originalAmount,
        },
      }),
    ]);

    this.logger.log(
      `Invoice ${invoice.invoice_no} adjusted: ${originalAmount} -> ${newAmount} (${dto.type}: ${dto.amount})`,
    );

    return {
      success: true,
      message: 'Invoice adjusted successfully',
      data: {
        invoiceNo: invoice.invoice_no,
        adjustmentType: dto.type,
        adjustmentAmount: Math.abs(dto.amount),
        originalAmount,
        newAmount,
        creditMemoNo,
      },
    };
  }

  /**
   * POST /api/v1/admin/invoices/:id/void
   * Void an invoice
   */
  async voidInvoice(
    invoiceId: string,
    dto: VoidInvoiceDto,
    adminId?: string,
  ): Promise<VoidInvoiceResponseDto> {
    const invoice = await this.findInvoice(invoiceId);

    if (invoice.status === InvoiceStatus.VOIDED) {
      throw new BadRequestException('Invoice is already voided');
    }

    const createCredit = dto.createCredit !== false;
    let creditAmount = 0;

    // If invoice was paid and we should create credit
    if (invoice.status === InvoiceStatus.PAID && createCredit) {
      creditAmount = Number(invoice.amount);
      // TODO: In Phase 4, create actual credit record
    }

    // Create void adjustment record
    const adjustment = this.adjustmentsRepository.create({
      invoiceId: invoice.id,
      type: AdjustmentType.VOID,
      amount: Number(invoice.amount),
      originalAmount: Number(invoice.amount),
      newAmount: 0,
      reason: dto.reason,
      notes: dto.notes,
      createdBy: adminId,
    });

    await this.adjustmentsRepository.save(adjustment);

    // Update invoice
    if (!invoice.originalAmount) {
      invoice.originalAmount = Number(invoice.amount);
    }
    invoice.status = InvoiceStatus.VOIDED;
    invoice.voidedAt = new Date();
    invoice.voidedReason = dto.reason;
    await this.invoicesRepository.save(invoice);

    this.logger.log(
      `Invoice ${invoice.invoiceNo} voided. Reason: ${dto.reason}. Credit created: ${createCredit && creditAmount > 0}`,
    );

    return {
      success: true,
      message: 'Invoice voided successfully',
      data: {
        invoiceNo: invoice.invoiceNo,
        voidedAt: new Date().toISOString(),
        creditAmount: createCredit ? creditAmount : undefined,
        creditCreated: createCredit && creditAmount > 0,
      },
    };
  }

  /**
   * GET /api/v1/admin/invoices/:id/adjustments
   * Get adjustment history for an invoice
   */
  async getAdjustments(invoiceId: string): Promise<InvoiceAdjustmentsListDto> {
    // Read via Prisma so the history reflects adjustments written above.
    const invoice = await this.prisma.invoices.findFirst({
      where: { OR: [{ id: invoiceId }, { invoice_no: invoiceId }] },
      include: { invoice_adjustments: { orderBy: { created_at: 'desc' } } },
    });
    if (!invoice) {
      throw new NotFoundException(`Invoice with ID "${invoiceId}" not found`);
    }

    const adjustmentItems: AdjustmentItemDto[] = (invoice.invoice_adjustments || []).map(
      (adj) => ({
        id: adj.id,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        type: adj.type as any,
        amount: Number(adj.amount),
        originalAmount: Number(adj.original_amount),
        newAmount: Number(adj.new_amount),
        reason: adj.reason || undefined,
        creditMemoNo: adj.adjustment_reference || undefined,
        createdAt: adj.created_at.toISOString(),
        createdBy: adj.created_by || undefined,
      }),
    );

    const originalAmount = Number(invoice.original_amount ?? invoice.amount);
    const currentAmount = Number(invoice.amount);

    return {
      invoiceNo: invoice.invoice_no,
      originalAmount,
      currentAmount,
      totalAdjustment: currentAmount - originalAmount,
      adjustments: adjustmentItems,
    };
  }

  /**
   * GET /api/v1/admin/invoices/:id/items
   * Get invoice with line items
   */
  async getInvoiceWithItems(invoiceId: string): Promise<InvoiceWithItemsDto> {
    // Read via Prisma (same source the customer print uses) so the admin view
    // shows the exact same line items — including the coupon discount row.
    // The previous TypeORM path could return a stale/empty invoiceItems relation
    // for Prisma-written rows, so the admin breakdown fell back to a single line.
    // This is a platform-admin cross-tenant route (no tenant context), so
    // findFirst({ id }) resolves the invoice across tenants; if a tenant context
    // is ever active the TenantScope guard auto-injects the tenant_id filter.
    const invoice = await this.prisma.invoices.findFirst({
      where: { OR: [{ id: invoiceId }, { invoice_no: invoiceId }] },
      include: { invoice_items: true, tenants: true },
    });

    if (!invoice) {
      throw new NotFoundException(`Invoice with ID "${invoiceId}" not found`);
    }

    const items: InvoiceItemDetailDto[] = (invoice.invoice_items || []).map((item) => ({
      id: item.id,
      type: item.type as unknown as InvoiceItemDetailDto['type'],
      description: item.description,
      quantity: item.quantity || 1,
      unitPrice: Number(item.unit_price ?? item.amount),
      amount: Number(item.amount),
      originalAmount: item.original_amount != null ? Number(item.original_amount) : undefined,
      isAdjusted: Boolean(item.is_adjusted),
    }));

    const subtotal = items.reduce((sum, i) => sum + i.amount, 0);
    const originalAmount = Number(invoice.original_amount ?? invoice.amount);
    const currentAmount = Number(invoice.amount);

    return {
      id: invoice.id,
      invoiceNo: invoice.invoice_no,
      hotelName: invoice.tenants?.name || 'N/A',
      status: invoice.status,
      items,
      subtotal,
      totalAdjustments: currentAmount - originalAmount,
      total: currentAmount,
      dueDate: invoice.due_date?.toISOString().split('T')[0] || 'N/A',
      voidedAt: invoice.voided_at?.toISOString() || undefined,
    };
  }

  /**
   * PATCH /api/v1/admin/invoice-items/:id
   * Update an invoice line item
   */
  async updateInvoiceItem(
    itemId: string,
    dto: UpdateInvoiceItemDto,
    adminId?: string,
  ): Promise<UpdateInvoiceItemResponseDto> {
    const item = await this.invoiceItemsRepository.findOne({
      where: { id: itemId },
      relations: ['invoice'],
    });

    if (!item) {
      throw new NotFoundException(`Invoice item with ID "${itemId}" not found`);
    }

    const invoice = item.invoice;

    if (invoice.status === InvoiceStatus.VOIDED) {
      throw new BadRequestException('Cannot update items on a voided invoice');
    }

    if (invoice.status === InvoiceStatus.PAID) {
      throw new BadRequestException(
        'Cannot update items on a paid invoice. Use adjustment or void instead.',
      );
    }

    const oldQuantity = item.quantity || 1;
    const oldUnitPrice = Number(item.unitPrice || item.amount);
    const oldAmount = Number(item.amount);

    const newQuantity = dto.quantity !== undefined ? dto.quantity : oldQuantity;
    const newUnitPrice = dto.unitPrice !== undefined ? dto.unitPrice : oldUnitPrice;
    const newAmount = newQuantity * newUnitPrice;

    // Save original amount if first edit
    if (!item.originalAmount) {
      item.originalAmount = oldAmount;
    }

    // Update item
    item.quantity = newQuantity;
    item.unitPrice = newUnitPrice;
    item.amount = newAmount;
    item.isAdjusted = true;
    if (dto.description) {
      item.description = dto.description;
    }

    await this.invoiceItemsRepository.save(item);

    // Recalculate invoice total
    const allItems = await this.invoiceItemsRepository.find({
      where: { invoiceId: invoice.id },
    });

    const newInvoiceTotal = allItems.reduce((sum, i) => sum + Number(i.amount), 0);

    // Update invoice
    if (!invoice.originalAmount) {
      invoice.originalAmount = Number(invoice.amount);
    }
    invoice.amount = newInvoiceTotal;
    invoice.adjustedAmount = newInvoiceTotal;
    await this.invoicesRepository.save(invoice);

    // Create adjustment record for audit
    if (oldAmount !== newAmount) {
      const adjustment = this.adjustmentsRepository.create({
        invoiceId: invoice.id,
        type: AdjustmentType.PRORATION,
        amount: Math.abs(newAmount - oldAmount),
        originalAmount: oldAmount,
        newAmount: newAmount,
        reason: dto.reason || `Item "${item.description}" updated`,
        createdBy: adminId,
      });
      await this.adjustmentsRepository.save(adjustment);
    }

    this.logger.log(
      `Invoice item ${itemId} updated: qty ${oldQuantity} -> ${newQuantity}, price ${oldUnitPrice} -> ${newUnitPrice}`,
    );

    return {
      success: true,
      message: 'Invoice item updated successfully',
      data: {
        itemId: item.id,
        description: item.description,
        oldQuantity,
        newQuantity,
        oldUnitPrice,
        newUnitPrice,
        oldAmount,
        newAmount,
        invoiceTotalUpdated: newInvoiceTotal,
      },
    };
  }

  // ============ Helper Methods ============

  private async findInvoice(invoiceId: string): Promise<Invoice> {
    let invoice = await this.invoicesRepository.findOne({
      where: { id: invoiceId },
    });

    if (!invoice) {
      // Try by invoice number
      invoice = await this.invoicesRepository.findOne({
        where: { invoiceNo: invoiceId },
      });
    }

    if (!invoice) {
      throw new NotFoundException(`Invoice with ID "${invoiceId}" not found`);
    }

    return invoice;
  }
}
