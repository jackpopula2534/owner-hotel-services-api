import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type AggregationStrategy = 'sum_per_period' | 'peak_in_period';

export interface RecordUsageInput {
  tenantId: string;
  metricCode: string;
  amount?: number;
  /** Optional ISO datetime — defaults to now. Useful for back-fill. */
  at?: string | Date;
}

export interface UsageSnapshot {
  tenantId: string;
  metricCode: string;
  period: string;
  value: number;
  peakValue: number;
  lastEventAt?: Date | null;
  // Filled when a plan limit can be resolved
  limit?: number | null;
  percentUsed?: number;
}

/**
 * Atomic per-tenant usage counter.
 *
 * Uses MySQL's `INSERT ... ON DUPLICATE KEY UPDATE` so a race between two
 * concurrent records cannot lose a tick. The unique index
 * (tenant_id, metric_code, period) gives us correctness without locking.
 *
 * "period" is stored as `YYYY-MM` so monthly billing aggregations can
 * group with a simple `WHERE period = ?`.
 */
@Injectable()
export class UsageMeteringService {
  private readonly logger = new Logger(UsageMeteringService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Increment a sum-per-period metric. Safe under concurrency.
   */
  async record(input: RecordUsageInput): Promise<void> {
    const amount = input.amount ?? 1;
    if (!Number.isFinite(amount) || amount < 0) {
      throw new BadRequestException('amount must be a non-negative number');
    }

    const period = this.periodKey(input.at);
    const now = input.at ? new Date(input.at) : new Date();

    // Atomic upsert: if a counter row exists for (tenant, metric, period)
    // we ADD `amount` to value AND keep peak_value = MAX(peak_value, value).
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO usage_counters (id, tenant_id, metric_code, period, value, peak_value, last_event_at, created_at, updated_at)
       VALUES (UUID(), ?, ?, ?, ?, ?, ?, NOW(6), NOW(6))
       ON DUPLICATE KEY UPDATE
         value = value + VALUES(value),
         peak_value = GREATEST(peak_value, value + VALUES(value)),
         last_event_at = VALUES(last_event_at),
         updated_at = NOW(6)`,
      input.tenantId,
      input.metricCode,
      period,
      amount,
      amount,
      now,
    );
  }

  /**
   * Set a peak-in-period metric (e.g. simultaneous active rooms). Stores
   * the highest value observed during the period.
   */
  async setPeak(input: RecordUsageInput): Promise<void> {
    const amount = input.amount ?? 0;
    if (!Number.isFinite(amount) || amount < 0) {
      throw new BadRequestException('amount must be a non-negative number');
    }

    const period = this.periodKey(input.at);
    const now = input.at ? new Date(input.at) : new Date();

    await this.prisma.$executeRawUnsafe(
      `INSERT INTO usage_counters (id, tenant_id, metric_code, period, value, peak_value, last_event_at, created_at, updated_at)
       VALUES (UUID(), ?, ?, ?, ?, ?, ?, NOW(6), NOW(6))
       ON DUPLICATE KEY UPDATE
         peak_value = GREATEST(peak_value, VALUES(peak_value)),
         value = GREATEST(value, VALUES(value)),
         last_event_at = VALUES(last_event_at),
         updated_at = NOW(6)`,
      input.tenantId,
      input.metricCode,
      period,
      amount,
      amount,
      now,
    );
  }

  /** Read a single tenant/metric snapshot for a period (defaults to now). */
  async getSnapshot(tenantId: string, metricCode: string, period?: string): Promise<UsageSnapshot> {
    const p = period || this.periodKey();
    const row = await (this.prisma as any).usage_counters.findUnique({
      where: {
        tenant_id_metric_code_period: {
          tenant_id: tenantId,
          metric_code: metricCode,
          period: p,
        },
      },
    });
    return {
      tenantId,
      metricCode,
      period: p,
      value: row ? Number(row.value) : 0,
      peakValue: row ? Number(row.peak_value) : 0,
      lastEventAt: row?.last_event_at || null,
    };
  }

  /** All metrics for a tenant in the given period. */
  async listSnapshots(tenantId: string, period?: string): Promise<UsageSnapshot[]> {
    const p = period || this.periodKey();
    const rows = await (this.prisma as any).usage_counters.findMany({
      where: { tenant_id: tenantId, period: p },
      orderBy: { metric_code: 'asc' },
    });
    return rows.map((r: any) => ({
      tenantId,
      metricCode: r.metric_code,
      period: r.period,
      value: Number(r.value),
      peakValue: Number(r.peak_value),
      lastEventAt: r.last_event_at,
    }));
  }

  /**
   * Returns YYYY-MM (UTC) used as the period key. Centralized so all
   * code paths agree on bucketing.
   */
  periodKey(at?: string | Date): string {
    const d = at ? new Date(at) : new Date();
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  }
}
