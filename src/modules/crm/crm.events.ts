/**
 * Event name constants for the CRM module.
 * Keep in sync with emitters in bookings/reviews/messaging modules.
 */
export const CRM_EVENTS = {
  BOOKING_CREATED: 'booking.created',
  BOOKING_CHECKED_IN: 'booking.checked_in',
  BOOKING_CHECKED_OUT: 'booking.checked_out',
  FOLIO_PAID: 'folio.paid',
  REVIEW_SUBMITTED: 'review.submitted',
  MESSAGE_RECEIVED: 'message.received',
  TICKET_OPENED: 'ticket.opened',
  LOYALTY_TIER_UPGRADED: 'loyalty.tier_upgraded',
} as const;

export interface BookingEventPayload {
  bookingId: string;
  tenantId: string;
  guestId?: string;
  totalAmount?: number;
}

export interface ReviewEventPayload {
  reviewId: string;
  tenantId: string;
  guestId?: string;
  bookingId?: string;
  rating: number;
  comment?: string;
}

export interface MessageEventPayload {
  conversationId: string;
  tenantId: string;
  guestId?: string;
  channel: 'line' | 'facebook' | 'email';
  content: string;
  intent?: 'complaint' | 'inquiry' | 'booking' | 'other';
}
