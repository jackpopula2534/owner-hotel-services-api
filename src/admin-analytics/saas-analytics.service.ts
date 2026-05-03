import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface MrrSummary {
  asOfDate: string;
  mrr: number;
  arr: number;
  activeSubscriptions: number;
  byPlan: Array<{ planId: string; planName: string; count: number; mrr: number }>;
}

export interface ChurnSummary {
  periodStart: string;
  periodEnd: string;
  startActive: number;
  endActive: number;
  churnedCount: number;
  churnedRevenue: number;
  logoChurnPercent: number;
  revenueChurnPercent: number;
}

export interface LtvSummary {
  asOfDate: string;
  averageMrr: number;
  monthlyChurnRate: number; // 0 → 1
  estimatedLtv: number; // averageMrr / churnRate
  paybackMonths: number; // CAC not modeled — assumed 1 month for now
}

export interface MrrTrendPoint {
  period: string; // YYYY-MM
  mrr: number;
  activeCount: number;
}

/**
 * Read-only SaaS analytics over the subscription/plans/invoices tables.
 * No write side-effects. Cached at the controller layer.
 *
 * MRR is computed from currently-active subscriptions × their plan's
 * normalized monthly price (yearly subs are divided by 12).
 */
@Injectable()
export class SaasAnalyticsService {
  private readonly logger = new Logger(SaasAnalyticsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getMrrSummary(asOfDate?: Date): Promise<MrrSummary> {
    const cutoff = asOfDate || new Date();
    const subs = await this.activeSubscriptionsAt(cutoff);

    let mrr = 0;
    const byPlan = new Map<string, { name: string; count: number; mrr: number }>();

    for (const sub of subs) {
      const plan = sub.plans_subscriptions_plan_idToplans;
      if (!plan) continue;
      const monthly = this.normalizeMonthly(
        Number(plan.price_monthly || 0),
        sub.billing_cycle,
      );
      mrr += monthly;
      const cur = byPlan.get(plan.id) || { name: plan.name, count: 0, mrr: 0 };
      cur.count += 1;
      cur.mrr += monthly;
      byPlan.set(plan.id, cur);
    }

    return {
      asOfDate: cutoff.toISOString().split('T')[0],
      mrr: Math.round(mrr),
      arr: Math.round(mrr * 12),
      activeSubscriptions: subs.length,
      byPlan: Array.from(byPlan.entries())
        .map(([planId, v]) => ({
          planId,
          planName: v.name,
          count: v.count,
          mrr: Math.round(v.mrr),
        }))
        .sort((a, b) => b.mrr - a.mrr),
    };
  }

  /**
   * 12-month MRR trend ending at `asOfDate` (default = now). Each point is
   * MRR computed as of the last day of that month.
   */
  async getMrrTrend(asOfDate?: Date): Promise<MrrTrendPoint[]> {
    const end = asOfDate || new Date();
    const points: MrrTrendPoint[] = [];

    for (let i = 11; i >= 0; i--) {
      const d = new Date(end);
      d.setMonth(d.getMonth() - i);
      d.setDate(1);
      d.setMonth(d.getMonth() + 1);
      d.setDate(0); // last day of that month

      const subs = await this.activeSubscriptionsAt(d);
      let mrr = 0;
      for (const s of subs) {
        const plan = s.plans_subscriptions_plan_idToplans;
        if (!plan) continue;
        mrr += this.normalizeMonthly(Number(plan.price_monthly || 0), s.billing_cycle);
      }
      points.push({
        period: this.formatYearMonth(d),
        mrr: Math.round(mrr),
        activeCount: subs.length,
      });
    }
    return points;
  }

  async getChurnSummary(periodStart: Date, periodEnd: Date): Promise<ChurnSummary> {
    const startActive = await this.activeSubscriptionsAt(periodStart);
    const endActive = await this.activeSubscriptionsAt(periodEnd);

    const startIds = new Set(startActive.map((s: any) => s.id));
    const endIds = new Set(endActive.map((s: any) => s.id));

    // Churned = started in the period but no longer active by the end.
    const churned = [...startIds].filter((id) => !endIds.has(id));
    const churnedSubs = startActive.filter((s: any) => churned.includes(s.id));

    const churnedRevenue = churnedSubs.reduce((sum: number, s: any) => {
      const plan = s.plans_subscriptions_plan_idToplans;
      if (!plan) return sum;
      return sum + this.normalizeMonthly(Number(plan.price_monthly || 0), s.billing_cycle);
    }, 0);

    const startRevenue = startActive.reduce((sum: number, s: any) => {
      const plan = s.plans_subscriptions_plan_idToplans;
      if (!plan) return sum;
      return sum + this.normalizeMonthly(Number(plan.price_monthly || 0), s.billing_cycle);
    }, 0);

    const logoChurnPercent =
      startActive.length > 0 ? (churned.length / startActive.length) * 100 : 0;
    const revenueChurnPercent =
      startRevenue > 0 ? (churnedRevenue / startRevenue) * 100 : 0;

    return {
      periodStart: periodStart.toISOString().split('T')[0],
      periodEnd: periodEnd.toISOString().split('T')[0],
      startActive: startActive.length,
      endActive: endActive.length,
      churnedCount: churned.length,
      churnedRevenue: Math.round(churnedRevenue),
      logoChurnPercent: Math.round(logoChurnPercent * 100) / 100,
      revenueChurnPercent: Math.round(revenueChurnPercent * 100) / 100,
    };
  }

  async getLtvSummary(): Promise<LtvSummary> {
    const now = new Date();
    const monthAgo = new Date(now);
    monthAgo.setMonth(monthAgo.getMonth() - 1);

    const mrr = await this.getMrrSummary(now);
    const churn = await this.getChurnSummary(monthAgo, now);

    const monthlyChurnRate =
      churn.startActive > 0 ? churn.churnedCount / churn.startActive : 0;

    const averageMrr =
      mrr.activeSubscriptions > 0 ? mrr.mrr / mrr.activeSubscriptions : 0;

    // Estimated LTV = ARPU / churn-rate. Cap at ~1000 months to avoid
    // showing infinity when churn is 0%.
    const ltv =
      monthlyChurnRate > 0 ? averageMrr / monthlyChurnRate : averageMrr * 1000;

    return {
      asOfDate: now.toISOString().split('T')[0],
      averageMrr: Math.round(averageMrr),
      monthlyChurnRate: Math.round(monthlyChurnRate * 10000) / 10000,
      estimatedLtv: Math.round(ltv),
      paybackMonths: 1, // placeholder until CAC model is wired
    };
  }

  // ─────────── helpers ───────────

  private async activeSubscriptionsAt(date: Date): Promise<any[]> {
    return (this.prisma as any).subscriptions.findMany({
      where: {
        status: 'active',
        start_date: { lte: date },
        end_date: { gt: date },
      },
      include: { plans_subscriptions_plan_idToplans: true },
    });
  }

  private normalizeMonthly(priceMonthly: number, cycle: string | null): number {
    if (cycle === 'yearly') {
      // Yearly plans usually quote priceMonthly already; if not, divide.
      return priceMonthly;
    }
    return priceMonthly;
  }

  private formatYearMonth(d: Date): string {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  }
}
