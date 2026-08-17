import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { RevenueSourceModule, RevenueSourceType } from '@prisma/client';
import { RestaurantMonthlySalesService } from './monthly-sales.service';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  RevenueDocument,
  RevenueFilter,
  RevenueQueryService,
} from '../../revenue/revenue-query.service';
import type { OrderDimensionRow } from './sales-shared';

/**
 * The monthly overview is what the manager lands on, and every bar in it is a
 * door into the daily report. So the things worth pinning down are: the money
 * comes from the revenue ledger (the same rows the daily drill-down reads), the
 * month window is a *Bangkok* month with the right number of days, each bill sits
 * on the business day the ledger filed it under, and the month total is exactly
 * the sum of the day rows the drill-down will show.
 */

const RESTAURANT_ID = 'rest-1';
const TENANT_ID = 'tenant-1';

/** สลิปหนึ่งใบ: แถวที่สมุดลงไว้ + แถวใบสั่งที่รายงานเอามาต่อมิติ */
interface Receipt {
  doc: RevenueDocument;
  order: OrderDimensionRow;
}

/** A receipt matching the POS: 1,100 + 110 service + 77 VAT = 1,287. */
const receipt = (
  businessDate: string,
  id: string,
  money: Partial<Pick<RevenueDocument, 'gross' | 'discount' | 'serviceCharge' | 'tax'>> = {},
  dimensions: Partial<OrderDimensionRow> = {},
): Receipt => {
  const gross = money.gross ?? 1100;
  const discount = money.discount ?? 0;
  const serviceCharge = money.serviceCharge ?? 110;
  const tax = money.tax ?? 77;
  const net = gross - discount;

  return {
    doc: {
      businessDate,
      sourceType: RevenueSourceType.ORDER,
      sourceId: id,
      gross,
      discount,
      net,
      serviceCharge,
      tax,
      total: net + serviceCharge + tax,
      entries: 1,
    },
    order: {
      id,
      partySize: 2,
      paymentMethod: 'CASH',
      paymentStatus: 'PAID',
      orderType: 'DINE_IN',
      completedAt: new Date(`${businessDate}T12:00:00+07:00`),
      ...dimensions,
    },
  };
};

const makePrismaMock = () => ({
  restaurant: { findFirst: jest.fn() },
  order: { findMany: jest.fn() },
  orderItem: { findMany: jest.fn() },
});

/** สมุดรายได้จำลอง — ตอบตามช่วงวันที่ถูกถามจริง ไม่ใช่ตามลำดับการเรียก */
const makeRevenueMock = (docs: RevenueDocument[]) => {
  const inRange = (filter: RevenueFilter) =>
    docs.filter((d) => d.businessDate >= filter.from && d.businessDate <= filter.to);

  return {
    documents: jest.fn(async (filter: RevenueFilter) => inRange(filter)),
    totals: jest.fn(async (filter: RevenueFilter) =>
      inRange(filter).reduce(
        (sum, d) => ({
          gross: sum.gross + d.gross,
          discount: sum.discount + d.discount,
          net: sum.net + d.net,
          serviceCharge: sum.serviceCharge + d.serviceCharge,
          tax: sum.tax + d.tax,
          total: sum.total + d.total,
          entries: sum.entries + 1,
        }),
        { gross: 0, discount: 0, net: 0, serviceCharge: 0, tax: 0, total: 0, entries: 0 },
      ),
    ),
  };
};

const round2 = (value: number): number => Math.round(value * 100) / 100;

describe('RestaurantMonthlySalesService', () => {
  let service: RestaurantMonthlySalesService;
  let prisma: ReturnType<typeof makePrismaMock>;
  let revenue: ReturnType<typeof makeRevenueMock>;
  /** Orders opened during the month — the operational query, independent of the ledger. */
  let opened: { status: string }[];

  /** Build the service with the ledger holding exactly these receipts. */
  const withLedger = async (receipts: Receipt[] = []): Promise<void> => {
    revenue = makeRevenueMock(receipts.map((r) => r.doc));

    prisma.order.findMany.mockImplementation(async (args: any) => {
      const ids: string[] | undefined = args?.where?.id?.in;
      if (!ids) return opened;
      return receipts.filter((r) => ids.includes(r.order.id)).map((r) => r.order);
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RestaurantMonthlySalesService,
        { provide: PrismaService, useValue: prisma },
        { provide: RevenueQueryService, useValue: revenue },
      ],
    }).compile();
    service = module.get(RestaurantMonthlySalesService);
  };

  /** ตัวกรองทุกใบที่บริการยื่นให้สมุด */
  const ledgerFilters = (): RevenueFilter[] =>
    [...revenue.documents.mock.calls, ...revenue.totals.mock.calls].map(
      ([filter]) => filter as RevenueFilter,
    );

  beforeEach(async () => {
    prisma = makePrismaMock();
    opened = [];
    prisma.restaurant.findFirst.mockResolvedValue({ id: RESTAURANT_ID, name: 'The Grand Bistro' });
    prisma.orderItem.findMany.mockResolvedValue([]);
    await withLedger();
  });

  it('rejects an outlet belonging to another tenant', async () => {
    prisma.restaurant.findFirst.mockResolvedValue(null);

    await expect(service.getMonthlySales(RESTAURANT_ID, TENANT_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('scopes the outlet lookup by tenant rather than by id alone', async () => {
    await service.getMonthlySales(RESTAURANT_ID, TENANT_ID, '2026-08');

    expect(prisma.restaurant.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: RESTAURANT_ID, tenantId: TENANT_ID } }),
    );
  });

  it('asks the ledger for the whole Bangkok month, and the month before it', async () => {
    await service.getMonthlySales(RESTAURANT_ID, TENANT_ID, '2026-08');

    expect(revenue.documents).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        outletId: RESTAURANT_ID,
        sourceModule: RevenueSourceModule.RESTAURANT,
        from: '2026-08-01',
        to: '2026-08-31',
      }),
    );
    expect(revenue.totals).toHaveBeenCalledWith(
      expect.objectContaining({ from: '2026-07-01', to: '2026-07-31' }),
    );
  });

  it('rolls the year over when comparing January with December', async () => {
    const report = await service.getMonthlySales(RESTAURANT_ID, TENANT_ID, '2026-01');

    expect(report.comparison.previousMonth).toBe('2025-12');
    expect(ledgerFilters()).toContainEqual(
      expect.objectContaining({ from: '2025-12-01', to: '2025-12-31' }),
    );
  });

  // เงินมาจากสมุดอย่างเดียว — ก่อนหน้านี้หน้านี้ไปนับ orders เองด้วยเงื่อนไขของตัวเอง
  // ยอดจึงไม่ตรงกับหน้าอื่นที่ถามคำถามเดียวกัน
  it('takes its money from the ledger, never by re-summing the orders table', async () => {
    await withLedger([receipt('2026-08-13', 'o1')]);

    await service.getMonthlySales(RESTAURANT_ID, TENANT_ID, '2026-08');

    for (const [args] of prisma.order.findMany.mock.calls) {
      expect(args.where.status).toBeUndefined();
      expect(args.where.paymentStatus).toBeUndefined();
      expect(args.where.completedAt).toBeUndefined();
    }
  });

  it('counts operations over the Bangkok month window', async () => {
    await service.getMonthlySales(RESTAURANT_ID, TENANT_ID, '2026-08');

    const opsWhere = prisma.order.findMany.mock.calls[0][0].where;
    // 2026-08-01 00:00 +07:00 → 2026-07-31T17:00Z; 2026-09-01 00:00 +07:00 → 2026-08-31T17:00Z.
    expect(opsWhere.createdAt.gte.toISOString()).toBe('2026-07-31T17:00:00.000Z');
    expect(opsWhere.createdAt.lt.toISOString()).toBe('2026-08-31T17:00:00.000Z');
    expect(opsWhere).toMatchObject({ restaurantId: RESTAURANT_ID, tenantId: TENANT_ID });
  });

  it('emits one row per calendar day, including days that sold nothing', async () => {
    const august = await service.getMonthlySales(RESTAURANT_ID, TENANT_ID, '2026-08');
    expect(august.days).toHaveLength(31);
    expect(august.days[0].date).toBe('2026-08-01');
    expect(august.days[30].date).toBe('2026-08-31');

    const february = await service.getMonthlySales(RESTAURANT_ID, TENANT_ID, '2026-02');
    expect(february.days).toHaveLength(28);

    // 2028 is a leap year — the grid is built from the calendar, not from 30-day maths.
    const leap = await service.getMonthlySales(RESTAURANT_ID, TENANT_ID, '2028-02');
    expect(leap.days).toHaveLength(29);
  });

  it('files each bill under the business day the ledger gave it, and the days sum to the month', async () => {
    await withLedger([
      receipt('2026-08-13', 'o1'),
      // A bill closed at 00:30 Bangkok on the 14th was posted to the 14th; the
      // report must take the ledger's word for it rather than re-deriving a day.
      receipt('2026-08-14', 'o2', {}, { completedAt: new Date('2026-08-14T00:30:00+07:00') }),
      receipt('2026-08-14', 'o3', { gross: 720, serviceCharge: 72, tax: 50.4 }, { partySize: 4 }),
    ]);

    const report = await service.getMonthlySales(RESTAURANT_ID, TENANT_ID, '2026-08');
    const byDate = Object.fromEntries(report.days.map((day) => [day.date, day]));

    expect(byDate['2026-08-13']).toMatchObject({ orders: 1, totalCollected: 1287, guests: 2 });
    expect(byDate['2026-08-14']).toMatchObject({ orders: 2, totalCollected: 2129.4, guests: 6 });

    const summed = report.days.reduce((sum, day) => sum + day.totalCollected, 0);
    expect(round2(summed)).toBe(report.totals.totalCollected);
    expect(report.totals.totalCollected).toBe(3416.4);
  });

  it('totals reconcile with the receipt: net + service + tax = collected', async () => {
    await withLedger([
      // 1,100 − 100 discount → net 1,000, +10% service, +7% VAT = 1,170.
      receipt('2026-08-13', 'o1', { discount: 100, serviceCharge: 100, tax: 70 }),
      receipt('2026-08-20', 'o2'),
    ]);

    const { totals } = await service.getMonthlySales(RESTAURANT_ID, TENANT_ID, '2026-08');

    expect(totals.grossSales).toBe(2200);
    expect(totals.discount).toBe(100);
    expect(totals.netSales).toBe(2100);
    expect(totals.serviceCharge).toBe(210);
    expect(totals.tax).toBe(147);
    expect(totals.totalCollected).toBe(2457);
    expect(totals.netSales + totals.serviceCharge + totals.tax).toBe(totals.totalCollected);
  });

  it('averages over trading days, not calendar days, and names the best day', async () => {
    await withLedger([
      receipt('2026-08-13', 'o1'),
      receipt('2026-08-20', 'o2'),
      receipt('2026-08-20', 'o3'),
    ]);

    const { pace, totals } = await service.getMonthlySales(RESTAURANT_ID, TENANT_ID, '2026-08');

    expect(pace.activeDays).toBe(2);
    expect(pace.calendarDays).toBe(31);
    // 3,861 over the two days that traded — dividing by 31 would read as a slump.
    expect(pace.averageDailySales).toBe(round2(totals.totalCollected / 2));
    expect(pace.bestDay).toEqual({ date: '2026-08-20', totalCollected: 2574 });
  });

  it('compares against the previous month and leaves growth from zero undefined', async () => {
    await withLedger([
      receipt('2026-08-13', 'o1'),
      receipt('2026-07-13', 'o0', { gross: 1000, serviceCharge: 0, tax: 0 }),
    ]);

    const withHistory = await service.getMonthlySales(RESTAURANT_ID, TENANT_ID, '2026-08');
    expect(withHistory.comparison).toMatchObject({
      previousMonth: '2026-07',
      totalCollected: 1000,
      changeAmount: 287,
      changePct: 28.7,
    });

    await withLedger([receipt('2026-08-13', 'o1')]);

    const firstMonth = await service.getMonthlySales(RESTAURANT_ID, TENANT_ID, '2026-08');
    expect(firstMonth.comparison.totalCollected).toBe(0);
    expect(firstMonth.comparison.changePct).toBeNull();
  });

  it('splits the month by payment method and order type', async () => {
    await withLedger([
      receipt('2026-08-13', 'o1'),
      receipt('2026-08-14', 'o2', {}, { paymentMethod: 'QR_PAYMENT', orderType: 'TAKEAWAY' }),
      receipt('2026-08-15', 'o3', {}, { paymentMethod: null }),
    ]);

    const report = await service.getMonthlySales(RESTAURANT_ID, TENANT_ID, '2026-08');

    const payments = Object.fromEntries(report.paymentBreakdown.map((r) => [r.key, r]));
    expect(payments.CASH).toMatchObject({ orders: 1, amount: 1287 });
    expect(payments.QR_PAYMENT).toMatchObject({ orders: 1, amount: 1287 });
    // A missing method is surfaced as UNKNOWN rather than dropped — money must not vanish.
    expect(payments.UNKNOWN).toMatchObject({ orders: 1, amount: 1287 });
    expect(report.paymentBreakdown.reduce((sum, r) => sum + r.share, 0)).toBeCloseTo(100, 1);

    const types = Object.fromEntries(report.orderTypeBreakdown.map((r) => [r.key, r]));
    expect(types.DINE_IN.orders).toBe(2);
    expect(types.TAKEAWAY.orders).toBe(1);
  });

  it('ranks the month top items and counts operations from orders opened in it', async () => {
    opened = [
      { status: 'COMPLETED' },
      { status: 'COMPLETED' },
      { status: 'CANCELLED' },
      { status: 'PREPARING' },
    ];
    await withLedger([receipt('2026-08-13', 'o1')]);
    prisma.orderItem.findMany.mockResolvedValue([
      {
        quantity: 4,
        totalPrice: '480.00',
        menuItem: { id: 'm1', name: 'ข้าวต้มปลา', category: { name: 'อาหารเช้า' } },
      },
      {
        quantity: 2,
        totalPrice: '400.00',
        menuItem: { id: 'm2', name: 'ต้มยำกุ้ง', category: null },
      },
      {
        quantity: 3,
        totalPrice: '360.00',
        menuItem: { id: 'm1', name: 'ข้าวต้มปลา', category: { name: 'อาหารเช้า' } },
      },
    ]);

    const report = await service.getMonthlySales(RESTAURANT_ID, TENANT_ID, '2026-08');

    expect(report.topItems[0]).toMatchObject({
      menuItemId: 'm1',
      quantity: 7,
      revenue: 840,
      category: 'อาหารเช้า',
    });
    expect(report.topItems[1].category).toBe('Uncategorized');
    expect(report.operations).toEqual({ opened: 4, completed: 2, cancelled: 1, active: 1 });
  });

  it('falls back to the current Bangkok month when the month is missing or malformed', async () => {
    const currentMonth = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 7);

    expect((await service.getMonthlySales(RESTAURANT_ID, TENANT_ID)).month).toBe(currentMonth);
    expect((await service.getMonthlySales(RESTAURANT_ID, TENANT_ID, '2026-13')).month).toBe(
      currentMonth,
    );
    expect((await service.getMonthlySales(RESTAURANT_ID, TENANT_ID, 'สิงหาคม')).month).toBe(
      currentMonth,
    );
    // A full date is accepted for convenience — its month is used.
    expect((await service.getMonthlySales(RESTAURANT_ID, TENANT_ID, '2026-08-14')).month).toBe(
      '2026-08',
    );
  });

  it('reports a month with no settled bills as zeros rather than failing', async () => {
    const report = await service.getMonthlySales(RESTAURANT_ID, TENANT_ID, '2026-08');

    expect(report.totals.totalCollected).toBe(0);
    expect(report.totals.orders).toBe(0);
    expect(report.pace.activeDays).toBe(0);
    expect(report.pace.averageDailySales).toBe(0);
    expect(report.pace.bestDay).toBeNull();
    expect(report.days.every((day) => day.totalCollected === 0)).toBe(true);
    expect(report.paymentBreakdown).toEqual([]);
    expect(report.topItems).toEqual([]);
  });
});
