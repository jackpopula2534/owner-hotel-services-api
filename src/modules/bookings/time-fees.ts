/**
 * ค่าธรรมเนียมเช็คอินก่อนเวลา / เช็คเอาท์หลังเวลา ตามการตั้งค่าของที่พัก
 *
 * - คิดเฉพาะเมื่อที่พักเปิดใช้ (earlyCheckInEnabled / lateCheckOutEnabled) และเวลาที่จองเลยเวลามาตรฐาน
 * - fixed     → ค่าคงที่ต่อการจอง
 * - percentage → % ของราคาคืนที่เกี่ยวข้อง (เช็คอินก่อน = คืนแรก, เช็คเอาท์หลัง = คืนสุดท้าย)
 * - เป็นยอดสุทธิ (ไม่คิดค่าบริการ/VAT ซ้ำ) — สูตรเดียวกับหน้าจองหลังบ้าน
 *
 * ต้องตรงกับ lib/utils/timeFees.ts ฝั่ง frontend
 */

export type TimeFeeType = 'fixed' | 'percentage';

export interface TimeFeeSettings {
  standardCheckInTime?: string | null;
  standardCheckOutTime?: string | null;
  earlyCheckInEnabled?: boolean | null;
  lateCheckOutEnabled?: boolean | null;
  earlyCheckInFeeType?: string | null;
  earlyCheckInFeeAmount?: unknown;
  lateCheckOutFeeType?: string | null;
  lateCheckOutFeeAmount?: unknown;
}

export interface TimeFeeLine {
  /** เวลาที่จอง — ไม่มีเมื่ออนุมัติคำขอทีหลัง (ไม่ได้ระบุเวลา) */
  time?: string;
  standardTime?: string;
  feeType: TimeFeeType;
  /** ค่าที่ตั้งไว้ (บาท หรือ %) */
  rate: number;
  amount: number;
}

export interface TimeFees {
  earlyCheckIn?: TimeFeeLine;
  lateCheckOut?: TimeFeeLine;
  total: number;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

const round2 = (n: number): number => Math.round(n * 100) / 100;

function feeLine(
  enabled: boolean | null | undefined,
  type: string | null | undefined,
  rawRate: unknown,
  time: string | undefined,
  standardTime: string | null | undefined,
  isOutside: (time: string, standard: string) => boolean,
  nightRate: number,
): TimeFeeLine | undefined {
  if (!enabled || !time || !standardTime || !HHMM.test(time) || !HHMM.test(standardTime)) {
    return undefined;
  }
  if (!isOutside(time, standardTime)) return undefined;
  const fee = timeFeeAmount(type, rawRate, nightRate);
  return fee.amount > 0 ? { time, standardTime, ...fee } : undefined;
}

/** ค่าธรรมเนียมหนึ่งรายการ: fixed = ค่าคงที่, percentage = % ของราคาคืนที่เกี่ยวข้อง (สูงสุด 100%) */
export function timeFeeAmount(
  type: string | null | undefined,
  rawRate: unknown,
  nightRate: number,
): Pick<TimeFeeLine, 'feeType' | 'rate' | 'amount'> {
  const rate = Math.max(0, Number(rawRate ?? 0) || 0);
  const feeType: TimeFeeType = type === 'percentage' ? 'percentage' : 'fixed';
  const amount = round2(feeType === 'percentage' ? (nightRate * Math.min(rate, 100)) / 100 : rate);
  return { feeType, rate, amount };
}

export function computeTimeFees(
  settings: TimeFeeSettings,
  times: { checkInTime?: string; checkOutTime?: string },
  nights: { firstNightRate: number; lastNightRate: number },
): TimeFees {
  // "HH:MM" แบบเติมศูนย์ เทียบเป็นสตริงได้ตรงตามเวลา
  const earlyCheckIn = feeLine(
    settings.earlyCheckInEnabled,
    settings.earlyCheckInFeeType,
    settings.earlyCheckInFeeAmount,
    times.checkInTime,
    settings.standardCheckInTime,
    (t, std) => t < std,
    nights.firstNightRate,
  );
  const lateCheckOut = feeLine(
    settings.lateCheckOutEnabled,
    settings.lateCheckOutFeeType,
    settings.lateCheckOutFeeAmount,
    times.checkOutTime,
    settings.standardCheckOutTime,
    (t, std) => t > std,
    nights.lastNightRate,
  );
  return {
    ...(earlyCheckIn && { earlyCheckIn }),
    ...(lateCheckOut && { lateCheckOut }),
    total: round2((earlyCheckIn?.amount ?? 0) + (lateCheckOut?.amount ?? 0)),
  };
}
