import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { OverageBillingService } from './overage-billing.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';

describe('OverageBillingService.settlePeriod', () => {
  let service: OverageBillingService;
  let mockCountersFindMany: jest.Mock;
  let mockSubFindFirst: jest.Mock;
  let mockMetricFindUnique: jest.Mock;
  let mockOverageCreate: jest.Mock;

  beforeEach(async () => {
    mockCountersFindMany = jest.fn();
    mockSubFindFirst = jest.fn();
    mockMetricFindUnique = jest.fn();
    mockOverageCreate = jest.fn().mockResolvedValue({});

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OverageBillingService,
        {
          provide: PrismaService,
          useValue: {
            usage_counters: { findMany: mockCountersFindMany },
            subscriptions: { findFirst: mockSubFindFirst },
            usage_metric_definitions: { findUnique: mockMetricFindUnique },
            usage_overage_charges: { create: mockOverageCreate },
            billing_history: {
              findFirst: jest.fn(),
              create: jest.fn(),
            },
          },
        },
        {
          provide: EmailService,
          useValue: { sendEmail: jest.fn() },
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(OverageBillingService);
  });

  afterEach(() => jest.clearAllMocks());

  it('creates overage charge when usage exceeds plan limit', async () => {
    mockCountersFindMany.mockResolvedValue([
      {
        tenant_id: 't1',
        metric_code: 'bookings',
        period: '2026-04',
        value: BigInt(150),
      },
    ]);
    mockSubFindFirst.mockResolvedValue({
      id: 'sub-1',
      plans_subscriptions_plan_idToplans: { max_bookings: 100 },
    });
    mockMetricFindUnique.mockResolvedValue({ overage_unit_price: 5 });

    const created = await service.settlePeriod('2026-04');

    expect(created).toBe(1);
    expect(mockOverageCreate).toHaveBeenCalledTimes(1);
    const data = mockOverageCreate.mock.calls[0][0].data;
    expect(data.usage_amount).toBe(150);
    expect(data.included_amount).toBe(100);
    expect(data.overage_amount).toBe(50);
    expect(Number(data.total_charge)).toBe(250); // 50 * 5
    expect(data.status).toBe('pending');
  });

  it('skips when usage is within limit', async () => {
    mockCountersFindMany.mockResolvedValue([
      {
        tenant_id: 't1',
        metric_code: 'bookings',
        period: '2026-04',
        value: BigInt(80),
      },
    ]);
    mockSubFindFirst.mockResolvedValue({
      id: 'sub-1',
      plans_subscriptions_plan_idToplans: { max_bookings: 100 },
    });

    const created = await service.settlePeriod('2026-04');
    expect(created).toBe(0);
    expect(mockOverageCreate).not.toHaveBeenCalled();
  });

  it('skips when plan has unlimited (limit <= 0)', async () => {
    mockCountersFindMany.mockResolvedValue([
      {
        tenant_id: 't1',
        metric_code: 'bookings',
        period: '2026-04',
        value: BigInt(9999),
      },
    ]);
    mockSubFindFirst.mockResolvedValue({
      id: 'sub-1',
      plans_subscriptions_plan_idToplans: { max_bookings: 0 },
    });
    expect(await service.settlePeriod('2026-04')).toBe(0);
  });

  it('skips metrics with no monetization (unit_price = 0)', async () => {
    mockCountersFindMany.mockResolvedValue([
      {
        tenant_id: 't1',
        metric_code: 'api_calls',
        period: '2026-04',
        value: BigInt(2000),
      },
    ]);
    mockSubFindFirst.mockResolvedValue({
      id: 'sub-1',
      plans_subscriptions_plan_idToplans: { max_api_calls: 1000 },
    });
    mockMetricFindUnique.mockResolvedValue({ overage_unit_price: 0 });
    expect(await service.settlePeriod('2026-04')).toBe(0);
  });

  it('is idempotent on unique-constraint replays', async () => {
    mockCountersFindMany.mockResolvedValue([
      {
        tenant_id: 't1',
        metric_code: 'bookings',
        period: '2026-04',
        value: BigInt(150),
      },
    ]);
    mockSubFindFirst.mockResolvedValue({
      id: 'sub-1',
      plans_subscriptions_plan_idToplans: { max_bookings: 100 },
    });
    mockMetricFindUnique.mockResolvedValue({ overage_unit_price: 5 });
    mockOverageCreate.mockRejectedValue(
      new Error('Unique constraint failed on usage_overage_charges'),
    );

    const created = await service.settlePeriod('2026-04');
    expect(created).toBe(0); // record was skipped due to dedupe
  });

  it('previousMonthKey returns YYYY-MM one month before now', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-15T00:00:00Z'));
    expect(service.previousMonthKey()).toBe('2026-04');
    jest.useRealTimers();
  });
});
