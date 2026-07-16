import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { CacheService } from '@/cache/cache.service';
import { PrismaService } from '@/prisma/prisma.service';
import { AddonService } from '@/modules/addons/addon.service';
import { SubscriptionFeaturesService } from './subscription-features.service';

/**
 * The legacy platform_admin grant path. It writes straight into
 * `subscription_features`, which AddonGuard reads as an entitlement — so without
 * a product-line check it is a back door for handing a hotel tenant the
 * campground module, bypassing everything we locked down on the plans side.
 *
 * The real AddonService is wired in so the rule under test is the real one.
 */
describe('SubscriptionFeaturesService — product-line separation', () => {
  let service: SubscriptionFeaturesService;

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

  const prismaMock = {
    add_ons: { findMany: jest.fn() },
    subscriptions: { findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn() },
    features: { findUnique: jest.fn(), findMany: jest.fn() },
    subscription_features: {
      create: jest.fn(),
      delete: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    addon_trial_requests: { findMany: jest.fn() },
  };

  const cacheMock = {
    getOrSet: jest.fn().mockImplementation((_k: string, fn: () => unknown) => fn()),
    del: jest.fn().mockResolvedValue(undefined),
  };

  /** The subscription being modified belongs to a tenant on this product line. */
  const tenantOnLine = (system: string) => {
    prismaMock.subscriptions.findUnique.mockResolvedValue({ tenant_id: 'tenant-1' });
    prismaMock.subscriptions.findFirst.mockResolvedValue({
      id: 'sub-1',
      plans_subscriptions_plan_idToplans: { system },
    });
  };

  const dto = { subscriptionId: 'sub-1', featureId: 'feat-1', price: 590 };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionFeaturesService,
        AddonService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: CacheService, useValue: cacheMock },
      ],
    }).compile();

    service = module.get(SubscriptionFeaturesService);
    jest.clearAllMocks();
    cacheMock.getOrSet.mockImplementation((_k: string, fn: () => unknown) => fn());
    prismaMock.add_ons.findMany.mockResolvedValue([
      catalogRow(),
      catalogRow({ id: 'addon-hr', code: 'HR_MODULE', name: 'HR', system: 'BOTH' }),
    ]);
  });

  describe('create', () => {
    it('refuses to attach the campground module to a hotel tenant', async () => {
      tenantOnLine('HOTEL');
      prismaMock.features.findUnique.mockResolvedValue({
        code: 'CAMP_MODULE',
        module_code: null,
      });

      await expect(service.create(dto)).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.subscription_features.create).not.toHaveBeenCalled();
    });

    it('refuses a camp sub-feature whose PARENT module is off-line', async () => {
      // Sub-features carry no line of their own; the ban has to follow the parent
      // module, or CAMP_MODULE gets handed over one child feature at a time.
      tenantOnLine('HOTEL');
      prismaMock.features.findUnique.mockResolvedValue({
        code: 'CAMP_PITCH_MAP',
        module_code: 'CAMP_MODULE',
      });

      await expect(service.create(dto)).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.subscription_features.create).not.toHaveBeenCalled();
    });

    it('attaches a module sold on both lines and drops the tenant cache', async () => {
      tenantOnLine('HOTEL');
      prismaMock.features.findUnique.mockResolvedValue({ code: 'HR_MODULE', module_code: null });
      prismaMock.subscription_features.create.mockResolvedValue({
        id: 'sf-1',
        subscriptions: { tenant_id: 'tenant-1' },
      });

      await expect(service.create(dto)).resolves.toMatchObject({ id: 'sf-1' });

      expect(prismaMock.subscription_features.create).toHaveBeenCalled();
      // is_active is set explicitly — AddonGuard filters on `is_active: 1`.
      expect(prismaMock.subscription_features.create.mock.calls[0][0].data.is_active).toBe(1);
      // Granted entitlement must not sit behind a stale 5-minute cache.
      expect(cacheMock.del).toHaveBeenCalled();
    });

    it('lets a campground tenant have the campground module', async () => {
      tenantOnLine('CAMP');
      prismaMock.features.findUnique.mockResolvedValue({ code: 'CAMP_MODULE', module_code: null });
      prismaMock.subscription_features.create.mockResolvedValue({
        id: 'sf-2',
        subscriptions: { tenant_id: 'tenant-1' },
      });

      await expect(service.create(dto)).resolves.toMatchObject({ id: 'sf-2' });
    });

    it('404s on an unknown subscription instead of failing on a foreign key', async () => {
      prismaMock.subscriptions.findUnique.mockResolvedValue(null);

      await expect(service.create(dto)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('remove', () => {
    it('invalidates the tenant cache so revoked access ends now, not in 5 minutes', async () => {
      prismaMock.subscription_features.findUnique.mockResolvedValue({
        id: 'sf-1',
        subscriptions: { tenant_id: 'tenant-1' },
      });
      prismaMock.subscription_features.delete.mockResolvedValue({ id: 'sf-1' });

      await service.remove('sf-1');

      expect(prismaMock.subscription_features.delete).toHaveBeenCalledWith({
        where: { id: 'sf-1' },
      });
      const tenants = new Set(
        cacheMock.del.mock.calls.map((c: unknown[]) => (c[0] as string).split(':')[0]),
      );
      expect(tenants).toEqual(new Set(['tenant-1']));
    });

    it('404s on an unknown row', async () => {
      prismaMock.subscription_features.findUnique.mockResolvedValue(null);

      await expect(service.remove('nope')).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaMock.subscription_features.delete).not.toHaveBeenCalled();
    });
  });
});
