/**
 * Camp pricing helpers — pure functions (ทดสอบง่าย ไม่พึ่ง DB)
 *
 * priority การคิดราคาต่อคืน:  season (เทศกาล) > weekend (ศุกร์/เสาร์) > base
 */

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/** ช่วงราคาตามฤดูกาล/เทศกาล */
export interface SeasonalRate {
  name?: string;
  start: string; // "YYYY-MM-DD"
  end: string; // "YYYY-MM-DD" (รวมวันสุดท้าย)
  price: number;
}

/** จำนวนคืนระหว่าง checkIn → checkOut (ขั้นต่ำ 1 คืน) */
export function countNights(checkIn: Date, checkOut: Date): number {
  const diff = Math.round((checkOut.getTime() - checkIn.getTime()) / MS_PER_DAY);
  return Math.max(1, diff);
}

/** จำนวนคืนที่เป็น weekend (คืนที่เริ่มวันศุกร์=5 หรือเสาร์=6) */
export function countWeekendNights(checkIn: Date, checkOut: Date): number {
  const nights = countNights(checkIn, checkOut);
  let weekend = 0;
  for (let i = 0; i < nights; i++) {
    const day = new Date(checkIn.getTime() + i * MS_PER_DAY).getDay();
    if (day === 5 || day === 6) weekend++;
  }
  return weekend;
}

const ymd = (d: Date): string => d.toISOString().slice(0, 10);

/** หา season ที่ครอบคลุมวันที่ระบุ (ถ้ามีหลายอันที่ทับ ใช้ตัวแรก) */
export function findSeasonForDate(
  date: Date,
  seasons?: SeasonalRate[] | null,
): SeasonalRate | null {
  if (!seasons || seasons.length === 0) return null;
  const key = ymd(date);
  return seasons.find((s) => s.start <= key && key <= s.end && s.price > 0) ?? null;
}

/** ราคาของคืนหนึ่ง: season > weekend > base */
export function rateForNight(
  nightStart: Date,
  basePrice: number,
  weekendPrice: number | null | undefined,
  seasons?: SeasonalRate[] | null,
): number {
  const season = findSeasonForDate(nightStart, seasons);
  if (season) return season.price;
  const day = nightStart.getDay();
  if ((day === 5 || day === 6) && weekendPrice && weekendPrice > 0) return weekendPrice;
  return basePrice;
}

/** ราคาค่าที่พักรวม (คิดทีละคืน: season > weekend > base) */
export function calcLodgingTotal(
  basePrice: number,
  weekendPrice: number | null | undefined,
  checkIn: Date,
  checkOut: Date,
  seasons?: SeasonalRate[] | null,
): number {
  const nights = countNights(checkIn, checkOut);
  let total = 0;
  for (let i = 0; i < nights; i++) {
    const nightStart = new Date(checkIn.getTime() + i * MS_PER_DAY);
    total += rateForNight(nightStart, basePrice, weekendPrice, seasons);
  }
  return total;
}

/** รวมราคา add-on จาก line items (qty * priceSnapshot) */
export function calcAddonTotal(items: { qty: number; priceSnapshot: number }[]): number {
  return items.reduce((sum, it) => sum + it.qty * it.priceSnapshot, 0);
}
