import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AdminSubscriptionsService } from './admin-subscriptions.service';
import { Subscription, SubscriptionStatus } from '../subscriptions/entities/subscription.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { Invoice } from '../invoices/entities/invoice.entity';
import { SubscriptionFeature } from '../subscription-features/entities/subscription-feature.entity';
import { Plan } from '../plans/entities/plan.entity';
import { PrismaService } from '../prisma/prisma.service';
import { AdminSubscriptionStatusFilter } from './dto/admin-subscriptions.dto';

/**
 * Regression coverage for the trial-billing bug: trial subscriptions were
 * showing a non-zero "ยอดรวม/เดือน" because bundled add-ons were summed as
 * revenue and the status was ignored. The expected behaviour:
 *   - bundled add-ons (รวมในแพ็กเกจ) -> billed price 0, list price kept
 *   - non-active subscriptions (trial/pending/...) -> nothing billed
 *   - active subscriptions -> plan price + purchased add-ons billed
 */
describe('AdminSubscriptionsService - pricing rules', () => {
  let service: AdminSubscriptionsService;
  let subscriptionsRepo: jest.Mocked<Repository<Subscription>>;
  let prisma: { user: { findMany: jest.Mock; findFirst: jest.Mock }; $queryRaw: jest.Mock };

  // Bundled add-ons returned by the plan_addons raw query (the "ฟีเจอร์ครบทุกระบบ" set).
  const BUNDLED = [
    { name: 'Housekeeping Module', price: 590 },
    { name: 'Maintenance Module', price: 490 },
    { name: 'Restaurant & F&B Module', price: 990 },
    { name: 'HR Module', price: 1200 },
  ];
  const BUNDLED_TOTAL = 590 + 490 + 990 + 1200; // 3270

  const buildSubscription = (overrides: Partial<Subscription> = {}): Subscription =>
    ({
      id: 'sub-1',
      subscriptionCode: 'SUB-001',
      tenantId: 'tenant-1',
      planId: 'plan-trial',
      status: SubscriptionStatus.TRIAL,
      startDate: new Date('2026-05-29'),
      endDate: new Date('2026-06-12'),
      autoRenew: false,
      createdAt: new Date('2026-05-29'),
      tenant: { name: 'โรงแรมสตาร์ซิงค์ เดโม', email: 'demo@hotel-test.com' } as any,
      plan: { name: 'ทดลองฟรี', priceMonthly: 0 } as any,
      subscriptionFeatures: [],
      invoices: [],
      ...overrides,
    }) as Subscription;

  const buildQueryBuilder = (rows: Subscription[]) =>
    ({
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(rows.length),
      getMany: jest.fn().mockResolvedValue(rows),
    }) as any;

  beforeEach(async () => {
    prisma = {
      user: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue({ email: 'demo@hotel-test.com' }),
      },
      // getPlanAddonsByPlanIds uses $queryRaw to fetch bundled add-ons.
      $queryRaw: jest.fn().mockResolvedValue(BUNDLED),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminSubscriptionsService,
        {
          provide: getRepositoryToken(Subscription),
          useValue: {
            createQueryBuilder: jest.fn(),
            findOne: jest.fn(),
            find: jest.fn().mockResolvedValue([]),
            count: jest.fn().mockResolvedValue(0),
          },
        },
        { provide: getRepositoryToken(Tenant), useValue: {} },
        { provide: getRepositoryToken(Invoice), useValue: {} },
        { provide: getRepositoryToken(SubscriptionFeature), useValue: {} },
        { provide: getRepositoryToken(Plan), useValue: {} },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(AdminSubscriptionsService);
    subscriptionsRepo = module.get(getRepositoryToken(Subscription));
  });

  describe('findAll (list)', () => {
    it('trial subscription is NOT billed: pricePerMonth = 0 even with bundled modules', async () => {
      const sub = buildSubscription({ status: SubscriptionStatus.TRIAL });
      subscriptionsRepo.createQueryBuilder.mockReturnValue(buildQueryBuilder([sub]));

      const res = await service.findAll({ status: AdminSubscriptionStatusFilter.ALL });
      const item = res.data[0];

      expect(item.isTrial).toBe(true);
      expect(item.pricePerMonth).toBe(0);
      expect(item.addonAmount).toBe(0);
      // List price is still surfaced for struck-through display.
      expect(item.addonOriginalAmount).toBe(BUNDLED_TOTAL);
      expect(item.originalPricePerMonth).toBe(BUNDLED_TOTAL); // plan price 0 + bundled list
    });

    it('every bundled add-on is flagged isBundled with billed price 0 but keeps originalPrice', async () => {
      const sub = buildSubscription({ status: SubscriptionStatus.TRIAL });
      subscriptionsRepo.createQueryBuilder.mockReturnValue(buildQueryBuilder([sub]));

      const item = (await service.findAll({})).data[0];

      expect(item.addons).toHaveLength(BUNDLED.length);
      for (const addon of item.addons) {
        expect(addon.isBundled).toBe(true);
        expect(addon.isBilled).toBe(false);
        expect(addon.price).toBe(0);
        expect(addon.originalPrice).toBeGreaterThan(0);
      }
    });

    it('active subscription bills plan price + purchased add-ons, bundled stay 0', async () => {
      const sub = buildSubscription({
        status: SubscriptionStatus.ACTIVE,
        planId: 'plan-pro',
        plan: { name: 'Professional', priceMonthly: 1290 } as any,
        subscriptionFeatures: [
          { price: 990, feature: { name: 'Extra Analytics' } },
          { price: 500, feature: { name: 'Advanced Report' } },
        ] as any,
      });
      subscriptionsRepo.createQueryBuilder.mockReturnValue(buildQueryBuilder([sub]));

      const item = (await service.findAll({})).data[0];

      expect(item.isTrial).toBe(false);
      // 1290 plan + 990 + 500 purchased = 2780 ; bundled add 0
      expect(item.pricePerMonth).toBe(1290 + 990 + 500);
      expect(item.addonAmount).toBe(990 + 500);

      const purchased = item.addons.filter((a) => !a.isBundled);
      expect(purchased).toHaveLength(2);
      expect(purchased.every((a) => a.isBilled && a.price === a.originalPrice)).toBe(true);

      const bundled = item.addons.filter((a) => a.isBundled);
      expect(bundled.every((a) => a.price === 0 && a.isBilled === false)).toBe(true);
    });

    it.each([SubscriptionStatus.PENDING, SubscriptionStatus.EXPIRED, SubscriptionStatus.CANCELLED])(
      'non-active status %s bills nothing',
      async (status) => {
        const sub = buildSubscription({
          status,
          plan: { name: 'Professional', priceMonthly: 1290 } as any,
          subscriptionFeatures: [{ price: 990, feature: { name: 'Extra Analytics' } }] as any,
        });
        subscriptionsRepo.createQueryBuilder.mockReturnValue(buildQueryBuilder([sub]));

        const item = (await service.findAll({})).data[0];

        expect(item.isTrial).toBe(true);
        expect(item.pricePerMonth).toBe(0);
        expect(item.addonAmount).toBe(0);
      },
    );
  });

  describe('findOne (detail)', () => {
    it('trial detail returns billed 0 with original list price preserved', async () => {
      const sub = buildSubscription({ status: SubscriptionStatus.TRIAL });
      subscriptionsRepo.findOne.mockResolvedValue(sub);

      const detail = await service.findOne('sub-1');

      expect(detail.isTrial).toBe(true);
      expect(detail.pricePerMonth).toBe(0);
      expect(detail.originalPricePerMonth).toBe(BUNDLED_TOTAL);
      expect(detail.addons.every((a) => a.isBundled && a.price === 0)).toBe(true);
    });

    it('active detail bills plan + purchased add-ons', async () => {
      const sub = buildSubscription({
        status: SubscriptionStatus.ACTIVE,
        plan: { name: 'Professional', priceMonthly: 1290 } as any,
        subscriptionFeatures: [{ price: 990, feature: { name: 'Extra Analytics' } }] as any,
      });
      subscriptionsRepo.findOne.mockResolvedValue(sub);

      const detail = await service.findOne('sub-1');

      expect(detail.isTrial).toBe(false);
      expect(detail.pricePerMonth).toBe(1290 + 990);
    });
  });
});
