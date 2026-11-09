import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  buildBangkokDateTime,
  DEFAULT_CHECK_IN_TIME,
  DEFAULT_CHECK_OUT_TIME,
} from '../common/availability/availability.util';
import { bangkokDayRange, shiftDate, toBangkokDate } from '../common/utils/bangkok-day.util';
import { hotelMap3dSummary, sanitizeHotelMap3dConfig } from '../modules/hotel-map3d/hotel-map3d-config';
import type { HotelMap3dConfig } from '../modules/hotel-map3d/hotel-map3d.types';

/**
 * ข้อมูลเดโม Monitor ห้องพัก 3D ของ Mountain View Resort (premium.test@email.com)
 *
 * ทำไมต้องมีแยก: seedDemoBookings สร้างห้องแค่ 4 ห้องชั้นเดียว และวันที่การจองอิงวันที่รัน seed
 * พอผ่านไปไม่กี่วันทุกใบกลายเป็น "เลยกำหนดเช็คเอาท์" — จอ Monitor เลยดูไม่ออกว่าทำงานยังไง
 *
 * ตัวนี้สร้างอาคาร 5 ชั้น + วิลล่า แล้วจัดสถานการณ์ "วันนี้" ให้ครบทุกสถานะ:
 * เข้าวันนี้ (มี VIP และห้องที่ยังไม่พร้อม) · มีแขกพักต่อ · ออกวันนี้ (มียอดค้าง) · รอทำความสะอาด ·
 * แม่บ้านกำลังทำ · รอตรวจ · ปิดซ่อม (มีแขกจองเข้าทับ) · ปิดขาย · แจ้งซ่อมห้องที่มีแขก
 *
 * รันซ้ำได้ทุกวัน (`npm run seed:hotel-3d`) — ลบเฉพาะข้อมูลที่ติดป้าย [HOTEL3D-DEMO] แล้วสร้างใหม่ตามวันนี้
 * ฉาก 3D ตั้งให้เฉพาะตอนโรงแรมยังไม่เคยเผยแพร่ฉากเอง (ไม่ทับงานที่ผู้ใช้ปรับไว้)
 */
export const HOTEL_DEMO_TENANT_NAME = 'Mountain View Resort (Premium Test)';
export const HOTEL_DEMO_MARK = '[HOTEL3D-DEMO]';
export const DEMO_BOOKING_PREFIX = 'MV3D-';

type RoomSeed = { number: string; type: string; floor: number | null; price: number; maxOccupancy: number };

const TYPE_PRICE: Record<string, number> = { Standard: 1800, Deluxe: 2600, Suite: 4800, 'Pool Villa': 7900 };

/** ชั้น 2–5 ชั้นละ 8 ห้อง (x01–x08) + วิลล่า V01–V04 */
export function demoRoomPlan(): RoomSeed[] {
  const out: RoomSeed[] = [];
  for (let f = 2; f <= 5; f++) {
    for (let i = 1; i <= 8; i++) {
      const type = f === 5 ? (i <= 4 ? 'Suite' : 'Deluxe') : f >= 3 ? (i >= 7 ? 'Suite' : 'Deluxe') : 'Standard';
      out.push({ number: `${f}0${i}`, type, floor: f, price: TYPE_PRICE[type], maxOccupancy: type === 'Suite' ? 4 : 2 });
    }
  }
  for (let i = 1; i <= 4; i++) out.push({ number: `V0${i}`, type: 'Pool Villa', floor: null, price: TYPE_PRICE['Pool Villa'], maxOccupancy: 4 });
  return out;
}

type StayKind = 'arrive' | 'inhouse' | 'depart' | 'future';
interface StaySeed {
  room: string;
  kind: StayKind;
  guest: number;
  nights?: number;
  /** ชำระแล้วกี่ % ของยอด (ค่าเริ่ม: เข้าพัก 100, เข้าวันนี้ 0) */
  paidPct?: number;
  late?: boolean;
}

const GUESTS: { first: string; last: string; phone: string; vip?: boolean; nat?: string }[] = [
  { first: 'Daniel', last: 'Keller', phone: '+41 79 555 0182', vip: true, nat: 'Swiss' },
  { first: 'มานพ', last: 'ศรีสุข', phone: '081-552-0912' },
  { first: 'ณัฐวุฒิ', last: 'บุญมา', phone: '089-114-2290' },
  { first: 'วรรณา', last: 'ลิ้มเจริญ', phone: '086-771-0345', vip: true },
  { first: 'Anna', last: 'Schmidt', phone: '+49 151 2234 778', nat: 'German' },
  { first: 'สุดารัตน์', last: 'ปัญญา', phone: '092-338-1147' },
  { first: 'Kenji', last: 'Tanaka', phone: '+81 90 4410 2231', nat: 'Japanese' },
  { first: 'ปิยะพงษ์', last: 'ทองดี', phone: '084-902-6621' },
  { first: 'Liu', last: 'Wei', phone: '+86 139 0021 4456', nat: 'Chinese' },
  { first: 'ชไมพร', last: 'แก้วกาญจนา', phone: '095-447-1280', vip: true },
  { first: 'Oliver', last: 'Brown', phone: '+44 7700 900461', nat: 'British' },
  { first: 'ธนากร', last: 'วงศ์ใหญ่', phone: '087-651-3309' },
  { first: 'Sophie', last: 'Martin', phone: '+33 6 12 34 56 78', nat: 'French' },
  { first: 'กิตติศักดิ์', last: 'ชัยวัฒน์', phone: '083-227-9014' },
  { first: 'Emma', last: 'Wilson', phone: '+61 412 555 019', nat: 'Australian' },
  { first: 'อรุณี', last: 'สายทอง', phone: '091-662-4473' },
  { first: 'Park', last: 'Min-jun', phone: '+82 10 5521 3398', nat: 'Korean' },
  { first: 'ศุภชัย', last: 'อินทร์แก้ว', phone: '080-145-7782' },
  { first: 'Lucas', last: 'Silva', phone: '+55 11 98765 4321', nat: 'Brazilian' },
  { first: 'พิมพ์ชนก', last: 'รุ่งเรือง', phone: '094-873-2016' },
];

export const DEMO_STAYS: StaySeed[] = [
  // เข้าวันนี้ — 203 ห้องยังสกปรก (แจ้งเตือน "ห้องยังไม่พร้อม"), 305 กับ V02 เป็น VIP
  { room: '203', kind: 'arrive', guest: 0, nights: 3 },
  { room: '305', kind: 'arrive', guest: 3, nights: 2, paidPct: 100 },
  { room: '402', kind: 'arrive', guest: 4, nights: 3 },
  { room: '501', kind: 'arrive', guest: 6, nights: 2, paidPct: 50 },
  { room: 'V02', kind: 'arrive', guest: 9, nights: 4, paidPct: 100 },
  { room: '407', kind: 'arrive', guest: 12, nights: 2 }, // ห้องปิดซ่อม แต่มีแขกจองเข้า → ต้องย้ายห้อง
  // มีแขกพักต่อ
  { room: '201', kind: 'inhouse', guest: 1 },
  { room: '204', kind: 'inhouse', guest: 2 },
  { room: '206', kind: 'inhouse', guest: 5 },
  { room: '207', kind: 'inhouse', guest: 7 }, // มีงานซ่อม (แขกยังพักอยู่)
  { room: '301', kind: 'inhouse', guest: 10, paidPct: 40 },
  { room: '303', kind: 'inhouse', guest: 11 },
  { room: '307', kind: 'inhouse', guest: 13 },
  { room: '404', kind: 'inhouse', guest: 14 },
  { room: '406', kind: 'inhouse', guest: 15 },
  { room: '502', kind: 'inhouse', guest: 16, paidPct: 30 },
  { room: '503', kind: 'inhouse', guest: 17 },
  { room: 'V01', kind: 'inhouse', guest: 18 },
  // ออกวันนี้ — 304 กับ V03 มียอดค้าง, 405 ขอ late check-out
  { room: '202', kind: 'depart', guest: 19 },
  { room: '304', kind: 'depart', guest: 8, paidPct: 60 },
  { room: '405', kind: 'depart', guest: 2, late: true },
  { room: 'V03', kind: 'depart', guest: 5, paidPct: 70 },
  // จองล่วงหน้า (เข้าพรุ่งนี้)
  { room: '208', kind: 'future', guest: 13, nights: 2 },
  { room: '306', kind: 'future', guest: 15, nights: 3 },
];

/** สถานะห้อง + งานแม่บ้าน/ซ่อม ของห้องที่ไม่มีแขก */
const HK_TASKS: { room: string; status: 'pending' | 'in_progress' | 'completed'; maid?: string; type: string; priority: string }[] = [
  { room: '203', status: 'pending', type: 'checkout', priority: 'urgent' },
  { room: '205', status: 'pending', type: 'checkout', priority: 'high' },
  { room: '302', status: 'in_progress', maid: 'พี่แดง', type: 'checkout', priority: 'high' },
  { room: '306', status: 'completed', maid: 'พี่ส้ม', type: 'checkout', priority: 'medium' },
  { room: '403', status: 'pending', maid: 'พี่ส้ม', type: 'deep', priority: 'medium' },
  { room: '505', status: 'completed', maid: 'พี่แดง', type: 'daily', priority: 'low' },
];
const DIRTY_ROOMS = ['203', '205', '302', '403'];
const MAINT: { room: string; title: string; category: string; priority: string; status: string; roomStatus?: string }[] = [
  { room: '407', title: 'แอร์ไม่เย็น มีน้ำหยด', category: 'ac', priority: 'urgent', status: 'in_progress', roomStatus: 'maintenance' },
  { room: '207', title: 'ไฟห้องน้ำกะพริบ', category: 'electrical', priority: 'medium', status: 'pending' },
  { room: '506', title: 'ท่อน้ำทิ้งรั่ว ซ่อมพื้นห้องน้ำ', category: 'plumbing', priority: 'high', status: 'pending', roomStatus: 'out_of_order' },
];

@Injectable()
export class Hotel3dDemoSeeder {
  private readonly logger = new Logger(Hotel3dDemoSeeder.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * เรียกตอน start:dev — รีเฟรชวันละครั้ง (ถ้าวันนี้สร้างไปแล้วจะข้าม)
   * เพื่อไม่ให้ทุกครั้งที่ไฟล์เปลี่ยน/รีสตาร์ต ข้อมูลที่ทดสอบอยู่ (เช่นเพิ่งเช็คอิน) ถูกรีเซ็ตทิ้ง
   */
  async seedDaily(): Promise<void> {
    const { start } = bangkokDayRange(toBangkokDate(new Date()));
    const fresh = await this.prisma.booking.findFirst({
      where: { bookingNo: { startsWith: DEMO_BOOKING_PREFIX }, createdAt: { gte: start } },
      select: { id: true },
    });
    if (fresh) return void this.logger.log('🏨 Hotel 3D demo: วันนี้รีเฟรชแล้ว ข้าม (บังคับรีเซ็ต: npm run seed:hotel-3d)');
    await this.seed();
  }

  async seed(): Promise<void> {
    this.logger.log('🏨 Seeding Hotel Monitor 3D demo (Mountain View Resort)...');
    try {
      const tenant = await this.prisma.tenants.findFirst({ where: { name: HOTEL_DEMO_TENANT_NAME }, select: { id: true } });
      if (!tenant) return void this.logger.warn('  ⚠️ Mountain View tenant not found, skipping');
      const property = await this.prisma.property.findFirst({
        where: { tenantId: tenant.id, deletedAt: null },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
        select: { id: true, map3dConfig: true },
      });
      if (!property) return void this.logger.warn('  ⚠️ Mountain View property not found, skipping');

      const rooms = await this.ensureRooms(tenant.id, property.id);
      await this.clearDemo(tenant.id, property.id, Object.values(rooms));
      const guests = await this.ensureGuests(tenant.id);
      const today = toBangkokDate(new Date());
      const stays = await this.createStays(tenant.id, property.id, rooms, guests, today);
      await this.createTasks(tenant.id, property.id, rooms);
      const placed = await this.ensureScene(property.id, property.map3dConfig, tenant.id);
      this.logger.log(
        `  ✓ ${Object.keys(rooms).length} ห้อง · ${stays} การจอง · ${HK_TASKS.length} งานแม่บ้าน · ${MAINT.length} งานซ่อม${placed ? ' · ตั้งฉาก 3D แล้ว' : ''}`,
      );
    } catch (error) {
      this.logger.warn(`  ⚠️ Hotel 3D demo seed failed: ${(error as Error).message}`);
    }
  }

  /** ห้องตามแผน (upsert ตามเลขห้อง) → map เลขห้อง → { id, price } */
  private async ensureRooms(tenantId: string, propertyId: string) {
    const out: Record<string, { id: string; price: number }> = {};
    for (const r of demoRoomPlan()) {
      const row = await this.prisma.room.upsert({
        where: { propertyId_number: { propertyId, number: r.number } },
        update: { floor: r.floor, type: r.type },
        create: {
          tenantId,
          propertyId,
          number: r.number,
          type: r.type,
          floor: r.floor,
          price: r.price,
          maxOccupancy: r.maxOccupancy,
          status: 'available',
          description: `${r.type} — ห้องเดโม Monitor 3D`,
        },
        select: { id: true, price: true },
      });
      out[r.number] = { id: row.id, price: Number(row.price) };
    }
    return out;
  }

  /** ลบเฉพาะข้อมูลเดโมรอบก่อน แล้วคืนห้องเดโมเป็นว่าง */
  private async clearDemo(tenantId: string, propertyId: string, rooms: { id: string }[]) {
    const roomIds = rooms.map((r) => r.id);
    const mark = { contains: HOTEL_DEMO_MARK };
    // การจองเดโมจำจากเลขจอง (หมายเหตุโชว์ให้พนักงานเห็น จึงไม่ใส่ป้ายไว้ตรงนั้น) — รุ่นแรกที่ติดป้ายในหมายเหตุก็ลบด้วย
    const bookings = await this.prisma.booking.findMany({
      where: { propertyId, OR: [{ bookingNo: { startsWith: DEMO_BOOKING_PREFIX } }, { notes: mark }] },
      select: { id: true },
    });
    const bookingIds = bookings.map((b) => b.id);
    await this.prisma.$transaction([
      this.prisma.housekeepingTask.deleteMany({ where: { tenantId, OR: [{ notes: mark }, { bookingId: { in: bookingIds } }] } }),
      this.prisma.maintenanceTask.deleteMany({ where: { tenantId, propertyId, notes: mark } }),
      this.prisma.guestFolio.deleteMany({ where: { bookingId: { in: bookingIds }, charges: { none: {} }, payments: { none: {} } } }),
      this.prisma.booking.deleteMany({ where: { id: { in: bookingIds }, guestFolios: { none: {} } } }),
      this.prisma.room.updateMany({ where: { id: { in: roomIds } }, data: { status: 'available' } }),
    ]);
  }

  private async ensureGuests(tenantId: string) {
    const ids: string[] = [];
    for (const [i, g] of GUESTS.entries()) {
      const email = `hotel3d.demo${i + 1}@example.com`;
      const found = await this.prisma.guest.findFirst({ where: { tenantId, email }, select: { id: true } });
      const data = { firstName: g.first, lastName: g.last, phone: g.phone, isVip: Boolean(g.vip), vipLevel: g.vip ? 'gold' : null, nationality: g.nat ?? 'Thai' };
      const row = found
        ? await this.prisma.guest.update({ where: { id: found.id }, data, select: { id: true } })
        : await this.prisma.guest.create({ data: { tenantId, email, ...data }, select: { id: true } });
      ids.push(row.id);
    }
    return ids;
  }

  private async createStays(
    tenantId: string,
    propertyId: string,
    rooms: Record<string, { id: string; price: number }>,
    guests: string[],
    today: string,
  ) {
    let n = 0;
    for (const [i, s] of DEMO_STAYS.entries()) {
      const room = rooms[s.room];
      if (!room) continue;
      const g = GUESTS[s.guest];
      const [inOff, nights] =
        s.kind === 'inhouse' ? [-1 - (i % 2), 3 + (i % 2)] : s.kind === 'depart' ? [-2 - (i % 2), 2 + (i % 2)] : s.kind === 'future' ? [1, s.nights ?? 2] : [0, s.nights ?? 2];
      const checkInStr = shiftDate(today, inOff);
      const checkOutStr = shiftDate(checkInStr, nights);
      const total = room.price * nights;
      const paidPct = s.paidPct ?? (s.kind === 'arrive' || s.kind === 'future' ? 0 : 100);
      const paid = Math.round((total * paidPct) / 100);
      const inHouse = s.kind === 'inhouse' || s.kind === 'depart';
      await this.prisma.booking.create({
        data: {
          tenantId,
          propertyId,
          roomId: room.id,
          guestId: guests[s.guest],
          bookingNo: `${DEMO_BOOKING_PREFIX}${String(i + 1).padStart(4, '0')}`,
          guestFirstName: g.first,
          guestLastName: g.last,
          guestPhone: g.phone,
          guestEmail: `hotel3d.demo${s.guest + 1}@example.com`,
          checkIn: new Date(`${checkInStr}T00:00:00.000Z`),
          checkOut: new Date(`${checkOutStr}T00:00:00.000Z`),
          scheduledCheckIn: buildBangkokDateTime(checkInStr, DEFAULT_CHECK_IN_TIME),
          scheduledCheckOut: buildBangkokDateTime(checkOutStr, DEFAULT_CHECK_OUT_TIME),
          actualCheckIn: inHouse ? buildBangkokDateTime(checkInStr, '14:30') : null,
          status: inHouse ? 'checked_in' : 'confirmed',
          requestedLateCheckOut: Boolean(s.late),
          approvedLateCheckOut: Boolean(s.late),
          adults: 2,
          children: 0,
          numberOfGuests: 2,
          totalPrice: total,
          grandTotal: total,
          roomSubtotal: total,
          amountPaid: paid,
          paymentStatus: paid >= total ? 'paid' : paid > 0 ? 'partial' : 'pending',
          source: ['DIRECT', 'BOOKING', 'AGODA', 'WEBSITE', 'PHONE'][i % 5],
          notes: null,
        },
      });
      if (inHouse) await this.prisma.room.update({ where: { id: room.id }, data: { status: 'occupied' } });
      n++;
    }
    return n;
  }

  private async createTasks(tenantId: string, propertyId: string, rooms: Record<string, { id: string }>) {
    const now = new Date();
    for (const no of DIRTY_ROOMS) {
      if (rooms[no]) await this.prisma.room.update({ where: { id: rooms[no].id }, data: { status: 'dirty' } });
    }
    for (const t of HK_TASKS) {
      const room = rooms[t.room];
      if (!room) continue;
      await this.prisma.housekeepingTask.create({
        data: {
          tenantId,
          roomId: room.id,
          type: t.type,
          priority: t.priority,
          status: t.status,
          assignedToName: t.maid ?? null,
          scheduledFor: now,
          actualStartTime: t.status !== 'pending' ? new Date(now.getTime() - 40 * 60_000) : null,
          actualEndTime: t.status === 'completed' ? new Date(now.getTime() - 5 * 60_000) : null,
          completionPercentage: t.status === 'completed' ? 100 : t.status === 'in_progress' ? 60 : 0,
          notes: `${HOTEL_DEMO_MARK} ${t.status === 'completed' ? 'ทำเสร็จ รอหัวหน้าแม่บ้านตรวจ' : 'งานแม่บ้านเดโม'}`,
        },
      });
    }
    for (const m of MAINT) {
      const room = rooms[m.room];
      if (!room) continue;
      await this.prisma.maintenanceTask.create({
        data: {
          tenantId,
          propertyId,
          roomId: room.id,
          title: m.title,
          description: m.title,
          category: m.category,
          priority: m.priority,
          status: m.status,
          requestedDate: now,
          startedAt: m.status === 'in_progress' ? now : null,
          notes: `${HOTEL_DEMO_MARK} งานซ่อมเดโม`,
        },
      });
      if (m.roomStatus) await this.prisma.room.update({ where: { id: room.id }, data: { status: m.roomStatus } });
    }
  }

  /**
   * ฉาก 3D: อาคาร A 5 ชั้น (ชั้น 1 ล็อบบี้) · ปีก B ชั้นเดียวสำหรับห้อง 1xx เดิม · วิลล่าริมสระ
   * ตั้งเฉพาะตอนยังไม่มีฉาก — ผู้ใช้ปรับฉากเองแล้วจะไม่ถูกทับ
   */
  private async ensureScene(propertyId: string, current: Prisma.JsonValue | null, tenantId: string) {
    if (current) return false;
    const all = await this.prisma.room.findMany({ where: { propertyId }, select: { id: true, number: true, floor: true } });
    const byNo = new Map(all.map((r) => [r.number, r.id]));
    const wing = all.filter((r) => r.floor === 1).sort((a, b) => a.number.localeCompare(b.number, 'th', { numeric: true }));
    const slots: Record<string, string> = {};
    for (let f = 2; f <= 5; f++)
      for (let i = 1; i <= 8; i++) {
        const id = byNo.get(`${f}0${i}`);
        if (id) slots[`A:${f}:${i <= 4 ? 0 : 1}:${(i - 1) % 4}`] = id;
      }
    wing.slice(0, 6).forEach((r, i) => (slots[`B:1:0:${i}`] = r.id));
    for (let i = 1; i <= 4; i++) {
      const id = byNo.get(`V0${i}`);
      if (id) slots[`V:1:0:${i - 1}`] = id;
    }
    const raw: HotelMap3dConfig = {
      version: 1,
      site: { widthM: 96, depthM: 74 },
      buildings: [
        { id: 'A', name: 'อาคาร A', preset: 'bar', x: 0, z: -12, rot: 0, floors: 5, per: 4, sides: 2, lobby: true, wall: '#efe9df', roof: 'flat' },
        ...(wing.length
          ? [{ id: 'B', name: 'ปีก B (Garden)', preset: 'bar' as const, x: -32, z: -10, rot: 90, floors: 1, per: Math.max(4, Math.min(6, wing.length)), sides: 1 as const, lobby: false, wall: '#f2e3d8', roof: 'gable' as const }]
          : []),
        { id: 'V', name: 'วิลล่าริมสระ', preset: 'villas', x: 6, z: 20, rot: 0, floors: 1, per: 4, sides: 1, lobby: false, wall: '#f5efe4', roof: 'gable' },
      ],
      slots,
      props: [
        { id: 'pool', t: 'pool', x: 30, z: 4, rot: 0 },
        { id: 'resto', t: 'restaurant', x: 32, z: -16, rot: 0 },
        { id: 'park', t: 'parking', x: -30, z: 22, rot: 0 },
        { id: 'gate', t: 'gate', x: -12, z: 33, rot: 0 },
        { id: 'garden', t: 'garden', x: -14, z: 8, rot: 0 },
        ...[
          [-42, -30],
          [-20, -30],
          [18, -30],
          [42, -28],
          [44, 14],
          [-44, 10],
          [22, 30],
          [-2, 33],
        ].map(([x, z], i) => ({ id: `tree${i}`, t: 'tree' as const, x, z, rot: 0 })),
      ],
    };
    const config = sanitizeHotelMap3dConfig(raw, new Set(all.map((r) => r.id)));
    await this.prisma.property.update({
      where: { id: propertyId },
      data: { map3dConfig: config as unknown as Prisma.InputJsonValue, map3dUpdatedAt: new Date() },
    });
    await this.prisma.hotelMap3dVersion.create({
      data: { tenantId, propertyId, config: config as unknown as Prisma.InputJsonValue, summary: hotelMap3dSummary(config) as unknown as Prisma.InputJsonValue, createdBy: null },
    });
    return true;
  }
}
