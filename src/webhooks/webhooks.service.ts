import { ConfigService } from '@nestjs/config';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { verifyHmacSha256 } from './webhook-signature.util';

export interface WebhookIngestInput {
  provider: 'promptpay' | 'scb' | '2c2p' | 'stripe' | string;
  eventType: string;
  idempotencyKey: string; // gateway's event id — must be globally unique per provider
  signature?: string;
  rawBody: string;
  payload: Record<string, unknown>;
}

export interface WebhookIngestResult {
  status: 'received' | 'duplicate' | 'failed';
  eventId?: string;
  error?: string;
}

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Persist a webhook synchronously (idempotent + signature-verified)
   * and return immediately. Heavy processing should be offloaded to a
   * Bull queue downstream — this method only ensures we never lose an
   * event and never double-process one.
   */
  async ingest(input: WebhookIngestInput): Promise<WebhookIngestResult> {
    const verified = this.verifySignature(input);

    // Idempotency check — Prisma's @@unique([provider, idempotency_key])
    // gives us a fast path; we still try-catch to handle race conditions.
    const existing = await (this.prisma as any).payment_webhook_events.findUnique({
      where: {
        // composite unique-input shape from Prisma
        provider_idempotency_key: {
          provider: input.provider,
          idempotency_key: input.idempotencyKey,
        },
      },
    });
    if (existing) {
      return { status: 'duplicate', eventId: existing.id };
    }

    try {
      const created = await (this.prisma as any).payment_webhook_events.create({
        data: {
          provider: input.provider,
          event_type: input.eventType,
          idempotency_key: input.idempotencyKey,
          signature: input.signature,
          signature_verified: verified ? 1 : 0,
          payload: input.payload as any,
          status: verified ? 'received' : 'failed',
          error_message: verified ? null : 'Signature verification failed',
        },
      });

      if (!verified) {
        this.logger.warn(
          `Webhook signature verification failed for ${input.provider}/${input.eventType} (id=${created.id})`,
        );
      } else {
        this.logger.log(
          `Webhook accepted: ${input.provider}/${input.eventType} (id=${created.id})`,
        );
      }

      return { status: 'received', eventId: created.id };
    } catch (err) {
      // Race condition fallback — another concurrent request may have
      // inserted the same idempotency key.
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Unique constraint')) {
        return { status: 'duplicate' };
      }
      this.logger.error('Failed to persist webhook', msg);
      return { status: 'failed', error: msg };
    }
  }

  /**
   * Mark an accepted event as processed once the downstream payment
   * matcher has linked it to a payments row.
   */
  async markProcessed(eventId: string, paymentId?: string) {
    await (this.prisma as any).payment_webhook_events.update({
      where: { id: eventId },
      data: {
        status: 'processed',
        processed_at: new Date(),
        payment_id: paymentId,
      },
    });
  }

  // ─────────── private ───────────

  private verifySignature(input: WebhookIngestInput): boolean {
    const secret = this.config.get<string>(`WEBHOOK_SECRET_${input.provider.toUpperCase()}`);
    if (!secret) {
      this.logger.warn(
        `No webhook secret configured for provider "${input.provider}" — skipping verification`,
      );
      return false;
    }
    return verifyHmacSha256(input.rawBody, input.signature, secret);
  }
}
