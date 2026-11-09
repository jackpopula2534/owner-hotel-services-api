import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { EmailTemplate } from '../email/dto/send-email.dto';

/**
 * Trial Reminder Cron Job
 *
 * Sends reminder emails to tenants whose trial subscriptions are about to
 * expire. Runs daily at 09:00 (local) to catch D-7, D-3, and D-1 buckets.
 *
 * Reminders are tracked in `billing_history` (eventType =
 * 'trial_reminder_sent', metadata.daysLeft) so we never send the same
 * day-bucket reminder twice for the same subscription.
 */
@Injectable()
export class TrialReminderService {
  private readonly logger = new Logger(TrialReminderService.name);

  /** Day buckets at which we send reminders before trial end. */
  private readonly REMINDER_DAYS = [7, 3, 1] as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly config: ConfigService,
  ) {}

  @Cron('0 9 * * *', { name: 'trial-reminder' })
  async handleTrialReminders(): Promise<void> {
    try {
      for (const daysLeft of this.REMINDER_DAYS) {
        await this.sendBucket(daysLeft);
      }
    } catch (error) {
      this.logger.error(
        'Failed to dispatch trial reminders',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * Find every trial subscription ending in exactly `daysLeft` days and
   * send the matching reminder. Idempotent per (subscription, daysLeft).
   */
  async sendBucket(daysLeft: number): Promise<number> {
    const target = this.dayWindow(daysLeft);

    const candidates = await this.prisma.subscriptions.findMany({
      where: {
        status: 'trial',
        end_date: { gte: target.start, lt: target.end },
      },
      select: {
        id: true,
        subscription_code: true,
        tenant_id: true,
        end_date: true,
        tenants: {
          select: {
            id: true,
            name: true,
            email: true,
            customer_name: true,
          },
        },
      },
    });

    if (candidates.length === 0) {
      this.logger.debug(`No trials in D-${daysLeft} bucket.`);
      return 0;
    }

    let sent = 0;
    for (const sub of candidates) {
      if (!sub.tenants?.email) continue;

      // Skip if a reminder for this exact bucket was already sent.
      const already = await this.prisma.billing_history.findFirst({
        where: {
          subscription_id: sub.id,
          // Cast: prisma client may need regeneration after migration
          // 20260501130000_add_trial_reminder_event_type adds this enum value.
          eventType: 'trial_reminder_sent' as any,
          metadata: { path: '$.daysLeft', equals: daysLeft },
        },
        select: { id: true },
      });
      if (already) continue;

      try {
        await this.emailService.sendEmail({
          to: sub.tenants.email,
          subject: this.buildSubject(daysLeft),
          template: EmailTemplate.TRIAL_REMINDER,
          tenantId: sub.tenant_id,
          context: {
            hotelName: sub.tenants.name,
            customerName: sub.tenants.customer_name || sub.tenants.name,
            daysLeft,
            trialEndDate: this.formatDate(sub.end_date),
            upgradeUrl: this.buildUpgradeUrl(sub.tenant_id),
            recipient: sub.tenants.email,
          },
          language: 'th',
        });

        await this.prisma.billing_history.create({
          data: {
            subscription_id: sub.id,
            // Cast: prisma client may need regeneration after migration
            // 20260501130000_add_trial_reminder_event_type adds this enum value.
            eventType: 'trial_reminder_sent' as any,
            description: `Trial reminder sent (D-${daysLeft})`,
            metadata: {
              daysLeft,
              channel: 'email',
              recipient: sub.tenants.email,
            },
          },
        });

        sent += 1;
      } catch (err) {
        this.logger.error(
          `Failed to send D-${daysLeft} reminder for subscription ${sub.subscription_code}`,
          err instanceof Error ? err.stack : String(err),
        );
      }
    }

    if (sent > 0) {
      this.logger.log(`Trial reminders sent (D-${daysLeft}): ${sent}`);
    }

    return sent;
  }

  /**
   * Returns [start, end) representing the calendar day exactly `daysLeft`
   * days from today. Using a half-open window avoids missing rows when
   * `end_date` is stored at midnight.
   */
  private dayWindow(daysLeft: number): { start: Date; end: Date } {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() + daysLeft);

    const end = new Date(start);
    end.setDate(end.getDate() + 1);

    return { start, end };
  }

  private buildSubject(daysLeft: number): string {
    if (daysLeft === 1) return 'แพ็กเกจทดลองของคุณจะหมดในพรุ่งนี้';
    return `เหลือเวลาทดลองอีก ${daysLeft} วัน — StaySync`;
  }

  private buildUpgradeUrl(tenantId: string): string {
    const baseUrl =
      this.config.get<string>('APP_URL') ||
      this.config.get<string>('FRONTEND_URL') ||
      'https://app.staysync.com';
    return `${baseUrl}/dashboard/billing?tenant=${tenantId}&utm_source=trial_reminder`;
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
