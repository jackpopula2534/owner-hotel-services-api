import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailEventsService } from '../email/email-events.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { PaymentStatus } from './entities/payment.entity';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { UpdatePaymentDto } from './dto/update-payment.dto';
import { Prisma, payments_method, payments_status } from '@prisma/client';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailEventsService: EmailEventsService,
    private readonly auditLogService: AuditLogService,
  ) {}

  create(createPaymentDto: CreatePaymentDto) {
    const data: Prisma.paymentsUncheckedCreateInput = {
      invoice_id: createPaymentDto.invoiceId,
      method: createPaymentDto.method as payments_method,
      slip_url: createPaymentDto.slipUrl,
      status: createPaymentDto.status as payments_status,
    };

    // Clean up undefined properties
    Object.keys(data).forEach((key) => {
      if (data[key as keyof Prisma.paymentsUncheckedCreateInput] === undefined) {
        delete data[key as keyof Prisma.paymentsUncheckedCreateInput];
      }
    });

    return this.prisma.payments.create({
      data,
      include: { invoices: true },
    });
  }

  findAll(tenantId?: string) {
    const where = tenantId ? { tenant_id: tenantId } : {};
    return this.prisma.payments.findMany({
      where,
      include: { invoices: true },
      orderBy: { created_at: 'desc' },
    });
  }

  findOne(id: string, tenantId?: string) {
    const where = tenantId ? { id, tenant_id: tenantId } : { id };
    return this.prisma.payments.findFirst({
      where,
      include: { invoices: true },
    });
  }

  findByInvoiceId(invoiceId: string, tenantId?: string) {
    const where: Prisma.paymentsWhereInput = { invoice_id: invoiceId };
    if (tenantId) {
      where.tenant_id = tenantId;
    }
    return this.prisma.payments.findMany({
      where,
      orderBy: { created_at: 'desc' },
    });
  }

  update(id: string, updatePaymentDto: UpdatePaymentDto) {
    const data: Prisma.paymentsUncheckedUpdateInput = {
      invoice_id: updatePaymentDto.invoiceId,
      method: updatePaymentDto.method as payments_method,
      slip_url: updatePaymentDto.slipUrl,
      status: updatePaymentDto.status as payments_status,
    };

    // Clean up undefined properties
    Object.keys(data).forEach((key) => {
      if (data[key as keyof Prisma.paymentsUncheckedUpdateInput] === undefined) {
        delete data[key as keyof Prisma.paymentsUncheckedUpdateInput];
      }
    });

    return this.prisma.payments.update({
      where: { id },
      data,
      include: { invoices: true },
    });
  }

  async approvePayment(id: string, adminId: string, tenantId?: string) {
    const payment = await this.findOne(id, tenantId);
    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    const approvedPayment = await this.prisma.payments.update({
      where: { id },
      data: {
        status: PaymentStatus.APPROVED,
        approved_by: adminId,
        approved_at: new Date(),
      },
      include: { invoices: true },
    });

    // Update invoice status to paid
    if (payment.invoice_id) {
      await this.updateInvoiceStatusToPaid(payment.invoice_id).catch((err) => {
        this.logger.error(`Failed to update invoice status: ${err.message}`);
      });
    }

    // Update related booking status to confirmed
    if (payment.invoice_id) {
      await this.updateBookingStatusToConfirmed(payment.invoice_id).catch((err) => {
        this.logger.error(`Failed to update booking status: ${err.message}`);
      });
    }

    // Log payment approval (async, non-blocking)
    this.auditLogService
      .logPaymentApprove(approvedPayment, adminId)
      .catch((err) => {
        this.logger.error(`Failed to log payment approval: ${err.message}`);
      });

    // Send payment receipt email (async, non-blocking)
    this.sendPaymentReceiptEmail(approvedPayment).catch((err) => {
      this.logger.error(`Failed to send payment receipt email: ${err.message}`);
    });

    return approvedPayment;
  }

  async rejectPayment(id: string, adminId: string, tenantId?: string) {
    const payment = await this.findOne(id, tenantId);
    if (!payment) {
      throw new Error('Payment not found');
    }

    return this.prisma.payments.update({
      where: { id },
      data: {
        status: PaymentStatus.REJECTED,
        approved_by: adminId,
        approved_at: new Date(),
      },
      include: { invoices: true },
    });
  }

  remove(id: string) {
    return this.prisma.payments.delete({
      where: { id },
    });
  }

  /**
   * Update invoice status to paid after payment approval
   */
  private async updateInvoiceStatusToPaid(invoiceId: string): Promise<void> {
    try {
      await this.prisma.invoices.update({
        where: { id: invoiceId },
        data: { status: 'paid' },
      });
      this.logger.log(`Invoice ${invoiceId} status updated to paid`);
    } catch (error) {
      this.logger.error(`Failed to update invoice ${invoiceId} status: ${error.message}`);
      throw error;
    }
  }

  /**
   * Find booking linked to invoice and update its status to confirmed
   * First tries to find booking via invoice.booking_id (direct foreign key)
   * Falls back to searching recent pending bookings if not found
   */
  private async updateBookingStatusToConfirmed(invoiceId: string): Promise<void> {
    try {
      // Get invoice to find booking_id and tenant_id
      const invoice = await this.prisma.invoices.findUnique({
        where: { id: invoiceId },
      });

      if (!invoice) {
        this.logger.warn(`Invoice ${invoiceId} not found for booking status update`);
        return;
      }

      // Try to find booking via direct booking_id relationship first (preferred method)
      let booking = null;

      if (invoice.booking_id) {
        booking = await this.prisma.booking.findUnique({
          where: { id: invoice.booking_id },
        });

        if (booking) {
          this.logger.log(`Found booking ${booking.id} via invoice.booking_id`);
        }
      }

      // Fallback: search by tenant and recent pending booking if direct lookup failed
      if (!booking) {
        this.logger.debug(`No booking_id found on invoice ${invoiceId}, searching by tenant and status`);
        booking = await this.prisma.booking.findFirst({
          where: {
            tenantId: invoice.tenant_id,
            status: 'pending',
            createdAt: {
              gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Within last 7 days
            },
          },
          orderBy: { createdAt: 'desc' },
        });

        if (!booking) {
          this.logger.warn(`No pending booking found for invoice ${invoiceId}`);
          return;
        }
      }

      await this.prisma.booking.update({
        where: { id: booking.id },
        data: { status: 'confirmed' },
      });

      this.logger.log(`Booking ${booking.id} status updated to confirmed from payment approval`);
    } catch (error) {
      this.logger.error(`Failed to update booking status: ${error.message}`);
      throw error;
    }
  }

  /**
   * Send payment receipt email to tenant
   */
  private async sendPaymentReceiptEmail(payment: Prisma.paymentsGetPayload<{ include: { invoices: true } }>): Promise<void> {
    try {
      if (!payment.tenant_id) {
        this.logger.warn(`Cannot send receipt email for payment ${payment.id}: tenant_id missing`);
        return;
      }

      // Get tenant email
      const tenant = await this.prisma.tenants.findUnique({
        where: { id: payment.tenant_id },
      });

      if (!tenant || !tenant.email) {
        this.logger.warn(`Tenant ${payment.tenant_id} not found or has no email`);
        return;
      }

      // Get invoice details
      const invoice = await this.prisma.invoices.findUnique({
        where: { id: payment.invoice_id },
      });

      if (!invoice) {
        this.logger.warn(`Invoice ${payment.invoice_id} not found for payment receipt`);
        return;
      }

      await this.emailEventsService.onPaymentReceived({
        to: tenant.email,
        invoiceNo: invoice.invoice_no,
        amount: Number(payment.amount || invoice.amount),
        paymentMethod: payment.method,
        paymentDate: payment.approved_at || new Date(),
        tenantId: payment.tenant_id,
      });

      this.logger.log(`Payment receipt email sent to ${tenant.email}`);
    } catch (error) {
      this.logger.error(`Failed to send payment receipt email: ${error.message}`);
      throw error;
    }
  }
}
