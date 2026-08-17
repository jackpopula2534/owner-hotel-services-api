/**
 * สถิติของหน้า "รายละเอียดโรงแรม" — เฟส 3 ของแผนสมุดรายได้
 *
 * ตัวเงินทุกตัวบนการ์ดนี้ต้องมาจาก RevenueEntry ที่เดียว ของเดิมบวก
 * `booking.grandTotal` ของใบที่ "สร้าง" เดือนนี้ ซึ่งผิดสองชั้น: ใบที่สร้าง
 * เดือนนี้เพื่อเข้าพักเดือนหน้าก็ถูกนับ และ grandTotal ยังรวม VAT ที่เป็นหนี้
 * ไม่ใช่รายได้ เทสต์ชุดนี้ตรึงไว้ว่าเลขมาจากสมุด ไม่ได้มาจากตารางการจอง
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { RevenueSegment, RevenueSourceModule } from '@prisma/client';
import { PropertiesService } from '../properties.service';
import { RevenueFilter } from '../../revenue/revenue-query.service';
import {
  LedgerRow,
  buildRevenueQueryStub,
  ledgerFiltersOf,
} from '../../revenue/__tests__/revenue-query.stub';

const TENANT = 'tenant-1';
const PROPERTY = 'prop-1';
/** 2026-08-17 12:00 ตามเวลาไทย — เดือนนี้ถึงวันนี้คือ 2026-08-01..2026-08-17 */
const NOW = new Date('2026-08-17T05:00:00.000Z');

const roomRow = (over: Partial<LedgerRow> & Pick<LedgerRow, 'businessDate' | 'sourceId' | 'amount'>): LedgerRow => ({
  sourceModule: RevenueSourceModule.HOTEL,
  segment: RevenueSegment.ROOMS,
  propertyId: PROPERTY,
  ...over,
});

interface PrismaCounts {
  rooms?: Record<string, number>;
  bookings?: number[];
}

function makeService(rows: LedgerRow[] = [], counts: PrismaCounts = {}) {
  const bookingCounts = counts.bookings ?? [0, 0, 0];
  let bookingCall = 0;

  const prisma = {
    property: {
      findFirst: jest.fn(async () => ({
        id: PROPERTY,
        tenantId: TENANT,
        name: 'StaySync Resort',
        _count: { rooms: 12, bookings: 40 },
      })),
    },
    room: {
      count: jest.fn(async (args: any) => {
        const status = args?.where?.status;
        if (!status) return counts.rooms?.total ?? 0;
        const key = typeof status === 'string' ? status : String(status.in?.[0]);
        return counts.rooms?.[key] ?? 0;
      }),
    },
    booking: {
      count: jest.fn(async () => bookingCounts[bookingCall++] ?? 0),
    },
    userTenant: { count: jest.fn(async () => 5) },
  };

  const audit = { log: jest.fn(async () => undefined) };
  const revenue = buildRevenueQueryStub(rows);

  const service = new PropertiesService(prisma as any, audit as any, revenue as any);
  return { service, prisma, revenue };
}

const filterFor = (filters: RevenueFilter[], segment?: RevenueSegment): RevenueFilter | undefined =>
  filters.find((filter) => filter.segment === segment);

describe('PropertiesService.findOne — สถิติตัวเงินอ่านจากสมุดรายได้', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('totalRevenue คือ net ที่รับรู้เดือนนี้ทุกช่องทางของโรงแรมหลังนี้ ไม่ใช่ผลรวมใบจอง', async () => {
    const { service, revenue } = makeService([
      roomRow({ businessDate: '2026-08-02', sourceId: 'bk-1', amount: 3000, tax: 210 }),
      roomRow({ businessDate: '2026-08-10', sourceId: 'bk-2', amount: 5000, discount: 500, tax: 315 }),
      {
        businessDate: '2026-08-11',
        sourceId: 'sale-1',
        amount: 800,
        sourceModule: RevenueSourceModule.RETAIL,
        propertyId: PROPERTY,
      },
    ]);

    const result: any = await service.findOne(PROPERTY, TENANT);

    // 3000 + (5000−500) + 800 — VAT 525 บาทเป็นหนี้สรรพากร ไม่ใช่รายได้
    expect(result.statistics.totalRevenue).toBe(8300);
    // เลขนี้ต้องมาจากสมุด: mock ของ prisma ไม่มี aggregate เลย ถ้าไปบวกเองจะพัง
    expect(revenue.totals).toHaveBeenCalled();
  });

  it('avgDailyRate หารด้วยจำนวนใบที่รับรู้ค่าห้อง — ตัวตั้งกับตัวหารมาจากชุดเดียวกัน', async () => {
    const { service } = makeService([
      roomRow({ businessDate: '2026-08-02', sourceId: 'bk-1', amount: 3000 }),
      roomRow({ businessDate: '2026-08-10', sourceId: 'bk-2', amount: 5000 }),
      // ร้านอาหารในโรงแรมต้องไม่ดันค่าห้องเฉลี่ยขึ้น
      {
        businessDate: '2026-08-11',
        sourceId: 'ord-1',
        amount: 9000,
        sourceModule: RevenueSourceModule.RESTAURANT,
        segment: RevenueSegment.FOOD_BEVERAGE,
        propertyId: PROPERTY,
      },
    ]);

    const result: any = await service.findOne(PROPERTY, TENANT);

    expect(result.statistics.avgDailyRate).toBe(4000);
    expect(result.statistics.totalRevenue).toBe(17000);
  });

  it('ถามสมุดด้วยช่วงเดือนนี้ถึงวันนี้ตามปฏิทินไทย และผูก propertyId เสมอ', async () => {
    const { service, revenue } = makeService();

    await service.findOne(PROPERTY, TENANT);

    const filters = ledgerFiltersOf(revenue);
    expect(filters).not.toHaveLength(0);
    for (const filter of filters) {
      expect(filter).toMatchObject({
        tenantId: TENANT,
        propertyId: PROPERTY,
        from: '2026-08-01',
        to: '2026-08-17',
      });
    }

    // ค่าห้องถามเฉพาะโรงแรม+ห้องพัก ส่วนยอดรวมไม่จำกัดช่องทาง
    expect(filterFor(filters, RevenueSegment.ROOMS)).toMatchObject({
      sourceModule: RevenueSourceModule.HOTEL,
      segment: RevenueSegment.ROOMS,
    });
    expect(filterFor(filters, undefined)?.sourceModule).toBeUndefined();
  });

  it('รายได้ของโรงแรมหลังอื่น และของเดือนก่อน ไม่ถูกนับ', async () => {
    const { service } = makeService([
      roomRow({ businessDate: '2026-07-31', sourceId: 'bk-old', amount: 9999 }),
      roomRow({ businessDate: '2026-08-05', sourceId: 'bk-other', amount: 7777, propertyId: 'prop-2' }),
      roomRow({ businessDate: '2026-08-05', sourceId: 'bk-1', amount: 2000 }),
    ]);

    const result: any = await service.findOne(PROPERTY, TENANT);

    expect(result.statistics.totalRevenue).toBe(2000);
    expect(result.statistics.avgDailyRate).toBe(2000);
  });

  it('เดือนที่ยังไม่มีการรับรู้ ให้ 0 ทั้งคู่ ไม่หารด้วยศูนย์', async () => {
    const { service } = makeService([]);

    const result: any = await service.findOne(PROPERTY, TENANT);

    expect(result.statistics.totalRevenue).toBe(0);
    expect(result.statistics.avgDailyRate).toBe(0);
  });

  it('นับห้องและใบจองยังมาจากโมดูลที่เป็นเจ้าของเอกสาร', async () => {
    const { service } = makeService([], {
      rooms: { total: 20, available: 8, occupied: 10, maintenance: 1, cleaning: 1 },
      bookings: [14, 3, 2],
    });

    const result: any = await service.findOne(PROPERTY, TENANT);

    expect(result.statistics).toMatchObject({
      roomCount: 20,
      availableRooms: 8,
      usedRooms: 10,
      maintenanceRooms: 1,
      cleaningRooms: 1,
      roomUsagePercent: 50,
      monthlyBookings: 14,
      todayCheckIns: 3,
      todayCheckOuts: 2,
      totalUsers: 5,
    });
  });

  it('ไม่มี tenantId ต้องปฏิเสธก่อน ไม่แตะทั้ง DB และสมุด', async () => {
    const { service, prisma, revenue } = makeService();

    await expect(service.findOne(PROPERTY, undefined)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.property.findFirst).not.toHaveBeenCalled();
    expect(ledgerFiltersOf(revenue)).toHaveLength(0);
  });

  it('ไม่พบโรงแรม ต้องโยน 404 โดยไม่ถามสมุด', async () => {
    const { service, prisma, revenue } = makeService();
    prisma.property.findFirst.mockResolvedValueOnce(null as any);

    await expect(service.findOne(PROPERTY, TENANT)).rejects.toBeInstanceOf(NotFoundException);
    expect(ledgerFiltersOf(revenue)).toHaveLength(0);
  });
});
