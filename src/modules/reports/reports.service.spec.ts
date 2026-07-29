import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * ครอบคลุมเฉพาะการรวม "ลานกางเต็นท์" (camp_reservations) เข้ารายงานรายได้/อัตราเข้าพัก
 * ก่อนหน้านี้รายงานอ่านตาราง booking อย่างเดียว รายได้ลานจึงไม่เคยขึ้น
 */
describe('ReportsService — camp integration', () => {
  let service: ReportsService;
  let prisma: any;

  const TENANT = 'tenant-1';
  const QUERY = { startDate: '2026-07-01', endDate: '2026-07-31' } as any;

  beforeEach(async () => {
    prisma = {
      booking: { findMany: jest.fn().mockResolvedValue([]) },
      campReservation: { findMany: jest.fn().mockResolvedValue([]) },
      room: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]) },
      campPitch: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [ReportsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(ReportsService);
  });

  describe('getRevenueReport', () => {
    it('ต้องมี tenantId', async () => {
      await expect(service.getRevenueReport(QUERY, undefined)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('รวมรายได้ลานกางเต็นท์เข้ายอดรวมและกราฟ', async () => {
      prisma.booking.findMany.mockResolvedValue([
        { checkIn: new Date('2026-07-10'), totalPrice: 1000, room: { type: 'Deluxe' }, channel: null },
      ]);
      prisma.campReservation.findMany.mockImplementation(({ where }: any) =>
        where.checkIn?.gte?.getTime() === new Date('2026-07-01').getTime()
          ? Promise.resolve([{ checkIn: new Date('2026-07-20'), totalPrice: 1980 }])
          : Promise.resolve([]),
      );

      const res = await service.getRevenueReport(QUERY, TENANT);

      expect(res.totalRevenue).toBe(2980);
      expect(res.totalBookings).toBe(2);
      const july20 = res.trend.find((t) => t.date === '2026-07-20');
      expect(july20?.revenue).toBe(1980);
    });

    it('แยกลานกางเต็นท์เป็นถังของตัวเองใน byRoomType / byChannel และเปอร์เซ็นต์รวมครบ 100', async () => {
      prisma.booking.findMany.mockResolvedValue([
        {
          checkIn: new Date('2026-07-10'),
          totalPrice: 1020,
          room: { type: 'Deluxe' },
          channel: { name: 'Agoda' },
        },
      ]);
      prisma.campReservation.findMany.mockResolvedValueOnce([
        { checkIn: new Date('2026-07-20'), totalPrice: 1980 },
      ]);

      const res = await service.getRevenueReport(QUERY, TENANT);

      expect(res.byRoomType?.map((r) => r.roomType)).toEqual(
        expect.arrayContaining(['Deluxe', 'ลานกางเต็นท์']),
      );
      expect(res.byChannel?.find((c) => c.channel === 'ลานกางเต็นท์')?.revenue).toBe(1980);
      const total = (res.byRoomType ?? []).reduce((s, r) => s + r.percentage, 0);
      expect(Math.round(total)).toBe(100);
    });

    it('นับแปลงกางเต็นท์เป็นตัวหารของ RevPAR ด้วย', async () => {
      prisma.room.count.mockResolvedValue(0);
      prisma.campPitch.count.mockResolvedValue(10);
      prisma.campReservation.findMany.mockResolvedValueOnce([
        { checkIn: new Date('2026-07-20'), totalPrice: 3000 },
      ]);

      const res = await service.getRevenueReport(QUERY, TENANT);

      // 3000 / (10 แปลง * 30 วัน) = 10
      expect(res.revpar).toBe(10);
    });

    it('ตัดลานออกเมื่อกรองเฉพาะ property (Campground ไม่มี propertyId)', async () => {
      await service.getRevenueReport({ ...QUERY, propertyId: 'prop-1' }, TENANT);

      expect(prisma.campReservation.findMany).not.toHaveBeenCalled();
      expect(prisma.campPitch.count).not.toHaveBeenCalled();
    });

    it('ยอมรับแถวที่ tenantId เป็น null ถ้าลานเป็นของ tenant นี้ (ไม่ fail open)', async () => {
      await service.getRevenueReport(QUERY, TENANT);

      const where = prisma.campReservation.findMany.mock.calls[0][0].where;
      expect(where.OR).toEqual([
        { tenantId: TENANT },
        { tenantId: null, campground: { tenantId: TENANT } },
      ]);
    });
  });

  describe('getOccupancyReport', () => {
    it('นับแปลงกางเต็นท์เป็นหน่วยที่ขายได้ และรวมคืนที่ขายได้ของลาน', async () => {
      prisma.room.findMany.mockResolvedValue([]);
      prisma.campPitch.findMany.mockResolvedValue([
        { id: 'p1', status: 'occupied' },
        { id: 'p2', status: 'available' },
      ]);
      prisma.campReservation.findMany.mockResolvedValueOnce([
        { checkIn: new Date('2026-07-20'), checkOut: new Date('2026-07-22') },
      ]);

      const res = await service.getOccupancyReport(QUERY, TENANT);

      // 2 แปลง * 30 วัน
      expect(res.availableRoomNights).toBe(60);
      expect(res.totalRoomNights).toBe(2);
      expect(res.currentStatus.total).toBe(2);
      expect(res.currentStatus.occupied).toBe(1);
      expect(res.byRoomType?.find((r) => r.roomType === 'ลานกางเต็นท์')?.totalRooms).toBe(2);
    });

    it('ตัดลานออกเมื่อกรองเฉพาะ property', async () => {
      await service.getOccupancyReport({ ...QUERY, propertyId: 'prop-1' }, TENANT);

      expect(prisma.campReservation.findMany).not.toHaveBeenCalled();
      expect(prisma.campPitch.findMany).not.toHaveBeenCalled();
    });
  });
});
