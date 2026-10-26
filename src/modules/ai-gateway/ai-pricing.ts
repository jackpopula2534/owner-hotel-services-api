import { AI_REPORT_TZ_OFFSET_HOURS, AiTaskPricing } from './ai-gateway.constants';

export interface AiUsageAmounts {
  inputTokens?: number | null;
  outputTokens?: number | null;
  units?: number | null;
}

/**
 * ต้นทุน USD ของการเรียกหนึ่งครั้ง ปัดที่ 6 ตำแหน่ง (ตรงกับ Decimal(12,6))
 * ราคาที่ไม่ได้ตั้ง/ติดลบ/ไม่ใช่ตัวเลข นับเป็น 0
 */
export function computeAiCostUsd(pricing: AiTaskPricing | undefined, usage: AiUsageAmounts): number {
  if (!pricing) return 0;
  const rate = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
  const qty = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

  const cost =
    (qty(usage.inputTokens) / 1_000_000) * rate(pricing.inputPer1M) +
    (qty(usage.outputTokens) / 1_000_000) * rate(pricing.outputPer1M) +
    qty(usage.units) * rate(pricing.perUnit);

  return Math.round(cost * 1_000_000) / 1_000_000;
}

/** งานนี้ตั้งราคาแล้วหรือยัง — ใช้เตือนแอดมินว่าต้นทุนจะถูกบันทึกเป็น 0 */
export function isPricingSet(pricing: AiTaskPricing | undefined): boolean {
  if (!pricing) return false;
  return [pricing.inputPer1M, pricing.outputPer1M, pricing.perUnit].some(
    (v) => typeof v === 'number' && v > 0,
  );
}

/** period รูปแบบ YYYY-MM ของเวลาไทย ณ ขณะ `at` */
export function currentAiPeriod(at: Date = new Date()): string {
  const local = new Date(at.getTime() + AI_REPORT_TZ_OFFSET_HOURS * 3_600_000);
  return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * ช่วงเวลา UTC [start, end) ของเดือน `period` ตามเวลาไทย
 * ตัวอย่าง: 2026-10 → 2026-09-30T17:00Z ถึง 2026-10-31T17:00Z
 */
export function aiPeriodRange(period: string): { start: Date; end: Date } {
  const match = /^(\d{4})-(\d{2})$/.exec(period);
  if (!match) throw new Error(`Invalid period "${period}" (expected YYYY-MM)`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) throw new Error(`Invalid period "${period}" (expected YYYY-MM)`);
  const offset = AI_REPORT_TZ_OFFSET_HOURS * 3_600_000;
  return {
    start: new Date(Date.UTC(year, month - 1, 1) - offset),
    end: new Date(Date.UTC(year, month, 1) - offset),
  };
}

/** แปลงเวลา UTC เป็นวันที่ไทย YYYY-MM-DD (ใช้จัดกลุ่มกราฟรายวัน) */
export function aiLocalDate(at: Date): string {
  return new Date(at.getTime() + AI_REPORT_TZ_OFFSET_HOURS * 3_600_000).toISOString().slice(0, 10);
}
