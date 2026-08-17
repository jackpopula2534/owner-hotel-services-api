/**
 * รายได้จากสมุด → ศูนย์ต้นทุน
 *
 * จุดที่ต้องล็อกไว้คือ "ยอดรวมของสมุด" กับ "ผลบวกของรายแผนก" เป็นคนละตัว
 * ถ้าผู้ใช้ยังสร้างศูนย์ต้นทุนไม่ครบ เงินส่วนที่ลงแผนกไม่ได้ต้องยังอยู่ในยอดรวม
 * และต้องมีชื่ออยู่ใน `unmapped` ให้ตามแก้ได้ — ไม่ใช่หายไปเงียบ ๆ จนยอดพาดหัว
 * ไม่ตรงกับหน้าจออื่นที่เฟส 3 แก้ไว้แล้ว
 */
import {
  CostCenterType,
  RevenueSegment,
  RevenueSourceModule,
  RevenueSourceType,
} from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { RevenueQueryService } from '@/modules/revenue/revenue-query.service';
import {
  buildRevenueQueryStub,
  LedgerRow,
} from '@/modules/revenue/__tests__/revenue-query.stub';
import { revenueByCostCenter } from '../revenue-by-cost-center';

const TENANT = 'tenant-1';
const PROPERTY = 'prop-1';
const SCOPE = { tenantId: TENANT, propertyId: PROPERTY, from: '2026-08-01', to: '2026-08-31' };

interface CenterRow {
  id: string;
  type: CostCenterType;
  code: string;
  sortOrder: number;
}

const center = (
  id: string,
  type: CostCenterType,
  code: string,
  sortOrder = 0,
): CenterRow => ({ id, type, code, sortOrder });

const row = (
  segment: RevenueSegment,
  amount: number,
  businessDate = '2026-08-10',
  propertyId = PROPERTY,
): LedgerRow => ({
  businessDate,
  propertyId,
  segment,
  amount,
  sourceId: `src-${segment}-${amount}`,
  sourceType: RevenueSourceType.BOOKING,
  sourceModule: RevenueSourceModule.HOTEL,
});

function makeWorld(rows: LedgerRow[], centers: CenterRow[]) {
  const findMany = jest.fn(async () => centers);
  const prisma = { costCenter: { findMany } } as unknown as PrismaService;
  const revenue = buildRevenueQueryStub(rows);
  return {
    prisma,
    findMany,
    revenue,
    run: () =>
      revenueByCostCenter(prisma, revenue as unknown as RevenueQueryService, SCOPE),
  };
}

describe('revenueByCostCenter', () => {
  it('จับคู่ด้วยประเภทศูนย์ ไม่ใช่ชื่อหรือรหัส', async () => {
    const { run } = makeWorld(
      [row(RevenueSegment.ROOMS, 9000), row(RevenueSegment.FOOD_BEVERAGE, 1500)],
      [
        center('cc-rooms', CostCenterType.ROOMS, 'DEPT-01'),
        center('cc-fb', CostCenterType.FOOD_BEVERAGE, 'DEPT-02', 1),
      ],
    );

    const result = await run();

    expect(result.byCostCenter.get('cc-rooms')).toBe(9000);
    expect(result.byCostCenter.get('cc-fb')).toBe(1500);
    expect(result.unmapped).toEqual([]);
  });

  it('ยอดรวมคือยอดของสมุด ไม่ใช่ผลบวกของแผนกที่จับคู่ได้', async () => {
    const { run } = makeWorld(
      [
        row(RevenueSegment.ROOMS, 9000),
        row(RevenueSegment.FOOD_BEVERAGE, 1500),
        row(RevenueSegment.OTHER_OPERATED, 500),
      ],
      [center('cc-rooms', CostCenterType.ROOMS, 'DEPT-01')],
    );

    const result = await run();

    expect(result.total).toBe(11000);
    const mapped = [...result.byCostCenter.values()].reduce((sum, value) => sum + value, 0);
    expect(mapped).toBe(9000);
  });

  it('บอกชื่อแผนกและประเภทศูนย์ที่ยังขาด เพื่อให้ตามสร้างได้', async () => {
    const { run } = makeWorld(
      [row(RevenueSegment.OTHER_OPERATED, 500), row(RevenueSegment.FOOD_BEVERAGE, 1500)],
      [center('cc-rooms', CostCenterType.ROOMS, 'DEPT-01')],
    );

    const result = await run();

    expect(result.unmapped).toEqual(
      expect.arrayContaining([
        {
          segment: RevenueSegment.FOOD_BEVERAGE,
          expectedCostCenterType: CostCenterType.FOOD_BEVERAGE,
          revenue: 1500,
        },
        {
          segment: RevenueSegment.OTHER_OPERATED,
          expectedCostCenterType: CostCenterType.OTHER_OPERATED,
          revenue: 500,
        },
      ]),
    );
  });

  it('ประเภทเดียวมีหลายศูนย์ เลือกตัวเดิมทุกครั้งไม่ว่าฐานข้อมูลจะคืนมาลำดับไหน', async () => {
    const centers = [
      center('cc-rooms-b', CostCenterType.ROOMS, 'DEPT-01-B', 5),
      center('cc-rooms-a', CostCenterType.ROOMS, 'DEPT-01-A', 1),
    ];

    const forward = await makeWorld([row(RevenueSegment.ROOMS, 9000)], centers).run();
    const reversed = await makeWorld([row(RevenueSegment.ROOMS, 9000)], [...centers].reverse()).run();

    expect(forward.byCostCenter.get('cc-rooms-a')).toBe(9000);
    expect([...reversed.byCostCenter.keys()]).toEqual([...forward.byCostCenter.keys()]);
  });

  it('sortOrder เท่ากันตัดสินด้วยรหัส ไม่ปล่อยให้ขึ้นกับลำดับของฐานข้อมูล', async () => {
    const { run } = makeWorld(
      [row(RevenueSegment.ROOMS, 9000)],
      [
        center('cc-rooms-z', CostCenterType.ROOMS, 'DEPT-Z', 0),
        center('cc-rooms-a', CostCenterType.ROOMS, 'DEPT-A', 0),
      ],
    );

    const result = await run();

    expect(result.byCostCenter.get('cc-rooms-a')).toBe(9000);
  });

  it('ถามเฉพาะศูนย์ที่ยังใช้งานของ tenant กับ property นั้น', async () => {
    const { run, findMany } = makeWorld([], [center('cc-rooms', CostCenterType.ROOMS, 'D1')]);

    await run();

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: TENANT, propertyId: PROPERTY, isActive: true },
      }),
    );
  });

  it('ถามสมุดด้วยช่วงวันเดียวกับที่ผู้เรียกส่งมา ไม่ตีความใหม่', async () => {
    const { run, revenue } = makeWorld([], []);

    await run();

    expect(revenue.bySegment).toHaveBeenCalledWith({
      tenantId: TENANT,
      propertyId: PROPERTY,
      from: '2026-08-01',
      to: '2026-08-31',
    });
  });

  it('เดือนที่ยังไม่มีรายได้คืนศูนย์ ไม่ใช่แผนกที่มีตัวเลขมั่ว', async () => {
    const { run } = makeWorld([], [center('cc-rooms', CostCenterType.ROOMS, 'D1')]);

    const result = await run();

    expect(result.total).toBe(0);
    expect(result.byCostCenter.size).toBe(0);
    expect(result.unmapped).toEqual([]);
  });

  it('ใบลดหนี้ที่กลับรายการทำให้แผนกติดลบได้ ไม่ถูกตัดทิ้ง', async () => {
    const { run } = makeWorld(
      [row(RevenueSegment.ROOMS, 9000), row(RevenueSegment.ROOMS, -12000, '2026-08-20')],
      [center('cc-rooms', CostCenterType.ROOMS, 'D1')],
    );

    const result = await run();

    expect(result.byCostCenter.get('cc-rooms')).toBe(-3000);
    expect(result.total).toBe(-3000);
  });
});
