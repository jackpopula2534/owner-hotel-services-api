import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { Prisma } from '@prisma/client';
import { CacheService } from '@/cache/cache.service';
import { PrismaService } from '@/prisma/prisma.service';
import { AddonService } from '../modules/addons/addon.service';
import { Feature } from '../features/entities/feature.entity';
import { Invoice } from '../invoices/entities/invoice.entity';
import { Subscription } from '../subscriptions/entities/subscription.entity';
import { SubscriptionFeatureLogs } from '../subscription-features/entities/subscription-feature-log.entity';
import { SubscriptionFeature } from '../subscription-features/entities/subscription-feature.entity';
import { AdminSubscriptionFeaturesService } from './admin-subscription-features.service';

/**
 * "Add add-on to subscription" in Admin is the last way a module can reach a
 * tenant, and it keys off `features` (which carries no product line) — so the
 * line has to be enforced against the module catalog. The real AddonService is
 * wired in so the rule itself is under test, not a stub of it.
 */
describe('AdminSubscriptionFeaturesService — product-line separation', () => {
  let service: AdminSubscriptionFeaturesService;

  const catalogRow = (over: Record<string, unknown> = {}) => ({
    id: 'addon-camp',
    code: 'CAMP_MODULE',
    name: 'Campground',
    description: null,
    price: new Prisma.Decimal(590),
    billing_cycle: 'monthly',
    category: 'CAMP',
    system: 'CAMP',
    icon: null,
    display_order: 1,
    min_quantity: 1,
    max_quantity: 1,
    is_active: 1,
    created_at: new Date('2026-05-01T00:00:00Z'),
    updated_at: new Date('2026-05-01T00:00:00Z'),
    ...over,
  });

  const subscriptionsRepo = { findOne: jest.fn() };
  const featuresRepo = { findOne: jest.fn() };
  const subscriptionFeaturesRepo = { findOne: jest.fn() };

  const prismaMock = {
    add_ons: { findMany: jest.fn() },
    subscriptions: { findFirst: jest.fn(), findMany: jest.fn() },
    subscription_features: { findFirst: jest.fn(), findMany: jest.fn() },
    features: { findMany: jest.fn() },
    $transaction: jest.fn(),
  };

  const cacheMock = {
    getOrSet: jest.fn().mockImplementation((_k: string, fn: () => unknown) => fn()),
    del: jest.fn().mockResolvedValue(undefined),
  };

  const tenantOnLine = (system: string) =>
    prismaMock.subscriptions.findFirst.mockResolvedValue({
      id: 'sub-1',
      plans_subscriptions_plan_idToplans: { system },
    });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminSubscriptionFeaturesService,
        AddonService,
        { provide: getRepositoryToken(SubscriptionFeature), useValue: subscriptionFeaturesRepo },
        { provide: getRepositoryToken(SubscriptionFeatureLogs), useValue: { findOne: jest.fn() } },
        { provide: getRepositoryToken(Subscription), useValue: subscriptionsRepo },
        { provide: getRepositoryToken(Feature), useValue: featuresRepo },
        { provide: getRepositoryToken(Invoice), useValue: { findOne: jest.fn() } },
        { provide: getDataSourceToken(), useValue: { transaction: jest.fn() } },
        { provide: PrismaService, useValue: prismaMock },
        { provide: CacheService, useValue: cacheMock },
      ],
    }).compile();

    service = module.get(AdminSubscriptionFeaturesService);
    jest.clearAllMocks();
    cacheMock.getOrSet.mockImplementation((_k: string, fn: () => unknown) => fn());
    prismaMock.add_ons.findMany.mockResolvedValue([
      catalogRow(),
      catalogRow({ id: 'addon-hr', code: 'HR_MODULE', name: 'HR', system: 'BOTH' }),
    ]);
    subscriptionsRepo.findOne.mockResolvedValue({
      id: 'sub-1',
      subscriptionCode: 'SUB-001',
      tenantId: 'tenant-hotel',
    });
    subscriptionFeaturesRepo.findOne.mockResolvedValue(null);
  });

  it('refuses to attach the campground module to a hotel tenant', async () => {
    tenantOnLine('HOTEL');
    featuresRepo.findOne.mockResolvedValue({
      id: 'feat-camp',
      code: 'CAMP_MODULE',
      name: 'Campground',
      moduleCode: null,
      priceMonthly: 590,
    });

    await expect(
      service.addFeature({ subscriptionId: 'sub-1', featureId: 'feat-camp' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a child feature whose parent module belongs to the other line', async () => {
    // The feature's own code is not a module code, so the parent module_code is
    // what gives it away — without that second check, campground sub-features
    // would slip through.
    tenantOnLine('HOTEL');
    featuresRepo.findOne.mockResolvedValue({
      id: 'feat-camp-site',
      code: 'camp_site_map',
      name: 'Camp Site Map',
      moduleCode: 'CAMP_MODULE',
      priceMonthly: 0,
    });

    await expect(
      service.addFeature({ subscriptionId: 'sub-1', featureId: 'feat-camp-site' }),
    ).rejects.toThrow(/คนละสายธุรกิจ/);
  });

  it('lets a module sold on both lines through the line check', async () => {
    tenantOnLine('HOTEL');
    featuresRepo.findOne.mockResolvedValue({
      id: 'feat-hr',
      code: 'HR_MODULE',
      name: 'HR',
      moduleCode: null,
      priceMonthly: 1200,
    });
    // Already attached — the run gets past the line check and stops at the
    // duplicate guard, which is what proves the module was not blocked.
    subscriptionFeaturesRepo.findOne.mockResolvedValue({ id: 'sf-1', isActive: true });

    await expect(
      service.addFeature({ subscriptionId: 'sub-1', featureId: 'feat-hr' }),
    ).rejects.toThrow(/already added/);
  });
});
