import { Test, TestingModule } from '@nestjs/testing';
import { BusinessOverviewService, OverviewModuleCode } from './business-overview.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AddonService } from '../addons/addon.service';

/**
 * The Command Center home is the one screen that claims to show "everything".
 * What must hold, no matter what the tenant has bought:
 *
 *  - a module the tenant has no add-on for never appears (the page must not
 *    advertise a system behind a paywall, and must not leak that it exists),
 *  - purchasing rides on the stock add-on, exactly as the sidebar gates it,
 *  - one broken module degrades to an empty tile instead of blanking the page,
 *  - the headline revenue is the sum of the modules that actually sell,
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
});

const addonRow = (code: string) => ({
  code,
  name: code,
  isActive: true,
  expiresAt: null,
  source: 'plan',
});

describe('BusinessOverviewService', () => {
  let service: BusinessOverviewService;
  let prisma: ReturnType<typeof makePrismaMock>;
  let addons: { getActiveAddons: jest.Mock };

  const codes = (modules: Array<{ code: OverviewModuleCode }>) => modules.map((m) => m.code);

  beforeEach(async () => {
    prisma = makePrismaMock();
    addons = { getActiveAddons: jest.fn().mockResolvedValue([]) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BusinessOverviewService,
        { provide: PrismaService, useValue: prisma },
        { provide: AddonService, useValue: addons },
      ],
    }).compile();

    service = module.get(BusinessOverviewService);
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

  it('returns an empty overview for a caller with no tenant', async () => {
    const overview = await service.getBusinessOverview(undefined, PROPERTY_ID);

    expect(overview.modules).toEqual([]);
    expect(overview.revenue.today).toBe(0);
    expect(addons.getActiveAddons).not.toHaveBeenCalled();
  });

  // ─── Resilience ──────────────────────────────────────────────────────────

  it('keeps the rest of the page when one module throws', async () => {
    addons.getActiveAddons.mockResolvedValue([addonRow('ACCOUNTING_MODULE')]);
    prisma.accountChart.count.mockRejectedValue(new Error('Table does not exist'));
    prisma.room.count.mockResolvedValue(20);

    const overview = await service.getBusinessOverview(TENANT_ID, PROPERTY_ID);

    expect(codes(overview.modules)).toEqual(['HOTEL', 'ACCOUNTING_MODULE']);
    expect(overview.modules.find((m) => m.code === 'HOTEL')?.metrics).toContainEqual({
      key: 'occupancy',
      value: 0,
      format: 'percent',
    });
    expect(overview.modules.find((m) => m.code === 'ACCOUNTING_MODULE')).toMatchObject({
      state: 'setup',
      metrics: [],
      openItems: 0,
    });
  });

  // ─── Revenue roll-up ─────────────────────────────────────────────────────

  it('adds up today revenue across every selling module', async () => {
    addons.getActiveAddons.mockResolvedValue([
      addonRow('RESTAURANT_MODULE'),
      addonRow('INVENTORY_MODULE'),
    ]);
    prisma.room.count.mockResolvedValue(10);
    prisma.booking.findMany.mockResolvedValue([
      { grandTotal: '3000.00', totalPrice: null, addOns: [{ amount: '500.00' }] },
    ]);
    prisma.restaurant.count.mockResolvedValue(1);
    prisma.order.aggregate.mockResolvedValue({ _sum: { total: '1287.00' }, _count: { _all: 2 } });
    prisma.retailSale.aggregate.mockResolvedValue({ _sum: { grandTotal: '213.00' } });

    const overview = await service.getBusinessOverview(TENANT_ID, PROPERTY_ID);

    expect(overview.revenue.today).toBe(3500 + 1287 + 213);
    expect(overview.revenue.sources).toEqual([
      { code: 'HOTEL', amount: 3500 },
      { code: 'RESTAURANT_MODULE', amount: 1287 },
      { code: 'INVENTORY_MODULE', amount: 213 },
    ]);
  });

  it('reports no change rather than an infinite one when yesterday took nothing', async () => {
    prisma.booking.findMany
      .mockResolvedValueOnce([{ grandTotal: '1000.00', totalPrice: null, addOns: [] }])
      .mockResolvedValueOnce([]);

    const overview = await service.getBusinessOverview(TENANT_ID, PROPERTY_ID);

    expect(overview.revenue.yesterday).toBe(0);
    expect(overview.revenue.changePct).toBeNull();
  });

  it('states the change against yesterday as a percentage', async () => {
    prisma.booking.findMany
      .mockResolvedValueOnce([{ grandTotal: '1500.00', totalPrice: null, addOns: [] }])
      .mockResolvedValueOnce([{ grandTotal: '1000.00', totalPrice: null, addOns: [] }]);

    const overview = await service.getBusinessOverview(TENANT_ID, PROPERTY_ID);

    expect(overview.revenue.changePct).toBe(50);
  });

  // ─── Windows ─────────────────────────────────────────────────────────────

  it('cuts the day at Bangkok midnight, not UTC midnight', async () => {
    // 2026-08-14 03:00 Bangkok — still 2026-08-13 in UTC, so a naive
    // implementation would report the wrong business day.
    jest.useFakeTimers().setSystemTime(new Date('2026-08-13T20:00:00.000Z'));

    try {
      const overview = await service.getBusinessOverview(TENANT_ID, PROPERTY_ID);

      expect(overview.date).toBe('2026-08-14');

      const window = prisma.booking.findMany.mock.calls[0][0].where.checkIn;
      expect(window.gte.toISOString()).toBe('2026-08-13T17:00:00.000Z');
      expect(window.lt.toISOString()).toBe('2026-08-14T17:00:00.000Z');
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

    expect(overview.modules.find((m) => m.code === 'HR_MODULE')?.state).toBe('setup');
  });

  it('calls a module "attention" once something is waiting on a human', async () => {
    addons.getActiveAddons.mockResolvedValue([addonRow('HR_MODULE')]);
    prisma.employee.count.mockResolvedValue(12);
    prisma.hrLeaveRequest.count.mockResolvedValue(3);

    const overview = await service.getBusinessOverview(TENANT_ID, PROPERTY_ID);
    const hr = overview.modules.find((m) => m.code === 'HR_MODULE');

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
    const stock = overview.modules.find((m) => m.code === 'INVENTORY_MODULE');

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
});
