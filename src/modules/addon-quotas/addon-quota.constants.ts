/** add-on ที่คิดโควตาตามจำนวนครั้ง — code ต้องมีแถวใน addon_quota_configs */
export const QUOTA_ADDONS = ['CAMP_3D_MAP'] as const;
export type QuotaAddonCode = (typeof QUOTA_ADDONS)[number];

export const RESERVATION_STATUS = {
  RESERVED: 'reserved',
  COMMITTED: 'committed',
  REFUNDED: 'refunded',
} as const;

export type QuotaSource = 'paid' | 'trial';

/** งานที่จองไว้นานเกินนี้โดยไม่ commit/refund ถือว่าค้าง (process ตายกลางทาง) → คืนอัตโนมัติ */
export const STALE_RESERVATION_MINUTES = 30;

const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

/** บวกเดือนบนนาฬิกาไทย (หนีบวันท้ายเดือน) — ขอบรอบไม่เลื่อนเพราะ UTC ข้ามวัน */
function addMonthsBangkok(at: Date, months: number): Date {
  const local = new Date(at.getTime() + BANGKOK_OFFSET_MS);
  const day = local.getUTCDate();
  local.setUTCDate(1);
  local.setUTCMonth(local.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 0),
  ).getUTCDate();
  local.setUTCDate(Math.min(day, lastDay));
  return new Date(local.getTime() - BANGKOK_OFFSET_MS);
}

function bangkokMonthKey(at: Date): string {
  const local = new Date(at.getTime() + BANGKOK_OFFSET_MS);
  return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** @db.Date (UTC midnight) → 00:00 น. เวลาไทยของวันนั้น */
export function bangkokStartOfDate(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - BANGKOK_OFFSET_MS,
  );
}

export interface QuotaCycle {
  /** YYYY-MM ของวันเริ่มรอบ (เวลาไทย) — คีย์ของ usage_counters / usage_overage_charges */
  period: string;
  start: Date;
  /** วันรีเซ็ตโควตาครั้งถัดไป */
  end: Date;
}

/**
 * รอบโควตานับจากวันเริ่มใช้ add-on (anchor) ทีละ 1 เดือน — ไม่ใช่ตามเดือนปฏิทิน
 * กดซื้อ 30 ก.ย. ได้โควตาเต็มถึง 30 ต.ค. ไม่ใช่รีเซ็ตทิ้ง 1 ต.ค. (และไม่ได้โควตาซ้อนสองก้อน)
 * ไม่มี anchor → เดือนปฏิทินตามเวลาไทย (เริ่ม 00:00 น. วันที่ 1)
 *
 * ทุกรอบเริ่มคนละเดือนเสมอ คีย์ period จึงไม่ชนกันภายใน anchor เดียว
 * (เปลี่ยน anchor แล้วคีย์ซ้ำได้ — countUsage จึงกรอง createdAt ≥ start ด้วย)
 */
export function quotaCycle(at: Date = new Date(), anchor: Date | null = null): QuotaCycle {
  if (!anchor || anchor > at) {
    const local = new Date(at.getTime() + BANGKOK_OFFSET_MS);
    const start = new Date(
      Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - BANGKOK_OFFSET_MS,
    );
    return { period: bangkokMonthKey(start), start, end: addMonthsBangkok(start, 1) };
  }
  const local = new Date(at.getTime() + BANGKOK_OFFSET_MS);
  const anchorLocal = new Date(anchor.getTime() + BANGKOK_OFFSET_MS);
  let k =
    (local.getUTCFullYear() - anchorLocal.getUTCFullYear()) * 12 +
    (local.getUTCMonth() - anchorLocal.getUTCMonth());
  // ประมาณจากเดือนแล้วขยับให้ start ≤ at < end
  while (k > 0 && addMonthsBangkok(anchor, k) > at) k -= 1;
  while (addMonthsBangkok(anchor, k + 1) <= at) k += 1;
  const start = addMonthsBangkok(anchor, k);
  return { period: bangkokMonthKey(start), start, end: addMonthsBangkok(anchor, k + 1) };
}

/** คีย์ period ตามเดือนปฏิทินไทย — ใช้กับหน้าสรุปของแอดมิน */
export function quotaPeriod(at: Date = new Date()): string {
  return quotaCycle(at, null).period;
}

export function isQuotaAddon(code: string): code is QuotaAddonCode {
  return (QUOTA_ADDONS as readonly string[]).includes(code);
}
