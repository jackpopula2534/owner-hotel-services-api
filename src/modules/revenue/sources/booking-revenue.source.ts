import { RevenueSourceModule, RevenueSourceType, RevenueType } from '@prisma/client';
import { round2 } from '@/common/utils/bangkok-day.util';
import type { PostRevenueInput, RevenueLineInput } from '../revenue-posting.service';
import { allocateProRata } from '../revenue-allocation.util';
import { settlementOf } from './settlement.util';
import { num, type Money } from './money';

/** แถว Booking เท่าที่การบันทึกรายได้ต้องใช้ */
export interface BookingRevenueRow {
  id: string;
  tenantId: string | null;
  propertyId: string;
  bookingNo: string | null;
  paymentMethod: string | null;
  checkOut: Date;
  actualCheckOut: Date | null;
  totalPrice: Money;
  roomSubtotal: Money;
  serviceChargeAmount: Money;
  vatAmount: Money;
  grandTotal: Money;
}

/** สิ่งที่ Prisma ต้อง select มาให้ {@link buildBookingRevenueInput} ทำงานได้ */
export const BOOKING_REVENUE_SELECT = {
  id: true,
  tenantId: true,
  propertyId: true,
  bookingNo: true,
  paymentMethod: true,
  checkOut: true,
  actualCheckOut: true,
  totalPrice: true,
  roomSubtotal: true,
  serviceChargeAmount: true,
  vatAmount: true,
  grandTotal: true,
} as const;

/**
 * แปลงการจองห้องพักหนึ่งใบเป็นรายการรายได้ที่พร้อมลงสมุด
 *
 * ── ทำไมยอดทั้งก้อนลงวันเช็คเอาต์ ─────────────────────────────────────────
 * การจอง 3 คืนถูกบันทึกเป็นรายได้ครั้งเดียวตอนแขกออก ไม่ได้เฉลี่ยรายคืน เพราะทุก
 * หน้าจอที่มีอยู่ตอนนี้นับรายได้ห้องพักแบบนี้อยู่แล้ว ถ้าสมุดรายได้เปลี่ยนไปเฉลี่ย
 * รายคืน ตัวเลขจะไม่ตรงกับที่ผู้ใช้เห็นมาตลอดทันทีที่เปิดใช้ — และการเถียงกันว่า
 * ยอดไหนถูกจะกลบปัญหาจริงที่งานนี้กำลังแก้
 *
 * (การรับรู้รายคืนทำผ่าน night audit ซึ่งลง `folio_charges` ต่างหาก — จงใจไม่ลง
 * สมุดรายได้ ไม่งั้นค่าห้องจะถูกนับสองรอบ: รอบหนึ่งตอน audit อีกรอบตอนเช็คเอาต์)
 *
 * ── การแตกยอด ──────────────────────────────────────────────────────────────
 * ใช้กติกาเดียวกับที่ `createBookingRevenueJournal` ใช้ลง GL อยู่แล้ว: ถ้าการจอง
 * ไม่มีการแยก VAT/ค่าบริการ (ข้อมูลเก่า) ให้ถือว่า `grandTotal` เป็นค่าห้องทั้งก้อน
 * ถ้าเขียนคนละกติกา สมุดรายได้กับงบการเงินจะให้ยอดค่าห้องคนละค่าตั้งแต่วันแรก
 *
 * @param additionalCharges ยอดรวมรายการเพิ่มเติมบนใบแจ้งหนี้ (invoice_items) —
 *   เป็นค่าบริการที่พนักงานคีย์เข้าบิลห้องเอง ไม่ใช่บิล POS ที่ชาร์จเข้าห้อง
 *   (บิล POS มีแถวของตัวเองในสมุดอยู่แล้ว ถ้านับตรงนี้ด้วยจะซ้ำ)
 */
export function buildBookingRevenueInput(
  booking: BookingRevenueRow,
  additionalCharges = 0,
): PostRevenueInput {
  const roomSubtotal = round2(num(booking.roomSubtotal));
  const serviceCharge = round2(num(booking.serviceChargeAmount));
  const vatAmount = round2(num(booking.vatAmount));
  const grandTotal = round2(num(booking.grandTotal) || num(booking.totalPrice));
  const extras = round2(additionalCharges);

  const hasBreakdown = serviceCharge > 0 || vatAmount > 0;
  const roomGross = hasBreakdown ? roomSubtotal || grandTotal : grandTotal;

  // VAT ของบิลห้องคิดบนค่าห้อง + ค่าบริการ ค่าบริการจึงต้องได้ส่วนแบ่ง VAT ด้วย
  // ไม่งั้นบรรทัดค่าห้องจะแบกภาษีของค่าบริการไปทั้งก้อน แล้วยอดรวมต่อแผนกเพี้ยน
  const vatWeights = serviceCharge > 0 ? [roomGross, serviceCharge] : [roomGross];
  const vatShare = allocateProRata(vatAmount, vatWeights);

  const lines: RevenueLineInput[] = [
    {
      revenueType: RevenueType.ROOM,
      grossAmount: roomGross,
      taxAmount: vatShare[0],
    },
  ];

  if (serviceCharge > 0) {
    lines.push({
      revenueType: RevenueType.SERVICE_CHARGE,
      grossAmount: serviceCharge,
      taxAmount: vatShare[1],
    });
  }

  if (extras > 0) {
    lines.push({
      revenueType: RevenueType.OTHER,
      grossAmount: extras,
    });
  }

  return {
    tenantId: booking.tenantId ?? '',
    propertyId: booking.propertyId,
    sourceModule: RevenueSourceModule.HOTEL,
    sourceType: RevenueSourceType.BOOKING,
    sourceId: booking.id,
    documentNo: booking.bookingNo,
    // เวลาเช็คเอาต์จริงคือเวลาที่บิลปิด การจองที่ยังไม่ได้กดเช็คเอาต์ (backfill
    // ของข้อมูลเก่า) ใช้วันออกตามกำหนดแทน
    occurredAt: booking.actualCheckOut ?? booking.checkOut,
    settlement: settlementOf(booking.paymentMethod),
    lines,
  };
}
