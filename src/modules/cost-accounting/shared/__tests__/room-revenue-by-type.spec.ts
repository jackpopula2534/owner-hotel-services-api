/**
 * ค่าห้องแยกตามประเภทห้อง — สะพานระหว่างสมุดรายได้กับมิติที่สมุดไม่ได้เก็บ
 *
 * ตัวช่วยนี้ถูกใช้สองที่: ตอนปิดงวด (เขียนลง `room_cost_analyses`) กับรายงานต้นทุนห้อง
 * แบบสด ถ้าสองที่นี้คำนวณคนละแบบ ตัวเลขบนหน้าจอเดียวกันจะกระโดดตอนงวดถูกปิด
 * สเปกชุดนี้จึงตรึงกติกาของตัวช่วยตัวเดียว ไม่ใช่ของแต่ละหน้าจอ
 */
import { RevenueSegment, RevenueSourceModule, RevenueSourceType } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { RevenueQueryService } from '@/modules/revenue/revenue-query.service';
import {
  buildRevenueQueryStub,
  LedgerRow,
} from '@/modules/revenue/__tests__/revenue-query.stub';
import { roomRevenueByType } from '../room-revenue-by-type';

const TENANT = 'tenant-1';
const PROPERTY = 'prop-1';
const SCOPE = { tenantId: TENANT, propertyId: PROPERTY, from: '2026-08-01', to: '2026-08-31' };

/** ใบจองที่ Prisma จะคืนให้ตัวช่วย — เลือกเฉพาะช่องที่มันใช้จริง */
interface BookingRow {
  id: string;
  scheduledCheckIn: Date;
  scheduledCheckOut: Date;
  room: { type: string } | null;
}

const booking = (
  id: string,
  type: string | null,
  checkIn: string,
  checkOut: string,
): BookingRow => ({
  id,
  scheduledCheckIn: new Date(`${checkIn}T07:00:00.000Z`),
  scheduledCheckOut: new Date(`${checkOut}T05:00:00.000Z`),
  room: type ? { type } : null,
});

/** แถวค่าห้องในสมุด — ค่าเริ่มต้นตรงกับที่ `booking-revenue.source.ts` ลงจริง */
const roomRow = (overrides: Partial<LedgerRow> & { sourceId: string }): LedgerRow => ({
  businessDate: '2026-08-10',
  amount: 0,
  sourceType: RevenueSourceType.BOOKING,
  sourceModule: RevenueSourceModule.HOTEL,
  segment: RevenueSegment.ROOMS,
  propertyId: PROPERTY,
  ...overrides,
});

function makeDeps(rows: LedgerRow[], bookings: BookingRow[]) {
  const findMany = jest.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
    bookings.filter((row) => where.id.in.includes(row.id)),
  );
  const prisma = { booking: { findMany } } as unknown as PrismaService;
  const revenue = buildRevenueQueryStub(rows);
  return {
    prisma,
    findMany,
    revenue,
    run: () => roomRevenueByType(prisma, revenue as unknown as RevenueQueryService, SCOPE),
  };
}

describe('roomRevenueByType', () => {
  it('ถามสมุดเฉพาะค่าห้องของโรงแรมหลังนั้น ในช่วงที่ขอ', async () => {
    const { revenue, run } = makeDeps([], []);

    await run();

    expect(revenue.documents).toHaveBeenCalledWith({
      tenantId: TENANT,
      propertyId: PROPERTY,
      from: '2026-08-01',
      to: '2026-08-31',
      sourceModule: RevenueSourceModule.HOTEL,
      segment: RevenueSegment.ROOMS,
    });
  });

  it('เทยอดจากสมุดลงถังตามประเภทห้อง แล้วรวมกลับได้เท่ายอดค่าห้องของช่วง', async () => {
    const { run } = makeDeps(
      [
        roomRow({ sourceId: 'bk-1', amount: 9000 }),
        roomRow({ sourceId: 'bk-2', amount: 4000 }),
        roomRow({ sourceId: 'bk-3', amount: 6000 }),
      ],
      [
        booking('bk-1', 'Deluxe', '2026-08-07', '2026-08-10'),
        booking('bk-2', 'Standard', '2026-08-09', '2026-08-10'),
        booking('bk-3', 'Deluxe', '2026-08-08', '2026-08-10'),
      ],
    );

    const byType = await run();

    expect(byType.get('Deluxe')).toEqual({ nights: 5, revenue: 15000 });
    expect(byType.get('Standard')).toEqual({ nights: 1, revenue: 4000 });
    expect([...byType.values()].reduce((sum, bucket) => sum + bucket.revenue, 0)).toBe(19000);
  });

  it('หักส่วนลดตาม net ไม่ใช่ราคาหน้าใบจอง', async () => {
    const { run } = makeDeps(
      [roomRow({ sourceId: 'bk-1', amount: 9000, discount: 1000, tax: 560 })],
      [booking('bk-1', 'Deluxe', '2026-08-07', '2026-08-10')],
    );

    expect((await run()).get('Deluxe')).toEqual({ nights: 3, revenue: 8000 });
  });

  it('ใบที่ถูกกลับรายการวันหลังหักยอดออก แต่จำนวนคืนยังนับใบละครั้ง', async () => {
    const { run } = makeDeps(
      [
        roomRow({ sourceId: 'bk-1', amount: 9000, businessDate: '2026-08-10' }),
        roomRow({ sourceId: 'bk-1', amount: -9000, businessDate: '2026-08-12' }),
        roomRow({ sourceId: 'bk-2', amount: 4000, businessDate: '2026-08-12' }),
      ],
      [
        booking('bk-1', 'Deluxe', '2026-08-07', '2026-08-10'),
        booking('bk-2', 'Deluxe', '2026-08-11', '2026-08-12'),
      ],
    );

    // ถ้านับคืนทุกแถว ใบที่ถูกกลับรายการจะได้ 6 คืนจากการเข้าพักครั้งเดียว
    expect((await run()).get('Deluxe')).toEqual({ nights: 4, revenue: 4000 });
  });

  it('ใบจองที่ถูกลบหลังลงสมุดแล้วยังนับเงิน แต่ไปอยู่ถัง Unknown', async () => {
    const { run } = makeDeps(
      [
        roomRow({ sourceId: 'bk-1', amount: 5000 }),
        roomRow({ sourceId: 'bk-gone', amount: 3000 }),
      ],
      [booking('bk-1', 'Deluxe', '2026-08-09', '2026-08-10')],
    );

    const byType = await run();

    expect(byType.get('Unknown')).toEqual({ nights: 0, revenue: 3000 });
    expect([...byType.values()].reduce((sum, bucket) => sum + bucket.revenue, 0)).toBe(8000);
  });

  it('ใบจองที่ไม่ผูกห้อง (ห้องถูกลบ) ตกถัง Unknown เหมือนกัน', async () => {
    const { run } = makeDeps(
      [roomRow({ sourceId: 'bk-1', amount: 5000 })],
      [booking('bk-1', null, '2026-08-09', '2026-08-10')],
    );

    expect((await run()).get('Unknown')).toEqual({ nights: 1, revenue: 5000 });
  });

  it('ช่วงที่ไม่มีค่าห้องเลย ไม่ต้องไปกวนตารางการจอง', async () => {
    const { findMany, run } = makeDeps([], []);

    await expect(run()).resolves.toEqual(new Map());
    expect(findMany).not.toHaveBeenCalled();
  });

  it('อ่านใบจองแบบผูก tenant และถามเฉพาะใบที่อยู่ในสมุด', async () => {
    const { findMany, run } = makeDeps(
      [
        roomRow({ sourceId: 'bk-1', amount: 5000, businessDate: '2026-08-10' }),
        roomRow({ sourceId: 'bk-1', amount: -5000, businessDate: '2026-08-12' }),
      ],
      [booking('bk-1', 'Deluxe', '2026-08-09', '2026-08-10')],
    );

    await run();

    expect(findMany).toHaveBeenCalledTimes(1);
    const { where } = findMany.mock.calls[0][0] as { where: { id: { in: string[] }; tenantId: string } };
    expect(where.tenantId).toBe(TENANT);
    expect(where.id.in).toEqual(['bk-1']);
  });

  it('การเข้าพักที่ไม่ค้างคืนยังนับเป็นหนึ่งคืน ไม่ใช่ศูนย์', async () => {
    const { run } = makeDeps(
      [roomRow({ sourceId: 'bk-1', amount: 1200 })],
      [
        {
          id: 'bk-1',
          scheduledCheckIn: new Date('2026-08-10T05:00:00.000Z'),
          scheduledCheckOut: new Date('2026-08-10T10:00:00.000Z'),
          room: { type: 'Day Use' },
        },
      ],
    );

    expect((await run()).get('Day Use')).toEqual({ nights: 1, revenue: 1200 });
  });
});
