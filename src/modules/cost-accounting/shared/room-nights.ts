/**
 * คืนพักของเดือนหนึ่ง — ตัวหารของ occupancy / RevPAR / ต้นทุนต่อห้องที่ขายได้
 *
 * เป็นตัวเลข **เชิงปฏิบัติการ** ไม่ใช่ตัวเงิน จึงยังนับจากใบจองตามเดิม ไม่ใช่จาก
 * สมุดรายได้ ถ้าไปนับจากสมุด เดือนที่ยังไม่จบจะดูว่างเปล่าเพราะแขกที่ยังไม่เช็คเอาต์
 * ยังไม่มีแถวในสมุด (ค่าห้องรับรู้ทั้งก้อนตอนเช็คเอาต์)
 *
 * เดิมโค้ดชุดนี้ถูกคัดลอกไว้สองที่ (ปิดงวด กับ รายงานต้นทุนห้อง) และทั้งสองที่
 * ตัดเดือนด้วย `new Date(year, month - 1, 1)` ซึ่งเป็น **เวลาท้องถิ่นของเครื่อง**
 * ไม่ใช่เวลาไทย — เครื่องที่รันเป็น UTC จะดึงใบจองของคืนวันสิ้นเดือนก่อนหน้าเข้ามา
 * ด้วย ที่นี่ใช้ `bangkokMonthRange` เหมือนที่เหลือทั้งระบบ
 */
import { bangkokMonthRange, DAY_MS } from '@/common/utils/bangkok-day.util';
import { PrismaService } from '@/prisma/prisma.service';

export interface RoomNightsScope {
  tenantId: string;
  propertyId: string;
  /** 'YYYY-MM' */
  period: string;
}

export interface RoomNights {
  /** ห้องทั้งหมด × จำนวนวันในเดือน = คืนที่ขายได้ */
  totalNights: number;
  /** คืนที่มีคนจองไว้ */
  occupiedNights: number;
  /** เปอร์เซ็นต์ 0–100 */
  rate: number;
}

/** คืนของใบจองหนึ่ง — เข้าพักแล้วออกวันเดียวกันนับเป็น 1 คืน */
export const nightsBetween = (checkIn: Date, checkOut: Date): number =>
  Math.max(1, Math.ceil((checkOut.getTime() - checkIn.getTime()) / DAY_MS));

export async function occupiedRoomNights(
  prisma: PrismaService,
  scope: RoomNightsScope,
): Promise<RoomNights> {
  const { start, end } = bangkokMonthRange(scope.period);
  const daysInMonth = Math.round((end.getTime() - start.getTime()) / DAY_MS);

  const [roomCount, bookings] = await Promise.all([
    prisma.room.count({ where: { propertyId: scope.propertyId } }),
    prisma.booking.findMany({
      where: {
        tenantId: scope.tenantId,
        propertyId: scope.propertyId,
        scheduledCheckIn: { gte: start, lt: end },
      },
      select: { scheduledCheckIn: true, scheduledCheckOut: true },
    }),
  ]);

  // ไม่มีห้อง = ไม่มีคืนให้ขาย ปล่อยเป็น 0 แล้วให้ตัวหารข้างล่างกันเอง ของเดิมเขียน
  // `roomCount || 1` ซึ่งแอบทำให้ property ที่ยังไม่ได้ตั้งห้องได้ RevPAR ออกมาเป็น
  // "รายได้ทั้งเดือน ÷ 31" แทนที่จะเป็น 0
  const totalNights = roomCount * daysInMonth;
  const occupied = bookings.reduce(
    (sum, booking) => sum + nightsBetween(booking.scheduledCheckIn, booking.scheduledCheckOut),
    0,
  );

  return {
    totalNights,
    occupiedNights: occupied,
    rate: totalNights > 0 ? (occupied / totalNights) * 100 : 0,
  };
}
