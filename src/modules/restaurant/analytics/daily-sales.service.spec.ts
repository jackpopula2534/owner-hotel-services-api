import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { RevenueSourceModule, RevenueSourceType } from '@prisma/client';
import { RestaurantDailySalesService } from './daily-sales.service';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  RevenueDocument,
  RevenueFilter,
  RevenueQueryService,
} from '../../revenue/revenue-query.service';
import type { OrderDimensionRow } from './sales-shared';

/**
 * The daily sales report is the number a manager closes the till against, so the
 * things worth pinning down are: every baht comes from the revenue ledger (not
 * from re-counting the orders table, which is how this screen used to disagree
 * with the Command Center), the day is a *Bangkok* day rather than the server's,
 * and the money adds up the way the printed receipt does.
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

/**
 * สมุดรายได้จำลอง — ตอบตามช่วงวันที่ถูกถามจริง ไม่ใช่ตามลำดับการเรียก
 * เทสต์จะได้ล้มถ้าบริการถามผิดวัน (วันนี้กับวันเทียบใช้คนละเมธอดแต่กรองแบบเดียวกัน)
 */
const makeRevenueMock = (docs: RevenueDocument[]) => {
  const inRange = (filter: RevenueFilter) =>
    docs.filter((d) => d.businessDate >= filter.from && d.businessDate <= filter.to);

  return {
    documents: jest.fn(async (filter: RevenueFilter) => inRange(filter)),
    totals: jest.fn(async (filter: RevenueFilter) => {
      const rows = inRange(filter);
      return rows.reduce(
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
      );
    }),
  };
};

describe('RestaurantDailySalesService', () => {
  let service: RestaurantDailySalesService;
  let prisma: ReturnType<typeof makePrismaMock>;
  let revenue: ReturnType<typeof makeRevenueMock>;
  /** Orders opened during the day — the operational query, independent of the ledger. */
  let opened: { status: string }[];

  /** Build the service with the ledger holding exactly these receipts. */
  const withLedger = async (receipts: Receipt[] = []): Promise<void> => {
    revenue = makeRevenueMock(receipts.map((r) => r.doc));

    prisma.order.findMany.mockImplementation(async (args: any) => {
      // The dimension fetch is keyed on the ids the ledger just handed over;
      // anything else is the operational (createdAt) query.
      const ids: string[] | undefined = args?.where?.id?.in;
      if (!ids) return opened;
      return receipts.filter((r) => ids.includes(r.order.id)).map((r) => r.order);
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RestaurantDailySalesService,
        { provide: PrismaService, useValue: prisma },
        { provide: RevenueQueryService, useValue: revenue },
      ],
    }).compile();
    service = module.get(RestaurantDailySalesService);
  };

  beforeEach(async () => {
    prisma = makePrismaMock();
    opened = [];
    prisma.restaurant.findFirst.mockResolvedValue({ id: RESTAURANT_ID, name: 'The Grand Bistro' });
    prisma.orderItem.findMany.mockResolvedValue([]);
    await withLedger();
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

  // เงินทุกบาทต้องมาจากสมุด ไม่ใช่ไปนับ orders เอง — ตอนนับเองหน้านี้กับ Command
  // Center ใช้เงื่อนไขคนละชุด ยอดเลยไม่เคยตรงกัน
  it('takes its money from the ledger, never by re-summing the orders table', async () => {
    await withLedger([receipt('2026-08-13', 'o1')]);

    await service.getDailySales(RESTAURANT_ID, TENANT_ID, '2026-08-13');

    expect(revenue.documents).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        outletId: RESTAURANT_ID,
        sourceModule: RevenueSourceModule.RESTAURANT,
        from: '2026-08-13',
        to: '2026-08-13',
      }),
    );
    // The orders table is only ever asked for operational rows or for the ids the
    // ledger already listed — never for a money filter of its own.
    for (const [args] of prisma.order.findMany.mock.calls) {
      expect(args.where.status).toBeUndefined();
      expect(args.where.paymentStatus).toBeUndefined();
      expect(args.where.completedAt).toBeUndefined();
    }
  });

  it('asks the ledger for the previous business day as the comparison', async () => {
    await service.getDailySales(RESTAURANT_ID, TENANT_ID, '2026-08-13');

    expect(revenue.totals).toHaveBeenCalledWith(
      expect.objectContaining({ from: '2026-08-12', to: '2026-08-12' }),
    );
  });

  it('counts operations over a Bangkok calendar day, not a server-local one', async () => {
    await service.getDailySales(RESTAURANT_ID, TENANT_ID, '2026-08-13');

    const opsWhere = prisma.order.findMany.mock.calls[0][0].where;
    // 2026-08-13 00:00 +07:00 is 2026-08-12T17:00Z.
    expect(opsWhere.createdAt.gte.toISOString()).toBe('2026-08-12T17:00:00.000Z');
    expect(opsWhere.createdAt.lt.toISOString()).toBe('2026-08-13T17:00:00.000Z');
    expect(opsWhere).toMatchObject({ restaurantId: RESTAURANT_ID, tenantId: TENANT_ID });
  });

  it('reads dish detail only for the bills the ledger listed', async () => {
    await withLedger([receipt('2026-08-13', 'o1'), receipt('2026-08-13', 'o2')]);

    await service.getDailySales(RESTAURANT_ID, TENANT_ID, '2026-08-13');

    expect(prisma.orderItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          order: { id: { in: ['o1', 'o2'] }, tenantId: TENANT_ID },
          status: { not: 'CANCELLED' },
        }),
      }),
    );
  });

  it('totals reconcile with the receipt: net + service + tax = collected', async () => {
    await withLedger([
      receipt('2026-08-13', 'o1'),
      receipt(
        '2026-08-13',
        'o2',
        { gross: 720, serviceCharge: 72, tax: 50.4 },
        { partySize: 4, paymentMethod: 'QR_CODE', orderType: 'TAKEAWAY' },
      ),
    ]);

    const res = await service.getDailySales(RESTAURANT_ID, TENANT_ID, '2026-08-13');

    expect(res.totals.grossSales).toBe(1820);
    expect(res.totals.netSales).toBe(1820);
    expect(res.totals.serviceCharge).toBe(182);
    expect(res.totals.tax).toBe(127.4);
    expect(res.totals.totalCollected).toBe(2129.4);
    expect(res.totals.netSales + res.totals.serviceCharge + res.totals.tax).toBeCloseTo(
      res.totals.totalCollected,
      2,
    );

    expect(res.totals.orders).toBe(2);
    expect(res.totals.guests).toBe(6);
    expect(res.totals.averageOrderValue).toBe(1064.7);
    expect(res.totals.averagePartySize).toBe(3);
    // Nothing was signed to a room, so revenue and cash agree here.
    expect(res.totals.cashCollected).toBe(2129.4);
    expect(res.totals.roomCharged).toBe(0);
  });

  // รายได้ กับ เงินสดรับ เป็นคนละตัวเลขโดยตั้งใจ: บิลที่เซ็นเข้าห้องเป็นรายได้แล้ว
  // แต่เงินยังไม่เข้าลิ้นชัก — ไปเก็บที่ folio ตอนเช็คเอาต์
  it('splits revenue from cash: a room charge counts as revenue but not as takings', async () => {
    await withLedger([
      receipt('2026-08-13', 'o1'),
      receipt(
        '2026-08-13',
        'o2',
        { gross: 720, serviceCharge: 72, tax: 50.4 },
        { partySize: 4, paymentMethod: 'ROOM_CHARGE', paymentStatus: 'CHARGED_TO_ROOM' },
      ),
    ]);

    const res = await service.getDailySales(RESTAURANT_ID, TENANT_ID, '2026-08-13');

    expect(res.totals.totalCollected).toBe(2129.4);
    expect(res.totals.cashCollected).toBe(1287);
    expect(res.totals.roomCharged).toBe(842.4);
    // The split has to account for the whole day, never a rounding gap.
    expect(res.totals.cashCollected + res.totals.roomCharged).toBeCloseTo(
      res.totals.totalCollected,
      2,
    );
  });

  it('subtracts discount from gross to get net sales', async () => {
    await withLedger([
      receipt('2026-08-13', 'o1', {
        gross: 1000,
        discount: 100,
        serviceCharge: 90,
        tax: 69.3,
      }),
    ]);

    const res = await service.getDailySales(RESTAURANT_ID, TENANT_ID, '2026-08-13');

    expect(res.totals.grossSales).toBe(1000);
    expect(res.totals.discount).toBe(100);
    expect(res.totals.netSales).toBe(900);
    expect(res.totals.totalCollected).toBe(1059.3);
  });

  it('buckets the hourly curve by Bangkok clock hour and keeps all 24 slots', async () => {
    await withLedger([
      receipt('2026-08-13', 'o1', {}, { completedAt: new Date('2026-08-13T19:45:00+07:00') }),
    ]);

    const res = await service.getDailySales(RESTAURANT_ID, TENANT_ID, '2026-08-13');

    expect(res.hourly).toHaveLength(24);
    expect(res.hourly[19]).toEqual({ hour: 19, orders: 1, amount: 1287 });
    expect(res.hourly[12]).toEqual({ hour: 12, orders: 0, amount: 0 });
  });

  // บิลที่ถูกลบทิ้งหลังลงสมุดยังต้องนับเงิน — ยอดรวมห้ามหายไปเงียบ ๆ เพราะแถวต้นทางหาย
  it('still counts a bill whose order row is gone, filed under UNKNOWN', async () => {
    const orphan = receipt('2026-08-13', 'o-deleted');
    revenue = makeRevenueMock([orphan.doc]);
    prisma.order.findMany.mockImplementation(async (args: any) =>
      args?.where?.id?.in ? [] : opened,
    );
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RestaurantDailySalesService,
        { provide: PrismaService, useValue: prisma },
        { provide: RevenueQueryService, useValue: revenue },
      ],
    }).compile();
    service = module.get(RestaurantDailySalesService);

    const res = await service.getDailySales(RESTAURANT_ID, TENANT_ID, '2026-08-13');

    expect(res.totals.totalCollected).toBe(1287);
    expect(res.orderTypeBreakdown).toEqual([
      { key: 'UNKNOWN', orders: 1, amount: 1287, share: 100 },
    ]);
  });

  it('keeps the previous day out of today and reports the change', async () => {
    await withLedger([
      receipt('2026-08-13', 'o1'),
      // Yesterday's bill — same ledger, must only appear in the comparison.
      receipt('2026-08-12', 'o0', { gross: 1000, serviceCharge: 0, tax: 0 }),
    ]);

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
    await withLedger([receipt('2026-08-13', 'o1')]);

    const res = await service.getDailySales(RESTAURANT_ID, TENANT_ID, '2026-08-13');

    expect(res.comparison.totalCollected).toBe(0);
    expect(res.comparison.changePct).toBeNull();
  });

  it('breaks revenue down by payment method and order type with shares', async () => {
    await withLedger([
      receipt('2026-08-13', 'o1', { gross: 750, serviceCharge: 0, tax: 0 }),
      receipt(
        '2026-08-13',
        'o2',
        { gross: 250, serviceCharge: 0, tax: 0 },
        { paymentMethod: 'CREDIT_CARD', orderType: 'ROOM_SERVICE' },
      ),
    ]);

    const res = await service.getDailySales(RESTAURANT_ID, TENANT_ID, '2026-08-13');

    expect(res.paymentBreakdown).toEqual([
      { key: 'CASH', orders: 1, amount: 750, share: 75 },
      { key: 'CREDIT_CARD', orders: 1, amount: 250, share: 25 },
    ]);
    expect(res.orderTypeBreakdown.map((r) => r.key)).toEqual(['DINE_IN', 'ROOM_SERVICE']);
  });

  it('ranks top items by quantity and caps the list at ten', async () => {
    await withLedger([receipt('2026-08-13', 'o1')]);
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

  // ใบสั่งที่เปิดแล้วยังไม่จ่ายไม่มีแถวในสมุด แต่ต้องยังเห็นบนหน้าจอปฏิบัติการ
  it('counts operations from orders opened during the day, ledger or not', async () => {
    opened = [
      { status: 'COMPLETED' },
      { status: 'CANCELLED' },
      { status: 'PENDING' },
      { status: 'PREPARING' },
    ];
    await withLedger();

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
