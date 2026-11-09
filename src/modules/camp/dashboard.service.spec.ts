import { Test, TestingModule } from '@nestjs/testing';
import { RevenueSourceModule, RevenueSourceType, RevenueType, SettlementType } from '@prisma/client';
import { CampDashboardService } from './dashboard.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  RevenueFilter,
  RevenueGroup,
  RevenueQueryService,
} from '../revenue/revenue-query.service';

/**
 * แดชบอร์ดลานกางเต็นท์หลังย้ายมาอ่านเงินจากสมุดรายได้
 *
 * สิ่งที่เทสต์ชุดนี้กันไว้:
 *
 *  - **ยอดทุกตัวมาจากสมุด** ไม่ใช่บวก `totalPrice` เอง (เคยนับตอนเช็คอินด้วยเงื่อนไข
 *    สถานะของตัวเอง ตัวเลขจึงไม่เคยตรงกับรายงานรายได้)
 *  - **ถังทุกใบรวมกลับได้เท่ายอดรวม** เพราะแยกจากแถวเดียวกัน
 *  - **ยอดค้างชำระยังมาจากใบจอง** เป็นลูกหนี้ ไม่ใช่รายได้
 */
describe('CampDashboardService', () => {
  const TENANT = 'tenant-1';
  const CAMP = 'camp-1';
  /** 2026-08-17 12:00 เวลาไทย */
  const NOW = new Date('2026-08-17T05:00:00.000Z');

  let service: CampDashboardService;
  let prisma: any;
  let revenue: ReturnType<typeof makeRevenueMock>;

  /** หนึ่งบรรทัดในสมุดรายได้ — ลานไม่แยก VAT ยอดจึงเป็นก้อนเดียว */
  interface Entry {
    businessDate: string;
    sourceId: string;
    amount: number;
    revenueType?: RevenueType;
    settlement?: SettlementType;
  }

  const entry = (
    businessDate: string,
    sourceId: string,
    amount: number,
    extra: Partial<Entry> = {},
  ): Entry => ({
    businessDate,
    sourceId,
    amount,
    revenueType: RevenueType.ROOM,
    settlement: SettlementType.CASH,
    ...extra,
  });

  const totalsOf = (rows: Entry[]) => {
    const net = rows.reduce((sum, r) => sum + r.amount, 0);
    return { gross: net, discount: 0, net, serviceCharge: 0, tax: 0, total: net, entries: rows.length };
  };

  /**
   * สมุดจำลอง — ตอบตามตัวกรองที่ถูกถามจริง (ช่วงวัน + ชนิดรายได้) ไม่ใช่ตามลำดับ
   * การเรียก เทสต์จึงล้มถ้าบริการถามผิดช่วงหรือลืมกรองชนิด
   */
  const makeRevenueMock = (rows: Entry[] = []) => {
    const inRange = (filter: RevenueFilter) =>
      rows.filter((r) => {
        if (r.businessDate < filter.from || r.businessDate > filter.to) return false;
        if (filter.revenueType !== undefined && r.revenueType !== filter.revenueType) return false;
        return true;
      });

    const groupBy = (filter: RevenueFilter, keyOf: (r: Entry) => string): RevenueGroup[] => {
      const buckets = new Map<string, Entry[]>();
      for (const row of inRange(filter)) {
        const key = keyOf(row);
        buckets.set(key, [...(buckets.get(key) ?? []), row]);
      }
      return [...buckets.entries()].map(([key, group]) => ({ key, ...totalsOf(group) }));
    };

    return {
      totals: jest.fn(async (filter: RevenueFilter) => totalsOf(inRange(filter))),
      byRevenueType: jest.fn(async (filter: RevenueFilter) =>
        groupBy(filter, (r) => String(r.revenueType)),
      ),
      bySettlement: jest.fn(async (filter: RevenueFilter) =>
        groupBy(filter, (r) => String(r.settlement)),
      ),
      byDay: jest.fn(async (filter: RevenueFilter) => groupBy(filter, (r) => r.businessDate)),
      documents: jest.fn(async (filter: RevenueFilter) => {
        const buckets = new Map<string, Entry[]>();
        for (const row of inRange(filter)) {
          const key = `${row.businessDate}:${row.sourceId}`;
          buckets.set(key, [...(buckets.get(key) ?? []), row]);
        }
        return [...buckets.values()].map((group) => ({
          businessDate: group[0].businessDate,
          sourceType: RevenueSourceType.CAMP_RESERVATION,
          sourceId: group[0].sourceId,
          ...totalsOf(group),
        }));
      }),
    };
  };

  /** ตัวกรองทุกใบที่บริการยื่นให้สมุด */
  const ledgerFilters = (): RevenueFilter[] =>
    [
      ...revenue.totals.mock.calls,
      ...revenue.byRevenueType.mock.calls,
      ...revenue.bySettlement.mock.calls,
      ...revenue.byDay.mock.calls,
      ...revenue.documents.mock.calls,
    ].map(([filter]) => filter as RevenueFilter);

  const withLedger = async (rows: Entry[] = []): Promise<void> => {
    revenue = makeRevenueMock(rows);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CampDashboardService,
        { provide: PrismaService, useValue: prisma },
        { provide: RevenueQueryService, useValue: revenue },
      ],
    }).compile();
    service = module.get(CampDashboardService);
  };

  const stats = async (params: { campgroundId?: string; period?: string } = {}) => {
    const res = await service.getStats({ campgroundId: CAMP, ...params }, TENANT);
    return res.data;
  };

  beforeAll(() => {
    jest.useFakeTimers().setSystemTime(NOW);
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  beforeEach(async () => {
    prisma = {
      campReservation: {
        findMany: jest.fn(async (args: any) => {
          // การจอง (มิติโซน) ที่สมุดชี้มา
          if (args?.where?.id?.in) return prisma.__zoneRows;
          // ใบที่ยังเก็บเงินไม่ครบ
          if (args?.where?.status?.in) return prisma.__outstanding;
          return prisma.__reservations;
        }),
      },
      campPitch: { findMany: jest.fn().mockResolvedValue([]) },
      campAddon: { findMany: jest.fn().mockResolvedValue([]) },
      campRequisition: { findMany: jest.fn().mockResolvedValue([]) },
      campFacility: { findMany: jest.fn().mockResolvedValue([]) },
      __reservations: [] as any[],
      __outstanding: [] as any[],
      __zoneRows: [] as any[],
    };
    await withLedger();
  });

  describe('revenue', () => {
    it('เอายอดจากสมุด ไม่ได้บวก totalPrice ของใบจองเอง', async () => {
      prisma.__reservations = [
        {
          id: 'r1',
          status: 'checked_in',
          checkIn: new Date('2026-08-16T07:00:00.000Z'),
          checkOut: new Date('2026-08-18T05:00:00.000Z'),
          createdAt: new Date('2026-08-10T05:00:00.000Z'),
          totalPrice: 99_999,
          amountPaid: 99_999,
          paymentMethod: 'cash',
          numGuests: 2,
          guestFirstName: 'ก',
          guestLastName: 'ข',
          reservationNo: 'CR-1',
          pitch: null,
          addonItems: [],
        },
      ];
      await withLedger([entry('2026-08-15', 'r-old', 1200)]);

      const { revenue: rev } = await stats();

      // ใบที่ยังพักอยู่ (ยังไม่เช็คเอาต์) ไม่ใช่ยอดขาย — สมุดยังไม่รับรู้
      expect(rev.total).toBe(1200);
      expect(rev.netTotal).toBe(1200);
    });

    it('แยกค่าที่พักกับค่าอุปกรณ์ตามชนิดรายได้ แล้วรวมกลับได้เท่ายอดรวม', async () => {
      await withLedger([
        entry('2026-08-15', 'r1', 2000),
        entry('2026-08-15', 'r1', 500, { revenueType: RevenueType.OTHER }),
      ]);

      const { revenue: rev } = await stats();

      expect(rev.addon).toBe(500);
      expect(rev.lodging).toBe(2000);
      expect(rev.lodging + rev.addon).toBe(rev.total);
    });

    it('ค่าที่พักคือส่วนที่เหลือจากยอดรวม แม้มีชนิดรายได้ที่หน้านี้ไม่รู้จัก', async () => {
      await withLedger([
        entry('2026-08-15', 'r1', 2000),
        entry('2026-08-15', 'r1', 300, { revenueType: RevenueType.FOOD }),
        entry('2026-08-15', 'r1', 200, { revenueType: RevenueType.OTHER }),
      ]);

      const { revenue: rev } = await stats();

      expect(rev.total).toBe(2500);
      expect(rev.addon).toBe(200);
      expect(rev.lodging).toBe(2300);
    });

    it('แยกยอดตามโซนโดยต่อ sourceId กลับไปหาใบจอง และรวมกลับได้เท่ายอดรวม', async () => {
      prisma.__zoneRows = [
        { id: 'r1', pitch: { zone: { name: 'ริมน้ำ A', type: 'riverside' } } },
        { id: 'r2', pitch: { zone: { name: 'ลานหญ้า B', type: 'lawn' } } },
      ];
      await withLedger([
        entry('2026-08-15', 'r1', 1000),
        entry('2026-08-16', 'r2', 3000),
      ]);

      const { revenue: rev } = await stats();

      expect(rev.byZone).toEqual([
        { zone: 'ลานหญ้า B', type: 'lawn', revenue: 3000 },
        { zone: 'ริมน้ำ A', type: 'riverside', revenue: 1000 },
      ]);
      expect(rev.byZone.reduce((s, z) => s + z.revenue, 0)).toBe(rev.total);
    });

    it('ใบที่หาโซนไม่เจอยังอยู่ในถัง ไม่หายไปจากยอดแยก', async () => {
      prisma.__zoneRows = [];
      await withLedger([entry('2026-08-15', 'r1', 800)]);

      const { revenue: rev } = await stats();

      expect(rev.byZone).toEqual([{ zone: 'อื่น ๆ', type: 'other', revenue: 800 }]);
      expect(rev.byZone.reduce((s, z) => s + z.revenue, 0)).toBe(rev.total);
    });

    it('อ่านใบจองเพื่อเอาโซนได้เฉพาะ tenant นี้ (ยอมรับแถวเก่าที่ tenantId เป็น null)', async () => {
      await withLedger([entry('2026-08-15', 'r1', 800)]);
      await stats();

      const call = prisma.campReservation.findMany.mock.calls
        .map(([args]: any[]) => args)
        .find((args: any) => args?.where?.id?.in);
      expect(call.where.id.in).toEqual(['r1']);
      expect(call.where.OR).toEqual([
        { tenantId: TENANT },
        { tenantId: null, campground: { tenantId: TENANT } },
      ]);
    });

    it('ไม่ถามใบจองเลยถ้าสมุดไม่มีเอกสารในช่วง', async () => {
      await stats();

      const idLookups = prisma.campReservation.findMany.mock.calls.filter(
        ([args]: any[]) => args?.where?.id?.in,
      );
      expect(idLookups).toHaveLength(0);
    });

    it('ช่องทางรับเงินมาจากสมุด ไม่ใช่ยอดที่เก็บได้บนใบจอง', async () => {
      await withLedger([
        entry('2026-08-15', 'r1', 1000, { settlement: SettlementType.CASH }),
        entry('2026-08-16', 'r2', 3000, { settlement: SettlementType.TRANSFER }),
      ]);

      const { revenue: rev } = await stats();

      expect(rev.byPaymentMethod).toEqual([
        { method: 'TRANSFER', amount: 3000, pct: 75 },
        { method: 'CASH', amount: 1000, pct: 25 },
      ]);
    });

    it('กราฟรายวันเติมวันที่ไม่มียอดให้ครบช่วง trend', async () => {
      await withLedger([
        entry('2026-08-15', 'r1', 1000),
        entry('2026-08-15', 'r1', 200, { revenueType: RevenueType.OTHER }),
      ]);

      const { revenue: rev } = await stats();

      expect(rev.dailyTrend).toHaveLength(7);
      expect(rev.dailyTrend[0].date).toBe('2026-08-11');
      expect(rev.dailyTrend[6].date).toBe('2026-08-17');
      expect(rev.dailyTrend.find((d) => d.date === '2026-08-15')).toEqual({
        date: '2026-08-15',
        lodging: 1000,
        addon: 200,
        revenue: 1200,
      });
      expect(rev.dailyTrend.find((d) => d.date === '2026-08-14')).toEqual({
        date: '2026-08-14',
        lodging: 0,
        addon: 0,
        revenue: 0,
      });
    });

    it('ยอดค้างชำระยังมาจากใบจอง ไม่ใช่สมุด', async () => {
      prisma.__outstanding = [
        {
          id: 'r9',
          reservationNo: 'CR-9',
          guestFirstName: 'ค',
          guestLastName: 'ง',
          totalPrice: 5000,
          amountPaid: 1500,
          checkIn: new Date('2026-08-10T07:00:00.000Z'),
          status: 'confirmed',
        },
      ];
      await withLedger();

      const { revenue: rev } = await stats();

      expect(rev.outstanding).toBe(3500);
      expect(rev.outstandingInvoices[0]).toMatchObject({ id: 'r9', amount: 3500, overdue: true });
    });
  });

  describe('ตัวกรองที่ยื่นให้สมุด', () => {
    it('ถามเฉพาะรายได้ลานของ tenant นี้ และเฉพาะลานที่เลือก', async () => {
      await stats();

      const filters = ledgerFilters();
      expect(filters.length).toBeGreaterThan(0);
      for (const filter of filters) {
        expect(filter.tenantId).toBe(TENANT);
        expect(filter.sourceModule).toBe(RevenueSourceModule.CAMP);
        expect(filter.outletId).toBe(CAMP);
      }
    });

    it('ไม่ล็อกลานใดลานหนึ่งเมื่อไม่ได้ระบุ campgroundId', async () => {
      await service.getStats({}, TENANT);

      for (const filter of ledgerFilters()) expect(filter.outletId).toBeUndefined();
    });

    it('period=today ถาม KPI วันเดียวแต่กราฟยังย้อน 7 วัน', async () => {
      await stats({ period: 'today' });

      const kpi = revenue.totals.mock.calls[0][0] as RevenueFilter;
      expect(kpi).toMatchObject({ from: '2026-08-17', to: '2026-08-17' });
      for (const [filter] of revenue.byDay.mock.calls) {
        expect(filter).toMatchObject({ from: '2026-08-11', to: '2026-08-17' });
      }
    });

    it('period=quarter ถามย้อน 90 วันแบบรวมปลายทั้งสองข้าง', async () => {
      await stats({ period: 'quarter' });

      const kpi = revenue.totals.mock.calls[0][0] as RevenueFilter;
      expect(kpi).toMatchObject({ from: '2026-05-20', to: '2026-08-17' });
    });

    it('ไม่มี tenantId = ตอบโครงเปล่า ไม่แตะสมุดและฐานข้อมูล', async () => {
      const res = await service.getStats({ campgroundId: CAMP }, undefined);

      expect(res.data.revenue).toMatchObject({ total: 0, netTotal: 0, lodging: 0, addon: 0 });
      expect(ledgerFilters()).toHaveLength(0);
      expect(prisma.campReservation.findMany).not.toHaveBeenCalled();
    });
  });

  describe('occupancy', () => {
    it('ADR/RevPAS ใช้ค่าที่พักจากสมุดหารด้วยคืนที่ขายได้', async () => {
      prisma.campPitch.findMany.mockResolvedValue([
        { id: 'p1', status: 'occupied', zone: { name: 'ริมน้ำ', type: 'riverside' } },
        { id: 'p2', status: 'available', zone: { name: 'ริมน้ำ', type: 'riverside' } },
      ]);
      prisma.__reservations = [
        {
          id: 'r1',
          status: 'checked_out',
          checkIn: new Date('2026-08-15T07:00:00.000Z'),
          checkOut: new Date('2026-08-17T05:00:00.000Z'),
          createdAt: new Date('2026-08-10T05:00:00.000Z'),
          totalPrice: 99_999,
          amountPaid: 0,
          paymentMethod: 'cash',
          numGuests: 2,
          guestFirstName: 'ก',
          guestLastName: null,
          reservationNo: 'CR-1',
          pitch: null,
          addonItems: [{ qty: 1, priceSnapshot: 12_345 }],
        },
      ];
      await withLedger([
        entry('2026-08-17', 'r1', 4000),
        entry('2026-08-17', 'r1', 1000, { revenueType: RevenueType.OTHER }),
      ]);

      const { occupancy } = await stats();

      // 2 คืน (15→17) ค่าที่พักจากสมุด 4000 → ADR 2000, RevPAS = 4000 / 2 แปลง
      expect(occupancy.occupiedNights).toBe(2);
      expect(occupancy.adr).toBe(2000);
      expect(occupancy.revpas).toBe(2000);
    });
  });
});
