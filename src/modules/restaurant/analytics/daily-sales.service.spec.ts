import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { RestaurantDailySalesService } from './daily-sales.service';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * The daily sales report is the number a manager closes the till against, so the
 * things worth pinning down are: the day window is a *Bangkok* day (not the
 * server's), the money adds up the same way the printed receipt does, and only
 * paid-and-completed orders count toward it.
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

describe('RestaurantDailySalesService', () => {
  let service: RestaurantDailySalesService;
  let prisma: ReturnType<typeof makePrismaMock>;

  beforeEach(async () => {
    prisma = makePrismaMock();
    const module: TestingModule = await Test.createTestingModule({
      providers: [RestaurantDailySalesService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(RestaurantDailySalesService);

    prisma.restaurant.findFirst.mockResolvedValue({ id: RESTAURANT_ID, name: 'The Grand Bistro' });
    prisma.order.findMany.mockResolvedValue([]);
    prisma.orderItem.findMany.mockResolvedValue([]);
  });

  it('rejects an outlet belonging to another tenant', async () => {
    prisma.restaurant.findFirst.mockResolvedValue(null);

    await expect(service.getDailySales(RESTAURANT_ID, TENANT_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('scopes the outlet lookup by tenant rather than by id alone', async () => {
    await service.getDailySales(RESTAURANT_ID, TENANT_ID, '2026-08-13');

    expect(prisma.restaurant.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: RESTAURANT_ID, tenantId: TENANT_ID } }),
    );
  });

  it('queries a Bangkok calendar day, not a server-local one', async () => {
    await service.getDailySales(RESTAURANT_ID, TENANT_ID, '2026-08-13');

    const where = prisma.order.findMany.mock.calls[0][0].where;
    // 2026-08-13 00:00 +07:00 is 2026-08-12T17:00Z; the paid-orders query reaches
    // back one further day for the comparison figure.
    expect(where.completedAt.gte.toISOString()).toBe('2026-08-11T17:00:00.000Z');
    expect(where.completedAt.lt.toISOString()).toBe('2026-08-13T17:00:00.000Z');

    const opsWhere = prisma.order.findMany.mock.calls[1][0].where;
    expect(opsWhere.createdAt.gte.toISOString()).toBe('2026-08-12T17:00:00.000Z');
    expect(opsWhere.createdAt.lt.toISOString()).toBe('2026-08-13T17:00:00.000Z');
  });

  it('counts only completed and paid orders', async () => {
    await service.getDailySales(RESTAURANT_ID, TENANT_ID, '2026-08-13');

    const where = prisma.order.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({
      restaurantId: RESTAURANT_ID,
      tenantId: TENANT_ID,
      status: 'COMPLETED',
      paymentStatus: 'PAID',
    });
  });

  it('totals reconcile with the receipt: net + service + tax = collected', async () => {
    prisma.order.findMany
      .mockResolvedValueOnce([
        receiptOrder('2026-08-13T12:30:00+07:00'),
        receiptOrder('2026-08-13T19:00:00+07:00', {
          subtotal: '720.00',
          discount: '0.00',
          serviceCharge: '72.00',
          taxAmount: '50.40',
          total: '842.40',
          partySize: 4,
          paymentMethod: 'QR_CODE',
          orderType: 'TAKEAWAY',
        }),
      ])
      .mockResolvedValueOnce([]);

    const res = await service.getDailySales(RESTAURANT_ID, TENANT_ID, '2026-08-13');

    expect(res.totals.grossSales).toBe(1820);
    expect(res.totals.netSales).toBe(1820);
    expect(res.totals.serviceCharge).toBe(182);
    expect(res.totals.tax).toBe(127.4);
    expect(res.totals.totalCollected).toBe(2129.4);
    expect(
      res.totals.netSales + res.totals.serviceCharge + res.totals.tax,
    ).toBeCloseTo(res.totals.totalCollected, 2);

    expect(res.totals.orders).toBe(2);
    expect(res.totals.guests).toBe(6);
    expect(res.totals.averageOrderValue).toBe(1064.7);
    expect(res.totals.averagePartySize).toBe(3);
  });

  it('subtracts discount from gross to get net sales', async () => {
    prisma.order.findMany
      .mockResolvedValueOnce([
        receiptOrder('2026-08-13T12:30:00+07:00', {
          subtotal: '1000.00',
          discount: '100.00',
          serviceCharge: '90.00',
          taxAmount: '69.30',
          total: '1059.30',
        }),
      ])
      .mockResolvedValueOnce([]);

    const res = await service.getDailySales(RESTAURANT_ID, TENANT_ID, '2026-08-13');

    expect(res.totals.grossSales).toBe(1000);
    expect(res.totals.discount).toBe(100);
    expect(res.totals.netSales).toBe(900);
    expect(res.totals.totalCollected).toBe(1059.3);
  });

  it('buckets the hourly curve by Bangkok clock hour and keeps all 24 slots', async () => {
    prisma.order.findMany
      .mockResolvedValueOnce([receiptOrder('2026-08-13T19:45:00+07:00')])
      .mockResolvedValueOnce([]);

    const res = await service.getDailySales(RESTAURANT_ID, TENANT_ID, '2026-08-13');

    expect(res.hourly).toHaveLength(24);
    expect(res.hourly[19]).toEqual({ hour: 19, orders: 1, amount: 1287 });
    expect(res.hourly[12]).toEqual({ hour: 12, orders: 0, amount: 0 });
  });

  it('splits the fetched window into today and the comparison day', async () => {
    prisma.order.findMany
      .mockResolvedValueOnce([
        receiptOrder('2026-08-13T12:00:00+07:00'),
        // Previous day — same query, must not land in today's totals.
        receiptOrder('2026-08-12T12:00:00+07:00', { total: '1000.00' }),
      ])
      .mockResolvedValueOnce([]);

    const res = await service.getDailySales(RESTAURANT_ID, TENANT_ID, '2026-08-13');

    expect(res.totals.orders).toBe(1);
    expect(res.totals.totalCollected).toBe(1287);
    expect(res.comparison).toEqual({
      previousDate: '2026-08-12',
      totalCollected: 1000,
      changeAmount: 287,
      changePct: 28.7,
    });
  });

  it('reports no growth percentage when the previous day took nothing', async () => {
    prisma.order.findMany
      .mockResolvedValueOnce([receiptOrder('2026-08-13T12:00:00+07:00')])
      .mockResolvedValueOnce([]);

    const res = await service.getDailySales(RESTAURANT_ID, TENANT_ID, '2026-08-13');

    expect(res.comparison.totalCollected).toBe(0);
    expect(res.comparison.changePct).toBeNull();
  });

  it('breaks revenue down by payment method and order type with shares', async () => {
    prisma.order.findMany
      .mockResolvedValueOnce([
        receiptOrder('2026-08-13T12:00:00+07:00', { total: '750.00', paymentMethod: 'CASH' }),
        receiptOrder('2026-08-13T13:00:00+07:00', {
          total: '250.00',
          paymentMethod: 'CREDIT_CARD',
          orderType: 'ROOM_SERVICE',
        }),
      ])
      .mockResolvedValueOnce([]);

    const res = await service.getDailySales(RESTAURANT_ID, TENANT_ID, '2026-08-13');

    expect(res.paymentBreakdown).toEqual([
      { key: 'CASH', orders: 1, amount: 750, share: 75 },
      { key: 'CREDIT_CARD', orders: 1, amount: 250, share: 25 },
    ]);
    expect(res.orderTypeBreakdown.map((r) => r.key)).toEqual(['DINE_IN', 'ROOM_SERVICE']);
  });

  it('ranks top items by quantity and caps the list at ten', async () => {
    prisma.orderItem.findMany.mockResolvedValue([
      {
        quantity: 2,
        totalPrice: '200.00',
        menuItem: { id: 'm1', name: 'Pad Thai', category: { name: 'Main' } },
      },
      {
        quantity: 3,
        totalPrice: '150.00',
        menuItem: { id: 'm2', name: 'Thai Tea', category: null },
      },
      {
        quantity: 1,
        totalPrice: '100.00',
        menuItem: { id: 'm1', name: 'Pad Thai', category: { name: 'Main' } },
      },
    ]);

    const res = await service.getDailySales(RESTAURANT_ID, TENANT_ID, '2026-08-13');

    expect(res.topItems).toEqual([
      { menuItemId: 'm1', name: 'Pad Thai', category: 'Main', quantity: 3, revenue: 300 },
      { menuItemId: 'm2', name: 'Thai Tea', category: 'Uncategorized', quantity: 3, revenue: 150 },
    ]);
    expect(res.topItems.length).toBeLessThanOrEqual(10);
  });

  it('counts operations from orders opened during the day', async () => {
    prisma.order.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
      { status: 'COMPLETED' },
      { status: 'CANCELLED' },
      { status: 'PENDING' },
      { status: 'PREPARING' },
    ]);

    const res = await service.getDailySales(RESTAURANT_ID, TENANT_ID, '2026-08-13');

    expect(res.operations).toEqual({ opened: 4, completed: 1, cancelled: 1, active: 2 });
  });

  it('falls back to today when the date is missing or malformed', async () => {
    const today = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().split('T')[0];

    expect((await service.getDailySales(RESTAURANT_ID, TENANT_ID)).date).toBe(today);
    expect((await service.getDailySales(RESTAURANT_ID, TENANT_ID, 'not-a-date')).date).toBe(today);
    expect((await service.getDailySales(RESTAURANT_ID, TENANT_ID, '2026-13-45')).date).toBe(today);
  });

  it('returns a zeroed report for a day with no sales', async () => {
    const res = await service.getDailySales(RESTAURANT_ID, TENANT_ID, '2026-08-14');

    expect(res.totals.totalCollected).toBe(0);
    expect(res.totals.averageOrderValue).toBe(0);
    expect(res.paymentBreakdown).toEqual([]);
    expect(res.topItems).toEqual([]);
    expect(res.hourly).toHaveLength(24);
    expect(res.restaurant).toEqual({ id: RESTAURANT_ID, name: 'The Grand Bistro' });
  });
});
