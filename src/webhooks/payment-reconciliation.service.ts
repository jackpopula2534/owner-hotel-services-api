import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Daily reconciliation between our `payments` table and the
 * `payment_webhook_events` log for each provider. Anything in the DB
 * without a matching webhook (or vice versa) is flagged as a mismatch
 * for the admin to investigate.
 */
@Injectable()
export class PaymentReconciliationService {
  private readonly logger = new Logger(PaymentReconciliationService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Runs daily at 02:00 to reconcile yesterday's traffic. */
  @Cron('0 2 * * *', { name: 'payment-reconciliation' })
  async runDailyReconciliation(): Promise<void> {
    const periodStart = this.startOfDay(this.daysAgo(1));
    const periodEnd = this.startOfDay(new Date());

    for (const provider of this.knownProviders()) {
      try {
        await this.reconcile(provider, periodStart, periodEnd);
      } catch (err) {
        this.logger.error(
          `Reconciliation failed for ${provider}`,
          err instanceof Error ? err.stack : String(err),
        );
      }
    }
  }

  /**
   * Run reconciliation for a single provider over [periodStart, periodEnd).
   * Returns the persisted run row.
   */
  async reconcile(provider: string, periodStart: Date, periodEnd: Date) {
    // payments completed via this provider during the window
    const dbPayments = await (this.prisma as any).payments.findMany({
      where: {
        provider,
        status: 'completed',
        created_at: { gte: periodStart, lt: periodEnd },
      },
      select: { id: true, amount: true, gateway_transaction_id: true },
    });

    const events = await (this.prisma as any).payment_webhook_events.findMany({
      where: {
        provider,
        status: 'processed',
        received_at: { gte: periodStart, lt: periodEnd },
      },
      select: { id: true, payment_id: true, payload: true },
    });

    const dbTotalCount = dbPayments.length;
    const dbTotalAmount = dbPayments.reduce(
      (sum: number, p: any) => sum + Number(p.amount || 0),
      0,
    );
    const gatewayTotalCount = events.length;
    const gatewayTotalAmount = events.reduce((sum: number, e: any) => {
      const amt = Number(e.payload?.amount ?? 0);
      return sum + amt;
    }, 0);

    const dbPaymentIds = new Set(dbPayments.map((p: any) => p.id));
    const eventPaymentIds = new Set(
      events.filter((e: any) => e.payment_id).map((e: any) => e.payment_id),
    );

    const mismatches: Array<{ type: string; id: string; detail?: string }> = [];

    for (const p of dbPayments) {
      if (!eventPaymentIds.has(p.id)) {
        mismatches.push({
          type: 'db_without_webhook',
          id: p.id,
          detail: `payment recorded but no matching webhook event`,
        });
      }
    }
    for (const e of events) {
      if (e.payment_id && !dbPaymentIds.has(e.payment_id)) {
        mismatches.push({
          type: 'webhook_without_payment',
          id: e.id,
          detail: `webhook references payment_id=${e.payment_id} which no longer exists`,
        });
      }
    }

    const status =
      mismatches.length === 0
        ? 'clean'
        : 'mismatch';

    const run = await (this.prisma as any).payment_reconciliation_runs.create({
      data: {
        provider,
        period_start: periodStart,
        period_end: periodEnd,
        db_total_count: dbTotalCount,
        db_total_amount: dbTotalAmount,
        gateway_total_count: gatewayTotalCount,
        gateway_total_amount: gatewayTotalAmount,
        mismatch_count: mismatches.length,
        mismatches: mismatches as any,
        status,
      },
    });

    this.logger.log(
      `Reconciliation ${provider} ${periodStart.toISOString()} → ${periodEnd.toISOString()}: ` +
        `db=${dbTotalCount}/${dbTotalAmount}, gw=${gatewayTotalCount}/${gatewayTotalAmount}, ` +
        `mismatches=${mismatches.length}`,
    );

    return run;
  }

  private knownProviders(): string[] {
    // Static list — add a new provider here when integrating one.
    return ['promptpay', 'scb', '2c2p', 'stripe'];
  }

  private startOfDay(d: Date): Date {
    const r = new Date(d);
    r.setHours(0, 0, 0, 0);
    return r;
  }

  private daysAgo(n: number): Date {
    const r = new Date();
    r.setDate(r.getDate() - n);
    return r;
  }
}
