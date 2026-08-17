import { Test, TestingModule } from '@nestjs/testing';
import { RevenueSourceModule, RevenueSourceType } from '@prisma/client';
import { RestaurantAnalyticsService } from './analytics.service';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  RevenueDocument,
  RevenueFilter,
  RevenueQueryService,
} from '../../revenue/revenue-query.service';
import type { OrderDimensionRow } from './sales-shared';

/**
 * These are the older outlet analytics — the revenue timeline, the day overview,
 * table utilisation and the hourly heatmap. What they must get right:
 *
 *  - **เงินมาจากสมุดรายได้เท่านั้น** ไม่ใช่บวก orders.total เอง (เคยเป็นแบบนั้น
 *    แล้วยอดหน้านี้ไม่ตรงกับรายงานรายวันและกับ Command Center)
 *  - **วันตัดที่เที่ยงคืนกรุงเทพ** ไม่ใช่เที่ยงคืนของเครื่องที่รันอยู่
 *  - the daily-summary widget must degrade to zeros instead of throwing a 500 —
 *    an invalid ?date= used to reach `toISOString()` and blow up the page.
 */

const RESTAURANT_ID = 'rest-1';
const TENANT_ID = 'tenant-1';

/** สลิปหนึ่งใบ: แถวที่สมุดลงไว้ + แถวใบสั่งที่รายงานเอามาต่อมิติ */
interface Receipt {
  doc: RevenueDocument;
  order: OrderDimensionRow & { tableId?: string | null; createdAt?: Date };
}

const receipt = (
  businessDate: string,
  id: string,
  money: Partial<Pick<RevenueDocument, 'gross' | 'discount' | 'serviceCharge' | 'tax'>> = {},
  dimensions: Partial<Receipt['order']> = {},
): Receipt => {
  const gross = money.gross ?? 1000;
  const discount = money.discount ?? 0;
  const serviceCharge = money.serviceCharge ?? 0;
  const tax = money.tax ?? 0;
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
      createdAt: new Date(`${businessDate}T11:00:00+07:00`),
      tableId: null,
      ...dimensions,
    },
  };
};

const makePrismaMock = () => ({
  order: { findMany: jest.fn() },
  orderItem: { findMany: jest.fn() },
  kitchenOrder: { findMany: jest.fn() },
  restaurantTable: { findMany: jest.fn() },
});

/** สมุดรายได้จำลอง — ตอบตามช่วงวันที่ถูกถามจริง */
const makeRevenueMock = (docs: RevenueDocument[]) => ({
  documents: jest.fn(async (filter: RevenueFilter) =>
    docs.filter((d) => d.businessDate >= filter.from && d.businessDate <= filter.to),
  ),
});

describe('RestaurantAnalyticsService', () => {
  let service: RestaurantAnalyticsService;
  let prisma: ReturnType<typeof makePrismaMock>;
  let revenue: ReturnType<typeof makeRevenueMock>;
  /** Orders opened in the window — the operational query, independent of the ledger. */
  let opened: { status: string }[];

  const withLedger = async (receipts: Receipt[] = []): Promise<void> => {
    revenue = makeRevenueMock(receipts.map((r) => r.doc));

    prisma.order.findMany.mockImplementation(async (args: any) => {
      const ids: string[] | undefined = args?.where?.id?.in;
      if (!ids) return opened;
      const rows = receipts.filter((r) => ids.includes(r.order.id)).map((r) => r.order);
      // The table report asks only for bills that sat at a table.
      return args.where.tableId ? rows.filter((r) => r.tableId) : rows;
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RestaurantAnalyticsService,
        { provide: PrismaService, useValue: prisma },
        { provide: RevenueQueryService, useValue: revenue },
      ],
    }).compile();
    service = module.get(RestaurantAnalyticsService);
    // Silence the expected error log from the fallback path.
    jest.spyOn(service['logger'], 'error').mockImplementation(() => undefined);
  };

  const ledgerFilters = (): RevenueFilter[] =>
    revenue.documents.mock.calls.map(([filter]) => filter as RevenueFilter);

  beforeEach(async () => {
    prisma = makePrismaMock();
    opened = [];
    prisma.orderItem.findMany.mockResolvedValue([]);
    prisma.kitchenOrder.findMany.mockResolvedValue([]);
    prisma.restaurantTable.findMany.mockResolvedValue([]);
    await withLedger();
  });

  describe('getRevenueSummary', () => {
    it('scopes the ledger to this outlet and an inclusive Bangkok date range', async () => {
      await withLedger([receipt('2026-08-13', 'o1')]);

      await service.getRevenueSummary(RESTAURANT_ID, TENANT_ID, {
        from: '2026-08-01',
        to: '2026-08-31',
      });

      expect(revenue.documents).toHaveBeenCalledWith({
        tenantId: TENANT_ID,
        outletId: RESTAURANT_ID,
        sourceModule: RevenueSourceModule.RESTAURANT,
        from: '2026-08-01',
        to: '2026-08-31',
      });
    });

    // A 'YYYY-MM-DD' has no timezone of its own; parsing it as an instant first
    // would move it a day backwards for anyone east of UTC.
    it('takes a plain date verbatim and an ISO instant as its Bangkok day', async () => {
      await service.getRevenueSummary(RESTAURANT_ID, TENANT_ID, {
        // 2026-08-13T18:30Z is already 2026-08-14 in Bangkok.
        from: '2026-08-13T18:30:00.000Z',
        to: '2026-08-20',
      });

      expect(ledgerFilters()[0]).toMatchObject({ from: '2026-08-14', to: '2026-08-20' });
    });

    it('reads its money from the ledger, never by re-summing the orders table', async () => {
      await withLedger([receipt('2026-08-13', 'o1', { gross: 1000, serviceCharge: 100, tax: 77 })]);

      const res = await service.getRevenueSummary(RESTAURANT_ID, TENANT_ID, {
        from: '2026-08-01',
        to: '2026-08-31',
      });

      expect(res.summary.totalRevenue).toBe(1177);
      // gross − discount: what accounting recognises, service charge and VAT excluded.
      expect(res.summary.netRevenue).toBe(1000);
      for (const [args] of prisma.order.findMany.mock.calls) {
        expect(args.where.status).toBeUndefined();
        expect(args.where.paymentStatus).toBeUndefined();
        expect(args.where.completedAt).toBeUndefined();
      }
    });

    it('buckets the timeline by the ledger business date, and the buckets re-total to the headline', async () => {
      await withLedger([
        receipt('2026-08-13', 'o1'),
        receipt('2026-08-14', 'o2', { gross: 500 }),
        receipt('2026-08-14', 'o3', { gross: 250 }),
      ]);

      const res = await service.getRevenueSummary(RESTAURANT_ID, TENANT_ID, {
        from: '2026-08-01',
        to: '2026-08-31',
      });

      expect(res.timeline).toEqual([
        expect.objectContaining({ date: '2026-08-13', revenue: 1000, orders: 1 }),
        expect.objectContaining({ date: '2026-08-14', revenue: 750, orders: 2 }),
      ]);
      expect(res.timeline.reduce((sum, row) => sum + row.revenue, 0)).toBe(
        res.summary.totalRevenue,
      );
      expect(res.summary.totalOrders).toBe(3);
    });

    it('groups by week starting Sunday and by calendar month', async () => {
      await withLedger([
        // 2026-08-13 is a Thursday; its week starts Sunday 2026-08-09.
        receipt('2026-08-13', 'o1'),
        receipt('2026-09-02', 'o2', { gross: 500 }),
      ]);

      const weekly = await service.getRevenueSummary(RESTAURANT_ID, TENANT_ID, {
        from: '2026-08-01',
        to: '2026-09-30',
        groupBy: 'week',
      });
      expect(weekly.timeline.map((row) => row.date)).toEqual(['2026-08-09', '2026-08-30']);

      const monthly = await service.getRevenueSummary(RESTAURANT_ID, TENANT_ID, {
        from: '2026-08-01',
        to: '2026-09-30',
        groupBy: 'month',
      });
      expect(monthly.timeline.map((row) => row.date)).toEqual(['2026-08', '2026-09']);
    });

    it('breaks the range down by payment method and order type', async () => {
      await withLedger([
        receipt('2026-08-13', 'o1', { gross: 750 }),
        receipt(
          '2026-08-14',
          'o2',
          { gross: 250 },
          { paymentMethod: 'CREDIT_CARD', orderType: 'TAKEAWAY' },
        ),
      ]);

      const res = await service.getRevenueSummary(RESTAURANT_ID, TENANT_ID, {
        from: '2026-08-01',
        to: '2026-08-31',
      });

      expect(res.paymentBreakdown).toEqual({
        CASH: { count: 1, total: 750 },
        CREDIT_CARD: { count: 1, total: 250 },
      });
      expect(res.orderTypeBreakdown).toEqual({
        DINE_IN: { count: 1, total: 750 },
        TAKEAWAY: { count: 1, total: 250 },
      });
    });
  });

  describe('getDailySummary', () => {
    it('aggregates a normal day: money from the ledger, counts from the orders table', async () => {
      opened = [{ status: 'COMPLETED' }, { status: 'PENDING' }];
      await withLedger([receipt('2026-08-13', 'o1', { gross: 250 })]);
      prisma.restaurantTable.findMany.mockResolvedValue([
        { id: 't1', capacity: 4, status: 'OCCUPIED' },
      ]);

      const res = await service.getDailySummary(RESTAURANT_ID, TENANT_ID, '2026-08-13');

      expect(res.revenue.total).toBe(250);
      expect(res.orders).toMatchObject({ total: 2, completed: 1, active: 1, billed: 1 });
      expect(res.guests).toMatchObject({ total: 2, averagePartySize: 2 });
      expect(res.tables).toMatchObject({ total: 1, occupied: 1, totalCapacity: 4 });
    });

    it('counts the operational day from Bangkok midnight, not the server clock', async () => {
      await service.getDailySummary(RESTAURANT_ID, TENANT_ID, '2026-08-13');

      const opsWhere = prisma.order.findMany.mock.calls[0][0].where;
      expect(opsWhere.createdAt.gte.toISOString()).toBe('2026-08-12T17:00:00.000Z');
      expect(opsWhere.createdAt.lt.toISOString()).toBe('2026-08-13T17:00:00.000Z');
      expect(ledgerFilters()[0]).toMatchObject({ from: '2026-08-13', to: '2026-08-13' });
    });

    it('falls back to today (not a crash) when date is invalid', async () => {
      const res = await service.getDailySummary(RESTAURANT_ID, TENANT_ID, 'not-a-date');

      // A valid ISO date string of length 10, not "Invalid Date".
      expect(res.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(res.revenue.total).toBe(0);
    });

    it('returns a zeroed summary instead of throwing when the ledger fails', async () => {
      revenue.documents.mockRejectedValue(new Error('db down'));

      const res = await service.getDailySummary(RESTAURANT_ID, TENANT_ID, '2026-08-13');

      expect(res).toMatchObject({
        date: '2026-08-13',
        revenue: { total: 0, averageOrderValue: 0 },
        orders: { total: 0, completed: 0, cancelled: 0, active: 0 },
        tables: { total: 0, totalCapacity: 0 },
      });
    });
  });

  describe('getTableUtilization', () => {
    it('pours ledger money into the tables that served the bills', async () => {
      await withLedger([
        receipt('2026-08-13', 'o1', { gross: 600 }, { tableId: 't1', partySize: 3 }),
        receipt('2026-08-13', 'o2', { gross: 400 }, { tableId: 't1', partySize: 2 }),
        // Takeaway: billed and counted in the totals, but sat at no table.
        receipt('2026-08-13', 'o3', { gross: 100 }, { tableId: null, orderType: 'TAKEAWAY' }),
      ]);
      prisma.restaurantTable.findMany.mockResolvedValue([
        { id: 't1', tableNumber: 'A1', capacity: 4, zone: 'Main' },
        { id: 't2', tableNumber: 'A2', capacity: 2, zone: 'Main' },
      ]);

      const res = await service.getTableUtilization(RESTAURANT_ID, TENANT_ID, {
        from: '2026-08-13',
        to: '2026-08-13',
      });

      expect(res.tables[0]).toMatchObject({
        tableId: 't1',
        ordersServed: 2,
        totalRevenue: 1000,
        totalGuests: 5,
        revenuePerSeat: 250,
      });
      expect(res.tables[1]).toMatchObject({ tableId: 't2', ordersServed: 0, totalRevenue: 0 });
      expect(res.totals).toMatchObject({ totalTables: 2, totalOrders: 3, totalRevenue: 1100 });
    });

    it('defaults to the last seven Bangkok days', async () => {
      await service.getTableUtilization(RESTAURANT_ID, TENANT_ID, { to: '2026-08-13' });

      expect(ledgerFilters()[0]).toMatchObject({ from: '2026-08-07', to: '2026-08-13' });
    });
  });

  describe('getHourlyHeatmap', () => {
    it('places a bill on its business weekday and its Bangkok closing hour', async () => {
      await withLedger([
        // Thursday 2026-08-13, closed 19:45 Bangkok.
        receipt(
          '2026-08-13',
          'o1',
          { gross: 900 },
          { completedAt: new Date('2026-08-13T19:45:00+07:00') },
        ),
        // Closed after midnight but still filed under the 13th — the trading day
        // decides the weekday, the clock decides the column.
        receipt(
          '2026-08-13',
          'o2',
          { gross: 100 },
          { completedAt: new Date('2026-08-14T00:30:00+07:00') },
        ),
      ]);

      const res = await service.getHourlyHeatmap(RESTAURANT_ID, TENANT_ID, {
        from: '2026-08-13',
        to: '2026-08-14',
      });

      expect(res.heatmap).toEqual([
        { day: 4, hour: 0, orders: 1, revenue: 100, dayName: 'Thursday' },
        { day: 4, hour: 19, orders: 1, revenue: 900, dayName: 'Thursday' },
      ]);
    });
  });

  describe('getTopMenuItems', () => {
    it('reads dish lines only for the bills the ledger listed', async () => {
      await withLedger([receipt('2026-08-13', 'o1'), receipt('2026-08-14', 'o2')]);
      prisma.orderItem.findMany.mockResolvedValue([
        {
          quantity: 2,
          unitPrice: '100.00',
          totalPrice: '200.00',
          menuItem: { id: 'm1', name: 'Pad Thai', category: { id: 'c1', name: 'Main' } },
        },
      ]);

      const res = await service.getTopMenuItems(RESTAURANT_ID, TENANT_ID, {
        from: '2026-08-01',
        to: '2026-08-31',
      });

      expect(prisma.orderItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            order: { id: { in: ['o1', 'o2'] }, tenantId: TENANT_ID },
            status: { not: 'CANCELLED' },
          }),
        }),
      );
      expect(res[0]).toMatchObject({ menuItemId: 'm1', quantity: 2, revenue: 200 });
    });

    it('skips the line query entirely when nothing was billed', async () => {
      const res = await service.getTopMenuItems(RESTAURANT_ID, TENANT_ID, {
        from: '2026-08-01',
        to: '2026-08-31',
      });

      expect(res).toEqual([]);
      expect(prisma.orderItem.findMany).not.toHaveBeenCalled();
    });
  });
});
