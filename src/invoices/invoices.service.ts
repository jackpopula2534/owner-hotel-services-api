import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import type { invoices as InvoiceRow, invoices_status } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';

// Subscription invoices in these states are still owed by the tenant and must
// block the creation of any new subscription invoice (no double-billing).
// `paid`, `voided` and `rejected` are settled/closed and never block.
const OUTSTANDING_INVOICE_STATUSES: invoices_status[] = ['pending', 'finalized'];

export interface CreateInvoiceOptions {
  // Internal callers (seeders, data migrations, admin backfills) can bypass the
  // outstanding-invoice guard. Customer-facing flows must never set this.
  skipOutstandingCheck?: boolean;
}

@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Return the tenant's outstanding (unpaid, not voided) SUBSCRIPTION invoices.
   * Booking/guest-folio invoices (booking_id set) are intentionally excluded —
   * this guard only governs SaaS subscription billing.
   */
  findOutstandingSubscriptionInvoices(tenantId: string) {
    return this.prisma.invoices.findMany({
      where: {
        tenant_id: tenantId,
        booking_id: null,
        subscription_id: { not: null },
        status: { in: OUTSTANDING_INVOICE_STATUSES },
      },
      orderBy: { created_at: 'asc' },
    });
  }

  /**
   * Throws 409 Conflict if the tenant still has any outstanding subscription
   * invoice. This is the single chokepoint that prevents duplicate invoices:
   * a tenant must settle or void the existing one before a new one is issued.
   */
  async assertNoOutstandingSubscriptionInvoices(tenantId: string): Promise<void> {
    const outstanding = await this.findOutstandingSubscriptionInvoices(tenantId);
    if (outstanding.length > 0) {
      const total = outstanding.reduce((sum, inv) => sum + Number(inv.amount), 0);
      throw new ConflictException({
        success: false,
        error: {
          code: 'OUTSTANDING_INVOICE_EXISTS',
          message:
            'มีใบแจ้งหนี้ที่ยังค้างชำระอยู่ กรุณาชำระหรือยกเลิกใบแจ้งหนี้เดิมก่อนจึงจะสามารถออกใบแจ้งหนี้ใหม่ได้',
          outstandingCount: outstanding.length,
          outstandingTotal: total,
          invoices: outstanding.map((inv) => ({
            id: inv.id,
            invoiceNo: inv.invoice_no,
            amount: Number(inv.amount),
            status: inv.status,
            dueDate: inv.due_date,
          })),
        },
      });
    }
  }

  async create(createInvoiceDto: CreateInvoiceDto, options: CreateInvoiceOptions = {}) {
    // Guard against duplicate subscription invoices. Only applies to
    // subscription invoices (has subscriptionId, no bookingId) and can be
    // bypassed explicitly by trusted internal callers.
    const isSubscriptionInvoice =
      !!createInvoiceDto.subscriptionId && !createInvoiceDto.bookingId;
    if (isSubscriptionInvoice && !options.skipOutstandingCheck) {
      await this.assertNoOutstandingSubscriptionInvoices(createInvoiceDto.tenantId);
    }

    const data: any = {
      tenant_id: createInvoiceDto.tenantId,
      subscription_id: createInvoiceDto.subscriptionId,
      booking_id: createInvoiceDto.bookingId,
      invoice_no: createInvoiceDto.invoiceNo,
      amount: createInvoiceDto.amount,
      status: createInvoiceDto.status,
      due_date: createInvoiceDto.dueDate,
    };

    // Clean up undefined properties
    Object.keys(data).forEach((key) => {
      if (data[key] === undefined) {
        delete data[key];
      }
    });

    return this.prisma.invoices.create({
      data,
      include: { tenants: true, subscriptions: true, invoice_items: true, payments: true },
    });
  }

  findAll(tenantId?: string) {
    const where = tenantId ? { tenant_id: tenantId } : {};
    return this.prisma.invoices.findMany({
      where,
      include: { tenants: true, subscriptions: true, invoice_items: true, payments: true },
      orderBy: { created_at: 'desc' },
    });
  }

  findOne(id: string, tenantId?: string) {
    const where = tenantId ? { id, tenant_id: tenantId } : { id };
    return this.prisma.invoices.findFirst({
      where,
      include: { tenants: true, subscriptions: true, invoice_items: true, payments: true },
    });
  }

  findByTenantId(tenantId: string) {
    return this.prisma.invoices.findMany({
      where: { tenant_id: tenantId },
      include: { subscriptions: true, invoice_items: true, payments: true },
      orderBy: { created_at: 'desc' },
    });
  }

  update(id: string, updateInvoiceDto: UpdateInvoiceDto) {
    const data: any = {
      tenant_id: updateInvoiceDto.tenantId,
      subscription_id: updateInvoiceDto.subscriptionId,
      invoice_no: updateInvoiceDto.invoiceNo,
      amount: updateInvoiceDto.amount,
      status: updateInvoiceDto.status,
      due_date: updateInvoiceDto.dueDate,
    };

    // Clean up undefined properties
    Object.keys(data).forEach((key) => {
      if (data[key] === undefined) {
        delete data[key];
      }
    });

    return this.prisma.invoices.update({
      where: { id },
      data,
      include: { tenants: true, subscriptions: true, invoice_items: true, payments: true },
    });
  }

  /**
   * Void (cancel) an outstanding subscription invoice. Self-service safe:
   * - scoped to the caller's tenant (passing tenantId)
   * - only invoices still outstanding (pending/finalized) can be voided;
   *   paid invoices must go through a refund flow, already-voided ones are no-ops
   */
  async voidInvoice(
    id: string,
    reason: string | undefined,
    tenantId?: string,
  ): Promise<InvoiceRow> {
    const where = tenantId ? { id, tenant_id: tenantId } : { id };
    const invoice = await this.prisma.invoices.findFirst({ where });
    if (!invoice) {
      throw new NotFoundException({
        success: false,
        error: { code: 'INVOICE_NOT_FOUND', message: `Invoice with ID ${id} not found` },
      });
    }
    if (invoice.status === 'paid') {
      throw new BadRequestException({
        success: false,
        error: {
          code: 'INVOICE_ALREADY_PAID',
          message: 'ไม่สามารถยกเลิกใบแจ้งหนี้ที่ชำระแล้วได้',
        },
      });
    }
    if (invoice.status === 'voided') {
      throw new BadRequestException({
        success: false,
        error: { code: 'INVOICE_ALREADY_VOIDED', message: 'ใบแจ้งหนี้นี้ถูกยกเลิกไปแล้ว' },
      });
    }

    const updated = await this.prisma.invoices.update({
      where: { id: invoice.id },
      data: {
        status: 'voided',
        voided_at: new Date(),
        voided_reason: reason ?? 'ยกเลิกโดยผู้ใช้',
      },
    });
    this.logger.log(
      `Invoice ${updated.invoice_no} (${updated.id}) voided for tenant ${updated.tenant_id}`,
    );
    return updated;
  }

  remove(id: string, tenantId?: string) {
    const where = tenantId ? { id, tenant_id: tenantId } : { id };
    return this.prisma.invoices.deleteMany({
      where,
    });
  }
}
