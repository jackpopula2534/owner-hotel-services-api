import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AdminBillingCycleService } from './admin-billing-cycle.service';
import {
  Subscription,
  SubscriptionStatus,
  BillingCycle,
} from '../subscriptions/entities/subscription.entity';
import { BillingHistory } from '../subscriptions/entities/billing-history.entity';
import { Invoice } from '../invoices/entities/invoice.entity';
import { SubscriptionFeature } from '../subscription-features/entities/subscription-feature.entity';
import { Plan } from '../plans/entities/plan.entity';

describe('AdminBillingCycleService.getBillingInfo - nextBillingDate', () => {
  let service: AdminBillingCycleService;
  let subscriptionsRepo: jest.Mocked<Repository<Subscription>>;
  let featuresRepo: jest.Mocked<Repository<SubscriptionFeature>>;

  const buildSubscription = (overrides: Partial<Subscription> = {}): Subscription => {
    const base: Partial<Subscription> = {
      id: 'sub-1',
      subscriptionCode: 'SUB-001',
      tenantId: 'tenant-1',
      planId: 'plan-1',
      status: SubscriptionStatus.ACTIVE,
      billingCycle: BillingCycle.MONTHLY,
      startDate: new Date('2026-04-01'),
      endDate: new Date('2026-06-01'),
      nextBillingDate: null as unknown as Date,
      billingAnchorDate: null as unknown as Date,
      autoRenew: true,
      renewedCount: 0,
      tenant: { name: 'Sukjai Hotel' } as any,
      plan: { name: 'Standard', priceMonthly: 4990 } as any,
    };
    return { ...base, ...overrides } as Subscription;
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminBillingCycleService,
        {
          provide: getRepositoryToken(Subscription),
          useValue: {
            findOne: jest.fn(),
            save: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(BillingHistory),
          useValue: { find: jest.fn(), create: jest.fn(), save: jest.fn() },
        },
        {
          provide: getRepositoryToken(Invoice),
          useValue: {
            findOne: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(SubscriptionFeature),
          useValue: { find: jest.fn().mockResolvedValue([]) },
        },
        {
          provide: getRepositoryToken(Plan),
          useValue: { findByIds: jest.fn().mockResolvedValue([]) },
        },
      ],
    }).compile();

    service = module.get(AdminBillingCycleService);
    subscriptionsRepo = module.get(getRepositoryToken(Subscription));
    featuresRepo = module.get(getRepositoryToken(SubscriptionFeature));
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('falls back to endDate when nextBillingDate is null and endDate is in the future', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-01'));
    const subscription = buildSubscription({
      nextBillingDate: null as unknown as Date,
      endDate: new Date('2026-06-01'),
    });
    subscriptionsRepo.findOne.mockResolvedValue(subscription);
    (featuresRepo.find as jest.Mock).mockResolvedValue([]);

    const result = await service.getBillingInfo('sub-1');

    expect(result.nextBillingDate).toBe('2026-06-01');
    expect(result.currentPeriodEnd).toBe('2026-06-01');
    expect(result.billingAnchorDate).toBe('2026-04-01');
  });

  it('uses stored nextBillingDate when available', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-01'));
    const subscription = buildSubscription({
      nextBillingDate: new Date('2026-07-15'),
      endDate: new Date('2026-06-01'),
    });
    subscriptionsRepo.findOne.mockResolvedValue(subscription);

    const result = await service.getBillingInfo('sub-1');

    expect(result.nextBillingDate).toBe('2026-07-15');
  });

  it('rolls forward by month when endDate already passed (monthly cycle)', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-15'));
    const subscription = buildSubscription({
      nextBillingDate: null as unknown as Date,
      endDate: new Date('2026-06-01'),
      billingCycle: BillingCycle.MONTHLY,
    });
    subscriptionsRepo.findOne.mockResolvedValue(subscription);

    const result = await service.getBillingInfo('sub-1');

    expect(result.nextBillingDate).toBe('2026-09-01');
  });

  it('rolls forward by year when endDate already passed (yearly cycle)', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2027-02-01'));
    const subscription = buildSubscription({
      nextBillingDate: null as unknown as Date,
      endDate: new Date('2026-06-01'),
      billingCycle: BillingCycle.YEARLY,
    });
    subscriptionsRepo.findOne.mockResolvedValue(subscription);

    const result = await service.getBillingInfo('sub-1');

    expect(result.nextBillingDate).toBe('2027-06-01');
  });

  it('returns N/A only when subscription has no endDate at all', async () => {
    const subscription = buildSubscription({
      nextBillingDate: null as unknown as Date,
      endDate: null as unknown as Date,
    });
    subscriptionsRepo.findOne.mockResolvedValue(subscription);

    const result = await service.getBillingInfo('sub-1');

    expect(result.nextBillingDate).toBe('N/A');
  });
});

describe('AdminBillingCycleService.renewSubscription - flexible periods', () => {
  let service: AdminBillingCycleService;
  let subsRepo: any;
  let invoicesRepo: any;
  let billingHistoryRepo: any;

  beforeEach(async () => {
    subsRepo = { findOne: jest.fn(), save: jest.fn(async (s: any) => s) };
    invoicesRepo = {
      findOne: jest.fn(),
      create: jest.fn((x: any) => x),
      save: jest.fn(async (x: any) => ({ ...x, id: 'inv-1', invoiceNo: 'INV-1' })),
    };
    billingHistoryRepo = {
      find: jest.fn(),
      create: jest.fn((x: any) => x),
      save: jest.fn(async (x: any) => x),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminBillingCycleService,
        { provide: getRepositoryToken(Subscription), useValue: subsRepo },
        { provide: getRepositoryToken(BillingHistory), useValue: billingHistoryRepo },
        { provide: getRepositoryToken(Invoice), useValue: invoicesRepo },
        {
          provide: getRepositoryToken(SubscriptionFeature),
          useValue: { find: jest.fn().mockResolvedValue([]) },
        },
        {
          provide: getRepositoryToken(Plan),
          useValue: { findByIds: jest.fn().mockResolvedValue([]) },
        },
      ],
    }).compile();

    service = module.get(AdminBillingCycleService);
  });

  const baseSub = (): any => ({
    id: 'sub-1',
    subscriptionCode: 'SUB-001',
    status: SubscriptionStatus.ACTIVE,
    billingCycle: BillingCycle.MONTHLY,
    startDate: new Date('2026-04-01'),
    endDate: new Date('2026-06-01'),
    autoRenew: true,
    renewedCount: 0,
    plan: { name: 'Standard', priceMonthly: 4990 },
    tenant: { name: 'Sukjai' },
  });

  it('uses periodDays for week-sized renewal (7 days)', async () => {
    subsRepo.findOne.mockResolvedValue(baseSub());

    const res = await service.renewSubscription('sub-1', {
      periodDays: 7,
      createInvoice: false,
    });

    // 2026-06-01 + 7 days = 2026-06-08
    expect(res.data.newEndDate).toBe('2026-06-08');
  });

  it('uses customEndDate when provided', async () => {
    subsRepo.findOne.mockResolvedValue(baseSub());

    const res = await service.renewSubscription('sub-1', {
      customEndDate: '2026-12-31',
      createInvoice: false,
    });

    expect(res.data.newEndDate).toBe('2026-12-31');
  });

  it('rejects customEndDate that is before current period end', async () => {
    subsRepo.findOne.mockResolvedValue(baseSub());

    await expect(
      service.renewSubscription('sub-1', {
        customEndDate: '2026-05-01',
        createInvoice: false,
      }),
    ).rejects.toThrow();
  });

  it('falls back to periodMonths when neither periodDays nor customEndDate given', async () => {
    subsRepo.findOne.mockResolvedValue(baseSub());

    const res = await service.renewSubscription('sub-1', {
      periodMonths: 3,
      createInvoice: false,
    });

    // 2026-06-01 + 3 months = 2026-09-01
    expect(res.data.newEndDate).toBe('2026-09-01');
  });
});
