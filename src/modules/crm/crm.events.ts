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
  /** บิลร้านค้าที่ผูกสมาชิก — เพิ่ม lifetimeValue */
  RETAIL_MEMBER_SALE: 'retail.member_sale.completed',
  /** บิลร้านค้าที่ผูกสมาชิกถูกยกเลิก — คืน lifetimeValue */
  RETAIL_MEMBER_SALE_VOIDED: 'retail.member_sale.voided',
  /** สมาชิกใช้โค้ดโปรสำเร็จ — ติด tag + journey trigger 'retail.promo_redeemed' */
  PROMO_REDEEMED: 'retail.promo.redeemed',
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

/** ส่งหลังทรานแซกชันขาย/ยกเลิก commit แล้วเท่านั้น — listener ล้มไม่กระทบบิล */
export interface RetailMemberSaleEventPayload {
  tenantId: string;
  guestId: string;
  contactId: string | null;
  saleId: string;
  receiptNo: string;
  /** ยอดสุทธิของบิล (grandTotal) */
  amount: number;
}

export interface PromoRedeemedEventPayload {
  tenantId: string;
  guestId: string;
  contactId: string | null;
  saleId: string;
  promotionId: string;
  code: string;
  discountAmount: number;
}
