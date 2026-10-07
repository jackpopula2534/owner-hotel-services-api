import { BadRequestException } from '@nestjs/common';
import { RetailPromoDiscountType } from '@prisma/client';

/**
 * Pure money rules for a POS promotion — no Prisma, so the preview endpoint and
 * the checkout transaction share one implementation and the unit tests can pin
 * every edge without a database.
 *
 * แผน: docs/RETAIL_PROMOTIONS_PLAN.md
 */

/** Round to 2 decimal places (THB). */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export interface PromoCartLine {
  itemId: string;
  quantity: number;
  unitPrice: number;
  lineDiscount?: number;
}

export interface PromoDiscountRule {
  discountType: RetailPromoDiscountType;
  discountValue: number;
  maxDiscount: number | null;
  minSpend: number;
  /** ว่าง = ทุกสินค้าในบิลร่วมรายการ */
  eligibleItemIds: string[];
}

export interface PromoDiscountResult {
  /** ยอดหลังหักส่วนลดรายบรรทัด — ใช้เทียบ minSpend */
  netSubtotal: number;
  /** ยอดของสินค้าที่ร่วมรายการ — ฐานคิดส่วนลด */
  eligibleSubtotal: number;
  discount: number;
}

/** Thrown error body — flat shape that AllExceptionsFilter passes through. */
export function promoError(
  code: string,
  message: string,
  details?: Record<string, unknown>,
): BadRequestException {
  return new BadRequestException(details ? { code, message, details } : { code, message });
}

function netOf(line: PromoCartLine): number {
  return Math.max(line.quantity * line.unitPrice - (line.lineDiscount ?? 0), 0);
}

/**
 * Discount a promotion grants on this cart. Throws (with a code the POS can show)
 * when the cart does not qualify — below min spend, or no eligible item in it.
 */
export function computePromoDiscount(
  rule: PromoDiscountRule,
  lines: PromoCartLine[],
): PromoDiscountResult {
  const netSubtotal = round2(lines.reduce((sum, l) => sum + netOf(l), 0));
  if (netSubtotal < rule.minSpend) {
    throw promoError(
      'PROMO_MIN_SPEND',
      `ยอดซื้อยังไม่ถึงขั้นต่ำ ${rule.minSpend.toLocaleString('th-TH')} บาท (ขาดอีก ${round2(
        rule.minSpend - netSubtotal,
      ).toLocaleString('th-TH')} บาท)`,
      { minSpend: rule.minSpend, netSubtotal },
    );
  }

  const eligible = new Set(rule.eligibleItemIds);
  const eligibleSubtotal = round2(
    lines
      .filter((l) => eligible.size === 0 || eligible.has(l.itemId))
      .reduce((sum, l) => sum + netOf(l), 0),
  );

  if (rule.discountType === RetailPromoDiscountType.NONE) {
    return { netSubtotal, eligibleSubtotal, discount: 0 };
  }
  if (eligibleSubtotal <= 0) {
    throw promoError('PROMO_NO_ELIGIBLE_ITEM', 'ไม่มีสินค้าที่ร่วมรายการโปรโมชั่นนี้ในบิล');
  }

  let discount =
    rule.discountType === RetailPromoDiscountType.PERCENT
      ? (eligibleSubtotal * rule.discountValue) / 100
      : rule.discountValue;
  if (rule.discountType === RetailPromoDiscountType.PERCENT && rule.maxDiscount != null) {
    discount = Math.min(discount, rule.maxDiscount);
  }
  // ลดเกินยอดสินค้าที่ร่วมรายการไม่ได้ — FIXED ฿100 กับบิลที่ร่วมรายการแค่ ฿60 ได้ ฿60
  discount = round2(Math.max(Math.min(discount, eligibleSubtotal), 0));
  return { netSubtotal, eligibleSubtotal, discount };
}

export interface GiftAvailability {
  itemId: string;
  quantity: number;
  /** ชิ้นที่แจกได้จริงตอนนี้ = min(สต็อกคลังของแถม, งบที่เหลือ) */
  availableQty: number;
}

/**
 * Which gifts can be handed out. A short gift is only dropped when the cashier
 * explicitly accepted "discount only" — never silently. A promotion that would
 * then give nothing at all is rejected.
 */
export function resolveGiftGrant<T extends GiftAvailability>(
  gifts: T[],
  discount: number,
  acceptWithoutGift: boolean,
): { granted: T[]; skipped: T[] } {
  const granted = gifts.filter((g) => g.availableQty >= g.quantity);
  const skipped = gifts.filter((g) => g.availableQty < g.quantity);

  if (skipped.length > 0 && !acceptWithoutGift) {
    throw promoError(
      'PROMO_GIFT_SHORTAGE',
      discount > 0
        ? 'ของแถมไม่พอ — ถามลูกค้าว่าจะรับเฉพาะส่วนลดหรือไม่'
        : 'ของแถมหมด — ใช้โค้ดนี้ไม่ได้ในขณะนี้',
      { skippedItemIds: skipped.map((g) => g.itemId), canAcceptWithoutGift: discount > 0 || granted.length > 0 },
    );
  }
  if (discount <= 0 && granted.length === 0) {
    throw promoError('PROMO_NO_BENEFIT', 'ของแถมหมดและโปรนี้ไม่มีส่วนลด — ใช้โค้ดนี้ไม่ได้ในขณะนี้');
  }
  return { granted, skipped };
}

/** Read a Json? column that should hold string[]; anything else counts as "no filter". */
export function jsonStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v !== '') : [];
}

/** Codes are case-insensitive at the counter; stored upper-case. */
export function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}
