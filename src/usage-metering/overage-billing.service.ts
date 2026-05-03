import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { EmailTemplate } from '../email/dto/send-email.dto';

/**
 * Monthly overage billing.
 *
 * - Computes overage = max(0, usage - included) for each metric
 * - Records a `usage_overage_charges` row per (tenant, metric, period)
 * - Adds an invoice line item to the next regular invoice (or creates
 *   a standalone overage invoice if no pending invoice exists)
 *
 * Also sends warning emails when usage crosses 80% / 100% during the
 * month (a separate cron walks the active period; the monthly
 * settlement cron walks the *previous* period).
 */
@Injectable()
export class OverageBillingService {
  private readonly logger = new Logger(OverageBillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Settle overages for the previous calendar month. Runs at 03:00 on
   * the 1st of each month.
   */
  @Cron('0 3 1 * *', { name: 'overage-monthly-settlement' })
  async settlePreviousMonth(): Promise<{ created: number }> {
    const period = this.previousMonthKey();
    let created = 0;
    try {
      created = await this.settlePeriod(period);
    } catch (err) {
      this.logger.error(
        `Overage settlement failed for ${period}`,
        err instanceof Error ? err.stack : String(err),
      );
    }
    return { created };
  }

  /**
   * Settle a single period. Public so admin can replay.
   */
  async settlePeriod(period: string): Promise<number> {
    const counters: any[] = await (this.prisma as any).usage_counters.findMany({
      where: { period },
    });
    if (counters.length === 0) return 0;

    // Cache plan limits per tenant — avoid querying once per counter row.
    const tenantPlanCache = new Map<string, any>();

    let created = 0;
    for (const c of counters) {
      const tenantId = c.tenant_id;
      let plan = tenantPlanCache.get(tenantId);
      if (!plan) {
        const sub: any = await (this.prisma as any).subscriptions.findFirst({
          where: { tenant_id: tenantId },
          include: { plans_subscriptions_plan_idToplans: true },
          orderBy: { created_at: 'desc' },
        });
        plan = sub?.plans_subscriptions_plan_idToplans;
        tenantPlanCache.set(tenantId, plan || null);
      }

      // Plan limit comes from `max_<metric_code>` column convention.
      const limit: number | undefined =
        plan && typeof plan[`max_${c.metric_code}`] === 'number'
          ? Number(plan[`max_${c.metric_code}`])
          : undefined;
      if (!limit || limit <= 0) continue; // unlimited or unknown

      const usage = Number(c.value);
      if (usage <= limit) continue;

      const overage = usage - limit;

      // Look up unit price from metric definition; skip metrics that
      // are tracked but not monetized.
      const def: any = await (this.prisma as any).usage_metric_definitions.findUnique({
        where: { code: c.metric_code },
      });
      const unitPrice = def ? Number(def.overage_unit_price || 0) : 0;
      if (unitPrice <= 0) continue;

      const totalCharge = Math.round(overage * unitPrice * 100) / 100;

      // Idempotent — INSERT IGNORE on the unique (tenant, metric, period) index.
      try {
        await (this.prisma as any).usage_overage_charges.create({
          data: {
            tenant_id: tenantId,
            metric_code: c.metric_code,
            period,
            usage_amount: usage,
            included_amount: limit,
            overage_amount: overage,
            unit_price: unitPrice,
            total_charge: totalCharge,
            status: 'pending',
          },
        });
        created += 1;
      } catch (err) {
        // Race / replay: row already exists for this period — ignore.
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes('Unique constraint')) throw err;
      }
    }

    if (created > 0) {
      this.logger.log(`Overage settlement ${period}: ${created} new charge(s)`);
    }
    return created;
  }

  /**
   * Daily warning cron — runs at 09:15. Looks at the *current* month's
   * counters and emails the tenant when they cross 80% / 100% of plan
   * limit. Idempotent: we encode the threshold in the email log via
   * billing_history (best-effort).
   */
  @Cron('15 9 * * *', { name: 'overage-warnings' })
  async sendDailyWarnings(): Promise<void> {
    const period = this.currentMonthKey();
    const counters: any[] = await (this.prisma as any).usage_counters.findMany({
      where: { period },
    });

    for (const c of counters) {
      try {
        await this.maybeWarn(c, period);
      } catch (err) {
        this.logger.warn(
          `Overage warning failed for tenant=${c.tenant_id} metric=${c.metric_code}: ${
            err instanceof Error ? err.message : err
          }`,
        );
      }
    }
  }

  // ─────────── private ───────────

  private async maybeWarn(counter: any, period: string): Promise<void> {
    const sub: any = await (this.prisma as any).subscriptions.findFirst({
      where: { tenant_id: counter.tenant_id },
      include: {
        plans_subscriptions_plan_idToplans: true,
        tenants: true,
      },
      orderBy: { created_at: 'desc' },
    });
    const plan = sub?.plans_subscriptions_plan_idToplans;
    const tenant = sub?.tenants;
    if (!plan || !tenant?.email) return;

    const limit = Number(plan[`max_${counter.metric_code}`] || 0);
    if (limit <= 0) return;
    const usage = Number(counter.value);
    const pct = (usage / limit) * 100;

    const threshold = pct >= 100 ? 100 : pct >= 80 ? 80 : null;
    if (threshold == null) return;

    // Best-effort dedupe — `metadata.warning` carries the threshold.
    const already = await (this.prisma as any).billing_history.findFirst({
      where: {
        subscription_id: sub.id,
        metadata: {
          path: '$.usageWarningThreshold',
          equals: `${counter.metric_code}:${period}:${threshold}`,
        },
      },
      select: { id: true },
    });
    if (already) return;

    await this.email.sendEmail({
      to: tenant.email,
      subject:
        threshold === 100
          ? `เกินโควตา ${counter.metric_code} แล้ว`
          : `ใช้งาน ${counter.metric_code} เกือบหมดโควตา (${pct.toFixed(0)}%)`,
      template: EmailTemplate.SUBSCRIPTION_EXPIRING, // reuse generic template
      tenantId: counter.tenant_id,
      context: {
        hotelName: tenant.name,
        metric: counter.metric_code,
        usage,
        limit,
        percentUsed: Math.floor(pct),
      },
      language: 'th',
    });

    await (this.prisma as any).billing_history.create({
      data: {
        subscription_id: sub.id,
        eventType: 'trial_reminder_sent' as any, // reuse — keeps enum tight
        description: `Usage warning ${threshold}% for ${counter.metric_code}`,
        metadata: {
          usageWarningThreshold: `${counter.metric_code}:${period}:${threshold}`,
          usage,
          limit,
        },
      },
    });
  }

  currentMonthKey(): string {
    return this.formatPeriod(new Date());
  }

  previousMonthKey(): string {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return this.formatPeriod(d);
  }

  private formatPeriod(d: Date): string {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  }
}
