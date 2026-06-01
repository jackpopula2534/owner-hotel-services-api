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
      include: {
        invoices: {
          include: {
            tenants: { select: { id: true, name: true } },
            subscriptions: {
              include: {
                plans_subscriptions_plan_idToplans: {
                  select: { id: true, name: true, price_monthly: true, price_yearly: true },
                },
              },
            },
          },
        },
      },
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

    // SALES-04: idempotency. An already-approved payment must NOT be approved
    // again — re-running would extend the subscription a second time and
    // re-mark the invoice paid. Fast-path no-op for the common double-click /
    // duplicate-request case.
    if (payment.status === PaymentStatus.APPROVED) {
      this.logger.warn(`Payment ${id} already approved — returning existing (idempotent no-op)`);
      return payment;
    }

    // Atomically "claim" the payment (pending → approved) and flip the invoice
    // to paid in the SAME transaction — this is the money-critical pair. The
    // conditional updateMany guard also closes the concurrent-approve race:
    // only one caller can transition a non-approved payment.
    const approvedPayment = await this.prisma.$transaction(async (tx) => {
      const claim = await tx.payments.updateMany({
        where: { id, status: { not: PaymentStatus.APPROVED as payments_status } },
        data: {
          status: PaymentStatus.APPROVED as payments_status,
          approved_by: adminId,
          approved_at: new Date(),
        },
      });

      if (claim.count === 0) {
        return null; // lost the race — another request approved it first
      }

      if (payment.invoice_id) {
        await tx.invoices.update({
          where: { id: payment.invoice_id },
          data: { status: 'paid' },
        });

        // H2: activate + extend the subscription INSIDE the same transaction.
        // If activation fails, the whole approval rolls back (payment stays
        // un-approved) so a retry reconciles cleanly — avoiding the stuck state
        // where a payment is approved but its subscription never activates.
        // Atomicity also means the idempotency guard above is safe: an
        // already-approved payment has, by construction, already been activated.
        await this.activateSubscriptionForInvoice(payment.invoice_id, tx);
      }

      return tx.payments.findUniqueOrThrow({ where: { id }, include: { invoices: true } });
    });

    if (!approvedPayment) {
      this.logger.warn(`Payment ${id} approved concurrently — idempotent no-op`);
      return this.findOne(id, tenantId);
    }

    // Update related booking status to confirmed (idempotent; runs post-commit)
    if (payment.invoice_id) {
      await this.updateBookingStatusToConfirmed(payment.invoice_id).catch((err) => {
        this.logger.error(`Failed to update booking status: ${err.message}`);
      });
    }

    // Log payment approval (async, non-blocking)
    this.auditLogService.logPaymentApprove(approvedPayment, adminId).catch((err) => {
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
   * Activate and extend the subscription linked to an approved invoice.
   *
   * - status: trial → active
   * - start_date: วันที่ approve จริง (now)
   * - end_date: start + 1 รอบบิล (monthly = +1 month, yearly = +1 year)
   * - next_billing_date: เท่ากับ end_date (รอบบิลถัดไป)
   *
   * ถ้า subscription ยัง active อยู่แล้ว (ต่ออายุ) จะต่อจาก end_date เดิม
   * เมื่อ end_date เดิมยังไม่หมดอายุ เพื่อไม่ให้ลูกค้าเสียวันที่เหลือ
   */
  private async activateSubscriptionForInvoice(
    invoiceId: string,
    // Optional transaction client so activation can run atomically with the
    // payment approval (H2). Defaults to the base client for standalone calls.
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
    const invoice = await db.invoices.findUnique({
      where: { id: invoiceId },
      select: { subscription_id: true },
    });

    if (!invoice?.subscription_id) {
      this.logger.log(`Invoice ${invoiceId} has no subscription — skipping activation`);
      return;
    }

    const subscription = await db.subscriptions.findUnique({
      where: { id: invoice.subscription_id },
      select: { id: true, billing_cycle: true, end_date: true, status: true },
    });

    if (!subscription) {
      this.logger.warn(`Subscription ${invoice.subscription_id} not found — skipping activation`);
      return;
    }

    const now = new Date();

    // ต่ออายุจาก end_date เดิมถ้ายังไม่หมด (กันลูกค้าเสียวันที่เหลือ), ไม่งั้นเริ่มนับจากวันนี้
    const extendFrom =
      subscription.end_date && subscription.end_date > now ? new Date(subscription.end_date) : now;

    const endDate = new Date(extendFrom);
    if (subscription.billing_cycle === 'yearly') {
      endDate.setFullYear(endDate.getFullYear() + 1);
    } else {
      endDate.setMonth(endDate.getMonth() + 1);
    }

    await db.subscriptions.update({
      where: { id: subscription.id },
      data: {
        status: 'active',
        start_date: now,
        end_date: endDate,
        next_billing_date: endDate,
      },
    });

    this.logger.log(
      `Subscription ${subscription.id} activated (${subscription.billing_cycle}) — ends ${endDate.toISOString().slice(0, 10)}`,
    );
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
        this.logger.debug(
          `No booking_id found on invoice ${invoiceId}, searching by tenant and status`,
        );
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
  private async sendPaymentReceiptEmail(
    payment: Prisma.paymentsGetPayload<{ include: { invoices: true } }>,
  ): Promise<void> {
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
