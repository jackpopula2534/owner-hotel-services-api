import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { CacheService } from '@/cache/cache.service';
import { PrismaService } from '@/prisma/prisma.service';
import { AddonService } from './addon.service';
import { AddonBillingCycle } from './dto/create-addon.dto';

describe('AddonService - Catalog CRUD', () => {
  let service: AddonService;

  const buildRecord = (over: Partial<Record<string, unknown>> = {}) => ({
    id: 'addon-1',
    code: 'BASIC_REPORT',
    name: 'Basic Report',
    description: 'desc',
    price: new Prisma.Decimal(0),
    billing_cycle: AddonBillingCycle.MONTHLY,
    category: 'reports',
    icon: 'bar-chart',
    display_order: 1,
    min_quantity: 1,
    max_quantity: 1,
    is_active: 1,
    created_at: new Date('2026-05-01T00:00:00Z'),
    updated_at: new Date('2026-05-01T00:00:00Z'),
    ...over,
  });

  const prismaMock = {
    add_ons: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    features: { findMany: jest.fn() },
    subscription_features: { findFirst: jest.fn(), findMany: jest.fn() },
    $transaction: jest.fn(),
  };

  const cacheMock = {
    getOrSet: jest.fn().mockImplementation((_k, fn) => fn()),
    del: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AddonService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: CacheService, useValue: cacheMock },
      ],
    }).compile();

    service = module.get(AddonService);
    jest.clearAllMocks();
  });

  describe('listPublicCatalog', () => {
    const feature = (code: string, moduleCode: string, over: Record<string, unknown> = {}) => ({
      code,
      name: code,
      description: null,
      icon: null,
      price_monthly: new Prisma.Decimal(0),
      display_order: 0,
      module_code: moduleCode,
      ...over,
    });

    it('nests active features under their parent module by module_code', async () => {
      prismaMock.add_ons.findMany.mockResolvedValue([
        buildRecord({ id: 'a1', code: 'RESTAURANT_MODULE', system: 'HOTEL' }),
        buildRecord({ id: 'a2', code: 'HR_MODULE', system: 'BOTH' }),
      ]);
      prismaMock.features.findMany.mockResolvedValue([
        feature('restaurant_pos', 'RESTAURANT_MODULE', { name: 'Restaurant POS' }),
      ]);

      const result = await service.listPublicCatalog();

      const restaurant = result.find((m) => m.code === 'RESTAURANT_MODULE');
      const hr = result.find((m) => m.code === 'HR_MODULE');
      expect(restaurant?.features).toEqual([
        {
          code: 'restaurant_pos',
          name: 'Restaurant POS',
          description: null,
          icon: null,
          priceMonthly: 0,
          displayOrder: 0,
        },
      ]);
      // A module with no matching feature rows still returns an empty array.
      expect(hr?.features).toEqual([]);
      // Only features that declare a module are queried.
      expect(prismaMock.features.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { is_active: 1, module_code: { not: null } } }),
      );
    });

    it('filters to one product line, always keeping BOTH modules', async () => {
      prismaMock.add_ons.findMany.mockResolvedValue([
        buildRecord({ id: 'a1', code: 'RESTAURANT_MODULE', system: 'HOTEL' }),
        buildRecord({ id: 'a2', code: 'CAMP_MODULE', system: 'CAMP' }),
        buildRecord({ id: 'a3', code: 'HR_MODULE', system: 'BOTH' }),
      ]);
      prismaMock.features.findMany.mockResolvedValue([]);

      const camp = await service.listPublicCatalog('camp');

      expect(camp.map((m) => m.code).sort()).toEqual(['CAMP_MODULE', 'HR_MODULE']);
    });

    it('returns every active module when the system filter is blank/invalid', async () => {
      prismaMock.add_ons.findMany.mockResolvedValue([
        buildRecord({ id: 'a1', code: 'RESTAURANT_MODULE', system: 'HOTEL' }),
        buildRecord({ id: 'a2', code: 'CAMP_MODULE', system: 'CAMP' }),
      ]);
      prismaMock.features.findMany.mockResolvedValue([]);

      const result = await service.listPublicCatalog('garbage');

      expect(result).toHaveLength(2);
    });
  });

  describe('list', () => {
    it('returns paginated add-ons with default page/limit', async () => {
      const records = [buildRecord()];
      prismaMock.$transaction.mockResolvedValue([records, 1]);

      const result = await service.list({});

      expect(result.meta).toEqual({ page: 1, limit: 20, total: 1 });
      expect(result.items).toHaveLength(1);
      expect(result.items[0].code).toBe('BASIC_REPORT');
      expect(result.items[0].isActive).toBe(true);
      expect(result.items[0].price).toBe(0);
    });

    it('applies search and isActive filter', async () => {
      prismaMock.$transaction.mockResolvedValue([[], 0]);
      await service.list({ search: 'report', isActive: false, page: 2, limit: 5 });

      expect(prismaMock.$transaction).toHaveBeenCalled();
      const findManyArgs = prismaMock.add_ons.findMany.mock.calls[0][0];
      expect(findManyArgs.where.is_active).toBe(0);
      expect(findManyArgs.where.OR).toEqual([
        { code: { contains: 'report' } },
        { name: { contains: 'report' } },
      ]);
      expect(findManyArgs.skip).toBe(5);
      expect(findManyArgs.take).toBe(5);
    });
  });

  describe('listActive', () => {
    it('returns only active add-ons (cached)', async () => {
      prismaMock.add_ons.findMany.mockResolvedValue([buildRecord()]);
      const result = await service.listActive();
      expect(result).toHaveLength(1);
      expect(prismaMock.add_ons.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { is_active: 1 } }),
      );
    });
  });

  describe('findOne', () => {
    it('returns the entity if found', async () => {
      prismaMock.add_ons.findUnique.mockResolvedValue(buildRecord());
      const result = await service.findOne('addon-1');
      expect(result.code).toBe('BASIC_REPORT');
    });

    it('throws NotFound if missing', async () => {
      prismaMock.add_ons.findUnique.mockResolvedValue(null);
      await expect(service.findOne('missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('create', () => {
    it('creates a new add-on with defaults', async () => {
      prismaMock.add_ons.findUnique.mockResolvedValue(null);
      prismaMock.add_ons.create.mockResolvedValue(buildRecord());

      const result = await service.create({
        code: 'BASIC_REPORT',
        name: 'Basic Report',
        price: 0,
      });

      expect(result.code).toBe('BASIC_REPORT');
      expect(prismaMock.add_ons.create).toHaveBeenCalled();
      const data = prismaMock.add_ons.create.mock.calls[0][0].data;
      expect(data.is_active).toBe(1);
      expect(data.billing_cycle).toBe(AddonBillingCycle.MONTHLY);
      expect(cacheMock.del).toHaveBeenCalled();
    });

    it('throws Conflict if code already exists', async () => {
      prismaMock.add_ons.findUnique.mockResolvedValue(buildRecord());
      await expect(
        service.create({ code: 'BASIC_REPORT', name: 'x', price: 0 }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('honors isActive=false', async () => {
      prismaMock.add_ons.findUnique.mockResolvedValue(null);
      prismaMock.add_ons.create.mockResolvedValue(buildRecord({ is_active: 0 }));
      await service.create({
        code: 'X',
        name: 'X',
        price: 100,
        isActive: false,
      });
      const data = prismaMock.add_ons.create.mock.calls[0][0].data;
      expect(data.is_active).toBe(0);
    });
  });

  describe('update', () => {
    it('updates fields and invalidates cache', async () => {
      prismaMock.add_ons.findUnique
        .mockResolvedValueOnce(buildRecord()) // existence check
        .mockResolvedValueOnce(null); // code conflict check skipped (no code change)
      prismaMock.add_ons.update.mockResolvedValue(buildRecord({ name: 'Updated' }));

      const result = await service.update('addon-1', { name: 'Updated', price: 200 });
      expect(result.name).toBe('Updated');
      const data = prismaMock.add_ons.update.mock.calls[0][0].data;
      expect(data.name).toBe('Updated');
      expect(cacheMock.del).toHaveBeenCalled();
    });

    it('throws NotFound if record missing', async () => {
      prismaMock.add_ons.findUnique.mockResolvedValue(null);
      await expect(service.update('missing', { name: 'x' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws Conflict when changing to existing code', async () => {
      prismaMock.add_ons.findUnique
        .mockResolvedValueOnce(buildRecord())
        .mockResolvedValueOnce(buildRecord({ id: 'addon-2', code: 'OTHER' }));

      await expect(service.update('addon-1', { code: 'OTHER' })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('toggleActive', () => {
    it('flips is_active flag', async () => {
      prismaMock.add_ons.findUnique.mockResolvedValue(buildRecord({ is_active: 1 }));
      prismaMock.add_ons.update.mockResolvedValue(buildRecord({ is_active: 0 }));

      const result = await service.toggleActive('addon-1');
      expect(result.isActive).toBe(false);
      const data = prismaMock.add_ons.update.mock.calls[0][0].data;
      expect(data.is_active).toBe(0);
    });
  });

  describe('remove', () => {
    it('deletes the add-on', async () => {
      prismaMock.add_ons.findUnique.mockResolvedValue(buildRecord());
      prismaMock.add_ons.delete.mockResolvedValue(buildRecord());
      await service.remove('addon-1');
      expect(prismaMock.add_ons.delete).toHaveBeenCalledWith({ where: { id: 'addon-1' } });
    });

    it('throws NotFound if missing', async () => {
      prismaMock.add_ons.findUnique.mockResolvedValue(null);
      await expect(service.remove('missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});

// ─── Tenant entitlements (getActiveAddons + cache invalidation) ─────────────
describe('AddonService - Tenant entitlements', () => {
  let service: AddonService;

  const subscriptionsClient = {
    findFirst: jest.fn(),
    findMany: jest.fn(),
  };

  const prismaMock = {
    add_ons: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    subscription_features: { findFirst: jest.fn(), findMany: jest.fn() },
    subscriptions: subscriptionsClient,
    $transaction: jest.fn(),
  };

  const cacheMock = {
    getOrSet: jest.fn().mockImplementation((_k, fn) => fn()),
    del: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AddonService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: CacheService, useValue: cacheMock },
      ],
    }).compile();

    service = module.get(AddonService);
    jest.clearAllMocks();
  });

  describe('getActiveAddons', () => {
    it('returns empty list when tenant has no active or trial subscription', async () => {
      subscriptionsClient.findFirst.mockResolvedValue(null);

      const result = await service.getActiveAddons('tenant-1');

      expect(result).toEqual([]);
      // Verifies the broadened status filter is sent through Prisma
      const where = subscriptionsClient.findFirst.mock.calls[0][0].where;
      expect(where.tenant_id).toBe('tenant-1');
      expect(where.status).toEqual({ in: ['active', 'trial'] });
    });

    it('includes module features attached at the plan level (Admin setup)', async () => {
      subscriptionsClient.findFirst.mockResolvedValue({
        id: 'sub-1',
        plans_subscriptions_plan_idToplans: {
          plan_features: [
            {
              features: {
                code: 'RESTAURANT_MODULE',
                name: 'Restaurant',
                type: 'module',
                is_active: 1,
              },
            },
            // non-module feature should be ignored — not all plan_features unlock sidebar items
            {
              features: {
                code: 'EARLY_CHECKIN',
                name: 'Early Check-in',
                type: 'toggle',
                is_active: 1,
              },
            },
          ],
        },
        subscription_features: [],
      });

      const result = await service.getActiveAddons('tenant-1');

      // Owning RESTAURANT_MODULE auto-grants its folded child POS_MODULE via
      // CHILD_ADDON_GRANTS so legacy `@RequireAddon('POS_MODULE')` guards keep
      // working without touching controllers.
      expect(result).toEqual([
        {
          code: 'RESTAURANT_MODULE',
          name: 'Restaurant',
          isActive: true,
          expiresAt: null,
          source: 'plan',
        },
        {
          code: 'POS_MODULE',
          name: 'POS_MODULE',
          isActive: true,
          expiresAt: null,
          source: 'plan',
        },
      ]);
    });

    it('includes per-tenant subscription_feature add-ons', async () => {
      subscriptionsClient.findFirst.mockResolvedValue({
        id: 'sub-2',
        plans_subscriptions_plan_idToplans: { plan_features: [] },
        subscription_features: [
          {
            features: { code: 'HR_MODULE', name: 'HR', type: 'module', is_active: 1 },
          },
        ],
      });

      const result = await service.getActiveAddons('tenant-2');
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ code: 'HR_MODULE', source: 'subscription' });
    });

    it('deduplicates the same module appearing in plan and subscription (plan wins)', async () => {
      subscriptionsClient.findFirst.mockResolvedValue({
        id: 'sub-3',
        plans_subscriptions_plan_idToplans: {
          plan_features: [
            {
              features: {
                code: 'INVENTORY_MODULE',
                name: 'Inventory',
                type: 'module',
                is_active: 1,
              },
            },
          ],
        },
        subscription_features: [
          {
            features: { code: 'INVENTORY_MODULE', name: 'Inventory', type: 'module', is_active: 1 },
          },
        ],
      });

      const result = await service.getActiveAddons('tenant-3');
      expect(result).toHaveLength(1);
      expect(result[0].source).toBe('plan');
    });

    it('skips inactive feature definitions (admin disabled the feature catalog row)', async () => {
      subscriptionsClient.findFirst.mockResolvedValue({
        id: 'sub-4',
        plans_subscriptions_plan_idToplans: {
          plan_features: [
            {
              features: {
                code: 'RESTAURANT_MODULE',
                name: 'Restaurant',
                type: 'module',
                is_active: 0,
              },
            },
          ],
        },
        subscription_features: [],
      });

      const result = await service.getActiveAddons('tenant-4');
      expect(result).toEqual([]);
    });
  });

  describe('hasActiveAddon', () => {
    it('returns true when the code appears in getActiveAddons', async () => {
      subscriptionsClient.findFirst.mockResolvedValue({
        id: 'sub-5',
        plans_subscriptions_plan_idToplans: {
          plan_features: [
            { features: { code: 'HR_MODULE', name: 'HR', type: 'module', is_active: 1 } },
          ],
        },
        subscription_features: [],
      });

      await expect(service.hasActiveAddon('tenant-5', 'HR_MODULE')).resolves.toBe(true);
    });

    it('returns false when the code is not entitled', async () => {
      subscriptionsClient.findFirst.mockResolvedValue({
        id: 'sub-6',
        plans_subscriptions_plan_idToplans: { plan_features: [] },
        subscription_features: [],
      });

      await expect(service.hasActiveAddon('tenant-6', 'HR_MODULE')).resolves.toBe(false);
    });
  });

  describe('invalidateAddonCacheForPlan', () => {
    it('invalidates cache for every active/trial tenant on the plan', async () => {
      subscriptionsClient.findMany.mockResolvedValue([
        { tenant_id: 'tenant-a' },
        { tenant_id: 'tenant-b' },
        { tenant_id: 'tenant-a' }, // duplicate — should be deduped
      ]);

      await service.invalidateAddonCacheForPlan('plan-xyz');

      const where = subscriptionsClient.findMany.mock.calls[0][0].where;
      expect(where.plan_id).toBe('plan-xyz');
      expect(where.status).toEqual({ in: ['active', 'trial'] });
      // 2 unique tenants × (8 codes + 1 :all) = 18 del calls
      expect(cacheMock.del).toHaveBeenCalled();
      const tenantsDeleted = new Set(
        cacheMock.del.mock.calls.map((c: unknown[]) => (c[0] as string).split(':')[0]),
      );
      expect(tenantsDeleted).toEqual(new Set(['tenant-a', 'tenant-b']));
    });
  });
});
