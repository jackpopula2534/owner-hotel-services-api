import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

export type ChurnRiskBand = 'low' | 'medium' | 'high' | 'critical';

export interface ChurnComputeInput {
  daysSinceLastStay: number | null;
  staysLast90d: number;
  staysLast365d: number;
  lifetimeValue: number;
  hasOpenTicket: boolean;
  lastSentimentScore: number | null;
}

export interface ChurnComputeResult {
  riskScore: number; // 0..1
  riskBand: ChurnRiskBand;
  reasons: string[];
}

/**
 * Rule-based churn risk model. Each rule contributes a weighted penalty to
 * the raw risk score; final score is clamped to [0, 1].
 *
 * Bands:
 *   < 0.30 → low
 *   < 0.55 → medium
 *   < 0.80 → high
 *   ≥ 0.80 → critical
 *
 * Phase 4 keeps it simple and explainable. Drop-in replacement for a real
 * ML model later — just swap `compute()`.
 */
@Injectable()
export class ChurnPredictionService {
  private readonly logger = new Logger(ChurnPredictionService.name);

  constructor(private readonly prisma: PrismaService) {}

  compute(input: ChurnComputeInput): ChurnComputeResult {
    let score = 0;
    const reasons: string[] = [];

    // Days since last stay — heaviest single contributor
    if (input.daysSinceLastStay === null) {
      score += 0.4;
      reasons.push('no_stay_recorded');
    } else if (input.daysSinceLastStay > 365) {
      score += 0.45;
      reasons.push('no_stay_365d+');
    } else if (input.daysSinceLastStay > 180) {
      score += 0.3;
      reasons.push('no_stay_180d+');
    } else if (input.daysSinceLastStay > 90) {
      score += 0.15;
      reasons.push('no_stay_90d+');
    }

    // Frequency decay
    if (input.staysLast365d > 0 && input.staysLast90d === 0) {
      score += 0.15;
      reasons.push('frequency_drop');
    }

    // Low engagement contacts
    if (input.staysLast365d <= 1 && input.lifetimeValue < 5000) {
      score += 0.1;
      reasons.push('low_engagement');
    }

    // Recent service issues
    if (input.hasOpenTicket) {
      score += 0.15;
      reasons.push('open_service_ticket');
    }

    if (input.lastSentimentScore !== null && input.lastSentimentScore < -0.3) {
      score += 0.15;
      reasons.push('negative_sentiment');
    }

    score = Math.min(1, Math.max(0, score));
    const riskBand = this.bandOf(score);
    return { riskScore: score, riskBand, reasons };
  }

  /**
   * Recompute and persist churn scores for all contacts in a tenant.
   * Returns the count of guests scored.
   *
   * Called by ChurnScheduler daily. Skips guests with no booking history.
   */
  async recomputeForTenant(tenantId: string, now: Date = new Date()): Promise<number> {
    if (!tenantId) return 0;
    let scored = 0;
    try {
      const contacts = await this.prisma.crmContact.findMany({
        where: { tenantId, guestId: { not: null } },
        select: {
          id: true,
          guestId: true,
          lifetimeValue: true,
          totalStays: true,
          lastStayAt: true,
        },
        take: 5_000,
      });

      for (const contact of contacts) {
        if (!contact.guestId) continue;
        const result = await this.scoreOne(tenantId, contact, now);
        if (result) scored++;
      }
    } catch (error: unknown) {
      const code = (error as { code?: string }).code;
      if (code !== 'P2021' && code !== 'P2022') {
        this.logger.error(`recomputeForTenant failed: ${(error as Error).message}`);
      }
    }
    return scored;
  }

  /**
   * Get the most recent risk snapshot for a guest. Returns null if none exists.
   */
  async getLatest(tenantId: string, guestId: string) {
    if (!tenantId || !guestId) return null;
    return this.prisma.crmChurnScore.findFirst({
      where: { tenantId, guestId },
      orderBy: { computedAt: 'desc' },
    });
  }

  /**
   * Top at-risk contacts dashboard — most recent score per guest, sorted
   * by band severity then score.
   */
  async listHighRisk(tenantId: string, limit = 50) {
    if (!tenantId) return [];
    return this.prisma.crmChurnScore.findMany({
      where: { tenantId, riskBand: { in: ['high', 'critical'] } },
      orderBy: [{ riskBand: 'desc' }, { riskScore: 'desc' }],
      take: limit,
    });
  }

  // ──────────────────────────────────────────────────────────
  // Internals
  // ──────────────────────────────────────────────────────────

  private async scoreOne(
    tenantId: string,
    contact: {
      id: string;
      guestId: string | null;
      lifetimeValue: unknown;
      totalStays: number;
      lastStayAt: Date | null;
    },
    now: Date,
  ) {
    if (!contact.guestId) return null;

    const sinceLastStay =
      contact.lastStayAt !== null
        ? Math.floor((now.getTime() - contact.lastStayAt.getTime()) / 86_400_000)
        : null;

    // Count stays in last 90/365 days from bookings
    const since90 = new Date(now.getTime() - 90 * 86_400_000);
    const since365 = new Date(now.getTime() - 365 * 86_400_000);
    const [staysLast90d, staysLast365d, openTicketCount, latestSentiment] = await Promise.all([
      this.prisma.booking.count({
        where: { tenantId, guestId: contact.guestId, createdAt: { gte: since90 } },
      }),
      this.prisma.booking.count({
        where: { tenantId, guestId: contact.guestId, createdAt: { gte: since365 } },
      }),
      this.prisma.crmTicket.count({
        where: {
          tenantId,
          guestId: contact.guestId,
          status: { in: ['open', 'in_progress', 'waiting'] },
        },
      }),
      this.prisma.crmSentimentAnalysis.findFirst({
        where: { tenantId, sourceType: 'review' },
        orderBy: { analyzedAt: 'desc' },
        select: { score: true },
      }),
    ]);

    const input: ChurnComputeInput = {
      daysSinceLastStay: sinceLastStay,
      staysLast90d,
      staysLast365d,
      lifetimeValue: Number(contact.lifetimeValue ?? 0),
      hasOpenTicket: openTicketCount > 0,
      lastSentimentScore: latestSentiment ? Number(latestSentiment.score) : null,
    };
    const result = this.compute(input);

    await this.prisma.crmChurnScore.create({
      data: {
        tenantId,
        guestId: contact.guestId,
        contactId: contact.id,
        riskScore: result.riskScore,
        riskBand: result.riskBand,
        reasons: JSON.stringify(result.reasons),
        daysSinceLastStay: sinceLastStay,
        staysLast90d,
        staysLast365d,
        computedAt: now,
      },
    });
    return result;
  }

  private bandOf(score: number): ChurnRiskBand {
    if (score >= 0.8) return 'critical';
    if (score >= 0.55) return 'high';
    if (score >= 0.3) return 'medium';
    return 'low';
  }
}
