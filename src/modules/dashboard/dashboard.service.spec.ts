/**
 * ไทล์ตัวเลขบนแดชบอร์ดโรงแรม — ตัวเงินมาจากสมุดรายได้ ตัวนับมาจากตารางการจอง
 *
 * ที่ต้องตรึงไว้คือ "ตัวตั้งกับตัวหารต้องมาจากประชากรชุดเดียวกัน" ADR เคยเอา
 * ค่าห้องที่สมุดรับรู้วันนี้ (ซึ่งรับรู้ทั้งก้อนตอนเช็คเอาต์) ไปหารด้วยจำนวนห้องที่มี
 * คนพัก "คืนนี้" — คนละชุดกันคนละคำถาม เข้าพัก 3 คืนเช็คเอาต์เช้านี้จึงถูกหารด้วย
 * ห้องของแขกอีกกลุ่มที่ยังไม่จ่าย ตัวเลขที่ได้ไม่ใช่ราคาห้องของใคร
 *
 * RevPAR หารด้วยจำนวนห้องทั้งหมดตามนิยาม จึงยังใช้ตัวนับจากตารางห้องต่อไป
 */
import { RevenueSegment, RevenueSourceModule, RevenueSourceType, RevenueType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RevenueQueryService } from '../revenue/revenue-query.service';
import { buildRevenueQueryStub, LedgerRow } from '../revenue/__tests__/revenue-query.stub';
import { DashboardService } from './dashboard.service';

const TENANT = 'tenant-1';
const PROPERTY = 'prop-1';
const TODAY = '2026-08-17';
const YESTERDAY = '2026-08-16';

/** บ่ายโมงตรงเวลาไทยของวันที่ 17 — UTC ยังเป็นเช้าวันเดียวกัน */
const NOW = new Date('2026-08-17T06:00:00.000Z');

const roomRow = (sourceId: string, amount: number, businessDate: string): LedgerRow => ({
  businessDate,
  sourceId,
  amount,
  sourceType: RevenueSourceType.BOOKING,
  sourceModule: RevenueSourceModule.HOTEL,
  segment: RevenueSegment.ROOMS,
  revenueType: RevenueType.ROOM,
  propertyId: PROPERTY,
});

/** ค่าใช้จ่ายอื่นในโรงแรมที่ไม่ใช่ค่าห้อง เช่นมินิบาร์ — เข้ายอดรวม แต่ไม่เข้า ADR */
const extraRow = (sourceId: string, amount: number, businessDate: string): LedgerRow => ({
  businessDate,
  sourceId,
  amount,
  sourceType: RevenueSourceType.BOOKING,
  sourceModule: RevenueSourceModule.HOTEL,
  segment: RevenueSegment.OTHER_OPERATED,
  revenueType: RevenueType.OTHER,
  propertyId: PROPERTY,
});

interface Counts {
  totalRooms?: number;
  /** ห้องที่มีคนพักคืนนี้ */
  occupiedTonight?: number;
  occupiedYesterday?: number;
  arrivals?: number;
  departures?: number;
}

function makeService(rows: LedgerRow[], counts: Counts = {}) {
  const {
    totalRooms = 10,
    occupiedTonight = 0,
    occupiedYesterday = 0,
    arrivals = 0,
    departures = 0,
  } = counts;

  const bookingCount = jest.fn(async ({ where }: { where: Record<string, any> }) => {
    if (where.checkIn?.gte) return arrivals;
    if (where.checkOut?.gte && where.checkOut?.lt) return departures;
    // ของเมื่อวานถามด้วย status หลายค่า ของคืนนี้ถามด้วยค่าเดียว
    if (typeof where.status === 'object') return occupiedYesterday;
    return occupiedTonight;
  });

  const prisma = {
    room: { count: jest.fn(async () => totalRooms) },
    booking: {
      count: bookingCount,
      aggregate: jest.fn(async () => ({ _sum: { numberOfGuests: 0 } })),
    },
  } as unknown as PrismaService;

  const revenue = buildRevenueQueryStub(rows);
  return {
    service: new DashboardService(prisma, revenue as unknown as RevenueQueryService),
    revenue,
  };
}

describe('DashboardService.getMetrics', () => {
  beforeAll(() => {
    jest.useFakeTimers().setSystemTime(NOW);
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  it('ADR หารด้วยใบที่รับรู้ค่าห้องวันนี้ ไม่ใช่ห้องที่มีคนพักคืนนี้', async () => {
    // เข้าพัก 3 คืน 9,000 เช็คเอาต์เช้านี้ = สมุดรับรู้ใบเดียววันนี้
    // ขณะที่ยังมีแขกพักอยู่ 6 ห้อง — ถ้าหารด้วย 6 จะได้ 1,500 ซึ่งไม่ใช่ราคาห้องของใครเลย
    const { service } = makeService([roomRow('bk-1', 9000, TODAY)], {
      totalRooms: 10,
      occupiedTonight: 6,
    });

    const metrics = await service.getMetrics(TENANT, PROPERTY);

    expect(metrics.adr).toBe(9000);
    expect(metrics.occupancyRate).toBe(60);
  });

  it('ADR นับเฉพาะค่าห้อง มินิบาร์เข้ายอดรวมของวันแต่ไม่เข้า ADR', async () => {
    const { service } = makeService(
      [roomRow('bk-1', 4000, TODAY), extraRow('bk-1', 600, TODAY)],
      { occupiedTonight: 1 },
    );

    const metrics = await service.getMetrics(TENANT, PROPERTY);

    expect(metrics.todayRevenue).toBe(4600);
    expect(metrics.adr).toBe(4000);
  });

  it('RevPAR หารด้วยจำนวนห้องทั้งหมดตามนิยาม', async () => {
    const { service } = makeService(
      [roomRow('bk-1', 4000, TODAY), roomRow('bk-2', 6000, TODAY)],
      { totalRooms: 10, occupiedTonight: 2 },
    );

    const metrics = await service.getMetrics(TENANT, PROPERTY);

    expect(metrics.adr).toBe(5000);
    expect(metrics.revpar).toBe(1000);
  });

  it('เทียบกับเมื่อวานด้วยกติกาเดียวกันทั้งสองวัน', async () => {
    const { service } = makeService(
      [
        roomRow('bk-1', 9000, TODAY),
        roomRow('bk-2', 3000, YESTERDAY),
        roomRow('bk-3', 3000, YESTERDAY),
      ],
      { occupiedTonight: 1, occupiedYesterday: 4 },
    );

    const metrics = await service.getMetrics(TENANT, PROPERTY);

    // เมื่อวาน 6,000 จากสองใบ = 3,000 ต่อใบ วันนี้ 9,000 จากใบเดียว
    expect(metrics.adrTrend).toBe(200);
    expect(metrics.revenueTrend).toBe(50);
  });

  it('ถามสมุดเป็นวันไทย และแยกตัวกรองค่าห้องออกจากยอดรวมของโรงแรม', async () => {
    const { service, revenue } = makeService([roomRow('bk-1', 9000, TODAY)]);

    await service.getMetrics(TENANT, PROPERTY);

    const [allToday, , roomsToday] = revenue.totalsOfMany.mock.calls[0][0];
    expect(allToday).toEqual({
      tenantId: TENANT,
      propertyId: PROPERTY,
      from: TODAY,
      to: TODAY,
      sourceModule: RevenueSourceModule.HOTEL,
      revenueType: undefined,
    });
    expect(roomsToday).toMatchObject({ from: TODAY, to: TODAY, revenueType: RevenueType.ROOM });
    // จำนวนใบต้องนับด้วยตัวกรองใบเดียวกับตัวตั้งของ ADR
    expect(revenue.countDocuments).toHaveBeenCalledWith(roomsToday);
  });

  it('วันที่ยังไม่มีรายได้เลยได้ศูนย์ ไม่ใช่ NaN', async () => {
    const { service } = makeService([], { totalRooms: 0, occupiedTonight: 0 });

    const metrics = await service.getMetrics(TENANT, PROPERTY);

    expect(metrics).toMatchObject({ adr: 0, revpar: 0, todayRevenue: 0, adrTrend: 0 });
  });

  it('ไม่มี tenant = ไม่ถามสมุดเลย', async () => {
    const { service, revenue } = makeService([roomRow('bk-1', 9000, TODAY)]);

    const metrics = await service.getMetrics(undefined, PROPERTY);

    expect(metrics.todayRevenue).toBe(0);
    expect(revenue.totalsOfMany).not.toHaveBeenCalled();
  });
});
