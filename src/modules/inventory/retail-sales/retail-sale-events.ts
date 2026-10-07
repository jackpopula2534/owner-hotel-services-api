import { Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  CRM_EVENTS,
  PromoRedeemedEventPayload,
  RetailMemberSaleEventPayload,
} from '@/modules/crm/crm.events';

const logger = new Logger('RetailSaleEvents');

interface SaleSnapshot {
  id: string;
  tenantId: string;
  receiptNo: string;
  grandTotal: unknown;
  memberGuestId: string | null;
  memberContactId: string | null;
  promotionId?: string | null;
  promoCode?: string | null;
  promoDiscount?: unknown;
}

/** ส่ง event ให้ CRM — เรียกหลัง commit เท่านั้น, ไม่ throw (CRM ล้มต้องไม่ทำให้บิลล้ม) */
export function emitRetailSaleCompleted(emitter: EventEmitter2, sale: SaleSnapshot): void {
  if (!sale.memberGuestId) return;
  safeEmit(emitter, CRM_EVENTS.RETAIL_MEMBER_SALE, memberPayload(sale, sale.memberGuestId));
  if (sale.promotionId && sale.promoCode) {
    const payload: PromoRedeemedEventPayload = {
      tenantId: sale.tenantId,
      guestId: sale.memberGuestId,
      contactId: sale.memberContactId,
      saleId: sale.id,
      promotionId: sale.promotionId,
      code: sale.promoCode,
      discountAmount: Number(sale.promoDiscount ?? 0),
    };
    safeEmit(emitter, CRM_EVENTS.PROMO_REDEEMED, payload);
  }
}

export function emitRetailSaleVoided(emitter: EventEmitter2, sale: SaleSnapshot): void {
  if (!sale.memberGuestId) return;
  safeEmit(emitter, CRM_EVENTS.RETAIL_MEMBER_SALE_VOIDED, memberPayload(sale, sale.memberGuestId));
}

function memberPayload(sale: SaleSnapshot, guestId: string): RetailMemberSaleEventPayload {
  return {
    tenantId: sale.tenantId,
    guestId,
    contactId: sale.memberContactId,
    saleId: sale.id,
    receiptNo: sale.receiptNo,
    amount: Number(sale.grandTotal ?? 0),
  };
}

function safeEmit(emitter: EventEmitter2, event: string, payload: object): void {
  try {
    emitter.emit(event, payload);
  } catch (err) {
    logger.warn(`emit ${event} failed: ${(err as Error).message}`);
  }
}
