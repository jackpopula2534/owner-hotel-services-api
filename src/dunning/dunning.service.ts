import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { EmailTemplate } from '../email/dto/send-email.dto';
import { TenantLifecycleService } from '../tenants/tenant-lifecycle.service';
import { TenantStatus } from '../tenants/entities/tenant.entity';

/**
 * Dunning policy. Each rule fires when an invoice has been overdue for the
 * specified number of days and no attempt at the same level has been made.
 */
const DUNNING_POLICY = [
  {
    level: 'reminder' as const,
    afterDays: 1,
    template: EmailTemplate.DUNNING_REMINDER,
    transitionTo: null as TenantStatus | null,
  },
  {
    level: 'first_warning' as const,
    afterDays: 3,
    template: EmailTemplate.DUNNING_FIRST_WARNING,
    transitionTo: TenantStatus.PAST_DUE,
  },
  {
    level: 'second_warning' as const,
    afterDays: 7,
    template: EmailTemplate.DUNNING_SECOND_WARNING,
    transitionTo: TenantStatus.PAST_DUE,
  },
  {
    level: 'final_notice' as const,
    afterDays: 14,
    template: EmailTemplate.DUNNING_FINAL_NOTICE,
    transitionTo: TenantStatus.SUSPENDED,
  },
];

type DunningLevel = (typeof DUNNING_POLICY)[number]['level'];

@Injectable()
export class DunningService {
  private readonly logger = new Logger(DunningService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly lifecycleService: TenantLifecycleService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Daily cron — runs once at 09:30 to escalate all overdue invoices.
   */
  @Cron('30 9 * * *', { name: 'dunning-daily' })
  async runDailyDunning(): Promise<{ processed: number; sent: number }> {
    let sent = 0;
    let processed = 0;

    try {
      // Walk policy in reverse so the highest level fires first; this way an
      // invoice that's been overdue for 30 days lands in `final_notice`, not
      // a chain of all four reminders.
      for (const rule of [...DUNNING_POLICY].reverse()) {
        const overdueInvoices = await this.findOverdueInvoices(rule.afterDays);
        for (const invoice of overdueInvoices) {
          processed += 1;

          const alreadySent = await (this.prisma as any).dunning_attempts.findFirst({
            where: {
              invoice_id: invoice.id,
              level: rule.level as any,
              status: { in: ['sent', 'queued'] as any },
            },
            select: { id: true },
          });
          if (alreadySent) continue;

          try {
            await this.dispatchDunning(invoice, rule);
            sent += 1;
          } catch (err) {
            this.logger.error(
              `Failed to dispatch ${rule.level} for invoice ${invoice.invoice_no}`,
              err instanceof Error ? err.stack : String(err),
            );
          }
        }
      }
    } catch (err) {
      this.logger.error('Dunning cron failed', err instanceof Error ? err.stack : String(err));
    }

    if (sent > 0) {
      this.logger.log(`Dunning cron complete: ${sent}/${processed} dispatched`);
    }
    return { processed, sent };
  }

  /**
   * Manually trigger an attempt for a specific invoice + level.
   * Used by admin UI's "Send manual reminder" button.
   */
  async sendManual(
    invoiceId: string,
    level: DunningLevel,
    actorId?: string,
  ): Promise<{ id: string }> {
    const invoice = await this.prisma.invoices.findUnique({
      where: { id: invoiceId },
      include: { tenants: true },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.status === 'paid') {
      throw new BadRequestException('Invoice is already paid');
    }

    const rule = DUNNING_POLICY.find((r) => r.level === level);
    if (!rule) throw new BadRequestException('Unknown dunning level');

    const attempt = await this.dispatchDunning(invoice as any, rule, actorId);
    return { id: attempt.id };
  }

  /**
   * List dunning attempts for the admin queue.
   */
  async listAttempts(filters: {
    tenantId?: string;
    level?: DunningLevel;
    status?: 'queued' | 'sent' | 'failed' | 'acknowledged';
    limit?: number;
  }): Promise<unknown[]> {
    return (this.prisma as any).dunning_attempts.findMany({
      where: {
        ...(filters.tenantId && { tenant_id: filters.tenantId }),
        ...(filters.level && { level: filters.level as any }),
        ...(filters.status && { status: filters.status as any }),
      },
      orderBy: { created_at: 'desc' },
      take: filters.limit || 100,
    });
  }

  /** Mark an attempt as acknowledged (admin clicked "Customer responded"). */
  async acknowledge(attemptId: string): Promise<void> {
    await (this.prisma as any).dunning_attempts.update({
      where: { id: attemptId },
      data: { status: 'acknowledged' as any },
    });
  }

  // ─────────── private ───────────

  private async findOverdueInvoices(afterDays: number) {
    const threshold = new Date();
    threshold.setHours(0, 0, 0, 0);
    threshold.setDate(threshold.getDate() - afterDays);

    return this.prisma.invoices.findMany({
      where: {
        status: { in: ['pending', 'partially_paid'] as any },
        due_date: { lt: threshold },
      },
      include: { tenants: true },
    });
  }

  private async dispatchDunning(
    invoice: any,
    rule: (typeof DUNNING_POLICY)[number],
    actorId?: string,
  ) {
    const tenant = invoice.tenants;
    if (!tenant?.email) {
      throw new BadRequestException(`Tenant ${invoice.tenant_id} has no email`);
    }

    const daysOverdue = Math.floor((Date.now() - new Date(invoice.due_date).getTime()) / 86400_000);

    const attempt = await (this.prisma as any).dunning_attempts.create({
      data: {
        invoice_id: invoice.id,
        tenant_id: invoice.tenant_id,
        level: rule.level as any,
        channel: 'email' as any,
        status: 'queued' as any,
        recipient: tenant.email,
        subject: this.buildSubject(rule.level, invoice.invoice_no),
        created_by: actorId,
        metadata: { daysOverdue, amount: Number(invoice.amount) },
      },
    });

    try {
      await this.emailService.sendEmail({
        to: tenant.email,
        subject: this.buildSubject(rule.level, invoice.invoice_no),
        template: rule.template,
        tenantId: invoice.tenant_id,
        context: {
          customerName: tenant.customer_name || tenant.name,
          hotelName: tenant.name,
          invoiceNo: invoice.invoice_no,
          amount: Number(invoice.amount).toLocaleString(),
          dueDate: this.formatDate(invoice.due_date),
          daysOverdue,
          gracePeriodEnd: this.formatDate(this.addDays(new Date(), 3)),
          suspensionDate: this.formatDate(this.addDays(new Date(), 7)),
          payInvoiceUrl: this.buildPayUrl(invoice.id),
        },
        language: 'th',
      });

      await (this.prisma as any).dunning_attempts.update({
        where: { id: attempt.id },
        data: { status: 'sent' as any, sent_at: new Date() },
      });

      // Side-effect: lifecycle transition (best-effort, don't fail dispatch)
      if (rule.transitionTo) {
        try {
          await this.lifecycleService.transition({
            tenantId: invoice.tenant_id,
            toStatus: rule.transitionTo,
            reason: `dunning ${rule.level} sent for invoice ${invoice.invoice_no}`,
            actorId: 'system:dunning',
          });
        } catch (err) {
          // Transition might be invalid (e.g. tenant already cancelled).
          // We log but keep the attempt as sent.
          this.logger.warn(
            `Lifecycle transition skipped for tenant ${invoice.tenant_id}: ${
              err instanceof Error ? err.message : err
            }`,
          );
        }
      }

      return attempt;
    } catch (err) {
      await (this.prisma as any).dunning_attempts.update({
        where: { id: attempt.id },
        data: {
          status: 'failed' as any,
          error_message: err instanceof Error ? err.message : String(err),
        },
      });
      throw err;
    }
  }

  private buildSubject(level: DunningLevel, invoiceNo: string): string {
    switch (level) {
      case 'reminder':
        return `แจ้งเตือนการชำระเงิน — ${invoiceNo}`;
      case 'first_warning':
        return `⚠️ ใบแจ้งหนี้เกินกำหนด — ${invoiceNo}`;
      case 'second_warning':
        return `🚨 แจ้งเตือนครั้งสุดท้าย — ${invoiceNo}`;
      case 'final_notice':
        return `บัญชีถูกระงับ — ${invoiceNo}`;
    }
  }

  private buildPayUrl(invoiceId: string): string {
    const baseUrl =
      this.config.get<string>('APP_URL') ||
      this.config.get<string>('FRONTEND_URL') ||
      'https://app.staysync.com';
    return `${baseUrl}/dashboard/billing/invoices/${invoiceId}`;
  }

  private addDays(d: Date, n: number): Date {
    const r = new Date(d);
    r.setDate(r.getDate() + n);
    return r;
  }

  private formatDate(date: Date | null): string {
    if (!date) return '-';
    return new Date(date).toLocaleDateString('th-TH', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    });
  }
}
