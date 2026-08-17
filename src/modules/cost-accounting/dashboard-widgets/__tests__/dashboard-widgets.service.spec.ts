/**
 * กราฟแนวโน้มรายรับของหน้าบัญชีต้นทุน — วันที่ยังไม่ปิดยอดต้องไม่เป็นศูนย์
 *
 * ของเดิมกราฟอ่านจาก `cost_kpi_snapshots` อย่างเดียว วันไหนไม่มีแถวก็เติมศูนย์
 * ยอดที่เพิ่งโพสต์เข้าสมุดวันนี้จึงไม่มีวันขึ้นกราฟจนกว่า job ปิดยอดรายวันจะวิ่ง
 * (และ tenant ที่ไม่เคยรัน job เลยเห็นกราฟแบนราบตลอดกาลทั้งที่ขายได้ทุกวัน)
 * กติกาใหม่เหมือน `KpiSnapshotsService.getSnapshot`: สแนปช็อตชนะเมื่อมี
 * ไม่มีก็คิดสดจากสมุด
 *
 * อีกอย่างที่ตรึงไว้: ช่วงของกราฟจบที่ "วันนี้" ของเวลาไทย ของเดิมนับจากเที่ยงคืน
 * ของเครื่องแล้ววน `days` รอบ กราฟจึงจบที่เมื่อวาน วันนี้ตกขอบไปทั้งใบ
 */
import { RevenueSegment, RevenueSourceModule, RevenueSourceType } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { RevenueQueryService } from '@/modules/revenue/revenue-query.service';
import { buildRevenueQueryStub, LedgerRow } from '@/modules/revenue/__tests__/revenue-query.stub';
import { KpiSnapshotsService } from '../../kpi-snapshots/kpi-snapshots.service';
import { DashboardWidgetsService } from '../dashboard-widgets.service';

const TENANT = 'tenant-1';
const PROPERTY = 'prop-1';
/** 17 ส.ค. 2026 ตอนบ่ายสามโมงไทย — ยังอยู่ในวันเดียวกันทั้งเวลาไทยและ UTC */
const NOW = new Date('2026-08-17T08:00:00.000Z');

const fbRow = (amount: number, businessDate: string): LedgerRow => ({
  businessDate,
  sourceId: `ord-${businessDate}`,
  amount,
  sourceType: RevenueSourceType.ORDER,
  sourceModule: RevenueSourceModule.RESTAURANT,
  segment: RevenueSegment.FOOD_BEVERAGE,
  propertyId: PROPERTY,
});

const roomRow = (amount: number, businessDate: string): LedgerRow => ({
  businessDate,
  sourceId: `bk-${businessDate}`,
  amount,
  sourceType: RevenueSourceType.BOOKING,
  sourceModule: RevenueSourceModule.HOTEL,
  segment: RevenueSegment.ROOMS,
  propertyId: PROPERTY,
});

interface SnapshotRow {
  snapshotDate: Date;
  roomRevenue: number;
  fbRevenue: number;
  otherRevenue: number;
  totalRevenue: number;
}

/** แถวสแนปช็อตของวันไทยหนึ่งวัน เก็บเป็นเที่ยงคืน UTC ตามกติกาของคอลัมน์วันที่ */
const snapshot = (day: string, room: number, fb: number, other = 0): SnapshotRow => ({
  snapshotDate: new Date(`${day}T00:00:00.000Z`),
  roomRevenue: room,
  fbRevenue: fb,
  otherRevenue: other,
  totalRevenue: room + fb + other,
});

function makeService(rows: LedgerRow[] = [], snapshots: SnapshotRow[] = []) {
  const prisma = {
    costKpiSnapshot: { findMany: jest.fn(async () => snapshots) },
  } as unknown as PrismaService;

  const revenue = buildRevenueQueryStub(rows);
  const service = new DashboardWidgetsService(
    prisma,
    {} as KpiSnapshotsService,
    revenue as unknown as RevenueQueryService,
  );

  return { service, prisma: prisma as any, revenue };
}

/** ค่าของวันที่ระบุในชุดข้อมูลหนึ่ง */
const atDay = (chart: { labels: string[] }, day: string): number => chart.labels.indexOf(day);

describe('DashboardWidgetsService.getRevenueChart', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('วันที่ยังไม่มีสแนปช็อตอ่านยอดจากสมุด ไม่ใช่เติมศูนย์', async () => {
    // เคสจริง: ร้านอาหารเปิดบิลวันนี้ 748 แต่ job ปิดยอดรายวันยังไม่วิ่ง
    const { service } = makeService([fbRow(748, '2026-08-17')]);

    const chart = await service.getRevenueChart(TENANT, PROPERTY, 30);
    const today = atDay(chart, '2026-08-17');

    expect(chart.datasets.fb[today]).toBe(748);
    expect(chart.datasets.total[today]).toBe(748);
  });

  it('ช่วงกราฟจบที่วันนี้ และยาวเท่าจำนวนวันที่ขอ', async () => {
    const { service } = makeService();

    const chart = await service.getRevenueChart(TENANT, PROPERTY, 30);

    expect(chart.labels).toHaveLength(30);
    expect(chart.labels[29]).toBe('2026-08-17');
    expect(chart.labels[0]).toBe('2026-07-19');
  });

  it('แยกยอดตามแผนกของสมุด ห้องพักกับอาหารไม่ปนกัน', async () => {
    const { service } = makeService([roomRow(4500, '2026-08-16'), fbRow(748, '2026-08-17')]);

    const chart = await service.getRevenueChart(TENANT, PROPERTY, 30);
    const yesterday = atDay(chart, '2026-08-16');
    const today = atDay(chart, '2026-08-17');

    expect(chart.datasets.room[yesterday]).toBe(4500);
    expect(chart.datasets.fb[yesterday]).toBe(0);
    expect(chart.datasets.room[today]).toBe(0);
    expect(chart.datasets.fb[today]).toBe(748);
  });

  it('วันที่ปิดยอดแล้วใช้ตัวเลขของสแนปช็อต ไม่คิดสดทับ', async () => {
    // สแนปช็อตคือตัวเลขที่บัญชีรับรองไว้ ปรับรายการย้อนหลังทีหลังต้องไม่ทำให้เปลี่ยน
    const { service } = makeService(
      [roomRow(4500, '2026-08-16')],
      [snapshot('2026-08-16', 4000, 1200, 300)],
    );

    const chart = await service.getRevenueChart(TENANT, PROPERTY, 30);
    const yesterday = atDay(chart, '2026-08-16');

    expect(chart.datasets.room[yesterday]).toBe(4000);
    expect(chart.datasets.fb[yesterday]).toBe(1200);
    expect(chart.datasets.other[yesterday]).toBe(300);
    expect(chart.datasets.total[yesterday]).toBe(5500);
  });

  it('ถามสมุดครบสามแผนก ผูก property และตรงช่วงกับป้ายบนกราฟ', async () => {
    const { service, revenue } = makeService();

    await service.getRevenueChart(TENANT, PROPERTY, 7);

    const asked = revenue.byDay.mock.calls.map(([filter]) => filter);
    expect(asked).toHaveLength(3);
    expect(asked.map((filter) => filter.segment)).toEqual([
      RevenueSegment.ROOMS,
      RevenueSegment.FOOD_BEVERAGE,
      RevenueSegment.OTHER_OPERATED,
    ]);
    for (const filter of asked) {
      expect(filter).toMatchObject({
        tenantId: TENANT,
        propertyId: PROPERTY,
        from: '2026-08-11',
        to: '2026-08-17',
      });
    }
  });

  it('อ่านสแนปช็อตรายวันของช่วงเดียวกัน เทียบด้วยเที่ยงคืน UTC ของวันไทย', async () => {
    const { service, prisma } = makeService();

    await service.getRevenueChart(TENANT, PROPERTY, 7);

    expect(prisma.costKpiSnapshot.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: TENANT,
          propertyId: PROPERTY,
          granularity: 'daily',
          snapshotDate: {
            gte: new Date('2026-08-11T00:00:00.000Z'),
            lte: new Date('2026-08-17T00:00:00.000Z'),
          },
        },
      }),
    );
  });

  it('เดือนที่ไม่มีทั้งสมุดและสแนปช็อตได้ศูนย์ ไม่ใช่ค่าว่าง', async () => {
    const { service } = makeService();

    const chart = await service.getRevenueChart(TENANT, PROPERTY, 3);

    expect(chart.datasets.room).toEqual([0, 0, 0]);
    expect(chart.datasets.total).toEqual([0, 0, 0]);
  });
});
