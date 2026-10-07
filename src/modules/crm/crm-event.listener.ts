import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { CrmContactsService } from './crm-contacts.service';
import { CrmTicketsService } from './crm-tickets.service';
import { LoyaltyService } from '../../loyalty/loyalty.service';
import { IntegrationsService } from '../integrations/integrations.service';
import {
  BookingEventPayload,
  CRM_EVENTS,
  MessageEventPayload,
  PromoRedeemedEventPayload,
  RetailMemberSaleEventPayload,
  ReviewEventPayload,
} from './crm.events';

/** tag ที่ติดให้สมาชิกที่เคยใช้โค้ดโปรร้านค้า — ใช้ทำ segment แคมเปญต่อได้ */
export const PROMO_REDEEMER_TAG = 'promo-redeemer';

/**
 * Subscribes CRM module to domain events emitted from bookings, reviews,
 * messaging. All handlers are best-effort and never throw — failures must
 * not break the source flow.
 */
@Injectable()
export class CrmEventListener {
  private readonly logger = new Logger(CrmEventListener.name);

  // Threshold below which we auto-create a service-desk ticket from a review.
  private static readonly LOW_RATING_THRESHOLD = 3;

  constructor(
    private readonly contacts: CrmContactsService,
    private readonly tickets: CrmTicketsService,
    private readonly loyalty: LoyaltyService,
    private readonly integrations: IntegrationsService,
  ) {}

  // ──────────────────────────────────────────────────────────
  // Booking events → enrich contact, kick off pre-stay journey hook
  // ──────────────────────────────────────────────────────────
  @OnEvent(CRM_EVENTS.BOOKING_CREATED, { async: true })
  async onBookingCreated(payload: BookingEventPayload): Promise<void> {
    if (!payload?.tenantId || !payload?.guestId) return;
    if (!(await this.integrations.isEnabled(payload.tenantId, 'booking-crm-sync'))) return;
    try {
      await this.contacts.upsertFromGuest(payload.tenantId, payload.guestId);
      this.logger.debug(`booking.created handled · bookingId=${payload.bookingId}`);
    } catch (error) {
      this.logger.warn(`booking.created handler failed: ${(error as Error).message}`);
    }
  }

  // ──────────────────────────────────────────────────────────
  // Check-out → award loyalty points + update lifetime value
  // ──────────────────────────────────────────────────────────
  @OnEvent(CRM_EVENTS.BOOKING_CHECKED_OUT, { async: true })
  async onBookingCheckedOut(payload: BookingEventPayload): Promise<void> {
    if (!payload?.tenantId || !payload?.guestId) return;
    if (!(await this.integrations.isEnabled(payload.tenantId, 'booking-crm-sync'))) return;
    const amount = payload.totalAmount ?? 0;
    try {
      await this.contacts.recordStayCompletion(payload.tenantId, payload.guestId, amount);
      await this.loyalty.addPointsForStay(payload.guestId, payload.tenantId, amount, {
        bookingId: payload.bookingId,
        reason: 'checkout_award',
      });
      this.logger.debug(
        `booking.checked_out handled · bookingId=${payload.bookingId} · amount=${amount}`,
      );
    } catch (error) {
      this.logger.warn(`booking.checked_out handler failed: ${(error as Error).message}`);
    }
  }

  // ──────────────────────────────────────────────────────────
  // Low review score → auto-open ticket for service recovery
  // ──────────────────────────────────────────────────────────
  @OnEvent(CRM_EVENTS.REVIEW_SUBMITTED, { async: true })
  async onReviewSubmitted(payload: ReviewEventPayload): Promise<void> {
    if (!payload?.tenantId) return;
    if (payload.rating > CrmEventListener.LOW_RATING_THRESHOLD) return;

    await this.tickets.createFromEvent(payload.tenantId, {
      subject: `Low review (${payload.rating}/5) — follow up`,
      description: payload.comment ?? 'Guest left a low rating with no comment',
      guestId: payload.guestId,
      bookingId: payload.bookingId,
      channel: 'review',
      category: 'service',
      priority: payload.rating <= 2 ? 'high' : 'normal',
      metadata: { reviewId: payload.reviewId, rating: payload.rating },
    });
  }

  // ──────────────────────────────────────────────────────────
  // Inbound LINE/Messenger with complaint intent → create ticket
  // ──────────────────────────────────────────────────────────
  @OnEvent(CRM_EVENTS.MESSAGE_RECEIVED, { async: true })
  async onMessageReceived(payload: MessageEventPayload): Promise<void> {
    if (!payload?.tenantId) return;
    if (payload.intent !== 'complaint') return;

    await this.tickets.createFromEvent(payload.tenantId, {
      subject: `Complaint via ${payload.channel}`,
      description: payload.content?.slice(0, 1000),
      guestId: payload.guestId,
      channel: payload.channel === 'facebook' ? 'manual' : payload.channel,
      category: 'service',
      priority: 'high',
      metadata: { conversationId: payload.conversationId },
    });
  }

  // ──────────────────────────────────────────────────────────
  // Retail POS (ร้านค้า) → lifetimeValue + tag ผู้ใช้โค้ดโปร
  // ส่งหลังทรานแซกชันขาย/ยกเลิก commit — CRM ล้มต้องไม่กระทบบิล
  // ──────────────────────────────────────────────────────────
  @OnEvent(CRM_EVENTS.RETAIL_MEMBER_SALE, { async: true })
  async onRetailMemberSale(payload: RetailMemberSaleEventPayload): Promise<void> {
    if (!payload?.tenantId || !payload?.guestId) return;
    await this.contacts.recordRetailSale(payload.tenantId, payload.guestId, payload.amount);
  }

  @OnEvent(CRM_EVENTS.RETAIL_MEMBER_SALE_VOIDED, { async: true })
  async onRetailMemberSaleVoided(payload: RetailMemberSaleEventPayload): Promise<void> {
    if (!payload?.tenantId || !payload?.guestId) return;
    await this.contacts.recordRetailSale(payload.tenantId, payload.guestId, -payload.amount);
  }

  @OnEvent(CRM_EVENTS.PROMO_REDEEMED, { async: true })
  async onPromoRedeemed(payload: PromoRedeemedEventPayload): Promise<void> {
    if (!payload?.tenantId || !payload?.guestId) return;
    await this.contacts.addTags(payload.tenantId, payload.guestId, [PROMO_REDEEMER_TAG]);
  }
}
