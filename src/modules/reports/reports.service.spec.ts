import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { RevenueSourceModule, RevenueSourceType } from '@prisma/client';
import { ReportsService } from './reports.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  RevenueDocument,
  RevenueFilter,
  RevenueQueryService,
} from '../revenue/revenue-query.service';

/**
 * สองเรื่องที่รายงานนี้ต้องไม่พลาด:
 *
 *  - **เงินทุกบาทมาจากสมุดรายได้** ไม่ใช่บวกเองจากตาราง booking/camp_reservations
 *    (เคยเป็นแบบนั้น แล้วยอดไม่ตรงกับหน้าภาพรวมและกับบัญชี)
 *  - **ลานกางเต็นท์ต้องอยู่ในรายงานด้วย** ทั้งยอดรวม กราฟ ถังแยกประเภท และตัวหาร
 *    ของ RevPAR ยกเว้นตอนกรองเฉพาะ property เพราะลานไม่ได้สังกัด property
 */
describe('ReportsService', () => {
  let service: ReportsService;
  let prisma: any;
  let revenue: ReturnType<typeof makeRevenueMock>;

  const TENANT = 'tenant-1';
  const QUERY = { startDate: '2026-07-01', endDate: '2026-07-31' } as any;

  const doc = (
    businessDate: string,
    sourceId: string,
    net: number,
    sourceType: RevenueSourceType = RevenueSourceType.BOOKING,
  ): RevenueDocument => ({
    businessDate,
    sourceType,
    sourceId,
    gross: net,
    discount: 0,
    net,
    serviceCharge: 0,
    tax: 0,
    total: net,
    entries: 1,
  });

  /**
   * สมุดรายได้จำลอง — ตอบจากช่วงวันที่ถูกถามจริง ไม่ใช่ตามลำดับการเรียก
   * เพื่อให้เทสต์ล้มถ้าบริการถามผิดงวด (งวดนี้กับงวดเทียบใช้เมธอดเดียวกัน)
   */
  const makeRevenueMock = (docs: RevenueDocument[] = []) => {
    const inRange = (filter: RevenueFilter) =>
      docs.filter((d) => d.businessDate >= filter.from && d.businessDate <= filter.to);

    return {
      totals: jest.fn(async (filter: RevenueFilter) => {
        const net = inRange(filter).reduce((sum, d) => sum + d.net, 0);
        return { gross: net, discount: 0, net, serviceCharge: 0, tax: 0, total: net, entries: 0 };
      }),
      documents: jest.fn(async (filter: RevenueFilter) => inRange(filter)),
      countDocuments: jest.fn(
        async (filter: RevenueFilter) => new Set(inRange(filter).map((d) => d.sourceId)).size,
      ),
    };
  };

  /** สร้างบริการใหม่โดยให้สมุดมีเอกสารตามที่กำหนด */
  const withLedger = async (docs: RevenueDocument[] = []): Promise<void> => {
    revenue = makeRevenueMock(docs);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: PrismaService, useValue: prisma },
        { provide: RevenueQueryService, useValue: revenue },
      ],
    }).compile();
    service = module.get(ReportsService);
  };

  /** ตัวกรองทุกใบที่บริการยื่นให้สมุด */
  const ledgerFilters = (): RevenueFilter[] =>
    [...revenue.totals.mock.calls, ...revenue.documents.mock.calls].map(
      ([filter]) => filter as RevenueFilter,
    );

  beforeEach(async () => {
    prisma = {
      booking: { findMany: jest.fn().mockResolvedValue([]) },
      campReservation: { findMany: jest.fn().mockResolvedValue([]) },
      room: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]) },
      campPitch: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    await withLedger();
  });

  describe('getRevenueReport', () => {
    it('ต้องมี tenantId', async () => {
      await expect(service.getRevenueReport(QUERY, undefined)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('ถามสมุดรายได้ ไม่ได้บวกเองจากตารางการจอง', async () => {
      await withLedger([doc('2026-07-10', 'b1', 1000)]);

      const res = await service.getRevenueReport(QUERY, TENANT);

      expect(res.totalRevenue).toBe(1000);
      // ตาราง booking ถูกอ่านได้ทางเดียว: ตาม id ที่สมุดชี้มา เพื่อเอาชื่อประเภทห้อง
      for (const [args] of prisma.booking.findMany.mock.calls) {
        expect(args.where.id.in).toEqual(['b1']);
        expect(args.where.tenantId).toBe(TENANT);
      }
    });

    it('รวมรายได้ลานกางเต็นท์เข้ายอดรวมและกราฟ', async () => {
      await withLedger([
        doc('2026-07-10', 'b1', 1000),
        doc('2026-07-20', 'c1', 1980, RevenueSourceType.CAMP_RESERVATION),
      ]);

      const res = await service.getRevenueReport(QUERY, TENANT);

      expect(res.totalRevenue).toBe(2980);
      expect(res.totalBookings).toBe(2);
      expect(res.trend.find((t) => t.date === '2026-07-20')?.revenue).toBe(1980);
      // ทุกวันในช่วงต้องมีแถว ถึงจะเป็นศูนย์
      expect(res.trend).toHaveLength(31);
      expect(res.trend.find((t) => t.date === '2026-07-11')?.revenue).toBe(0);
    });

    it('ขอสมุดเฉพาะรายได้ที่พัก (โรงแรม + ลาน) ไม่ปนร้านอาหาร/ร้านค้า', async () => {
      await service.getRevenueReport(QUERY, TENANT);

      for (const filter of ledgerFilters()) {
        expect(filter.sourceModule).toEqual([
          RevenueSourceModule.HOTEL,
          RevenueSourceModule.CAMP,
        ]);
        expect(filter.tenantId).toBe(TENANT);
      }
    });

    it('เทียบกับงวดก่อนหน้าที่ยาวเท่ากันและจบก่อนวันเริ่มงวดนี้', async () => {
      await withLedger([
        doc('2026-07-10', 'b1', 1500),
        doc('2026-06-10', 'b0', 1000),
      ]);

      const res = await service.getRevenueReport(QUERY, TENANT);

      expect(res.totalRevenue).toBe(1500);
      expect(res.comparison.revenueChange).toBe(500);
      expect(res.comparison.revenueChangePercent).toBe(50);
      expect(ledgerFilters().map((f) => `${f.from}..${f.to}`)).toContain('2026-06-01..2026-06-30');
    });

    it('แยกลานกางเต็นท์เป็นถังของตัวเองใน byRoomType / byChannel และเปอร์เซ็นต์รวมครบ 100', async () => {
      await withLedger([
        doc('2026-07-10', 'b1', 1020),
        doc('2026-07-20', 'c1', 1980, RevenueSourceType.CAMP_RESERVATION),
      ]);
      prisma.booking.findMany.mockResolvedValue([
        { id: 'b1', room: { type: 'Deluxe' }, channel: { name: 'Agoda' } },
      ]);

      const res = await service.getRevenueReport(QUERY, TENANT);

      expect(res.byRoomType?.map((r) => r.roomType)).toEqual(
        expect.arrayContaining(['Deluxe', 'ลานกางเต็นท์']),
      );
      expect(res.byChannel?.find((c) => c.channel === 'ลานกางเต็นท์')?.revenue).toBe(1980);
      // ถังทุกใบมาจากแถวเดียวกับยอดรวม จึงต้องรวมกลับได้พอดี
      expect((res.byRoomType ?? []).reduce((s, r) => s + r.revenue, 0)).toBe(res.totalRevenue);
      expect(Math.round((res.byRoomType ?? []).reduce((s, r) => s + r.percentage, 0))).toBe(100);
    });

    it('นับแปลงกางเต็นท์เป็นตัวหารของ RevPAR ด้วย', async () => {
      prisma.campPitch.count.mockResolvedValue(10);
      await withLedger([doc('2026-07-20', 'c1', 3000, RevenueSourceType.CAMP_RESERVATION)]);

      const res = await service.getRevenueReport(QUERY, TENANT);

      // 3000 / (10 แปลง * 30 วัน) = 10
      expect(res.revpar).toBe(10);
    });

    it('ตัดลานออกเมื่อกรองเฉพาะ property (Campground ไม่มี propertyId)', async () => {
      await service.getRevenueReport({ ...QUERY, propertyId: 'prop-1' }, TENANT);

      // แถวลานในสมุดเก็บ propertyId เป็น null การกรอง property จึงตัดออกให้เอง
      for (const filter of ledgerFilters()) expect(filter.propertyId).toBe('prop-1');
      expect(prisma.campPitch.count).not.toHaveBeenCalled();
    });

    it('ยุบกราฟเป็นรายเดือนได้โดยไม่ทำวันหล่น', async () => {
      await withLedger([
        doc('2026-07-10', 'b1', 1000),
        doc('2026-07-31', 'b2', 500),
      ]);

      const res = await service.getRevenueReport({ ...QUERY, groupBy: 'month' }, TENANT);

      expect(res.trend).toEqual([{ date: '2026-07', revenue: 1500, bookings: 2, adr: 750 }]);
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

    it('ยอมรับแถวที่ tenantId เป็น null ถ้าลานเป็นของ tenant นี้ (ไม่ fail open)', async () => {
      await service.getOccupancyReport(QUERY, TENANT);

      const where = prisma.campReservation.findMany.mock.calls[0][0].where;
      expect(where.OR).toEqual([
        { tenantId: TENANT },
        { tenantId: null, campground: { tenantId: TENANT } },
      ]);
    });

    it('ตัดลานออกเมื่อกรองเฉพาะ property', async () => {
      await service.getOccupancyReport({ ...QUERY, propertyId: 'prop-1' }, TENANT);

      expect(prisma.campReservation.findMany).not.toHaveBeenCalled();
      expect(prisma.campPitch.findMany).not.toHaveBeenCalled();
    });
  });
});
