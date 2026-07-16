import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { CacheService } from '@/cache/cache.service';
import { PrismaService } from '@/prisma/prisma.service';
import { AddonService } from '@/modules/addons/addon.service';
import { AddonTrialRequestService } from './addon-trial-request.service';

/**
 * Trials are a grant path: an approved request hands the tenant a module. The
 * real AddonService is wired in (not a stub) so these tests exercise the actual
 * product-line rule — a hotel tenant must not be able to request, nor be
 * approved for, the campground module.
 */
describe('AddonTrialRequestService — product-line separation', () => {
  let service: AddonTrialRequestService;
  let moduleRef: TestingModule;

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

  const trialRequests = {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  };

  const prismaMock = {
    addon_trial_requests: trialRequests,
    add_ons: { findMany: jest.fn(), findUnique: jest.fn() },
    subscriptions: { findFirst: jest.fn(), findMany: jest.fn() },
    subscription_features: { findFirst: jest.fn(), findMany: jest.fn() },
    features: { findFirst: jest.fn(), findMany: jest.fn() },
    notification: { create: jest.fn() },
    $transaction: jest.fn(),
  };

  const cacheMock = {
    getOrSet: jest.fn().mockImplementation((_k, fn) => fn()),
    del: jest.fn().mockResolvedValue(undefined),
  };

  /**
   * The tenant's line comes from the plan behind their entitling subscription.
   * The same row is read by getActiveAddons (owns-it-already check), hence the
   * empty feature lists — the tenant is entitled to nothing yet.
   */
  const tenantOnLine = (system: string) =>
    prismaMock.subscriptions.findFirst.mockResolvedValue({
      id: 'sub-1',
      plans_subscriptions_plan_idToplans: { system, plan_features: [] },
      subscription_features: [],
    });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AddonTrialRequestService,
        AddonService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: CacheService, useValue: cacheMock },
      ],
    }).compile();

    moduleRef = module;
    service = module.get(AddonTrialRequestService);
    jest.clearAllMocks();
    cacheMock.getOrSet.mockImplementation((_k: string, fn: () => unknown) => fn());
    prismaMock.add_ons.findMany.mockResolvedValue([
      catalogRow(),
      catalogRow({ id: 'addon-hr', code: 'HR_MODULE', name: 'HR', system: 'BOTH' }),
    ]);
    // getActiveAddons() now reads approved trials as an entitlement source.
    trialRequests.findMany.mockResolvedValue([]);
  });

  describe('createRequest', () => {
    it('refuses a hotel tenant asking to trial the campground module', async () => {
      tenantOnLine('HOTEL');

      await expect(
        service.createRequest('tenant-hotel', { addonCode: 'CAMP_MODULE' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(trialRequests.create).not.toHaveBeenCalled();
    });

    it('lets a hotel tenant trial a module sold on both lines', async () => {
      tenantOnLine('HOTEL');
      trialRequests.findFirst.mockResolvedValue(null);
      trialRequests.create.mockResolvedValue({
        id: 'req-1',
        tenant_id: 'tenant-hotel',
        addon_code: 'HR_MODULE',
        addon_name: 'HR',
        status: 'pending',
        note: null,
        admin_note: null,
        approved_by: null,
        approved_at: null,
        expires_at: null,
        created_at: new Date('2026-07-13T00:00:00Z'),
        updated_at: new Date('2026-07-13T00:00:00Z'),
      });

      const result = await service.createRequest('tenant-hotel', { addonCode: 'HR_MODULE' });

      expect(result.status).toBe('pending');
      expect(trialRequests.create).toHaveBeenCalled();
    });

    it('lets a campground tenant trial the campground module', async () => {
      tenantOnLine('CAMP');
      trialRequests.findFirst.mockResolvedValue(null);
      trialRequests.create.mockResolvedValue({
        id: 'req-2',
        tenant_id: 'tenant-camp',
        addon_code: 'CAMP_MODULE',
        addon_name: 'Campground',
        status: 'pending',
        note: null,
        admin_note: null,
        approved_by: null,
        approved_at: null,
        expires_at: null,
        created_at: new Date('2026-07-13T00:00:00Z'),
        updated_at: new Date('2026-07-13T00:00:00Z'),
      });

      await expect(
        service.createRequest('tenant-camp', { addonCode: 'CAMP_MODULE' }),
      ).resolves.toMatchObject({ addonCode: 'CAMP_MODULE' });
    });
  });

  describe('approve', () => {
    it('refuses to approve a campground trial for a tenant now on a hotel plan', async () => {
      // The tenant may have switched plans after filing the request, so the line
      // is re-checked at approval instead of trusting the earlier check.
      trialRequests.findUnique.mockResolvedValue({
        id: 'req-1',
        tenant_id: 'tenant-hotel',
        addon_code: 'CAMP_MODULE',
        status: 'pending',
      });
      tenantOnLine('HOTEL');

      await expect(service.approve('req-1', 'admin-1', {})).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(trialRequests.update).not.toHaveBeenCalled();
    });

    /**
     * Approval used to copy the add-on into subscription_features, which never
     * worked — the upsert named a compound unique that doesn't exist and its
     * create omitted the required `price`, and the whole thing was wrapped in a
     * catch that logged and moved on. Admins saw "approved"; tenants got nothing.
     * The approved row itself is now the entitlement.
     */
    it('grants the trial through the request row, not subscription_features', async () => {
      const approvedRow = {
        id: 'req-9',
        tenant_id: 'tenant-camp',
        addon_code: 'CAMP_MODULE',
        addon_name: 'Campground',
        status: 'approved',
        note: null,
        admin_note: null,
        approved_by: 'admin-1',
        approved_at: new Date('2026-07-13T00:00:00Z'),
        expires_at: new Date('2026-07-27T00:00:00Z'),
        created_at: new Date('2026-07-13T00:00:00Z'),
        updated_at: new Date('2026-07-13T00:00:00Z'),
      };
      trialRequests.findUnique.mockResolvedValue({ ...approvedRow, status: 'pending' });
      trialRequests.update.mockResolvedValue(approvedRow);
      tenantOnLine('CAMP');

      const result = await service.approve('req-9', 'admin-1', { trialDays: 14 });

      // The write that matters: status + a real expiry on the request row.
      const written = trialRequests.update.mock.calls[0][0].data;
      expect(written.status).toBe('approved');
      expect(written.expires_at).toBeInstanceOf(Date);
      expect(result.expiresAt).toBe('2026-07-27T00:00:00.000Z');

      // Billing is driven off subscription_features; a free trial must not land
      // there or the tenant gets invoiced for it — and never loses it.
      expect(prismaMock.subscription_features).not.toHaveProperty('upsert');
      expect(prismaMock.features.findFirst).not.toHaveBeenCalled();

      // Cache is dropped, so the new entitlement shows up immediately.
      expect(cacheMock.del).toHaveBeenCalled();
    });

    it('surfaces the entitlement to the tenant right after approval', async () => {
      // End to end through the real AddonService: an approved, unexpired row is
      // an active add-on.
      const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
      tenantOnLine('CAMP');
      trialRequests.findMany.mockResolvedValue([
        { addon_code: 'CAMP_MODULE', addon_name: 'Campground', expires_at: expiresAt },
      ]);

      const addonService = moduleRef.get(AddonService);

      await expect(addonService.hasActiveAddon('tenant-camp', 'CAMP_MODULE')).resolves.toBe(true);
      const active = await addonService.getActiveAddons('tenant-camp');
      expect(active).toContainEqual({
        code: 'CAMP_MODULE',
        name: 'Campground',
        isActive: true,
        expiresAt: expiresAt.toISOString(),
        source: 'trial',
      });
    });
  });

  describe('createRequest after a trial has run out', () => {
    it('lets a tenant ask again once the previous trial has lapsed', async () => {
      // The duplicate check keys off the expiry date, not the status, so a tenant
      // is not locked out in the window before the hourly job stamps `expired`.
      tenantOnLine('CAMP');
      trialRequests.findFirst.mockResolvedValue(null);
      trialRequests.create.mockResolvedValue({
        id: 'req-10',
        tenant_id: 'tenant-camp',
        addon_code: 'CAMP_MODULE',
        addon_name: 'Campground',
        status: 'pending',
        note: null,
        admin_note: null,
        approved_by: null,
        approved_at: null,
        expires_at: null,
        created_at: new Date('2026-07-13T00:00:00Z'),
        updated_at: new Date('2026-07-13T00:00:00Z'),
      });

      await service.createRequest('tenant-camp', { addonCode: 'CAMP_MODULE' });

      const where = trialRequests.findFirst.mock.calls[0][0].where;
      expect(where.OR).toEqual([
        { status: 'pending' },
        { status: 'approved', expires_at: { gt: expect.any(Date) } },
      ]);
    });
  });
});
