/**
 * add-on แบบ "ใช้ก่อน เก็บเงินรอบบิลถัดไป" (subscription_features.billing_mode = 'bill_later')
 *
 * ช่วงเวลาทั้งหมดเป็น @db.Date (UTC midnight) และนับช่วงแบบ [start, end)
 * subscriptions.end_date = ขอบของรอบที่ยังไม่ได้ออกบิล — ออกใบต่ออายุแล้ว end_date เลื่อนไปอีกรอบ
 */

export const BILL_LATER_MODE = 'bill_later';
/** ใช้ฟรีขั้นต่ำ 1 เดือนก่อนรอบบิลแรกที่คิดเงิน */
export const BILL_LATER_MIN_FREE_MONTHS = 1;
/** รอบบิลถัดไปไกลเกิน 2 เดือน (จ่ายแพ็กเกจล่วงหน้าหลายเดือน) = ไม่มีบิลให้ฝากเก็บ → ต้องชำระทันที */
export const BILL_LATER_MAX_WAIT_MONTHS = 2;
export const SAAS_VAT_RATE = 7;

/** บวกเดือนแบบ UTC โดยหนีบวันท้ายเดือน (31 ม.ค. + 1 เดือน = 28/29 ก.พ. ไม่ล้นไป มี.ค.) */
export function addMonthsUtc(from: Date, months: number): Date {
  const d = new Date(from);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}

/** @db.Date เก็บเป็น UTC midnight — เทียบ/ตั้งค่าด้วย UTC เสมอ */
export function utcMidnight(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** วันที่ตามปฏิทินไทย (UTC+7) เป็น UTC midnight — "วันนี้" ของลูกค้า ไม่ใช่ของเซิร์ฟเวอร์ */
export function bangkokToday(now: Date): Date {
  return utcMidnight(new Date(now.getTime() + 7 * 60 * 60 * 1000));
}

/** ขอบรอบบิลชุดเดียวกับ anchor (anchor + k เดือน) — หนีบวันท้ายเดือนเทียบกับ anchor ไม่ใช่ขอบก่อนหน้า */
function boundaryAt(anchor: Date, k: number): Date {
  return addMonthsUtc(anchor, k);
}

export interface BillLaterWindow {
  /** วันแรกที่คิดเงิน = ขอบรอบบิล; ก่อนหน้านี้ใช้ฟรี */
  billingStartsOn: Date;
  /** สัญญาขั้นต่ำ: คิดเงินอย่างน้อย 1 รอบ */
  committedUntil: Date;
  /** ใบแจ้งหนี้ใบแรกที่มีค่า add-on ออกวันนี้ (ใบต่ออายุของรอบที่เริ่ม billingStartsOn) */
  firstChargeDate: Date;
  /** true = เคยใช้ช่วงฟรีไปแล้ว คิดย้อนตั้งแต่ต้นรอบปัจจุบัน */
  arrears: boolean;
}

/**
 * หาวันเริ่มคิดเงินของ add-on ที่เปิดวันนี้
 *
 * - ครั้งแรก: ขอบรอบบิลแรกที่ห่างจากวันนี้ ≥ 1 เดือน (ใช้ฟรีอย่างน้อย 30 วัน)
 *   เช่น กด 19 ต.ค. ตัดรอบวันที่ 1 → 1 พ.ย. ยังไม่ถึงเดือน → เริ่มคิด 1 ธ.ค.
 * - เคยทดลองใช้ add-on นี้แล้ว: ฟรีถึงขอบรอบบิลถัดไปเท่านั้น (ไม่การันตี 30 วัน)
 * - เคยได้ช่วงฟรีไปแล้ว (เปิดซ้ำ): คิดตั้งแต่ต้นรอบปัจจุบัน (เต็มเดือน ย้อนหลัง)
 *
 * nextBoundary = subscriptions.end_date (ขอบของรอบที่ยังไม่ออกบิล)
 */
export function computeBillLaterWindow(input: {
  today: Date;
  nextBoundary: Date;
  usedTrial: boolean;
  usedFreeWindow: boolean;
}): BillLaterWindow {
  const today = utcMidnight(input.today);
  const anchor = utcMidnight(input.nextBoundary);

  // k = ขอบรอบแรกที่เลยวันนี้ (end_date อาจผ่านมาแล้วถ้า cron ต่ออายุยังไม่ทำงาน)
  let k = 0;
  while (boundaryAt(anchor, k) <= today) k += 1;

  let billingStartsOn: Date;
  if (input.usedFreeWindow) {
    billingStartsOn = boundaryAt(anchor, k - 1);
  } else if (input.usedTrial) {
    billingStartsOn = boundaryAt(anchor, k);
  } else {
    const minFreeUntil = addMonthsUtc(today, BILL_LATER_MIN_FREE_MONTHS);
    while (boundaryAt(anchor, k) < minFreeUntil) k += 1;
    billingStartsOn = boundaryAt(anchor, k);
  }

  // ใบที่คิดรอบ [billingStartsOn, +1 เดือน) ออกตอนต่ออายุที่ขอบ billingStartsOn
  // — ถ้าเป็นการคิดย้อนหลัง ก็ไปรวมในใบต่ออายุถัดไป (ขอบแรกที่เลยวันนี้)
  const firstChargeDate = input.usedFreeWindow ? boundaryAt(anchor, k) : billingStartsOn;

  return {
    billingStartsOn,
    committedUntil: addMonthsUtc(billingStartsOn, 1),
    firstChargeDate,
    arrears: input.usedFreeWindow,
  };
}

/** จำนวนเดือนเต็มใน [from, to) — ช่วงไม่ครบเดือนท้ายสุดปัดขึ้นเป็น 1 เดือน (คิดเต็มเดือน) */
export function wholeMonthsBetween(from: Date, to: Date): number {
  if (to <= from) return 0;
  let months = 0;
  while (addMonthsUtc(from, months) < to) months += 1;
  return months;
}

export interface AddonBillingRow {
  id: string;
  price: number;
  billingMode: string | null;
  billingStartsOn: Date | null;
  billedThrough: Date | null;
  cancelAt: Date | null;
}

export interface AddonCharge {
  id: string;
  months: number;
  amount: number;
  /** null = แถวแบบเดิม ไม่ต้องบันทึก billed_through */
  billedThrough: Date | null;
}

/**
 * ค่า add-on ในใบต่ออายุของรอบ [periodStart, periodEnd)
 *
 * - แถวแบบเดิม (billing_mode null): ราคา × จำนวนเดือนของการต่ออายุ เหมือนเดิมทุกอย่าง
 * - bill_later: ยังอยู่ช่วงฟรี (billing_starts_on > periodStart) → ไม่คิด
 *   ไม่งั้นคิดตั้งแต่ (billed_through ?? billing_starts_on) ถึง min(periodEnd, cancel_at)
 *   — ครอบคลุมการคิดย้อนหลังของการเปิดซ้ำ และรอบที่ cron พลาดไป
 */
export function addonChargesForRenewal(
  rows: AddonBillingRow[],
  periodStart: Date,
  periodEnd: Date,
  legacyMonths: number,
): AddonCharge[] {
  const charges: AddonCharge[] = [];
  for (const row of rows) {
    if (row.billingMode !== BILL_LATER_MODE || !row.billingStartsOn) {
      if (row.price > 0) {
        charges.push({
          id: row.id,
          months: legacyMonths,
          amount: row.price * legacyMonths,
          billedThrough: null,
        });
      }
      continue;
    }
    if (row.billingStartsOn > periodStart) continue;
    const from = row.billedThrough ?? row.billingStartsOn;
    const until = row.cancelAt && row.cancelAt < periodEnd ? row.cancelAt : periodEnd;
    const months = wholeMonthsBetween(from, until);
    if (months <= 0) continue;
    charges.push({
      id: row.id,
      months,
      amount: row.price * months,
      billedThrough: addMonthsUtc(from, months),
    });
  }
  return charges;
}

/** VAT 7% บวกเพิ่มจากราคาสุทธิ (แบบเดียวกับหน้าชำระแพ็กเกจ) — ปัดเป็นสตางค์ */
export function vatOnTop(subtotal: number, rate = SAAS_VAT_RATE) {
  const net = Math.round(subtotal * 100) / 100;
  const vat = Math.round(net * rate) / 100;
  return {
    subtotal: net,
    vatRate: rate,
    vatAmount: vat,
    total: Math.round((net + vat) * 100) / 100,
  };
}

/** ยกเลิกมีผลไม่ก่อนสัญญาขั้นต่ำ และไม่ก่อนสิ้นรอบที่จ่ายแล้ว (คิดเต็มเดือน ไม่คืนเงิน) */
export function cancelEffectiveDate(
  row: {
    committedUntil: Date | null;
    billedThrough: Date | null;
    billingStartsOn: Date | null;
  },
  today: Date,
): Date {
  const candidates = [
    row.committedUntil,
    row.billedThrough,
    row.billingStartsOn,
    utcMidnight(today),
  ].filter((d): d is Date => d instanceof Date);
  return new Date(Math.max(...candidates.map((d) => d.getTime())));
}
