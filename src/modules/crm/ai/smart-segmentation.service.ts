import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

export type AutoSegment = 'vip' | 'loyal' | 'regular' | 'new' | 'churn_risk' | 'dormant';

interface SegmentRule {
  segment: AutoSegment;
  match: (input: SegmentInput) => boolean;
  priority: number;
}

interface SegmentInput {
  totalStays: number;
  lifetimeValue: number;
  daysSinceLastStay: number | null;
  churnRiskBand: string | null;
}

/**
 * Recomputes CrmContact.segment for every tenant guest using RFM-like rules.
 *
 * Rule precedence (first match wins, highest priority first):
 *   1. critical/high churn → "churn_risk"
 *   2. new contact (≤1 stay) → "new"
 *   3. no stay 180+ days → "dormant"
 *   4. high LTV + frequent stays → "vip"
 *   5. ≥3 stays past year → "loyal"
 *   6. fallback → "regular"
 */
@Injectable()
export class SmartSegmentationService {
  private readonly logger = new Logger(SmartSegmentationService.name);

  private static readonly VIP_LTV_THRESHOLD = 50_000;
  private static readonly VIP_STAYS_THRESHOLD = 5;
  private static readonly LOYAL_STAYS_THRESHOLD = 3;

  private readonly rules: SegmentRule[] = [
    {
      segment: 'churn_risk',
      priority: 100,
      match: (i) => i.churnRiskBand === 'high' || i.churnRiskBand === 'critical',
    },
    {
      segment: 'new',
      priority: 90,
      match: (i) => i.totalStays <= 1,
    },
    {
      segment: 'dormant',
      priority: 80,
      match: (i) => i.daysSinceLastStay !== null && i.daysSinceLastStay >= 180,
    },
    {
      segment: 'vip',
      priority: 70,
      match: (i) =>
        i.lifetimeValue >= SmartSegmentationService.VIP_LTV_THRESHOLD &&
        i.totalStays >= SmartSegmentationService.VIP_STAYS_THRESHOLD,
    },
    {
      segment: 'loyal',
      priority: 60,
      match: (i) => i.totalStays >= SmartSegmentationService.LOYAL_STAYS_THRESHOLD,
    },
  ];

  constructor(private readonly prisma: PrismaService) {}

  /** Deterministic segment assignment. Falls back to "regular". */
  resolve(input: SegmentInput): AutoSegment {
    const sorted = [...this.rules].sort((a, b) => b.priority - a.priority);
    for (const rule of sorted) {
      if (rule.match(input)) return rule.segment;
    }
    return 'regular';
  }

  /**
   * Recompute segments for all contacts in a tenant.
   * Returns the count of contacts updated (only changes are written).
   */
  async recomputeForTenant(tenantId: string, now: Date = new Date()): Promise<number> {
    if (!tenantId) return 0;
    let updated = 0;
    try {
      const contacts = await this.prisma.crmContact.findMany({
        where: { tenantId },
        select: {
          id: true,
          guestId: true,
          segment: true,
          totalStays: true,
          lifetimeValue: true,
          lastStayAt: true,
        },
        take: 10_000,
      });

      for (const contact of contacts) {
        const daysSinceLastStay = contact.lastStayAt
          ? Math.floor((now.getTime() - contact.lastStayAt.getTime()) / 86_400_000)
          : null;

        const churn = contact.guestId
          ? await this.prisma.crmChurnScore.findFirst({
              where: { tenantId, guestId: contact.guestId },
              orderBy: { computedAt: 'desc' },
              select: { riskBand: true },
            })
          : null;

        const newSegment = this.resolve({
          totalStays: contact.totalStays,
          lifetimeValue: Number(contact.lifetimeValue ?? 0),
          daysSinceLastStay,
          churnRiskBand: churn?.riskBand ?? null,
        });

        if (newSegment !== contact.segment) {
          await this.prisma.crmContact.update({
            where: { id: contact.id },
            data: { segment: newSegment },
          });
          updated++;
        }
      }
    } catch (error: unknown) {
      const code = (error as { code?: string }).code;
      if (code !== 'P2021' && code !== 'P2022') {
        this.logger.error(`recomputeForTenant failed: ${(error as Error).message}`);
      }
    }
    return updated;
  }

  /** Aggregate segment distribution for dashboard. */
  async distribution(tenantId: string) {
    if (!tenantId) return [];
    try {
      const grouped = await this.prisma.crmContact.groupBy({
        by: ['segment'],
        where: { tenantId },
        _count: true,
      });
      return grouped.map((g) => ({ segment: g.segment ?? 'unknown', count: g._count }));
    } catch (error: unknown) {
      const code = (error as { code?: string }).code;
      if (code === 'P2021' || code === 'P2022') return [];
      throw error;
    }
  }
}
