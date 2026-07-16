import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { CacheService } from '@/cache/cache.service';
import { PrismaService } from '@/prisma/prisma.service';
import { AddonService, isAddonAvailableForSystem } from './addon.service';
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
    addon_trial_requests: { findMany: jest.fn() },
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
    // No approved trials unless a test says otherwise — trials are a fourth
    // entitlement source and every getActiveAddons() call reads them.
    prismaMock.addon_trial_requests.findMany.mockResolvedValue([]);
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

    it('auto-grants COST_ACCOUNTING_MODULE when the tenant owns ACCOUNTING_MODULE', async () => {
      // Regression guard for the 10 cost-accounting controllers, which gate on
      // @RequireAddon('COST_ACCOUNTING_MODULE'). Cost Accounting (USALI) was
      // folded into ACCOUNTING_MODULE, so owning the parent must grant the child
      // — otherwise every cost-accounting endpoint would 403 for paid tenants.
      subscriptionsClient.findFirst.mockResolvedValue({
        id: 'sub-acc',
        plans_subscriptions_plan_idToplans: {
          plan_features: [
            {
              features: {
                code: 'ACCOUNTING_MODULE',
                name: 'Accounting',
                type: 'module',
                is_active: 1,
              },
            },
          ],
        },
        subscription_features: [],
      });

      const result = await service.getActiveAddons('tenant-acc');

      expect(result).toEqual([
        {
          code: 'ACCOUNTING_MODULE',
          name: 'Accounting',
          isActive: true,
          expiresAt: null,
          source: 'plan',
        },
        {
          code: 'COST_ACCOUNTING_MODULE',
          name: 'COST_ACCOUNTING_MODULE',
          isActive: true,
          expiresAt: null,
          source: 'plan',
        },
      ]);
    });

    it('hasActiveAddon(COST_ACCOUNTING_MODULE) is true via the ACCOUNTING_MODULE parent grant', async () => {
      // Mirrors AddonGuard.canActivate → hasActiveAddon(requiredAddon) for a
      // paid tenant hitting a cost-accounting controller.
      subscriptionsClient.findFirst.mockResolvedValue({
        id: 'sub-acc-2',
        plans_subscriptions_plan_idToplans: {
          plan_features: [
            {
              features: {
                code: 'ACCOUNTING_MODULE',
                name: 'Accounting',
                type: 'module',
                is_active: 1,
              },
            },
          ],
        },
        subscription_features: [],
      });

      await expect(
        service.hasActiveAddon('tenant-acc-2', 'COST_ACCOUNTING_MODULE'),
      ).resolves.toBe(true);
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

  /**
   * Approved trials ARE the entitlement — nothing is copied into
   * subscription_features on approval (that table has no expiry column and feeds
   * billing). So these tests are what stands between "admin approved a trial"
   * and the tenant actually getting the module, and between the trial lapsing
   * and access ending.
   */
  describe('getActiveAddons — approved trials', () => {
    const HOUR = 60 * 60 * 1000;

    /** An approved trial row as findActiveTrialGrants selects it. */
    const trialGrant = (code: string, expiresAt: Date, name: string | null = null) => ({
      addon_code: code,
      addon_name: name,
      expires_at: expiresAt,
    });

    const noPlan = (subId = 'sub-t') =>
      subscriptionsClient.findFirst.mockResolvedValue({
        id: subId,
        plans_subscriptions_plan_idToplans: { plan_features: [] },
        subscription_features: [],
      });

    it('grants an approved trial, carrying its real expiry date', async () => {
      const expiresAt = new Date(Date.now() + 72 * HOUR);
      noPlan();
      prismaMock.addon_trial_requests.findMany.mockResolvedValue([
        trialGrant('CAMP_MODULE', expiresAt, 'Campground'),
      ]);

      const result = await service.getActiveAddons('tenant-t1');

      expect(result).toEqual([
        {
          code: 'CAMP_MODULE',
          name: 'Campground',
          isActive: true,
          expiresAt: expiresAt.toISOString(),
          source: 'trial',
        },
      ]);
      await expect(service.hasActiveAddon('tenant-t1', 'CAMP_MODULE')).resolves.toBe(true);
    });

    it('only asks the database for approved trials that have not lapsed', async () => {
      // Expiry is enforced in the query, so a trial dies on its expires_at even
      // if the hourly job hasn't stamped it `expired` yet.
      noPlan();

      await service.getActiveAddons('tenant-t2');

      const where = prismaMock.addon_trial_requests.findMany.mock.calls[0][0].where;
      expect(where.tenant_id).toBe('tenant-t2');
      expect(where.status).toBe('approved');
      expect(where.expires_at.gt).toBeInstanceOf(Date);
    });

    it('grants a trial to a tenant who has no subscription at all', async () => {
      // A trial can be approved before the tenant ever buys a plan; the old
      // "no subscription → no entitlements" shortcut would have swallowed it.
      const expiresAt = new Date(Date.now() + 24 * HOUR);
      subscriptionsClient.findFirst.mockResolvedValue(null);
      prismaMock.addon_trial_requests.findMany.mockResolvedValue([
        trialGrant('HR_MODULE', expiresAt),
      ]);

      const result = await service.getActiveAddons('tenant-t3');

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ code: 'HR_MODULE', name: 'HR_MODULE', source: 'trial' });
    });

    it('does not let a trial shadow a module the tenant already owns', async () => {
      // Otherwise a trial approved on top of a paid module would stamp an expiry
      // date on it and the module would "expire" out from under a paying tenant.
      subscriptionsClient.findFirst.mockResolvedValue({
        id: 'sub-t4',
        plans_subscriptions_plan_idToplans: {
          plan_features: [
            { features: { code: 'HR_MODULE', name: 'HR', type: 'module', is_active: 1 } },
          ],
        },
        subscription_features: [],
      });
      prismaMock.addon_trial_requests.findMany.mockResolvedValue([
        trialGrant('HR_MODULE', new Date(Date.now() + 24 * HOUR)),
      ]);

      const result = await service.getActiveAddons('tenant-t4');

      expect(result).toEqual([
        { code: 'HR_MODULE', name: 'HR', isActive: true, expiresAt: null, source: 'plan' },
      ]);
    });

    it('expires child grants along with the trialled parent that carries them', async () => {
      const expiresAt = new Date(Date.now() + 24 * HOUR);
      noPlan();
      prismaMock.addon_trial_requests.findMany.mockResolvedValue([
        trialGrant('ACCOUNTING_MODULE', expiresAt),
      ]);

      const result = await service.getActiveAddons('tenant-t5');

      const child = result.find((a) => a.code === 'COST_ACCOUNTING_MODULE');
      expect(child).toMatchObject({ source: 'trial', expiresAt: expiresAt.toISOString() });
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

// ─── Product line separation (HOTEL vs CAMP) ────────────────────────────────
describe('AddonService - Product line separation', () => {
  let service: AddonService;

  const buildRecord = (over: Partial<Record<string, unknown>> = {}) => ({
    id: 'addon-1',
    code: 'CAMP_MODULE',
    name: 'Campground',
    description: null,
    price: new Prisma.Decimal(500),
    billing_cycle: AddonBillingCycle.MONTHLY,
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
    add_ons: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    plan_addons: { findMany: jest.fn(), deleteMany: jest.fn() },
    subscriptions: { findFirst: jest.fn(), findMany: jest.fn() },
    features: { findMany: jest.fn() },
    subscription_features: { findFirst: jest.fn(), findMany: jest.fn() },
    addon_trial_requests: { findMany: jest.fn() },
    $transaction: jest.fn(),
  };

  const cacheMock = {
    getOrSet: jest.fn().mockImplementation((_k, fn) => fn()),
    del: jest.fn().mockResolvedValue(undefined),
  };

  /** Tenant whose entitling subscription sits on a plan of the given line. */
  const tenantOnLine = (system: string) =>
    prismaMock.subscriptions.findFirst.mockResolvedValue({
      id: 'sub-1',
      plans_subscriptions_plan_idToplans: { system },
    });

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
    prismaMock.subscriptions.findMany.mockResolvedValue([]);
    prismaMock.plan_addons.deleteMany.mockResolvedValue({ count: 1 });
    prismaMock.addon_trial_requests.findMany.mockResolvedValue([]);
  });

  describe('isAddonAvailableForSystem', () => {
    it('keeps a single-line module on its own line and lets BOTH cross over', () => {
      expect(isAddonAvailableForSystem('CAMP', 'HOTEL')).toBe(false);
      expect(isAddonAvailableForSystem('HOTEL', 'CAMP')).toBe(false);
      expect(isAddonAvailableForSystem('CAMP', 'CAMP')).toBe(true);
      expect(isAddonAvailableForSystem('BOTH', 'HOTEL')).toBe(true);
      expect(isAddonAvailableForSystem('BOTH', 'CAMP')).toBe(true);
      // Legacy rows: a null system means "sellable anywhere" on a hotel plan.
      expect(isAddonAvailableForSystem(null, null)).toBe(true);
    });
  });

  describe('create', () => {
    it('persists the product line the admin picked', async () => {
      prismaMock.add_ons.findUnique.mockResolvedValue(null);
      prismaMock.add_ons.create.mockResolvedValue(buildRecord());

      const result = await service.create({
        code: 'CAMP_MODULE',
        name: 'Campground',
        price: 500,
        system: 'CAMP',
      });

      expect(prismaMock.add_ons.create.mock.calls[0][0].data.system).toBe('CAMP');
      expect(result.system).toBe('CAMP');
    });

    it('defaults to BOTH when no product line is given', async () => {
      prismaMock.add_ons.findUnique.mockResolvedValue(null);
      prismaMock.add_ons.create.mockResolvedValue(buildRecord({ code: 'HR_MODULE', system: 'BOTH' }));

      await service.create({ code: 'HR_MODULE', name: 'HR', price: 100 });

      expect(prismaMock.add_ons.create.mock.calls[0][0].data.system).toBe('BOTH');
    });
  });

  describe('update', () => {
    it('persists a changed line and unbundles it from plans of the other line', async () => {
      prismaMock.add_ons.findUnique.mockResolvedValue(buildRecord({ system: 'BOTH' }));
      prismaMock.add_ons.update.mockResolvedValue(buildRecord({ system: 'CAMP' }));
      prismaMock.plan_addons.findMany.mockResolvedValue([
        {
          plan_id: 'plan-hotel',
          plans: { id: 'plan-hotel', code: 'M', system: 'HOTEL' },
          add_ons: { code: 'CAMP_MODULE', system: 'CAMP' },
        },
        {
          plan_id: 'plan-camp',
          plans: { id: 'plan-camp', code: 'CAMP', system: 'CAMP' },
          add_ons: { code: 'CAMP_MODULE', system: 'CAMP' },
        },
      ]);

      await service.update('addon-1', { system: 'CAMP' });

      expect(prismaMock.add_ons.update.mock.calls[0][0].data.system).toBe('CAMP');
      // Only the hotel plan loses the module; the camp plan keeps it.
      expect(prismaMock.plan_addons.deleteMany).toHaveBeenCalledTimes(1);
      expect(prismaMock.plan_addons.deleteMany).toHaveBeenCalledWith({
        where: { plan_id: 'plan-hotel', addon_id: 'addon-1' },
      });
    });

    it('leaves plan bundles alone when the line is unchanged', async () => {
      prismaMock.add_ons.findUnique.mockResolvedValue(buildRecord({ system: 'CAMP' }));
      prismaMock.add_ons.update.mockResolvedValue(buildRecord({ system: 'CAMP' }));

      await service.update('addon-1', { system: 'CAMP', name: 'Campground Pro' });

      expect(prismaMock.plan_addons.findMany).not.toHaveBeenCalled();
      expect(prismaMock.plan_addons.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('filters the catalog to one business line, keeping BOTH modules', async () => {
      prismaMock.$transaction.mockResolvedValue([[], 0]);

      await service.list({ system: 'HOTEL' });

      const where = prismaMock.add_ons.findMany.mock.calls[0][0].where;
      expect(where.system).toEqual({ in: ['HOTEL', 'BOTH'] });
    });

    it('does not filter by line when none is requested', async () => {
      prismaMock.$transaction.mockResolvedValue([[], 0]);

      await service.list({});

      expect(prismaMock.add_ons.findMany.mock.calls[0][0].where.system).toBeUndefined();
    });
  });

  describe('assertAddonAllowedForTenant', () => {
    beforeEach(() => {
      prismaMock.add_ons.findMany.mockResolvedValue([
        buildRecord({ id: 'a1', code: 'CAMP_MODULE', name: 'Campground', system: 'CAMP' }),
        buildRecord({ id: 'a2', code: 'HR_MODULE', name: 'HR', system: 'BOTH' }),
        buildRecord({
          id: 'a3',
          code: 'HOUSEKEEPING_MODULE',
          name: 'Housekeeping',
          system: 'HOTEL',
        }),
      ]);
    });

    it('rejects granting the campground module to a hotel tenant', async () => {
      tenantOnLine('HOTEL');

      await expect(
        service.assertAddonAllowedForTenant('tenant-1', 'CAMP_MODULE'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects granting a hotel-only module to a campground tenant', async () => {
      tenantOnLine('CAMP');

      await expect(
        service.assertAddonAllowedForTenant('tenant-1', 'HOUSEKEEPING_MODULE'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('allows a BOTH module on either line', async () => {
      tenantOnLine('HOTEL');
      await expect(service.assertAddonAllowedForTenant('t1', 'HR_MODULE')).resolves.toBeUndefined();

      tenantOnLine('CAMP');
      await expect(service.assertAddonAllowedForTenant('t2', 'HR_MODULE')).resolves.toBeUndefined();
    });

    it('allows the campground module on a campground tenant', async () => {
      tenantOnLine('CAMP');

      await expect(
        service.assertAddonAllowedForTenant('tenant-1', 'CAMP_MODULE'),
      ).resolves.toBeUndefined();
    });

    it('ignores codes that are not sellable modules', async () => {
      tenantOnLine('HOTEL');

      // Not in the catalog → not our call to make; the caller owns not-found.
      await expect(
        service.assertAddonAllowedForTenant('tenant-1', 'SOME_FEATURE_FLAG'),
      ).resolves.toBeUndefined();
    });

    it('treats a tenant with no entitling subscription as a hotel tenant', async () => {
      prismaMock.subscriptions.findFirst.mockResolvedValue(null);

      await expect(
        service.assertAddonAllowedForTenant('tenant-1', 'CAMP_MODULE'),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.assertAddonAllowedForTenant('tenant-1', 'HOUSEKEEPING_MODULE'),
      ).resolves.toBeUndefined();
    });
  });
});
