import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { CacheService } from '@/cache/cache.service';
import { PrismaService } from '@/prisma/prisma.service';
import { AddonService } from '@/modules/addons/addon.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { REQUIRE_ADDON_KEY } from '../decorators/require-addon.decorator';
import { AddonGuard } from './addon.guard';

/**
 * The camp controllers are gated with @RequireAddon('CAMP_MODULE'), so the guard
 * is the only thing standing between a hotel tenant and CampSync. Two of its
 * bypasses — the tenant-level "admin" role and trial subscriptions — let a
 * request skip the entitlement check entirely, which is why the product-line
 * check has to run *before* them. These tests pin that ordering: they fail if
 * the check is ever moved back down.
 *
 * The real AddonService is wired in so the rule under test is the real one.
 */
describe('AddonGuard — product-line separation', () => {
  let guard: AddonGuard;

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
    subscriptions: { findFirst: jest.fn(), findMany: jest.fn() },
    subscription_features: { findFirst: jest.fn(), findMany: jest.fn() },
    features: { findMany: jest.fn() },
    addon_trial_requests: { findMany: jest.fn() },
  };

  const cacheMock = {
    getOrSet: jest.fn().mockImplementation((_k: string, fn: () => unknown) => fn()),
    del: jest.fn().mockResolvedValue(undefined),
  };

  const reflectorMock = {
    getAllAndOverride: jest.fn(),
  };

  /** @RequireAddon(code) on the handler, not @Public(). */
  const gateOn = (code: string) =>
    reflectorMock.getAllAndOverride.mockImplementation((key: string) =>
      key === IS_PUBLIC_KEY ? false : key === REQUIRE_ADDON_KEY ? code : undefined,
    );

  const contextFor = (user: Record<string, unknown>): ExecutionContext =>
    ({
      getHandler: () => ({ name: 'findAll' }),
      getClass: () => ({ name: 'ZonesController' }),
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as unknown as ExecutionContext;

  /**
   * One subscription row answers every read the guard makes: the plan's line
   * (getTenantSystem), the trial check, and the entitlement list.
   */
  const subscriptionOn = (
    system: string,
    status: string,
    modules: string[] = [],
  ): Record<string, unknown> => ({
    id: 'sub-1',
    status,
    plans_subscriptions_plan_idToplans: {
      system,
      plan_features: modules.map((code) => ({
        features: { code, name: code, type: 'module', is_active: 1 },
      })),
    },
    subscription_features: [],
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AddonGuard,
        AddonService,
        { provide: Reflector, useValue: reflectorMock },
        { provide: PrismaService, useValue: prismaMock },
        { provide: CacheService, useValue: cacheMock },
      ],
    }).compile();

    guard = module.get(AddonGuard);
    jest.clearAllMocks();
    cacheMock.getOrSet.mockImplementation((_k: string, fn: () => unknown) => fn());
    prismaMock.addon_trial_requests.findMany.mockResolvedValue([]);
    prismaMock.add_ons.findMany.mockResolvedValue([
      catalogRow(),
      catalogRow({ id: 'addon-hr', code: 'HR_MODULE', name: 'HR', system: 'BOTH' }),
    ]);
    gateOn('CAMP_MODULE');
  });

  it('blocks a hotel tenant from a camp endpoint even when the user is a tenant admin', async () => {
    // 'admin' is a TENANT role and sits in the guard's bypass list — the line
    // check has to have already rejected the request by the time we get there.
    prismaMock.subscriptions.findFirst.mockResolvedValue(subscriptionOn('HOTEL', 'active'));

    await expect(
      guard.canActivate(contextFor({ tenantId: 'tenant-hotel', role: 'admin' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('blocks a hotel tenant on trial (trial otherwise grants full access)', async () => {
    prismaMock.subscriptions.findFirst.mockResolvedValue(subscriptionOn('HOTEL', 'trial'));

    await expect(
      guard.canActivate(contextFor({ tenantId: 'tenant-hotel', role: 'manager' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('returns a product-line error code, not the generic upgrade prompt', async () => {
    // A hotel tenant cannot buy their way in, so the 403 must not point at the
    // add-on checkout page the way a missing-entitlement 403 does.
    prismaMock.subscriptions.findFirst.mockResolvedValue(subscriptionOn('HOTEL', 'active'));

    const error = await guard
      .canActivate(contextFor({ tenantId: 'tenant-hotel', role: 'manager' }))
      .catch((e: ForbiddenException) => e);

    const body = (error as ForbiddenException).getResponse() as Record<string, unknown>;
    expect(body.code).toBe('CAMP_MODULE_WRONG_PRODUCT_LINE');
    expect(body.upgradeUrl).toBeUndefined();
  });

  it('lets a campground tenant who owns the module through', async () => {
    prismaMock.subscriptions.findFirst.mockResolvedValue(
      subscriptionOn('CAMP', 'active', ['CAMP_MODULE']),
    );

    await expect(
      guard.canActivate(contextFor({ tenantId: 'tenant-camp', role: 'manager' })),
    ).resolves.toBe(true);
  });

  it('still asks a campground tenant without the module to upgrade', async () => {
    // Same line, no entitlement → the ordinary 403, which does point at checkout.
    prismaMock.subscriptions.findFirst.mockResolvedValue(subscriptionOn('CAMP', 'active'));

    const error = await guard
      .canActivate(contextFor({ tenantId: 'tenant-camp', role: 'manager' }))
      .catch((e: ForbiddenException) => e);

    const body = (error as ForbiddenException).getResponse() as Record<string, unknown>;
    expect(body.code).toBe('CAMP_MODULE_REQUIRED');
    expect(body.upgradeUrl).toBe('/billing/addons');
  });

  it('leaves the trial bypass intact for a module sold on both lines', async () => {
    gateOn('HR_MODULE');
    prismaMock.subscriptions.findFirst.mockResolvedValue(subscriptionOn('HOTEL', 'trial'));

    await expect(
      guard.canActivate(contextFor({ tenantId: 'tenant-hotel', role: 'manager' })),
    ).resolves.toBe(true);
  });

  it('exempts platform users, who work across tenants and lines', async () => {
    prismaMock.subscriptions.findFirst.mockResolvedValue(subscriptionOn('HOTEL', 'active'));

    await expect(
      guard.canActivate(
        contextFor({ tenantId: 'tenant-hotel', role: 'platform_admin', isPlatformAdmin: true }),
      ),
    ).resolves.toBe(true);
  });
});
