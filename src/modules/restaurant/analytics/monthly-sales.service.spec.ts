import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { RestaurantMonthlySalesService } from './monthly-sales.service';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * The monthly overview is what the manager lands on, and every bar in it is a
 * door into the daily report. So the things worth pinning down are: the month
 * window is a *Bangkok* month with the right number of days, the per-day rows
 * are keyed on the Bangkok day (a bill settled at 00:30 belongs to that day, not
 * the previous one in UTC), and the month total is exactly the sum of the days
 * the drill-down will show.
 */

const RESTAURANT_ID = 'rest-1';
const TENANT_ID = 'tenant-1';

const makePrismaMock = () => ({
  restaurant: { findFirst: jest.fn() },
  order: { findMany: jest.fn() },
  orderItem: { findMany: jest.fn() },
});

/** An order matching the receipt in the POS: 1,100 + 110 service + 77 VAT = 1,287. */
const receiptOrder = (completedAt: string, overrides: Record<string, unknown> = {}) => ({
  subtotal: '1100.00',
  discount: '0.00',
  serviceCharge: '110.00',
  taxAmount: '77.00',
  total: '1287.00',
  partySize: 2,
  paymentMethod: 'CASH',
  orderType: 'DINE_IN',
  completedAt: new Date(completedAt),
  ...overrides,
});

describe('RestaurantMonthlySalesService', () => {
  let service: RestaurantMonthlySalesService;
  let prisma: ReturnType<typeof makePrismaMock>;

  beforeEach(async () => {
    prisma = makePrismaMock();
    const module: TestingModule = await Test.createTestingModule({
      providers: [RestaurantMonthlySalesService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(RestaurantMonthlySalesService);

    prisma.restaurant.findFirst.mockResolvedValue({ id: RESTAURANT_ID, name: 'The Grand Bistro' });
    prisma.order.findMany.mockResolvedValue([]);
    prisma.orderItem.findMany.mockResolvedValue([]);
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

  it('queries a Bangkok calendar month, reaching back one month for the comparison', async () => {
    await service.getMonthlySales(RESTAURANT_ID, TENANT_ID, '2026-08');

    const where = prisma.order.findMany.mock.calls[0][0].where;
    // 2026-07-01 00:00 +07:00 → 2026-06-30T17:00Z; 2026-09-01 00:00 +07:00 → 2026-08-31T17:00Z.
    expect(where.completedAt.gte.toISOString()).toBe('2026-06-30T17:00:00.000Z');
    expect(where.completedAt.lt.toISOString()).toBe('2026-08-31T17:00:00.000Z');

    const opsWhere = prisma.order.findMany.mock.calls[1][0].where;
    expect(opsWhere.createdAt.gte.toISOString()).toBe('2026-07-31T17:00:00.000Z');
    expect(opsWhere.createdAt.lt.toISOString()).toBe('2026-08-31T17:00:00.000Z');
  });

  it('rolls the year over when comparing January with December', async () => {
    const report = await service.getMonthlySales(RESTAURANT_ID, TENANT_ID, '2026-01');

    expect(report.comparison.previousMonth).toBe('2025-12');
    const where = prisma.order.findMany.mock.calls[0][0].where;
    expect(where.completedAt.gte.toISOString()).toBe('2025-11-30T17:00:00.000Z');
  });

  it('counts only completed and paid orders', async () => {
    await service.getMonthlySales(RESTAURANT_ID, TENANT_ID, '2026-08');

    expect(prisma.order.findMany.mock.calls[0][0].where).toMatchObject({
      restaurantId: RESTAURANT_ID,
      tenantId: TENANT_ID,
      status: 'COMPLETED',
      paymentStatus: 'PAID',
    });
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

  it('files each bill under its Bangkok day, and the days sum to the month total', async () => {
    prisma.order.findMany
      .mockResolvedValueOnce([
        receiptOrder('2026-08-13T12:30:00+07:00'),
        // 00:30 Bangkok on the 14th is still 17:30Z on the 13th — this belongs to
        // the 14th, and filing it by UTC date would move the money a day.
        receiptOrder('2026-08-14T00:30:00+07:00'),
        receiptOrder('2026-08-14T19:00:00+07:00', {
          subtotal: '720.00',
          serviceCharge: '72.00',
          taxAmount: '50.40',
          total: '842.40',
          partySize: 4,
        }),
      ])
      .mockResolvedValueOnce([]);

    const report = await service.getMonthlySales(RESTAURANT_ID, TENANT_ID, '2026-08');
    const byDate = Object.fromEntries(report.days.map((day) => [day.date, day]));

    expect(byDate['2026-08-13']).toMatchObject({ orders: 1, totalCollected: 1287, guests: 2 });
    expect(byDate['2026-08-14']).toMatchObject({ orders: 2, totalCollected: 2129.4, guests: 6 });

    const summed = report.days.reduce((sum, day) => sum + day.totalCollected, 0);
    expect(Math.round(summed * 100) / 100).toBe(report.totals.totalCollected);
    expect(report.totals.totalCollected).toBe(3416.4);
  });

  it('totals reconcile with the receipt: net + service + tax = collected', async () => {
    prisma.order.findMany
      .mockResolvedValueOnce([
        // 1,100 − 100 discount → net 1,000, +10% service, +7% VAT = 1,170.
        receiptOrder('2026-08-13T12:30:00+07:00', {
          discount: '100.00',
          serviceCharge: '100.00',
          taxAmount: '70.00',
          total: '1170.00',
        }),
        receiptOrder('2026-08-20T19:00:00+07:00'),
      ])
      .mockResolvedValueOnce([]);

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
    prisma.order.findMany
      .mockResolvedValueOnce([
        receiptOrder('2026-08-13T12:30:00+07:00'),
        receiptOrder('2026-08-20T19:00:00+07:00'),
        receiptOrder('2026-08-20T20:00:00+07:00'),
      ])
      .mockResolvedValueOnce([]);

    const { pace, totals } = await service.getMonthlySales(RESTAURANT_ID, TENANT_ID, '2026-08');

    expect(pace.activeDays).toBe(2);
    expect(pace.calendarDays).toBe(31);
    // 3,861 over the two days that traded — dividing by 31 would read as a slump.
    expect(pace.averageDailySales).toBe(round2(totals.totalCollected / 2));
    expect(pace.bestDay).toEqual({ date: '2026-08-20', totalCollected: 2574 });
  });

  it('compares against the previous month and leaves growth from zero undefined', async () => {
    prisma.order.findMany
      .mockResolvedValueOnce([
        receiptOrder('2026-08-13T12:30:00+07:00'),
        receiptOrder('2026-07-13T12:30:00+07:00', { total: '1000.00' }),
      ])
      .mockResolvedValueOnce([]);

    const withHistory = await service.getMonthlySales(RESTAURANT_ID, TENANT_ID, '2026-08');
    expect(withHistory.comparison).toMatchObject({
      previousMonth: '2026-07',
      totalCollected: 1000,
      changeAmount: 287,
      changePct: 28.7,
    });

    prisma.order.findMany
      .mockResolvedValueOnce([receiptOrder('2026-08-13T12:30:00+07:00')])
      .mockResolvedValueOnce([]);

    const firstMonth = await service.getMonthlySales(RESTAURANT_ID, TENANT_ID, '2026-08');
    expect(firstMonth.comparison.totalCollected).toBe(0);
    expect(firstMonth.comparison.changePct).toBeNull();
  });

  it('splits the month by payment method and order type', async () => {
    prisma.order.findMany
      .mockResolvedValueOnce([
        receiptOrder('2026-08-13T12:30:00+07:00'),
        receiptOrder('2026-08-14T19:00:00+07:00', {
          total: '1287.00',
          paymentMethod: 'QR_PAYMENT',
          orderType: 'TAKEAWAY',
        }),
        receiptOrder('2026-08-15T19:00:00+07:00', { paymentMethod: null }),
      ])
      .mockResolvedValueOnce([]);

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
    prisma.order.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
      { status: 'COMPLETED' },
      { status: 'COMPLETED' },
      { status: 'CANCELLED' },
      { status: 'PREPARING' },
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

const round2 = (value: number): number => Math.round(value * 100) / 100;
