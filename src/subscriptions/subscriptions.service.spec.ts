import { Test, TestingModule } from '@nestjs/testing';
import { SubscriptionsService } from './subscriptions.service';
import { PrismaService } from '../prisma/prisma.service';
import { AddonService } from '@/modules/addons/addon.service';
import { SubscriptionStatus } from './entities/subscription.entity';

describe('SubscriptionsService.create - billing date defaults', () => {
  let service: SubscriptionsService;
  let prismaCreate: jest.Mock;
  let invalidateAddonCache: jest.Mock;

  beforeEach(async () => {
    prismaCreate = jest.fn().mockResolvedValue({ tenant_id: 'tenant-1' });
    invalidateAddonCache = jest.fn().mockResolvedValue(undefined);
    const mockPrisma = {
      subscriptions: {
        create: prismaCreate,
        findMany: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AddonService, useValue: { invalidateAddonCache } },
      ],
    }).compile();

    service = module.get(SubscriptionsService);
  });

  it('drops the tenant entitlement cache so a new plan is visible immediately', async () => {
    await service.create({
      tenantId: 'tenant-1',
      planId: 'plan-1',
      status: SubscriptionStatus.ACTIVE,
      startDate: new Date('2026-04-01') as any,
      endDate: new Date('2026-05-01') as any,
    });

    expect(invalidateAddonCache).toHaveBeenCalledWith('tenant-1');
  });

  it('defaults next_billing_date to endDate and billing_anchor_date to startDate when omitted', async () => {
    await service.create({
      tenantId: 'tenant-1',
      planId: 'plan-1',
      status: SubscriptionStatus.ACTIVE,
      startDate: new Date('2026-04-01') as any,
      endDate: new Date('2026-05-01') as any,
      autoRenew: true,
    });

    expect(prismaCreate).toHaveBeenCalledTimes(1);
    const data = prismaCreate.mock.calls[0][0].data;

    expect(data.next_billing_date).toBeInstanceOf(Date);
    expect((data.next_billing_date as Date).toISOString().split('T')[0]).toBe('2026-05-01');

    expect(data.billing_anchor_date).toBeInstanceOf(Date);
    expect((data.billing_anchor_date as Date).toISOString().split('T')[0]).toBe('2026-04-01');
  });

  it('honors explicit nextBillingDate / billingAnchorDate when provided', async () => {
    await service.create({
      tenantId: 'tenant-1',
      planId: 'plan-1',
      status: SubscriptionStatus.ACTIVE,
      startDate: new Date('2026-04-01') as any,
      endDate: new Date('2026-05-01') as any,
      autoRenew: true,
      nextBillingDate: new Date('2026-06-15') as any,
      billingAnchorDate: new Date('2026-04-15') as any,
    });

    const data = prismaCreate.mock.calls[0][0].data;
    expect((data.next_billing_date as Date).toISOString().split('T')[0]).toBe('2026-06-15');
    expect((data.billing_anchor_date as Date).toISOString().split('T')[0]).toBe('2026-04-15');
  });

  it('still strips undefined fields (no previous_plan_id leak)', async () => {
    await service.create({
      tenantId: 'tenant-1',
      planId: 'plan-1',
      status: SubscriptionStatus.ACTIVE,
      startDate: new Date('2026-04-01') as any,
      endDate: new Date('2026-05-01') as any,
    });

    const data = prismaCreate.mock.calls[0][0].data;
    expect('previous_plan_id' in data).toBe(false);
    expect('subscription_code' in data).toBe(false);
    expect(data.auto_renew).toBe(1);
  });
});

describe('SubscriptionsService.update - camelCase → snake_case mapping', () => {
  let service: SubscriptionsService;
  let prismaUpdate: jest.Mock;
  let invalidateAddonCache: jest.Mock;

  beforeEach(async () => {
    prismaUpdate = jest.fn().mockResolvedValue({ tenant_id: 'tenant-1' });
    invalidateAddonCache = jest.fn().mockResolvedValue(undefined);
    const mockPrisma = {
      subscriptions: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn().mockResolvedValue({ tenant_id: 'tenant-1' }),
        update: prismaUpdate,
        delete: jest.fn(),
      },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AddonService, useValue: { invalidateAddonCache } },
      ],
    }).compile();
    service = module.get(SubscriptionsService);
  });

  it('drops the entitlement cache after a plan change (stale modules would gate the new plan)', async () => {
    await service.update('sub-1', { planId: 'plan-2' } as any);

    expect(invalidateAddonCache).toHaveBeenCalledWith('tenant-1');
  });

  it('maps planId → plan_id so a plan change does not throw "Unknown argument planId"', async () => {
    await service.update('sub-1', { planId: 'plan-2' } as any);

    const data = prismaUpdate.mock.calls[0][0].data;
    expect(data.plan_id).toBe('plan-2');
    // the raw camelCase key must NOT be forwarded to Prisma
    expect('planId' in data).toBe(false);
  });

  it('forwards only defined fields (partial update does not clobber others)', async () => {
    await service.update('sub-1', { status: SubscriptionStatus.ACTIVE } as any);

    const data = prismaUpdate.mock.calls[0][0].data;
    expect(data.status).toBe(SubscriptionStatus.ACTIVE);
    expect('plan_id' in data).toBe(false);
    expect('tenant_id' in data).toBe(false);
  });
});
