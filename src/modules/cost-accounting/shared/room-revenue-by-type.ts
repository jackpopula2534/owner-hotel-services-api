/**
 * ค่าห้องที่ "รับรู้แล้ว" ในช่วงหนึ่ง แยกตามประเภทห้อง
 *
 * ใช้ร่วมกันระหว่างการปิดงวด (เขียนลง `room_cost_analyses`) กับรายงานต้นทุนห้องแบบ
 * สด ๆ ถ้าสองที่นี้คำนวณคนละแบบ ตัวเลขบนหน้าจอเดียวกันจะเปลี่ยนไปตอนงวดถูกปิด
 *
 * กติกาเดียวกับที่เฟส 3 ใช้ทั้งระบบ: **เงินมาจากสมุดรายได้ มิติที่สมุดไม่เก็บ
 * (ประเภทห้อง) ต่อเอาจากตารางต้นทางด้วย `sourceId`** ยอดที่แยกได้จึงรวมกลับมา
 * เท่ากับยอดค่าห้องของช่วงนั้นพอดี
 *
 * ของเดิมทั้งสองที่บวก `booking.totalPrice` ของใบที่ "กำหนดเช็คอิน" ในเดือนนั้น
 * ซึ่งนับใบที่ถูกยกเลิก ใบที่ยังไม่มาพัก และผลักยอดของการเข้าพักคร่อมเดือนไปไว้ที่
 * เดือนเช็คอินทั้งก้อน
 */
import { RevenueSegment, RevenueSourceModule } from '@prisma/client';
import { round2 } from '@/common/utils/bangkok-day.util';
import { PrismaService } from '@/prisma/prisma.service';
import { RevenueQueryService } from '@/modules/revenue/revenue-query.service';

/** ยอดของประเภทห้องหนึ่งในช่วงที่ถาม */
export interface RoomTypeRevenue {
  /** จำนวนคืนของใบที่รับรู้ในช่วงนี้ — นับใบละครั้ง */
  nights: number;
  /** net (= gross − ส่วนลด) ตามสมุด */
  revenue: number;
}

export interface RoomRevenueScope {
  tenantId: string;
  propertyId: string;
  /** วันธุรกิจไทย 'YYYY-MM-DD' รวมปลายทั้งสองข้าง */
  from: string;
  to: string;
}

const nightsOf = (checkIn: Date, checkOut: Date): number =>
  Math.max(1, Math.ceil((checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24)));

export async function roomRevenueByType(
  prisma: PrismaService,
  revenue: RevenueQueryService,
  scope: RoomRevenueScope,
): Promise<Map<string, RoomTypeRevenue>> {
  const documents = await revenue.documents({
    tenantId: scope.tenantId,
    propertyId: scope.propertyId,
    from: scope.from,
    to: scope.to,
    sourceModule: RevenueSourceModule.HOTEL,
    segment: RevenueSegment.ROOMS,
  });

  const byType = new Map<string, RoomTypeRevenue>();
  if (documents.length === 0) return byType;

  const bookings = await prisma.booking.findMany({
    where: {
      id: { in: [...new Set(documents.map((doc) => doc.sourceId))] },
      tenantId: scope.tenantId,
    },
    select: {
      id: true,
      scheduledCheckIn: true,
      scheduledCheckOut: true,
      room: { select: { type: true } },
    },
  });
  const bookingById = new Map(bookings.map((booking) => [booking.id, booking]));

  // หนึ่งใบอาจมีหลายแถวในสมุด (เช่นถูกกลับรายการข้ามวัน) เงินต้องบวกทุกแถวเพื่อให้
  // ยอดสุทธิถูก แต่จำนวนคืนต้องนับใบละครั้งเดียว
  const countedNights = new Set<string>();

  for (const doc of documents) {
    const booking = bookingById.get(doc.sourceId);
    // ใบที่ถูกลบทิ้งหลังลงสมุดยังต้องนับเงิน ไม่งั้นยอดรวมของช่วงหาย
    const type = booking?.room?.type || 'Unknown';
    const current = byType.get(type) ?? { nights: 0, revenue: 0 };

    let nights = 0;
    if (booking && !countedNights.has(booking.id)) {
      countedNights.add(booking.id);
      nights = nightsOf(booking.scheduledCheckIn, booking.scheduledCheckOut);
    }

    byType.set(type, {
      nights: current.nights + nights,
      revenue: round2(current.revenue + doc.net),
    });
  }

  return byType;
}
