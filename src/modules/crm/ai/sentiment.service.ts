import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

export type SentimentLabel = 'positive' | 'neutral' | 'negative';
export type SentimentSourceType = 'review' | 'ticket' | 'message';

export interface SentimentResult {
  label: SentimentLabel;
  score: number; // -1 .. 1
  confidence: number; // 0 .. 1
  keywords: string[];
  language: 'th' | 'en' | 'auto';
}

/**
 * Rule-based sentiment analyzer for Thai + English text.
 *
 * Why rule-based? Phase 4 ships without an external NLP dependency so it can
 * run offline. Each keyword carries a polarity weight; the final score is the
 * normalized sum scaled to [-1, 1]. Confidence is the proportion of words
 * matched against known keywords (capped).
 *
 * Replace with a model-backed service later by swapping `analyze()` to call
 * an LLM/HuggingFace endpoint — the public API stays the same.
 */
@Injectable()
export class SentimentService {
  private readonly logger = new Logger(SentimentService.name);

  // Polarity-weighted keyword lexicon. Weights in [-2, 2].
  private static readonly LEXICON: Record<string, number> = {
    // Strongly positive — TH
    ดีมาก: 2,
    ยอดเยี่ยม: 2,
    ประทับใจ: 2,
    แนะนำ: 1.5,
    พอใจ: 1.5,
    สะดวก: 1,
    สะอาด: 1,
    อร่อย: 1.5,
    สวย: 1,
    ดี: 0.8,
    น่ารัก: 1.2,
    อบอุ่น: 1,
    // Strongly positive — EN
    excellent: 2,
    amazing: 2,
    wonderful: 2,
    perfect: 1.8,
    great: 1.5,
    good: 1,
    clean: 1,
    friendly: 1.2,
    nice: 1,
    comfortable: 1.2,
    love: 1.5,
    helpful: 1.2,
    recommend: 1.5,

    // Strongly negative — TH
    แย่มาก: -2,
    ห่วย: -1.8,
    แย่: -1.5,
    ไม่ดี: -1.5,
    สกปรก: -1.8,
    เสีย: -1.2,
    พัง: -1.5,
    ช้า: -1,
    รอนาน: -1,
    ผิดหวัง: -1.8,
    ไม่แนะนำ: -1.8,
    ร้องเรียน: -1.5,
    น่ารำคาญ: -1.5,
    แพง: -0.8,
    // Strongly negative — EN
    terrible: -2,
    awful: -2,
    horrible: -2,
    bad: -1.5,
    dirty: -1.8,
    rude: -1.5,
    slow: -1,
    broken: -1.5,
    disappointing: -1.8,
    overpriced: -1,
    'never again': -2,
    'waste of money': -2,
    complaint: -1,
    issue: -0.8,
    problem: -1,
  };

  // Negation words that flip the next match's polarity.
  private static readonly NEGATIONS = [
    'ไม่',
    'ไม่ได้',
    'ไม่ค่อย',
    'not',
    "isn't",
    "wasn't",
    'no',
    'never',
  ];

  constructor(private readonly prisma: PrismaService) {}

  /** Synchronous deterministic analysis — safe to call inline. */
  analyze(text: string): SentimentResult {
    if (!text?.trim()) {
      return { label: 'neutral', score: 0, confidence: 0, keywords: [], language: 'auto' };
    }

    const normalized = text.toLowerCase();
    const language = this.detectLanguage(text);

    let sum = 0;
    let matches = 0;
    const triggered: string[] = [];

    // Single-pass scan for both languages
    for (const [keyword, weight] of Object.entries(SentimentService.LEXICON)) {
      const idx = normalized.indexOf(keyword);
      if (idx < 0) continue;

      // Check for negation in the preceding 15 chars
      const before = normalized.slice(Math.max(0, idx - 15), idx);
      const negated = SentimentService.NEGATIONS.some((n) => before.includes(n));
      const effectiveWeight = negated ? -weight * 0.8 : weight;

      sum += effectiveWeight;
      matches += 1;
      triggered.push(negated ? `!${keyword}` : keyword);
    }

    // Normalize sum to [-1, 1]. Treat sum of magnitude 4+ as saturated.
    const score = Math.max(-1, Math.min(1, sum / 4));

    // Confidence scales with number of matches (caps at 1 with 6+ matches).
    const confidence = Math.min(1, matches / 6);

    const label: SentimentLabel =
      score > 0.15 ? 'positive' : score < -0.15 ? 'negative' : 'neutral';

    return { label, score, confidence, keywords: triggered, language };
  }

  /** Persist result for a given source (review/ticket/message). Idempotent. */
  async analyzeAndStore(
    tenantId: string,
    sourceType: SentimentSourceType,
    sourceId: string,
    text: string,
  ) {
    const result = this.analyze(text);
    try {
      return await this.prisma.crmSentimentAnalysis.upsert({
        where: {
          sourceType_sourceId: { sourceType, sourceId },
        },
        update: {
          text: text.slice(0, 5000),
          label: result.label,
          score: result.score,
          confidence: result.confidence,
          keywords: JSON.stringify(result.keywords),
          language: result.language,
          analyzedAt: new Date(),
        },
        create: {
          tenantId,
          sourceType,
          sourceId,
          text: text.slice(0, 5000),
          label: result.label,
          score: result.score,
          confidence: result.confidence,
          keywords: JSON.stringify(result.keywords),
          language: result.language,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to persist sentiment for ${sourceType}:${sourceId}: ${(error as Error).message}`,
      );
      return null;
    }
  }

  /** Aggregate sentiment trend for tenant dashboard. */
  async getTrend(tenantId: string, days = 30) {
    if (!tenantId) return null;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    try {
      const rows = await this.prisma.crmSentimentAnalysis.findMany({
        where: { tenantId, analyzedAt: { gte: since } },
        select: { label: true, score: true, analyzedAt: true },
        orderBy: { analyzedAt: 'asc' },
      });
      const total = rows.length;
      const positive = rows.filter((r) => r.label === 'positive').length;
      const neutral = rows.filter((r) => r.label === 'neutral').length;
      const negative = rows.filter((r) => r.label === 'negative').length;
      const avgScore = total > 0 ? rows.reduce((s, r) => s + Number(r.score), 0) / total : 0;
      return { total, positive, neutral, negative, avgScore, sampleSize: total };
    } catch (error: unknown) {
      const code = (error as { code?: string }).code;
      if (code === 'P2021' || code === 'P2022') return null;
      throw error;
    }
  }

  // ──────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────
  private detectLanguage(text: string): 'th' | 'en' | 'auto' {
    // Thai unicode block: U+0E00 – U+0E7F
    const hasThai = /[฀-๿]/.test(text);
    const hasLatin = /[a-zA-Z]/.test(text);
    if (hasThai && !hasLatin) return 'th';
    if (hasLatin && !hasThai) return 'en';
    return 'auto';
  }
}
