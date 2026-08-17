import { RevenueSourceModule, RevenueSourceType, RevenueType } from '@prisma/client';
import { round2 } from '@/common/utils/bangkok-day.util';
import type { PostRevenueInput, RevenueLineInput } from '../revenue-posting.service';
import { settlementOf } from './settlement.util';
import { num, type Money } from './money';

/** แถว CampReservation เท่าที่การบันทึกรายได้ต้องใช้ */
export interface CampRevenueRow {
  id: string;
  tenantId: string | null;
  campgroundId: string;
  reservationNo: string | null;
  paymentMethod: string | null;
  checkOut: Date;
  actualCheckOut: Date | null;
  totalPrice: Money;
  addonItems: { qty: number; priceSnapshot: Money }[];
}

/** ข้อมูลลานที่แถวการจองไม่ได้ถืออยู่เอง */
export interface CampRevenueOutlet {
  campgroundId: string;
  campgroundName: string | null;
}

/** สิ่งที่ Prisma ต้อง select มาให้ {@link buildCampRevenueInput} ทำงานได้ */
export const CAMP_REVENUE_SELECT = {
  id: true,
  tenantId: true,
  campgroundId: true,
  reservationNo: true,
  paymentMethod: true,
  checkOut: true,
  actualCheckOut: true,
  totalPrice: true,
  addonItems: { select: { qty: true, priceSnapshot: true } },
} as const;

/**
 * แปลงการจองลานกางเต็นท์หนึ่งใบเป็นรายการรายได้ที่พร้อมลงสมุด
 *
 * ── ทำไมค่าที่พักของลานเป็น ROOM ────────────────────────────────────────────
 * จุดกางเต็นท์คือที่พักค้างคืนที่ขายเป็นคืน ๆ เหมือนห้องพัก จึงเป็นรายได้แผนกที่พัก
 * (segment `ROOMS`) ตามผัง USALI ไม่ใช่รายได้เบ็ดเตล็ด
 *
 * **ข้อควรระวังสำหรับรายงาน:** ยอดนี้จะโผล่ในผลรวม segment `ROOMS` ด้วย รายงานที่
 * หมายถึง "ห้องพักของโรงแรม" ต้องกรอง `sourceModule = HOTEL` เพิ่ม ไม่ใช่กรองแค่
 * segment — มิติสองตัวนี้ตอบคนละคำถาม (แผนกไหน / ธุรกิจไหน) และตั้งใจให้แยกกัน
 *
 * ค่าอุปกรณ์ให้เช่า (เต็นท์ ถุงนอน ฟืน) เป็น `OTHER` → `OTHER_OPERATED` เพราะเป็น
 * การให้เช่าของ ไม่ใช่ค่าที่พัก ตรงนี้คือตัวที่ทำให้เจ้าของลานเห็นว่ากำไรมาจากการ
 * ขายคืนหรือมาจากการปล่อยเช่าอุปกรณ์
 *
 * ยอดของลานเป็นราคารวมทุกอย่างแล้ว ไม่มีการแยก VAT ในระบบลาน จึงไม่มีบรรทัดภาษี
 */
export function buildCampRevenueInput(
  reservation: CampRevenueRow,
  outlet: CampRevenueOutlet,
): PostRevenueInput {
  const totalPrice = round2(num(reservation.totalPrice));
  const addonTotal = round2(
    (reservation.addonItems ?? []).reduce(
      (sum, item) => sum + item.qty * num(item.priceSnapshot),
      0,
    ),
  );

  // ค่าที่พัก = ยอดรวม − ค่าอุปกรณ์ (ยอดรวมเก็บก้อนเดียว ไม่ได้แยกคอลัมน์ไว้)
  // ถ้าค่าอุปกรณ์เกินยอดรวมเพราะราคาถูกแก้ทีหลัง ให้ค่าที่พักเป็น 0 แล้วตัดค่าอุปกรณ์
  // ลงเท่ายอดรวม — สมุดรายได้ต้องไม่มีวันบันทึกเกินกว่าที่เอกสารบอกว่าเก็บได้
  const lodging = round2(Math.max(totalPrice - addonTotal, 0));
  const addons = round2(Math.min(addonTotal, totalPrice));

  const lines: RevenueLineInput[] = [];
  if (lodging > 0) lines.push({ revenueType: RevenueType.ROOM, grossAmount: lodging });
  if (addons > 0) lines.push({ revenueType: RevenueType.OTHER, grossAmount: addons });
  // การจองยอด 0 (คอมพลิเมนต์) ยังต้องมีแถว ไม่งั้นสมุดจะไม่รู้ว่าจุดนี้เคยถูกใช้
  if (lines.length === 0) lines.push({ revenueType: RevenueType.ROOM, grossAmount: 0 });

  return {
    tenantId: reservation.tenantId ?? '',
    // ลานกางเต็นท์ไม่ผูกกับ property ของโรงแรม — เป็นธุรกิจคนละที่ตั้ง
    propertyId: null,
    sourceModule: RevenueSourceModule.CAMP,
    sourceType: RevenueSourceType.CAMP_RESERVATION,
    sourceId: reservation.id,
    documentNo: reservation.reservationNo,
    occurredAt: reservation.actualCheckOut ?? reservation.checkOut,
    outletId: outlet.campgroundId,
    outletName: outlet.campgroundName,
    settlement: settlementOf(reservation.paymentMethod),
    lines,
  };
}
