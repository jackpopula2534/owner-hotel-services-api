import { Test, TestingModule } from '@nestjs/testing';
import { RevenueSourceModule } from '@prisma/client';
import { BusinessOverviewService, OverviewModuleCode } from './business-overview.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AddonService } from '../addons/addon.service';
import { RevenueQueryService } from '../revenue/revenue-query.service';
import {
  LedgerRow,
  RevenueQueryStub,
  buildRevenueQueryStub,
  ledgerFiltersOf,
} from '../revenue/__tests__/revenue-query.stub';

/**
 * The Command Center home is the one screen that claims to show "everything".
 * What must hold, no matter what the tenant has bought:
 *
 *  - a module the tenant has no add-on for and no money in never appears (the
 *    page must not advertise a system behind a paywall),
 *  - a module the tenant has lost but earned money in still reports that money,
 *    and nothing else — the day has to add up, but no queue is offered behind a
 *    lock,
 *  - the headline is the ledger's total for the tenant, so letting an add-on go
 *    cannot make revenue disappear from the page,
 *  - purchasing rides on the stock add-on, exactly as the sidebar gates it,
 *  - one broken module degrades to an empty tile instead of blanking the page,
 *  - every money figure is asked of the revenue ledger, never re-derived here,
 *  - the day is cut at Bangkok midnight, not UTC midnight.
 */

const TENANT_ID = 'tenant-1';
const PROPERTY_ID = 'prop-1';

const makePrismaMock = () => ({
  room: { count: jest.fn().mockResolvedValue(0) },
  booking: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]) },
  payments: { count: jest.fn().mockResolvedValue(0) },
  restaurant: { count: jest.fn().mockResolvedValue(0) },
  order: {
    count: jest.fn().mockResolvedValue(0),
    aggregate: jest.fn().mockResolvedValue({ _sum: { total: null }, _count: { _all: 0 } }),
  },
  inventoryItem: { findMany: jest.fn().mockResolvedValue([]) },
  inventoryLot: { count: jest.fn().mockResolvedValue(0) },
  retailSale: { aggregate: jest.fn().mockResolvedValue({ _sum: { grandTotal: null } }) },
  purchaseRequisition: { count: jest.fn().mockResolvedValue(0) },
  purchaseOrder: { count: jest.fn().mockResolvedValue(0) },
  goodsReceive: { count: jest.fn().mockResolvedValue(0) },
  accountChart: { count: jest.fn().mockResolvedValue(0) },
  arInvoice: {
    count: jest.fn().mockResolvedValue(0),
    aggregate: jest.fn().mockResolvedValue({ _sum: { balance: null } }),
  },
  apInvoice: {
    count: jest.fn().mockResolvedValue(0),
    aggregate: jest.fn().mockResolvedValue({ _sum: { balance: null } }),
  },
  journalEntry: { count: jest.fn().mockResolvedValue(0) },
  costEntry: {
    count: jest.fn().mockResolvedValue(0),
    aggregate: jest.fn().mockResolvedValue({ _sum: { amount: null } }),
  },
  employee: { count: jest.fn().mockResolvedValue(0) },
  hrLeaveRequest: { count: jest.fn().mockResolvedValue(0) },
  campPitch: { count: jest.fn().mockResolvedValue(0) },
  campReservation: { count: jest.fn().mockResolvedValue(0) },
});

const addonRow = (code: string) => ({
  code,
  name: code,
  isActive: true,
  expiresAt: null,
  source: 'plan',
});

const TODAY = '2026-08-14';
const YESTERDAY = '2026-08-13';
/** 2026-08-14 12:00 Bangkok. */
const NOON = new Date('2026-08-14T05:00:00.000Z');

/**
 * One sale in the fake book. Hotel and restaurant rows carry the property they
 * were earned at, the way the posting sources file them; shop and campground
 * rows do not, because neither sits inside a hotel.
 */
const sale = (
  sourceModule: RevenueSourceModule,
  businessDate: string,
  amount: number,
  extra: Partial<LedgerRow> = {},
): LedgerRow => ({
  businessDate,
  sourceId: `${sourceModule}-${businessDate}-${amount}`,
  amount,
  sourceModule,
  propertyId:
    sourceModule === RevenueSourceModule.HOTEL || sourceModule === RevenueSourceModule.RESTAURANT
      ? PROPERTY_ID
      : null,
  ...extra,
});

describe('BusinessOverviewService', () => {
  let service: BusinessOverviewService;
  let prisma: ReturnType<typeof makePrismaMock>;
  let addons: { getActiveAddons: jest.Mock; getTenantSystem: jest.Mock };
  let revenue: RevenueQueryStub;

  const codes = (modules: Array<{ code: OverviewModuleCode }>) => modules.map((m) => m.code);
  const tile = <T extends { code: OverviewModuleCode }>(
    modules: T[],
    code: OverviewModuleCode,
  ): T | undefined => modules.find((m) => m.code === code);

  /** Rebuild the service over a book holding exactly `rows`. */
  const withLedger = async (rows: LedgerRow[] = []): Promise<void> => {
    revenue = buildRevenueQueryStub(rows);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BusinessOverviewService,
        { provide: PrismaService, useValue: prisma },
        { provide: AddonService, useValue: addons },
        { provide: RevenueQueryService, useValue: revenue },
      ],
    }).compile();
    service = module.get(BusinessOverviewService);
  };

  /** Run the page as it looked at noon on {@link TODAY}. */
  const overviewAtNoon = async () => {
    jest.useFakeTimers().setSystemTime(NOON);
    try {
      return await service.getBusinessOverview(TENANT_ID, PROPERTY_ID);
    } finally {
      jest.useRealTimers();
    }
  };

  beforeEach(async () => {
    prisma = makePrismaMock();
    addons = {
      getActiveAddons: jest.fn().mockResolvedValue([]),
      getTenantSystem: jest.fn().mockResolvedValue('HOTEL'),
    };
    await withLedger();
  });

  // ─── Entitlements ────────────────────────────────────────────────────────

  it('shows the hotel alone when the tenant owns no add-ons', async () => {
    const overview = await service.getBusinessOverview(TENANT_ID, PROPERTY_ID);

    expect(codes(overview.modules)).toEqual(['HOTEL']);
  });

  it('adds a module only once its add-on is active', async () => {
    addons.getActiveAddons.mockResolvedValue([addonRow('RESTAURANT_MODULE')]);

    const overview = await service.getBusinessOverview(TENANT_ID, PROPERTY_ID);

    expect(codes(overview.modules)).toEqual(['HOTEL', 'RESTAURANT_MODULE']);
    expect(tile(overview.modules, 'RESTAURANT_MODULE')?.entitlement).toBe('owned');
  });

  it('never reports an add-on the tenant holds but is no longer active', async () => {
    addons.getActiveAddons.mockResolvedValue([{ ...addonRow('HR_MODULE'), isActive: false }]);

    const overview = await service.getBusinessOverview(TENANT_ID, PROPERTY_ID);

    expect(codes(overview.modules)).not.toContain('HR_MODULE');
  });

  it('lets purchasing ride on the stock add-on, the way the sidebar gates it', async () => {
    addons.getActiveAddons.mockResolvedValue([addonRow('INVENTORY_MODULE')]);

    const overview = await service.getBusinessOverview(TENANT_ID, PROPERTY_ID);

    expect(codes(overview.modules)).toEqual(['HOTEL', 'INVENTORY_MODULE', 'PROCUREMENT']);
  });

  it('falls back to the hotel when entitlements cannot be read', async () => {
    addons.getActiveAddons.mockRejectedValue(new Error('cache down'));

    const overview = await service.getBusinessOverview(TENANT_ID, PROPERTY_ID);

    expect(codes(overview.modules)).toEqual(['HOTEL']);
  });

  it('leaves the hotel off a campground tenant’s page — separate products', async () => {
    // ลานกางเต็นท์ขายแปลง ไม่ได้ขายห้อง ถังโรงแรมว่าง ๆ ที่ชวนไป "ตั้งค่าห้องพัก"
    // ไม่ใช่ภาพรวมของธุรกิจเขา
    addons.getTenantSystem.mockResolvedValue('CAMP');
    addons.getActiveAddons.mockResolvedValue([addonRow('CAMP_MODULE')]);
    prisma.campPitch.count.mockResolvedValue(20);

    const overview = await service.getBusinessOverview(TENANT_ID, PROPERTY_ID);

    expect(codes(overview.modules)).toEqual(['CAMP_MODULE']);
    expect(prisma.room.count).not.toHaveBeenCalled();
  });

  it('still reports hotel money a campground tenant somehow holds', async () => {
    // กติกาเดียวกันทับกันได้: ไม่ใช่สินค้าของเขาแล้ว แต่เงินในสมุดไม่หายจากหน้าจอ
    addons.getTenantSystem.mockResolvedValue('CAMP');
    addons.getActiveAddons.mockResolvedValue([addonRow('CAMP_MODULE')]);
    await withLedger([sale(RevenueSourceModule.HOTEL, TODAY, 900)]);

    const overview = await overviewAtNoon();

    expect(tile(overview.modules, 'HOTEL')).toMatchObject({ entitlement: 'lapsed', revenueToday: 900 });
    expect(overview.revenue.today).toBe(900);
  });

  it('falls back to the hotel when the product line cannot be read', async () => {
    addons.getTenantSystem.mockRejectedValue(new Error('cache down'));

    const overview = await service.getBusinessOverview(TENANT_ID, PROPERTY_ID);

    expect(codes(overview.modules)).toEqual(['HOTEL']);
  });

  it('returns an empty overview for a caller with no tenant', async () => {
    const overview = await service.getBusinessOverview(undefined, PROPERTY_ID);

    expect(overview.modules).toEqual([]);
    expect(overview.revenue.today).toBe(0);
    expect(addons.getActiveAddons).not.toHaveBeenCalled();
  });

  // ─── owned / lapsed / never ──────────────────────────────────────────────

  describe('BusinessOverviewService — สิทธิ์ที่หมดไปแล้ว (lapsed)', () => {
    it('ยอดขายของโมดูลที่หมดสิทธิ์ยังอยู่ในยอดรวมของวัน', async () => {
      // ลดแพลนตอนเที่ยง บิลอาหารของเช้านี้ยังอยู่ในสมุด — หน้ารวมจะทำเป็นไม่เห็นไม่ได้
      await withLedger([
        sale(RevenueSourceModule.HOTEL, TODAY, 4500),
        sale(RevenueSourceModule.RESTAURANT, TODAY, 388),
      ]);

      const overview = await overviewAtNoon();

      expect(overview.revenue.today).toBe(4888);
      expect(overview.revenue.sources).toEqual([
        { code: 'HOTEL', amount: 4500 },
        { code: 'RESTAURANT_MODULE', amount: 388 },
      ]);
    });

    it('โมดูลที่หมดสิทธิ์ยังมีถังของตัวเอง ติดป้ายว่า lapsed', async () => {
      await withLedger([sale(RevenueSourceModule.RESTAURANT, TODAY, 388)]);

      const overview = await overviewAtNoon();
      const fnb = tile(overview.modules, 'RESTAURANT_MODULE');

      expect(fnb).toMatchObject({
        entitlement: 'lapsed',
        state: 'ok',
        openItems: 0,
        revenueToday: 388,
        metrics: [{ key: 'revenueToday', value: 388, format: 'currency' }],
      });
    });

    it('โมดูลที่หมดสิทธิ์ไม่ถูกถามเรื่องงานค้าง — เปิดระบบนั้นไม่ได้แล้ว', async () => {
      prisma.restaurant.count.mockResolvedValue(3);
      prisma.order.count.mockResolvedValue(9);
      await withLedger([sale(RevenueSourceModule.RESTAURANT, TODAY, 388)]);

      const overview = await overviewAtNoon();

      expect(prisma.restaurant.count).not.toHaveBeenCalled();
      expect(prisma.order.count).not.toHaveBeenCalled();
      expect(overview.openItems).toBe(0);
    });

    it('ยอดของเมื่อวานก็รั้งถังไว้ ไม่งั้นเปอร์เซ็นต์เทียบวันก่อนโกหก', async () => {
      // ทดลองใช้ร้านอาหารหมดอายุเมื่อคืน เมื่อวานขายได้ วันนี้ขายไม่ได้
      await withLedger([
        sale(RevenueSourceModule.HOTEL, TODAY, 1000),
        sale(RevenueSourceModule.HOTEL, YESTERDAY, 1000),
        sale(RevenueSourceModule.RESTAURANT, YESTERDAY, 1000),
      ]);

      const overview = await overviewAtNoon();

      expect(overview.revenue.yesterday).toBe(2000);
      // ยอดตกครึ่งหนึ่งจริง ๆ ถ้าตัดร้านอาหารทิ้งจะรายงานว่า "เท่าเดิม"
      expect(overview.revenue.changePct).toBe(-50);
      expect(tile(overview.modules, 'RESTAURANT_MODULE')).toMatchObject({
        entitlement: 'lapsed',
        revenueToday: 0,
      });
    });

    it('โมดูลที่ไม่เคยซื้อและไม่เคยมีเงิน ไม่โผล่บนหน้าจอ', async () => {
      await withLedger([sale(RevenueSourceModule.HOTEL, TODAY, 4500)]);

      const overview = await overviewAtNoon();

      expect(codes(overview.modules)).toEqual(['HOTEL']);
      expect(prisma.employee.count).not.toHaveBeenCalled();
      expect(prisma.accountChart.count).not.toHaveBeenCalled();
    });

    it('จัดซื้อไม่มีวันเป็น lapsed — ไม่เคยมีรายได้ให้ค้างอยู่ในสมุด', async () => {
      await withLedger([sale(RevenueSourceModule.RETAIL, TODAY, 270)]);

      const overview = await overviewAtNoon();

      expect(codes(overview.modules)).toEqual(['HOTEL', 'INVENTORY_MODULE']);
      expect(tile(overview.modules, 'INVENTORY_MODULE')?.entitlement).toBe('lapsed');
    });

    it('ยอดรวมหัวหน้าเพจไม่ขยับตามสิทธิ์ — สมุดเล่มเดียวกันต้องได้ยอดเดียวกัน', async () => {
      // ข้อบกพร่องเดิม: ยอดรวมคือผลบวกของถังที่ "มีสิทธิ์" ลดแพลนแล้วเงินหายจากหน้าจอ
      const book = [
        sale(RevenueSourceModule.HOTEL, TODAY, 4500),
        sale(RevenueSourceModule.RESTAURANT, TODAY, 388),
        sale(RevenueSourceModule.RETAIL, TODAY, 270),
      ];

      addons.getActiveAddons.mockResolvedValue([
        addonRow('RESTAURANT_MODULE'),
        addonRow('INVENTORY_MODULE'),
      ]);
      await withLedger(book);
      const entitled = await overviewAtNoon();

      addons.getActiveAddons.mockResolvedValue([]);
      await withLedger(book);
      const downgraded = await overviewAtNoon();

      expect(entitled.revenue.today).toBe(5158);
      expect(downgraded.revenue.today).toBe(entitled.revenue.today);
      expect(downgraded.revenue.sources).toEqual(entitled.revenue.sources);
    });
  });

  // ─── Resilience ──────────────────────────────────────────────────────────

  it('keeps the rest of the page when one module throws', async () => {
    addons.getActiveAddons.mockResolvedValue([addonRow('ACCOUNTING_MODULE')]);
    prisma.accountChart.count.mockRejectedValue(new Error('Table does not exist'));
    prisma.room.count.mockResolvedValue(20);

    const overview = await service.getBusinessOverview(TENANT_ID, PROPERTY_ID);

    expect(codes(overview.modules)).toEqual(['HOTEL', 'ACCOUNTING_MODULE']);
    expect(tile(overview.modules, 'HOTEL')?.metrics).toContainEqual({
      key: 'occupancy',
      value: 0,
      format: 'percent',
    });
    expect(tile(overview.modules, 'ACCOUNTING_MODULE')).toMatchObject({
      state: 'setup',
      metrics: [],
      openItems: 0,
    });
  });

  it('keeps a module’s takings even when the module itself fails', async () => {
    // เงินมาจากสมุด ไม่ได้มาจากถัง ถังพังจึงไม่ทำให้ยอดขายของวันหาย
    addons.getActiveAddons.mockResolvedValue([addonRow('RESTAURANT_MODULE')]);
    prisma.restaurant.count.mockRejectedValue(new Error('Table does not exist'));
    await withLedger([sale(RevenueSourceModule.RESTAURANT, TODAY, 388)]);

    const overview = await overviewAtNoon();

    expect(tile(overview.modules, 'RESTAURANT_MODULE')).toMatchObject({
      entitlement: 'owned',
      state: 'setup',
      revenueToday: 388,
    });
    expect(overview.revenue.today).toBe(388);
  });

  // ─── Revenue roll-up ─────────────────────────────────────────────────────

  it('adds up today revenue across every selling module', async () => {
    addons.getActiveAddons.mockResolvedValue([
      addonRow('RESTAURANT_MODULE'),
      addonRow('INVENTORY_MODULE'),
    ]);
    prisma.room.count.mockResolvedValue(10);
    prisma.restaurant.count.mockResolvedValue(1);
    await withLedger([
      sale(RevenueSourceModule.HOTEL, TODAY, 3500),
      sale(RevenueSourceModule.RESTAURANT, TODAY, 1287),
      sale(RevenueSourceModule.RETAIL, TODAY, 213),
    ]);

    const overview = await overviewAtNoon();

    expect(overview.revenue.today).toBe(3500 + 1287 + 213);
    expect(overview.revenue.sources).toEqual([
      { code: 'HOTEL', amount: 3500 },
      { code: 'RESTAURANT_MODULE', amount: 1287 },
      { code: 'INVENTORY_MODULE', amount: 213 },
    ]);
  });

  it('lists every baht of the headline under a module, reversals included', async () => {
    // บิลเมื่อวานที่ถูกยกเลิกวันนี้ลงเป็นแถวติดลบ ถ้าคัดเฉพาะยอดบวกออกมาโชว์
    // ผลรวมของรายการย่อยจะไม่เท่ายอดหัวเพจ
    await withLedger([
      sale(RevenueSourceModule.HOTEL, TODAY, 4500),
      sale(RevenueSourceModule.RESTAURANT, TODAY, -388),
    ]);

    const overview = await overviewAtNoon();
    const listed = overview.revenue.sources.reduce((sum, source) => sum + source.amount, 0);

    expect(listed).toBe(overview.revenue.today);
    expect(overview.revenue.sources).toContainEqual({ code: 'RESTAURANT_MODULE', amount: -388 });
  });

  it('reports no change rather than an infinite one when yesterday took nothing', async () => {
    await withLedger([sale(RevenueSourceModule.HOTEL, TODAY, 1000)]);

    const overview = await overviewAtNoon();

    expect(overview.revenue.yesterday).toBe(0);
    expect(overview.revenue.changePct).toBeNull();
  });

  it('states the change against yesterday as a percentage', async () => {
    await withLedger([
      sale(RevenueSourceModule.HOTEL, TODAY, 1500),
      sale(RevenueSourceModule.HOTEL, YESTERDAY, 1000),
    ]);

    const overview = await overviewAtNoon();

    expect(overview.revenue.changePct).toBe(50);
  });

  it('takes room revenue from the ledger instead of counting bookings itself', async () => {
    await service.getBusinessOverview(TENANT_ID, PROPERTY_ID);

    expect(prisma.booking.findMany).not.toHaveBeenCalled();
    const asked = revenue.byModule.mock.calls.flatMap(([filter]) => filter.sourceModule ?? []);
    expect(asked).toContain(RevenueSourceModule.HOTEL);
  });

  it('narrows revenue earned inside a hotel to the property being viewed', async () => {
    await service.getBusinessOverview(TENANT_ID, PROPERTY_ID);

    const bound = revenue.byModule.mock.calls
      .map(([filter]) => filter)
      .filter((filter) =>
        [filter.sourceModule].flat().includes(RevenueSourceModule.HOTEL),
      );
    expect(bound.length).toBeGreaterThan(0);
    for (const filter of bound) expect(filter.propertyId).toBe(PROPERTY_ID);
  });

  it('keeps shop and campground takings tenant-wide — neither sits inside a hotel', async () => {
    await service.getBusinessOverview(TENANT_ID, PROPERTY_ID);

    const wide = revenue.byModule.mock.calls
      .map(([filter]) => filter)
      .filter((filter) =>
        [filter.sourceModule].flat().includes(RevenueSourceModule.RETAIL),
      );
    expect(wide.length).toBeGreaterThan(0);
    for (const filter of wide) {
      expect(filter.propertyId).toBeUndefined();
      expect([filter.sourceModule].flat()).toContain(RevenueSourceModule.CAMP);
    }
  });

  // ─── Campground ──────────────────────────────────────────────────────────

  it('names campground takings instead of leaving them out of the day', async () => {
    prisma.campPitch.count.mockResolvedValue(12);
    addons.getActiveAddons.mockResolvedValue([addonRow('CAMP_MODULE')]);
    await withLedger([sale(RevenueSourceModule.CAMP, TODAY, 2400)]);

    const overview = await overviewAtNoon();

    expect(overview.revenue.today).toBe(2400);
    expect(overview.revenue.sources).toContainEqual({ code: 'CAMP_MODULE', amount: 2400 });
    expect(tile(overview.modules, 'CAMP_MODULE')).toMatchObject({
      entitlement: 'owned',
      revenueToday: 2400,
    });
    expect(tile(overview.modules, 'CAMP_MODULE')?.metrics).toContainEqual({
      key: 'pitches',
      value: 12,
      format: 'number',
    });
  });

  // ─── Windows ─────────────────────────────────────────────────────────────

  it('cuts the day at Bangkok midnight, not UTC midnight', async () => {
    // 2026-08-14 03:00 Bangkok — still 2026-08-13 in UTC, so a naive
    // implementation would report the wrong business day.
    jest.useFakeTimers().setSystemTime(new Date('2026-08-13T20:00:00.000Z'));

    try {
      const overview = await service.getBusinessOverview(TENANT_ID, PROPERTY_ID);

      expect(overview.date).toBe('2026-08-14');

      // The ledger is asked for a single Bangkok calendar day at a time, and the
      // comparison day is the one before it.
      const asked = ledgerFiltersOf(revenue).map((f) => `${f.from}..${f.to}`);
      expect(asked).toContain('2026-08-14..2026-08-14');
      expect(asked).toContain('2026-08-13..2026-08-13');

      // Operational counts still cut the day the same way — the arrivals count
      // is the one bounded on both sides.
      const arrivals = prisma.booking.count.mock.calls
        .map(([arg]) => arg.where.checkIn)
        .find((checkIn: { gte?: Date; lt?: Date }) => checkIn?.gte && checkIn?.lt);
      expect(arrivals.gte.toISOString()).toBe('2026-08-13T17:00:00.000Z');
      expect(arrivals.lt.toISOString()).toBe('2026-08-14T17:00:00.000Z');
    } finally {
      jest.useRealTimers();
    }
  });

  it('judges invoices overdue against the calendar day the due date is stored as', async () => {
    // dueDate is a @db.Date column — UTC midnight of the day — so comparing it
    // against the Bangkok window's start (17:00 the day before) would call every
    // invoice due today overdue.
    jest.useFakeTimers().setSystemTime(new Date('2026-08-13T20:00:00.000Z'));
    addons.getActiveAddons.mockResolvedValue([addonRow('ACCOUNTING_MODULE')]);

    try {
      await service.getBusinessOverview(TENANT_ID, PROPERTY_ID);

      const overdueCall = prisma.arInvoice.count.mock.calls[0][0];
      expect(overdueCall.where.dueDate.lt.toISOString()).toBe('2026-08-14T00:00:00.000Z');
    } finally {
      jest.useRealTimers();
    }
  });

  // ─── Per-module signals ──────────────────────────────────────────────────

  it('calls a module "setup" while it holds no data at all', async () => {
    addons.getActiveAddons.mockResolvedValue([addonRow('HR_MODULE')]);
    prisma.employee.count.mockResolvedValue(0);

    const overview = await service.getBusinessOverview(TENANT_ID, PROPERTY_ID);

    expect(tile(overview.modules, 'HR_MODULE')?.state).toBe('setup');
  });

  it('calls a module "attention" once something is waiting on a human', async () => {
    addons.getActiveAddons.mockResolvedValue([addonRow('HR_MODULE')]);
    prisma.employee.count.mockResolvedValue(12);
    prisma.hrLeaveRequest.count.mockResolvedValue(3);

    const overview = await service.getBusinessOverview(TENANT_ID, PROPERTY_ID);
    const hr = tile(overview.modules, 'HR_MODULE');

    expect(hr?.state).toBe('attention');
    expect(hr?.openItems).toBe(3);
    expect(hr?.metrics).toContainEqual({ key: 'headcount', value: 12, format: 'number' });
  });

  it('totals the open items of every module into one figure', async () => {
    addons.getActiveAddons.mockResolvedValue([addonRow('HR_MODULE')]);
    prisma.room.count.mockResolvedValue(10); // rooms + rooms-to-clean
    prisma.booking.count.mockResolvedValue(2); // arrivals + departures
    prisma.payments.count.mockResolvedValue(1);
    prisma.employee.count.mockResolvedValue(5);
    prisma.hrLeaveRequest.count.mockResolvedValue(4); // pending + on-leave

    const overview = await service.getBusinessOverview(TENANT_ID, PROPERTY_ID);

    // hotel: 2 arrivals + 2 departures + 10 to clean + 1 payment = 15; hr: 4 pending
    expect(overview.openItems).toBe(19);
  });

  it('counts an item low against its reorder point, falling back to its minimum', async () => {
    addons.getActiveAddons.mockResolvedValue([addonRow('INVENTORY_MODULE')]);
    prisma.inventoryItem.findMany.mockResolvedValue([
      // 8 available vs a reorder point of 10 → low
      { minStock: 0, reorderPoint: 10, warehouseStocks: [{ quantity: 10, reservedQty: 2 }] },
      // no reorder point, but under the minimum → low
      { minStock: 5, reorderPoint: 0, warehouseStocks: [{ quantity: 4, reservedQty: 0 }] },
      // neither configured and still in stock → fine
      { minStock: 0, reorderPoint: 0, warehouseStocks: [{ quantity: 3, reservedQty: 0 }] },
      // neither configured and out of stock → low
      { minStock: 0, reorderPoint: 0, warehouseStocks: [] },
      // comfortably above both → fine
      { minStock: 5, reorderPoint: 10, warehouseStocks: [{ quantity: 40, reservedQty: 1 }] },
    ]);

    const overview = await service.getBusinessOverview(TENANT_ID, PROPERTY_ID);
    const stock = tile(overview.modules, 'INVENTORY_MODULE');

    expect(stock?.metrics).toContainEqual({ key: 'lowStock', value: 3, format: 'number' });
    expect(stock?.state).toBe('attention');
  });

  it('scopes every module query to the tenant', async () => {
    addons.getActiveAddons.mockResolvedValue([
      addonRow('RESTAURANT_MODULE'),
      addonRow('INVENTORY_MODULE'),
      addonRow('ACCOUNTING_MODULE'),
      addonRow('COST_ACCOUNTING_MODULE'),
      addonRow('HR_MODULE'),
      addonRow('CAMP_MODULE'),
    ]);

    await service.getBusinessOverview(TENANT_ID, PROPERTY_ID);

    const everyCall = Object.values(prisma)
      .flatMap((model) => Object.values(model))
      .flatMap((fn) => (fn as jest.Mock).mock.calls)
      .map(([arg]) => arg?.where)
      .filter(Boolean);

    expect(everyCall.length).toBeGreaterThan(0);
    for (const where of everyCall) {
      // `payments` is the one legacy table on snake_case columns.
      expect(where.tenantId ?? where.tenant_id).toBe(TENANT_ID);
    }
  });

  it('asks the ledger once per day rather than once per module', async () => {
    // ตัวเลขทุกถังมาจากการอ่านครั้งเดียวกัน ถังจึงเถียงกับยอดหัวเพจไม่ได้
    addons.getActiveAddons.mockResolvedValue([
      addonRow('RESTAURANT_MODULE'),
      addonRow('INVENTORY_MODULE'),
      addonRow('CAMP_MODULE'),
    ]);

    await service.getBusinessOverview(TENANT_ID, PROPERTY_ID);

    // สองวัน × (รายการที่ผูก property, รายการที่ไม่ผูก) = 4 คำถาม ไม่โตตามจำนวนโมดูล
    expect(revenue.byModule).toHaveBeenCalledTimes(4);
    expect(revenue.totals).not.toHaveBeenCalled();
  });
});
