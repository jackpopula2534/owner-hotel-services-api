import { Test, TestingModule } from '@nestjs/testing';
import { RestaurantAnalyticsService } from './analytics.service';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * Focused unit tests for the daily-summary hardening: an invalid ?date= must not
 * crash (it used to throw a RangeError via toISOString → 500), and any unexpected
 * Prisma failure must degrade to a zeroed summary instead of surfacing a 500 to
 * this best-effort overview widget.
 */

const RESTAURANT_ID = 'rest-1';
const TENANT_ID = 'tenant-1';

const makePrismaMock = () => ({
  order: { findMany: jest.fn() },
  kitchenOrder: { findMany: jest.fn() },
  restaurantTable: { findMany: jest.fn() },
});

describe('RestaurantAnalyticsService.getDailySummary', () => {
  let service: RestaurantAnalyticsService;
  let prisma: ReturnType<typeof makePrismaMock>;

  beforeEach(async () => {
    prisma = makePrismaMock();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RestaurantAnalyticsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(RestaurantAnalyticsService);
    // Silence the expected error log from the fallback path.
    jest.spyOn(service['logger'], 'error').mockImplementation(() => undefined);
  });

  it('aggregates a normal day', async () => {
    prisma.order.findMany.mockResolvedValue([
      { status: 'COMPLETED', paymentStatus: 'PAID', total: '250.00', orderType: 'DINE_IN', partySize: 2, paymentMethod: 'CASH' },
      { status: 'PENDING', paymentStatus: 'UNPAID', total: '100.00', orderType: 'DINE_IN', partySize: 1, paymentMethod: null },
    ]);
    prisma.kitchenOrder.findMany.mockResolvedValue([]);
    prisma.restaurantTable.findMany.mockResolvedValue([
      { id: 't1', capacity: 4, status: 'OCCUPIED' },
    ]);

    const res = await service.getDailySummary(RESTAURANT_ID, TENANT_ID);

    expect(res.revenue.total).toBe(250);
    expect(res.orders).toMatchObject({ total: 2, completed: 1, active: 1 });
    expect(res.tables).toMatchObject({ total: 1, occupied: 1, totalCapacity: 4 });
  });

  it('falls back to today (not a crash) when date is invalid', async () => {
    prisma.order.findMany.mockResolvedValue([]);
    prisma.kitchenOrder.findMany.mockResolvedValue([]);
    prisma.restaurantTable.findMany.mockResolvedValue([]);

    const res = await service.getDailySummary(RESTAURANT_ID, TENANT_ID, 'not-a-date');

    // A valid ISO date string of length 10, not "Invalid Date".
    expect(res.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(res.revenue.total).toBe(0);
  });

  it('returns a zeroed summary instead of throwing when Prisma fails', async () => {
    prisma.order.findMany.mockRejectedValue(new Error('db down'));
    prisma.kitchenOrder.findMany.mockResolvedValue([]);
    prisma.restaurantTable.findMany.mockResolvedValue([]);

    const res = await service.getDailySummary(RESTAURANT_ID, TENANT_ID);

    expect(res).toMatchObject({
      revenue: { total: 0, averageOrderValue: 0 },
      orders: { total: 0, completed: 0, cancelled: 0, active: 0 },
      tables: { total: 0, totalCapacity: 0 },
    });
  });
});
