import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { UsageMeteringService } from './usage-metering.service';
import { PrismaService } from '../prisma/prisma.service';

describe('UsageMeteringService', () => {
  let service: UsageMeteringService;
  let mockExecuteRaw: jest.Mock;
  let mockFindUnique: jest.Mock;
  let mockFindMany: jest.Mock;

  beforeEach(async () => {
    mockExecuteRaw = jest.fn().mockResolvedValue(1);
    mockFindUnique = jest.fn();
    mockFindMany = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsageMeteringService,
        {
          provide: PrismaService,
          useValue: {
            $executeRawUnsafe: mockExecuteRaw,
            usage_counters: {
              findUnique: mockFindUnique,
              findMany: mockFindMany,
            },
          },
        },
      ],
    }).compile();

    service = module.get(UsageMeteringService);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('periodKey formats as YYYY-MM in UTC', () => {
    expect(service.periodKey(new Date('2026-05-15T03:00:00Z'))).toBe('2026-05');
    expect(service.periodKey(new Date('2026-12-31T23:00:00Z'))).toBe('2026-12');
  });

  it('record() upserts with VALUES sum + GREATEST peak', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-01T00:00:00Z'));

    await service.record({ tenantId: 't1', metricCode: 'bookings', amount: 5 });

    expect(mockExecuteRaw).toHaveBeenCalledTimes(1);
    const sql = mockExecuteRaw.mock.calls[0][0] as string;
    expect(sql).toContain('INSERT INTO usage_counters');
    expect(sql).toContain('ON DUPLICATE KEY UPDATE');
    expect(sql).toContain('value = value + VALUES(value)');
    // bind args: tenantId, metric, period, amount, amount, now
    expect(mockExecuteRaw.mock.calls[0].slice(1, 4)).toEqual([
      't1',
      'bookings',
      '2026-05',
    ]);
  });

  it('record() defaults amount to 1 when omitted', async () => {
    await service.record({ tenantId: 't1', metricCode: 'api_calls' });
    const args = mockExecuteRaw.mock.calls[0];
    expect(args[4]).toBe(1); // amount
    expect(args[5]).toBe(1); // amount (peak seed)
  });

  it('record() rejects negative amount', async () => {
    await expect(
      service.record({ tenantId: 't1', metricCode: 'x', amount: -1 }),
    ).rejects.toThrow(BadRequestException);
    expect(mockExecuteRaw).not.toHaveBeenCalled();
  });

  it('setPeak() uses GREATEST(peak_value, ...)', async () => {
    await service.setPeak({ tenantId: 't1', metricCode: 'rooms', amount: 12 });
    const sql = mockExecuteRaw.mock.calls[0][0] as string;
    expect(sql).toContain('peak_value = GREATEST(peak_value, VALUES(peak_value))');
  });

  it('getSnapshot returns zeroed snapshot when no row exists', async () => {
    mockFindUnique.mockResolvedValue(null);
    const snap = await service.getSnapshot('t1', 'bookings', '2026-05');
    expect(snap).toEqual({
      tenantId: 't1',
      metricCode: 'bookings',
      period: '2026-05',
      value: 0,
      peakValue: 0,
      lastEventAt: null,
    });
  });

  it('getSnapshot maps DB row to numeric snapshot', async () => {
    mockFindUnique.mockResolvedValue({
      tenant_id: 't1',
      metric_code: 'bookings',
      period: '2026-05',
      value: BigInt(123),
      peak_value: BigInt(150),
      last_event_at: new Date('2026-05-10T10:00:00Z'),
    });
    const snap = await service.getSnapshot('t1', 'bookings', '2026-05');
    expect(snap.value).toBe(123);
    expect(snap.peakValue).toBe(150);
    expect(snap.lastEventAt).toBeInstanceOf(Date);
  });

  it('listSnapshots maps every row in the period', async () => {
    mockFindMany.mockResolvedValue([
      {
        tenant_id: 't1',
        metric_code: 'bookings',
        period: '2026-05',
        value: BigInt(10),
        peak_value: BigInt(10),
      },
      {
        tenant_id: 't1',
        metric_code: 'rooms',
        period: '2026-05',
        value: BigInt(0),
        peak_value: BigInt(45),
      },
    ]);
    const list = await service.listSnapshots('t1', '2026-05');
    expect(list).toHaveLength(2);
    expect(list[0].metricCode).toBe('bookings');
    expect(list[1].peakValue).toBe(45);
  });
});
