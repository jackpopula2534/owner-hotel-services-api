/**
 * มัดจำของการจองหน้าเว็บที่แขกโอน PromptPay — ส่วนที่เหลือชำระที่โรงแรม
 *
 * - full       → โอนเต็มจำนวน (ค่าเริ่มต้น)
 * - percentage → % ของยอดรวม (หลังส่วนลด รวมค่าบริการ/VAT)
 * - fixed      → บาทต่อการจอง
 * มัดจำที่ ≥ ยอดรวม (เช่นห้องราคาถูกกว่ามัดจำแบบคงที่) = โอนเต็มจำนวน
 */

export const DEPOSIT_TYPES = ['full', 'percentage', 'fixed'] as const;
export type DepositType = (typeof DEPOSIT_TYPES)[number];

export interface DepositPolicy {
  type: DepositType;
  /** % หรือบาท — 0 เมื่อ type = full */
  value: number;
}

export const FULL_PAYMENT: DepositPolicy = { type: 'full', value: 0 };

const round2 = (n: number): number => Math.round(n * 100) / 100;

export function readDepositPolicy(
  row: { websiteDepositType?: string | null; websiteDepositValue?: unknown } | null | undefined,
): DepositPolicy {
  const type = row?.websiteDepositType;
  const value = Number(row?.websiteDepositValue ?? 0) || 0;
  if ((type === 'percentage' || type === 'fixed') && value > 0) {
    return { type, value: type === 'percentage' ? Math.min(value, 100) : value };
  }
  return FULL_PAYMENT;
}

/** ยอดที่ต้องโอนตอนจอง — null = โอนเต็มจำนวน (ไม่ใช่มัดจำ) */
export function depositDue(policy: DepositPolicy, grandTotal: number): number | null {
  if (policy.type === 'full' || grandTotal <= 0) return null;
  const amount = round2(
    policy.type === 'percentage' ? (grandTotal * policy.value) / 100 : policy.value,
  );
  return amount > 0 && amount < grandTotal ? amount : null;
}

/**
 * แบ่งยอดที่ต้องโอนของการจองหลายห้องลงแต่ละห้องตามสัดส่วนยอดรวม (ห้องสุดท้ายรับเศษสตางค์)
 * deposit = null → แต่ละห้องโอนเต็มจำนวนของตัวเอง
 */
export function allocateDue(deposit: number | null, totals: number[]): number[] {
  if (deposit == null) return totals.map(round2);
  const sum = totals.reduce((a, b) => a + b, 0);
  if (sum <= 0) return totals.map(() => 0);
  let left = round2(deposit);
  return totals.map((t, i) => {
    if (i === totals.length - 1) return left;
    const share = round2((deposit * t) / sum);
    left = round2(left - share);
    return share;
  });
}
