import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Subscription Auto-Expiry Cron Job
 *
 * Runs daily at midnight to update subscriptions whose end_date has passed
 * from 'active' or 'trial' status to 'expired'.
 *
 * This ensures the database stays in sync and prevents stale 'active' statuses
 * from bypassing frontend/backend subscription checks.
 */
@Injectable()
export class SubscriptionExpiryService {
  private readonly logger = new Logger(SubscriptionExpiryService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Roll forward the next_billing_date for active subscriptions whose stored
   * value already lies in the past (or whose value was missing). Without this
   * job, the admin Billing tab keeps showing a stale "บิลถัดไป" once the
   * scheduled charge moment is crossed.
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async rollForwardNextBillingDates(): Promise<void> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    try {
      const candidates = await this.prisma.subscriptions.findMany({
        where: {
          status: 'active',
          OR: [{ next_billing_date: null }, { next_billing_date: { lt: today } }],
        },
        select: {
          id: true,
          subscription_code: true,
          end_date: true,
          next_billing_date: true,
          billing_cycle: true,
        },
      });

      if (candidates.length === 0) {
        this.logger.log('No subscriptions need next_billing_date roll-forward.');
        return;
      }

      let updated = 0;
      for (const sub of candidates) {
        const baseDate = sub.next_billing_date
          ? new Date(sub.next_billing_date)
          : sub.end_date
            ? new Date(sub.end_date)
            : null;

        if (!baseDate) continue;

        const cycle = sub.billing_cycle || 'monthly';
        const next = new Date(baseDate);
        let safety = 0;
        while (next.getTime() < today.getTime() && safety < 240) {
          if (cycle === 'yearly') {
            next.setFullYear(next.getFullYear() + 1);
          } else {
            next.setMonth(next.getMonth() + 1);
          }
          safety += 1;
        }

        await this.prisma.subscriptions.update({
          where: { id: sub.id },
          data: { next_billing_date: next, updated_at: new Date() },
        });
        updated += 1;
      }

      this.logger.log(`Rolled forward next_billing_date for ${updated} subscription(s).`);
    } catch (error) {
      this.logger.error(
        'Failed to roll forward subscription next_billing_date',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * Run every day at 00:05 — mark expired subscriptions
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleExpiredSubscriptions(): Promise<void> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    try {
      // Find all subscriptions that should be expired
      const expiredSubs = await this.prisma.subscriptions.findMany({
        where: {
          end_date: { lt: today },
          status: { in: ['active', 'trial'] },
        },
        select: {
          id: true,
          subscription_code: true,
          tenant_id: true,
          status: true,
          end_date: true,
          auto_renew: true,
        },
      });

      if (expiredSubs.length === 0) {
        this.logger.log('No expired subscriptions found.');
        return;
      }

      this.logger.warn(`Found ${expiredSubs.length} expired subscription(s) to update.`);

      // Batch update to 'expired'
      const result = await this.prisma.subscriptions.updateMany({
        where: {
          id: { in: expiredSubs.map((s) => s.id) },
        },
        data: {
          status: 'expired',
          updated_at: new Date(),
        },
      });

      this.logger.warn(
        `Auto-expired ${result.count} subscription(s): ${expiredSubs
          .map(
            (s) =>
              `${s.subscription_code || s.id} (tenant: ${s.tenant_id}, was: ${s.status}, ended: ${s.end_date})`,
          )
          .join(', ')}`,
      );
    } catch (error) {
      this.logger.error(
        'Failed to auto-expire subscriptions',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
