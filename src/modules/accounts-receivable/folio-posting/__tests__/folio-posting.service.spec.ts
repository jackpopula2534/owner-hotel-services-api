/**
 * ตาข่ายรับเงินที่เคยหาย
 *
 * POS กับร้านค้ารับ ROOM_CHARGE โดยไม่เคยสร้าง FolioCharge เลย แขกเซ็นชื่อแล้ว
 * ไม่มีใครเก็บเงินตอนเช็คเอาต์ สเปกชุดนี้ตรึงกติกาที่กันไม่ให้เกิดซ้ำ:
 *
 *   1. ห้องที่ชี้ไม่ได้ชัดเจน = ปฏิเสธการชาร์จ (ไม่ใช่เดาแล้วปล่อยผ่าน)
 *   2. ยิงซ้ำต้องไม่คิดเงินสองรอบ (idempotent บน sourceType+sourceId)
 *   3. ยอดที่ลง folio ต้องบวกเข้า balance เสมอ
 */
import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FolioPostingService, FOLIO_SOURCE_TYPE } from '../folio-posting.service';
import { PrismaService } from '@/prisma/prisma.service';

const TENANT = 'tenant-1';
const USER = 'user-1';
const ORDER = 'order-1';

const BOOKING = {
  id: 'booking-1',
  tenantId: TENANT,
  propertyId: 'prop-1',
  roomId: 'room-1',
  guestId: 'guest-1',
  guestFirstName: 'สมชาย',
  guestLastName: 'ใจดี',
  guestEmail: null,
  guestPhone: null,
  checkIn: new Date('2026-08-13T07:00:00.000Z'),
  status: 'checked_in',
};

const FOLIO = {
  id: 'folio-1',
  folioNo: 'FOLIO-202608-000001',
  tenantId: TENANT,
  propertyId: 'prop-1',
  bookingId: BOOKING.id,
  guestId: BOOKING.guestId,
  status: 'OPEN',
};

function buildPrisma() {
  const mock: any = {
    folioCharge: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    guestFolio: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    booking: { findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn() },
    guest: { create: jest.fn() },
    documentSequence: { upsert: jest.fn() },
  };
  mock.$transaction = jest.fn((cb: any) => cb(mock));

  mock.folioCharge.findFirst.mockResolvedValue(null);
  mock.folioCharge.create.mockImplementation(({ data }: any) => ({ id: 'charge-1', ...data }));
  mock.guestFolio.findFirst.mockResolvedValue(FOLIO);
  mock.guestFolio.update.mockResolvedValue({});
  mock.booking.findFirst.mockResolvedValue(BOOKING);
  mock.booking.findMany.mockResolvedValue([BOOKING]);
  mock.documentSequence.upsert.mockResolvedValue({ lastNumber: 1 });
  return mock;
}

async function makeService(prisma: any): Promise<FolioPostingService> {
  const moduleRef = await Test.createTestingModule({
    providers: [FolioPostingService, { provide: PrismaService, useValue: prisma }],
  }).compile();
  return moduleRef.get(FolioPostingService);
}

const input = (over: Record<string, unknown> = {}) => ({
  tenantId: TENANT,
  chargeType: 'FB_CHARGE' as const,
  description: 'ร้านอาหาร — บิล ORD-1',
  netAmount: 200,
  vatRate: 7,
  vatAmount: 14,
  totalAmount: 214,
  sourceType: FOLIO_SOURCE_TYPE.RESTAURANT_ORDER,
  sourceId: ORDER,
  postedBy: USER,
  ...over,
});

describe('FolioPostingService', () => {
  describe('postCharge — ชี้ห้องให้ได้ก่อน', () => {
    it('รับ bookingId ตรง ๆ แล้วลงรายการเข้า folio ที่เปิดอยู่', async () => {
      const prisma = buildPrisma();
      const service = await makeService(prisma);

      const posted = await service.postCharge(input({ bookingId: BOOKING.id }));

      expect(posted).toMatchObject({
        folioId: FOLIO.id,
        chargeId: 'charge-1',
        bookingId: BOOKING.id,
        alreadyPosted: false,
      });
      expect(prisma.folioCharge.create.mock.calls[0][0].data).toMatchObject({
        tenantId: TENANT,
        folioId: FOLIO.id,
        totalAmount: 214,
        sourceType: 'RESTAURANT_ORDER',
        sourceId: ORDER,
        status: 'POSTED',
      });
      // ยอดต้องไปโผล่ที่ balance ไม่ใช่แค่สร้างแถวทิ้งไว้
      expect(prisma.guestFolio.update).toHaveBeenCalledWith({
        where: { id: FOLIO.id },
        data: { totalCharges: { increment: 214 }, balance: { increment: 214 } },
      });
    });

    it('ชาร์จเข้าการจองที่เช็คเอาต์แล้วไม่ได้', async () => {
      const prisma = buildPrisma();
      prisma.booking.findFirst.mockResolvedValue({ ...BOOKING, status: 'checked_out' });
      const service = await makeService(prisma);

      await expect(service.postCharge(input({ bookingId: BOOKING.id }))).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.folioCharge.create).not.toHaveBeenCalled();
    });

    it('ชาร์จข้าม tenant ไม่ได้ — booking ของ tenant อื่นอ่านเป็นไม่พบ', async () => {
      const prisma = buildPrisma();
      prisma.booking.findFirst.mockResolvedValue(null);
      const service = await makeService(prisma);

      await expect(service.postCharge(input({ bookingId: 'booking-ของคนอื่น' }))).rejects.toThrow(
        'ไม่พบการจองห้องพักนี้ในองค์กรของคุณ',
      );
      // where ต้องมี tenantId เสมอ — Booking ไม่ได้อยู่ใน tenant-scope registry
      expect(prisma.booking.findFirst.mock.calls[0][0].where).toMatchObject({ tenantId: TENANT });
    });

    it('เลขห้องที่ไม่มีแขกเช็คอินอยู่ = ปฏิเสธ ไม่ใช่ปล่อยผ่าน', async () => {
      const prisma = buildPrisma();
      prisma.booking.findMany.mockResolvedValue([]);
      const service = await makeService(prisma);

      await expect(service.postCharge(input({ roomNumber: '999' }))).rejects.toThrow(
        'ห้อง 999 ไม่มีแขกที่เช็คอินอยู่ จึงชาร์จเข้าห้องไม่ได้',
      );
      expect(prisma.folioCharge.create).not.toHaveBeenCalled();
    });

    it('เลขห้องที่ตรงหลายการจอง = ให้คนขายเลือกเอง ห้ามเดา', async () => {
      const prisma = buildPrisma();
      prisma.booking.findMany.mockResolvedValue([BOOKING, { ...BOOKING, id: 'booking-2' }]);
      const service = await makeService(prisma);

      await expect(service.postCharge(input({ roomNumber: '101' }))).rejects.toThrow(
        /มากกว่า 1 รายการ/,
      );
      expect(prisma.folioCharge.create).not.toHaveBeenCalled();
    });

    it('ไม่ระบุทั้ง bookingId และเลขห้อง = ปฏิเสธ', async () => {
      const prisma = buildPrisma();
      const service = await makeService(prisma);

      await expect(service.postCharge(input())).rejects.toThrow(BadRequestException);
    });

    // สถานะอย่างเดียวไม่พอ: การจอง confirmed ของเดือนหน้าก็ผ่านเงื่อนไขสถานะ
    // ถ้าไม่คุมช่วงวัน ห้องที่ว่างวันนี้แต่มีคนจองไว้ล่วงหน้าจะดูดยอดวันนี้เข้าไป
    it('หาห้องด้วยเลขห้อง ต้องกรองเฉพาะการจองที่คาบเกี่ยววันนี้', async () => {
      const prisma = buildPrisma();
      const service = await makeService(prisma);

      await service.postCharge(input({ roomNumber: '101' }));

      const where = prisma.booking.findMany.mock.calls[0][0].where;
      expect(where.status).toEqual({ in: ['checked_in', 'confirmed'] });
      const [dateWindow] = where.AND;
      expect(dateWindow.OR).toEqual([
        { checkIn: { lt: expect.any(Date) }, checkOut: { gte: expect.any(Date) } },
        {
          scheduledCheckIn: { lt: expect.any(Date) },
          scheduledCheckOut: { gte: expect.any(Date) },
        },
      ]);
    });
  });

  describe('listChargeableRooms — จอต้องเสนอเฉพาะห้องที่โพสต์ได้จริง', () => {
    const roomBooking = {
      ...BOOKING,
      room: { number: '101' },
      guest: { firstName: 'Marco', lastName: 'Rossi' },
    };

    it('คืนเฉพาะการจองที่ชาร์จได้ พร้อม bookingId ให้จอส่งกลับมา', async () => {
      const prisma = buildPrisma();
      prisma.booking.findMany.mockResolvedValue([roomBooking]);
      const service = await makeService(prisma);

      await expect(
        service.listChargeableRooms({ tenantId: TENANT, propertyId: 'prop-1' }),
      ).resolves.toEqual([
        { roomNumber: '101', guestName: 'Marco Rossi', bookingId: BOOKING.id, status: 'checked_in' },
      ]);

      const where = prisma.booking.findMany.mock.calls[0][0].where;
      expect(where).toMatchObject({ tenantId: TENANT, propertyId: 'prop-1' });
      expect(where.status).toEqual({ in: ['checked_in', 'confirmed'] });
    });

    // ค้นหาเคยถูกเขียนลง where.OR ทับเงื่อนไขช่วงวัน พอพิมพ์ค้นหาทีเดียว
    // การจองเดือนหน้าก็โผล่ขึ้นมาให้เลือก
    it('พิมพ์ค้นหาแล้วเงื่อนไขช่วงวันต้องไม่หายไป', async () => {
      const prisma = buildPrisma();
      prisma.booking.findMany.mockResolvedValue([roomBooking]);
      const service = await makeService(prisma);

      await service.listChargeableRooms({ tenantId: TENANT, search: '101' });

      const where = prisma.booking.findMany.mock.calls[0][0].where;
      expect(where.AND).toHaveLength(2);
      expect(where.AND[0].OR[0]).toHaveProperty('checkIn');
      expect(where.AND[1].OR).toContainEqual({ room: { number: { contains: '101' } } });
    });

    it('การจองที่ยังไม่ผูกห้องไม่ต้องเอามาให้เลือก — ชาร์จเข้าห้องไม่ได้อยู่ดี', async () => {
      const prisma = buildPrisma();
      prisma.booking.findMany.mockResolvedValue([{ ...roomBooking, room: null }]);
      const service = await makeService(prisma);

      await expect(service.listChargeableRooms({ tenantId: TENANT })).resolves.toEqual([]);
    });
  });

  describe('postCharge — ยิงซ้ำต้องไม่คิดเงินสองรอบ', () => {
    it('คืนรายการเดิมเมื่อ (sourceType, sourceId) เคยลงไปแล้ว', async () => {
      const prisma = buildPrisma();
      prisma.folioCharge.findFirst.mockResolvedValue({ id: 'charge-เดิม', folioId: FOLIO.id });
      const service = await makeService(prisma);

      const posted = await service.postCharge(input({ bookingId: BOOKING.id }));

      expect(posted).toMatchObject({ chargeId: 'charge-เดิม', alreadyPosted: true });
      expect(prisma.folioCharge.create).not.toHaveBeenCalled();
      expect(prisma.guestFolio.update).not.toHaveBeenCalled();
    });
  });

  describe('postCharge — เปิด folio ให้อัตโนมัติ', () => {
    it('สร้าง folio ใหม่พร้อมเลขจาก document_sequences เมื่อการจองยังไม่มีบิล', async () => {
      const prisma = buildPrisma();
      prisma.guestFolio.findFirst.mockResolvedValue(null);
      prisma.guestFolio.create.mockImplementation(({ data }: any) => ({ id: 'folio-ใหม่', ...data }));
      const service = await makeService(prisma);

      await service.postCharge(input({ bookingId: BOOKING.id }));

      const created = prisma.guestFolio.create.mock.calls[0][0].data;
      expect(created).toMatchObject({
        tenantId: TENANT,
        bookingId: BOOKING.id,
        guestId: BOOKING.guestId,
        status: 'OPEN',
        balance: 0,
      });
      expect(created.folioNo).toMatch(/^FOLIO-\d{6}-000001$/);
    });

    it('เติมรายการเข้าบิลที่ปิดไปแล้วไม่ได้', async () => {
      const prisma = buildPrisma();
      prisma.guestFolio.findFirst
        .mockResolvedValueOnce(null) // ไม่มีที่ OPEN
        .mockResolvedValueOnce({ status: 'CLOSED', folioNo: 'FOLIO-202608-000001' });
      const service = await makeService(prisma);

      await expect(service.postCharge(input({ bookingId: BOOKING.id }))).rejects.toThrow(
        /ถูกปิดแล้ว/,
      );
      expect(prisma.guestFolio.create).not.toHaveBeenCalled();
    });

    // GuestFolio.guestId บังคับ แต่ Booking.guestId เป็น null ได้ — ถ้าไม่ปะรอยนี้
    // walk-in ที่จองโดยไม่มีโปรไฟล์แขกจะชาร์จเข้าห้องไม่ได้เลย
    it('สร้างโปรไฟล์แขกจากชื่อบนใบจองเมื่อการจองยังไม่ผูกแขก', async () => {
      const prisma = buildPrisma();
      prisma.booking.findFirst.mockResolvedValue({ ...BOOKING, guestId: null });
      prisma.guestFolio.findFirst.mockResolvedValue(null);
      prisma.guestFolio.create.mockImplementation(({ data }: any) => ({ id: 'folio-ใหม่', ...data }));
      prisma.guest.create.mockResolvedValue({ id: 'guest-ใหม่' });
      const service = await makeService(prisma);

      const posted = await service.postCharge(input({ bookingId: BOOKING.id }));

      expect(prisma.guest.create.mock.calls[0][0].data).toMatchObject({
        tenantId: TENANT,
        firstName: 'สมชาย',
        lastName: 'ใจดี',
      });
      // ผูกกลับเข้าใบจอง ไม่ใช่สร้างแขกใหม่ทุกครั้งที่ขายของ
      expect(prisma.booking.update).toHaveBeenCalledWith({
        where: { id: BOOKING.id },
        data: { guestId: 'guest-ใหม่' },
      });
      expect(posted.guestId).toBe('guest-ใหม่');
    });
  });

  describe('reverseCharge', () => {
    it('กลับรายการแล้วลด balance ของ folio ลงเท่ายอดเดิม', async () => {
      const prisma = buildPrisma();
      prisma.folioCharge.findFirst.mockResolvedValue({
        id: 'charge-1',
        folioId: FOLIO.id,
        totalAmount: 214,
      });
      const service = await makeService(prisma);

      const reversed = await service.reverseCharge(
        TENANT,
        FOLIO_SOURCE_TYPE.RESTAURANT_ORDER,
        ORDER,
        USER,
      );

      expect(reversed).toBe(true);
      expect(prisma.folioCharge.update.mock.calls[0][0].data).toMatchObject({
        status: 'REVERSED',
        isReversed: true,
        reversedBy: USER,
      });
      expect(prisma.guestFolio.update).toHaveBeenCalledWith({
        where: { id: FOLIO.id },
        data: { totalCharges: { decrement: 214 }, balance: { decrement: 214 } },
      });
    });

    it('เป็น no-op เมื่อไม่เคยมีรายการถูกโพสต์ — คนเรียกไม่ต้องเช็คก่อน', async () => {
      const prisma = buildPrisma();
      prisma.folioCharge.findFirst.mockResolvedValue(null);
      const service = await makeService(prisma);

      await expect(
        service.reverseCharge(TENANT, FOLIO_SOURCE_TYPE.RETAIL_SALE, 'sale-1', USER),
      ).resolves.toBe(false);
      expect(prisma.folioCharge.update).not.toHaveBeenCalled();
    });
  });
});
