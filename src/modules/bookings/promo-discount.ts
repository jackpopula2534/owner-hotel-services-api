/**
 * ส่วนลดจากโค้ดโปรโมชันของโรงแรม
 *
 * - หักจากค่าห้อง (ค่าห้องทุกคืน + เตียงเสริม + ค่าเวลา) ก่อนคิดค่าบริการ/VAT
 * - percentage → % ของค่าห้อง (มีเพดาน maxDiscount ได้), fixed → ลดเป็นบาทต่อการจอง
 * - ส่วนลดไม่เกินค่าห้อง (ยอดไม่ติดลบ)
 *
 * ต้องตรงกับ lib/utils/promoDiscount.ts ฝั่ง frontend
 */

export type PromoDiscountType = 'percentage' | 'fixed';

export interface PromoRule {
  id: string;
  code: string;
  discountType: string;
  discountValue: unknown;
  maxDiscount?: unknown;
  minNights?: number | null;
  minAmount?: unknown;
}

export interface AppliedPromo {
  id: string;
  code: string;
  discountType: PromoDiscountType;
  discountValue: number;
  /** ค่าห้องก่อนหักส่วนลด */
  grossSubtotal: number;
  amount: number;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
const num = (v: unknown): number => Math.max(0, Number(v ?? 0) || 0);

export function applyPromo(rule: PromoRule, grossSubtotal: number): AppliedPromo {
  const discountType: PromoDiscountType = rule.discountType === 'fixed' ? 'fixed' : 'percentage';
  const value = num(rule.discountValue);
  let amount = discountType === 'percentage' ? (grossSubtotal * Math.min(value, 100)) / 100 : value;
  const cap = rule.maxDiscount == null ? 0 : num(rule.maxDiscount);
  if (discountType === 'percentage' && cap > 0) amount = Math.min(amount, cap);
  return {
    id: rule.id,
    code: rule.code,
    discountType,
    discountValue: value,
    grossSubtotal: round2(grossSubtotal),
    amount: round2(Math.min(Math.max(0, amount), grossSubtotal)),
  };
}

/** เหตุผลที่การเข้าพักนี้ใช้โค้ดไม่ได้ (null = ใช้ได้) */
export function promoStayIneligibility(
  rule: PromoRule,
  stay: { nights: number; grossSubtotal: number },
): string | null {
  const minNights = Math.max(1, Number(rule.minNights ?? 1) || 1);
  if (stay.nights < minNights) return `โค้ดนี้ใช้ได้เมื่อพักอย่างน้อย ${minNights} คืน`;
  const minAmount = rule.minAmount == null ? 0 : num(rule.minAmount);
  if (minAmount > 0 && stay.grossSubtotal < minAmount) {
    return `โค้ดนี้ใช้ได้เมื่อค่าห้องตั้งแต่ ${minAmount.toLocaleString('th-TH')} บาทขึ้นไป`;
  }
  return null;
}
