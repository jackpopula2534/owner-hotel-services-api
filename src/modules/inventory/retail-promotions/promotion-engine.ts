import { randomBytes } from 'crypto';
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

/** ไม่มี 0/O/1/I — แคชเชียร์อ่านโค้ดจากจอลูกค้าแล้วพิมพ์ไม่พลาด */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function randomPromoCode(length: number): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

// ───────────────────────── Audience (tier / segment / per-member) ─────────────────────────

export interface PromoAudienceRule {
  eligibleTiers: string[];
  eligibleSegments: string[];
  perMemberLimit: number | null;
}

/**
 * โปรที่ "จำกัดสิทธิ์" = จำกัด tier/segment หรือโควตาต่อสมาชิก — ต้องรู้ว่าลูกค้าเป็นใคร
 * โปรอัตโนมัติที่ไม่จำกัดสิทธิ์แจกให้ลูกค้าทั่วไปได้โดยไม่ต้องผูกสมาชิก
 */
export function isRestrictedPromotion(rule: PromoAudienceRule): boolean {
  return rule.eligibleTiers.length > 0 || rule.eligibleSegments.length > 0 || rule.perMemberLimit != null;
}

/** สมาชิกคนนี้ใช้โปรนี้ได้ไหม — คืน error (ยังไม่ throw) ให้ผู้เรียกเลือกว่าจะโยนหรือข้าม */
export function audienceError(
  rule: PromoAudienceRule,
  member: { tier: string; segment: string | null },
  memberUsedCount: number,
): BadRequestException | null {
  if (rule.eligibleTiers.length && !rule.eligibleTiers.includes(member.tier)) {
    return promoError('PROMO_TIER_NOT_ELIGIBLE', `โปรนี้สำหรับสมาชิกระดับ ${rule.eligibleTiers.join(', ')} เท่านั้น`, {
      tier: member.tier,
    });
  }
  if (rule.eligibleSegments.length && (!member.segment || !rule.eligibleSegments.includes(member.segment))) {
    return promoError('PROMO_SEGMENT_NOT_ELIGIBLE', 'สมาชิกท่านนี้ไม่อยู่ในกลุ่มเป้าหมายของโปรนี้');
  }
  if (rule.perMemberLimit != null && memberUsedCount >= rule.perMemberLimit) {
    return promoError('PROMO_MEMBER_LIMIT', `สมาชิกท่านนี้ใช้โปรนี้ครบ ${rule.perMemberLimit} ครั้งแล้ว`);
  }
  return null;
}

// ─────────────────────────────────── Stacking ───────────────────────────────────

export interface StackCandidate {
  id: string;
  stackable: boolean;
}

export type StackBlockReason = 'CODE_NOT_STACKABLE' | 'NOT_STACKABLE';

/**
 * กติกาใช้ร่วม: บิลละ 1 โค้ด + โปรอัตโนมัติ — ทุกโปรในบิลต้อง "ใช้ร่วมได้" ทั้งหมด
 *
 *   • มีโค้ดที่ใช้ร่วมไม่ได้ → โค้ดตัวเดียว (ลูกค้าตั้งใจใช้โค้ด จึงชนะโปรอัตโนมัติ)
 *   • มีโค้ด → ได้โปรอัตโนมัติเฉพาะตัวที่ใช้ร่วมได้
 *   • ไม่มีโค้ด → โปรอัตโนมัติที่ใช้ร่วมได้ทั้งหมด; ถ้าไม่มีเลย ได้ตัวที่ใช้ร่วมไม่ได้ตัวแรก (เก่าสุด)
 *
 * `autos` ต้องเรียงตามลำดับความสำคัญมาแล้ว (เก่า → ใหม่)
 */
export function selectStackedPromotions<T extends StackCandidate>(
  code: StackCandidate | null,
  autos: T[],
): { selected: T[]; blocked: Array<{ promotion: T; reason: StackBlockReason }> } {
  const others = autos.filter((a) => a.id !== code?.id);
  if (code && !code.stackable) {
    return { selected: [], blocked: others.map((promotion) => ({ promotion, reason: 'CODE_NOT_STACKABLE' })) };
  }
  const stackable = others.filter((a) => a.stackable);
  const selected = code || stackable.length ? stackable : others.slice(0, 1);
  const chosen = new Set(selected.map((s) => s.id));
  return {
    selected,
    blocked: others
      .filter((a) => !chosen.has(a.id))
      .map((promotion) => ({ promotion, reason: 'NOT_STACKABLE' as const })),
  };
}
