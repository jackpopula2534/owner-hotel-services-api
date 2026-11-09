import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { SentimentService } from './sentiment.service';
import { CRM_EVENTS, ReviewEventPayload } from '../crm.events';

/**
 * AI module subscribers — automatically run sentiment analysis when
 * a review is submitted. Failures are swallowed (best-effort enrichment).
 */
@Injectable()
export class AiEventListener {
  private readonly logger = new Logger(AiEventListener.name);

  constructor(private readonly sentiment: SentimentService) {}

  @OnEvent(CRM_EVENTS.REVIEW_SUBMITTED, { async: true })
  async onReviewSubmitted(payload: ReviewEventPayload): Promise<void> {
    if (!payload?.tenantId || !payload?.reviewId) return;
    const text = payload.comment ?? '';
    if (!text.trim()) return;
    try {
      await this.sentiment.analyzeAndStore(payload.tenantId, 'review', payload.reviewId, text);
      this.logger.debug(`Sentiment computed for review ${payload.reviewId}`);
    } catch (error) {
      this.logger.warn(`sentiment listener failed: ${(error as Error).message}`);
    }
  }
}
