import { Test, TestingModule } from '@nestjs/testing';
import { SaasAnalyticsService } from './saas-analytics.service';
import { PrismaService } from '../prisma/prisma.service';

describe('SaasAnalyticsService', () => {
  let service: SaasAnalyticsService;
  let mockSubsFindMany: jest.Mock;

  beforeEach(async () => {
    mockSubsFindMany = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SaasAnalyticsService,
        {
          provide: PrismaService,
          useValue: {
            subscriptions: { findMany: mockSubsFindMany },
          },
        },
      ],
    }).compile();

    service = module.get(SaasAnalyticsService);
  });

  afterEach(() => jest.clearAllMocks());

  it('getMrrSummary aggregates revenue by plan', async () => {
    mockSubsFindMany.mockResolvedValue([
      {
        id: 's1',
        billing_cycle: 'monthly',
        plans_subscriptions_plan_idToplans: {
          id: 'p-basic',
          name: 'Basic',
          price_monthly: 1000,
        },
      },
      {
        id: 's2',
        billing_cycle: 'monthly',
        plans_subscriptions_plan_idToplans: {
          id: 'p-basic',
          name: 'Basic',
          price_monthly: 1000,
        },
      },
      {
        id: 's3',
        billing_cycle: 'monthly',
        plans_subscriptions_plan_idToplans: {
          id: 'p-pro',
          name: 'Pro',
          price_monthly: 3000,
        },
      },
    ]);

    const r = await service.getMrrSummary(new Date('2026-05-01'));
    expect(r.mrr).toBe(5000);
    expect(r.arr).toBe(60000);
    expect(r.activeSubscriptions).toBe(3);
    expect(r.byPlan).toEqual([
      { planId: 'p-pro', planName: 'Pro', count: 1, mrr: 3000 },
      { planId: 'p-basic', planName: 'Basic', count: 2, mrr: 2000 },
    ]);
  });

  it('getMrrSummary returns zero when no active subs', async () => {
    mockSubsFindMany.mockResolvedValue([]);
    const r = await service.getMrrSummary();
    expect(r.mrr).toBe(0);
    expect(r.arr).toBe(0);
    expect(r.activeSubscriptions).toBe(0);
    expect(r.byPlan).toEqual([]);
  });

  it('getMrrTrend returns 12 monthly points', async () => {
    mockSubsFindMany.mockResolvedValue([]);
    const points = await service.getMrrTrend(new Date('2026-12-15'));
    expect(points).toHaveLength(12);
    expect(points[points.length - 1].period).toBe('2026-12');
    // periods strictly increasing
    for (let i = 1; i < points.length; i++) {
      expect(points[i].period > points[i - 1].period).toBe(true);
    }
  });

  it('getChurnSummary computes logo + revenue churn', async () => {
    // First call (start of period) returns 4 subs; second call (end) returns
    // 3 — meaning 1 churned and 0 net new (for the unit test).
    const startSubs = [
      {
        id: 's1',
        billing_cycle: 'monthly',
        plans_subscriptions_plan_idToplans: { price_monthly: 1000 },
      },
      {
        id: 's2',
        billing_cycle: 'monthly',
        plans_subscriptions_plan_idToplans: { price_monthly: 1000 },
      },
      {
        id: 's3',
        billing_cycle: 'monthly',
        plans_subscriptions_plan_idToplans: { price_monthly: 2000 },
      },
      {
        id: 's4',
        billing_cycle: 'monthly',
        plans_subscriptions_plan_idToplans: { price_monthly: 1000 },
      },
    ];
    const endSubs = startSubs.filter((s) => s.id !== 's3');
    mockSubsFindMany.mockResolvedValueOnce(startSubs).mockResolvedValueOnce(endSubs);

    const r = await service.getChurnSummary(new Date('2026-04-01'), new Date('2026-05-01'));

    expect(r.startActive).toBe(4);
    expect(r.endActive).toBe(3);
    expect(r.churnedCount).toBe(1);
    expect(r.churnedRevenue).toBe(2000);
    expect(r.logoChurnPercent).toBeCloseTo(25, 0);
    expect(r.revenueChurnPercent).toBeCloseTo(40, 0); // 2000/5000
  });

  it('getLtvSummary computes ARPU and LTV when churn > 0', async () => {
    const subs = [
      {
        id: 's1',
        billing_cycle: 'monthly',
        plans_subscriptions_plan_idToplans: { id: 'p1', name: 'X', price_monthly: 2000 },
      },
      {
        id: 's2',
        billing_cycle: 'monthly',
        plans_subscriptions_plan_idToplans: { id: 'p1', name: 'X', price_monthly: 2000 },
      },
    ];
    // mrrSummary needs 1 call; churnSummary needs 2 calls (start + end)
    mockSubsFindMany
      .mockResolvedValueOnce(subs) // mrrSummary
      .mockResolvedValueOnce(subs) // churn period start
      .mockResolvedValueOnce(subs.slice(0, 1)); // churn period end (1 churned)

    const r = await service.getLtvSummary();
    expect(r.averageMrr).toBe(2000);
    expect(r.monthlyChurnRate).toBeCloseTo(0.5, 4);
    expect(r.estimatedLtv).toBe(4000); // 2000 / 0.5
  });
});
