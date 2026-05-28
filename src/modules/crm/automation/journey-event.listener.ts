import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { JourneyService } from './journey.service';
import { BookingEventPayload, CRM_EVENTS } from '../crm.events';

/**
 * Auto-enroll guests into matching active journeys whenever
 * a booking event fires.
 */
@Injectable()
export class JourneyEventListener {
  private readonly logger = new Logger(JourneyEventListener.name);

  constructor(private readonly journeys: JourneyService) {}

  @OnEvent(CRM_EVENTS.BOOKING_CREATED, { async: true })
  async onBookingCreated(payload: BookingEventPayload): Promise<void> {
    if (!payload?.tenantId || !payload?.guestId) return;
    const n = await this.journeys.enrollByTrigger(
      'booking.created',
      payload.tenantId,
      payload.guestId,
      { bookingId: payload.bookingId, metadata: { totalAmount: payload.totalAmount } },
    );
    if (n > 0) this.logger.debug(`Enrolled in ${n} pre-stay journey(s)`);
  }

  @OnEvent(CRM_EVENTS.BOOKING_CHECKED_IN, { async: true })
  async onBookingCheckedIn(payload: BookingEventPayload): Promise<void> {
    if (!payload?.tenantId || !payload?.guestId) return;
    await this.journeys.enrollByTrigger('booking.checked_in', payload.tenantId, payload.guestId, {
      bookingId: payload.bookingId,
    });
  }

  @OnEvent(CRM_EVENTS.BOOKING_CHECKED_OUT, { async: true })
  async onBookingCheckedOut(payload: BookingEventPayload): Promise<void> {
    if (!payload?.tenantId || !payload?.guestId) return;
    await this.journeys.enrollByTrigger('booking.checked_out', payload.tenantId, payload.guestId, {
      bookingId: payload.bookingId,
      metadata: { totalAmount: payload.totalAmount },
    });
  }
}
