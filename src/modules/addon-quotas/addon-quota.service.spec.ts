import { HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AddonQuotaService } from './addon-quota.service';
import { bangkokStartOfDate, quotaPeriod } from './addon-quota.constants';

type Row = {
  id: string;
  tenantId: string;
  addonCode: string;
  metricCode: string;
  period: string;
  source: string;
  isOverage: boolean;
  status: string;
  createdAt: Date;
  failureReason?: string | null;
};

const config = (overrides: Record<string, unknown> = {}) => ({
  id: 'c1',
  addonCode: 'CAMP_3D_MAP',
  metricCode: 'CAMP_3D_AI_EXTRACT',
  includedPerPeriod: 3,
  overageUnitPriceThb: new Prisma.Decimal(79),
  maxOveragePerPeriod: 2,
  trialDays: 14,
  trialIncluded: 1,
  rateLimitPerMinute: 0,
  refundOnFailure: true,
  updatedBy: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

/** ตาราง addon_usage_reservations แบบ in-memory — รองรับ where เท่าที่ service ใช้ */
function matches(row: Row, where: Record<string, any>): boolean {
  return Object.entries(where).every(([k, v]) => {
    const value = (row as Record<string, unknown>)[k];
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if ('not' in v) return value !== v.not;
      if ('gte' in v) return (value as Date) >= v.gte;
      if ('lt' in v) return (value as Date) < v.lt;
    }
    return value === v;
  });
}

function setup(
  opts: { cfg?: Record<string, unknown>; source?: 'subscription' | 'trial' | null } = {},
) {
  const rows: Row[] = [];
  let seq = 0;
  const reservations = {
    count: jest.fn(async ({ where }) => rows.filter((r) => matches(r, where)).length),
    create: jest.fn(async ({ data }) => {
      const row = { id: `r${++seq}`, createdAt: new Date(), ...data } as Row;
      rows.push(row);
      return row;
    }),
    updateMany: jest.fn(async ({ where, data }) => {
      const hit = rows.filter((r) => matches(r, where));
      hit.forEach((r) => Object.assign(r, data));
      return { count: hit.length };
    }),
    findFirst: jest.fn(async ({ where }) => rows.find((r) => matches(r, where)) ?? null),
    findMany: jest.fn(async ({ where }) => rows.filter((r) => matches(r, where))),
  };
  const counter = { value: 0 };
  const prisma: any = {
    addonQuotaConfig: { findUnique: jest.fn().mockResolvedValue(config(opts.cfg)) },
    addonUsageReservation: reservations,
    $executeRaw: jest.fn(async (strings: TemplateStringsArray) => {
      counter.value += strings.join('').includes('INSERT') ? 1 : -1;
      return 1;
    }),
  };
  // ทรานแซกชัน: rollback แถวที่สร้างถ้า fn โยน error
  prisma.$transaction = jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
    const snapshot = rows.length;
    const counterBefore = counter.value;
    try {
      return await fn(prisma);
    } catch (err) {
      rows.splice(snapshot);
      counter.value = counterBefore;
      throw err;
    }
  });
  const source = opts.source === undefined ? 'subscription' : opts.source;
  const addonService = {
    getActiveAddons: jest.fn().mockResolvedValue(
      source
        ? [
            {
              code: 'CAMP_3D_MAP',
              name: '3D',
              isActive: true,
              expiresAt: source === 'trial' ? '2026-11-01T00:00:00.000Z' : null,
              source,
            },
          ]
        : [],
    ),
  };
  const service = new AddonQuotaService(prisma, addonService as never);
  return { service, rows, counter, prisma };
}

const input = { tenantId: 't-1', addonCode: 'CAMP_3D_MAP', userId: 'u-1' };

async function expectHttp(p: Promise<unknown>, status: number, code: string): Promise<void> {
  try {
    await p;
    throw new Error('expected rejection');
  } catch (err) {
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(status);
    expect(((err as HttpException).getResponse() as { code: string }).code).toBe(code);
  }
}

describe('AddonQuotaService', () => {
  it('ไม่มีสิทธิ์ → 403 ADDON_NOT_ENTITLED และไม่นับอะไร', async () => {
    const { service, rows, counter } = setup({ source: null });
    await expectHttp(service.reserve(input), 403, 'ADDON_NOT_ENTITLED');
    expect(rows).toHaveLength(0);
    expect(counter.value).toBe(0);
    await expect(service.getStatus('t-1', 'CAMP_3D_MAP')).resolves.toMatchObject({
      entitled: false,
      canRun: false,
      blockedReason: 'ADDON_NOT_ENTITLED',
      // หน้าขายใช้เงื่อนไขทดลองจาก config จริง
      trialDays: 14,
      trialIncluded: 1,
    });
  });

  it('paid: ใช้ในแพ็กก่อน แล้วเป็นส่วนเกินจนถึงเพดาน แล้ว 402', async () => {
    const { service, rows, counter } = setup();
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await service.reserve(input));
    expect(results.map((r) => r.isOverage)).toEqual([false, false, false, true, true]);
    expect(results[2].remaining).toBe(0);
    expect(rows.every((r) => r.period === quotaPeriod() && r.source === 'paid')).toBe(true);

    await expectHttp(service.reserve(input), 402, 'QUOTA_EXCEEDED');
    expect(rows).toHaveLength(5);
    expect(counter.value).toBe(5);

    const status = await service.getStatus('t-1', 'CAMP_3D_MAP');
    expect(status).toMatchObject({
      included: 3,
      used: 5,
      remaining: 0,
      overageUsed: 2,
      canRun: false,
    });
  });

  it('ราคาส่วนเกิน 0 = หยุดเมื่อครบโควตาในแพ็ก', async () => {
    const { service } = setup({
      cfg: { overageUnitPriceThb: new Prisma.Decimal(0), includedPerPeriod: 1 },
    });
    await service.reserve(input);
    await expectHttp(service.reserve(input), 402, 'QUOTA_EXCEEDED');
  });

  it('trial: ใช้ได้ตาม trialIncluded ไม่มีส่วนเกิน', async () => {
    const { service } = setup({ source: 'trial' });
    const first = await service.reserve(input);
    expect(first).toMatchObject({ source: 'trial', isOverage: false, remaining: 0 });
    await expectHttp(service.reserve(input), 402, 'TRIAL_QUOTA_EXCEEDED');
    const status = await service.getStatus('t-1', 'CAMP_3D_MAP');
    expect(status).toMatchObject({
      source: 'trial',
      included: 1,
      overageAllowed: false,
      trialEndsAt: '2026-11-01T00:00:00.000Z',
    });
  });

  it('rate limit ต่อนาที → 429 (นับงานที่คืนโควตาแล้วด้วย)', async () => {
    const { service } = setup({ cfg: { rateLimitPerMinute: 2, includedPerPeriod: 10 } });
    const a = await service.reserve(input);
    await service.refund('t-1', a.reservationId, 'boom');
    await service.reserve(input);
    await expectHttp(service.reserve(input), 429, 'RATE_LIMITED');
  });

  it('refund คืนโควตาครั้งเดียว และลด counter', async () => {
    const { service, counter } = setup({
      cfg: { includedPerPeriod: 1, overageUnitPriceThb: new Prisma.Decimal(0) },
    });
    const r = await service.reserve(input);
    expect(counter.value).toBe(1);
    await expect(service.refund('t-1', r.reservationId, 'AI failed')).resolves.toBe(true);
    await expect(service.refund('t-1', r.reservationId, 'again')).resolves.toBe(false);
    expect(counter.value).toBe(0);
    // ได้โควตาคืนจริง จองใหม่ได้
    await expect(service.reserve(input)).resolves.toMatchObject({ isOverage: false });
  });

  it('refundOnFailure = false → งานล้มเหลวนับเป็นใช้แล้ว', async () => {
    const { service, rows, counter } = setup({ cfg: { refundOnFailure: false } });
    const r = await service.reserve(input);
    await expect(service.refund('t-1', r.reservationId, 'AI failed')).resolves.toBe(false);
    expect(rows[0]).toMatchObject({ status: 'committed', failureReason: 'AI failed' });
    expect(counter.value).toBe(1);
  });

  it('commit หลังสำเร็จ แล้ว refund ไม่มีผล', async () => {
    const { service, rows } = setup();
    const r = await service.reserve(input);
    await service.commit('t-1', r.reservationId);
    await expect(service.refund('t-1', r.reservationId)).resolves.toBe(false);
    expect(rows[0].status).toBe('committed');
  });

  it('runWithQuota: สำเร็จ = committed, โยน error = refunded และโยนต่อ', async () => {
    const { service, rows } = setup();
    await expect(service.runWithQuota(input, async () => 'ok')).resolves.toBe('ok');
    await expect(
      service.runWithQuota(input, async () => {
        throw new Error('fal timeout');
      }),
    ).rejects.toThrow('fal timeout');
    expect(rows.map((r) => r.status)).toEqual(['committed', 'refunded']);
    expect(rows[1].failureReason).toBe('fal timeout');
  });

  it('งานที่ค้าง reserved เกิน 30 นาที ถูกคืนโควตาเสมอ แม้ปิด refundOnFailure', async () => {
    const { service, rows } = setup({
      cfg: {
        refundOnFailure: false,
        includedPerPeriod: 1,
        overageUnitPriceThb: new Prisma.Decimal(0),
      },
    });
    await service.reserve(input);
    rows[0].createdAt = new Date(Date.now() - 31 * 60_000);
    await expect(service.reserve(input)).resolves.toMatchObject({ isOverage: false });
    expect(rows[0]).toMatchObject({ status: 'refunded', failureReason: 'stale reservation' });
  });

  it('รอบโควตานับจากวันเปิด add-on: ไม่รีเซ็ตวันที่ 1 และบอกวันรีเซ็ต', async () => {
    const { service, rows, prisma } = setup();
    const anchor = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    prisma.subscriptions = {
      findFirst: jest
        .fn()
        .mockResolvedValue({ id: 'sub-1', billing_anchor_date: null, start_date: null }),
    };
    prisma.subscription_features = {
      findFirst: jest.fn().mockResolvedValue({ activated_at: anchor, created_at: new Date(0) }),
    };
    // ใช้ไปก่อนเปิด add-on (คีย์ period เดียวกัน) — ต้องไม่ถูกนับในรอบใหม่
    rows.push({
      id: 'old',
      tenantId: 't-1',
      addonCode: 'CAMP_3D_MAP',
      metricCode: 'CAMP_3D_AI_EXTRACT',
      period: quotaPeriod(anchor),
      source: 'paid',
      isOverage: false,
      status: 'committed',
      createdAt: new Date(
        bangkokStartOfDate(new Date(anchor.getTime() + 7 * 3600_000)).getTime() - 60_000,
      ),
    });

    const status = await service.getStatus('t-1', 'CAMP_3D_MAP');

    const thaiDay = bangkokStartOfDate(new Date(anchor.getTime() + 7 * 60 * 60 * 1000));
    expect(status.periodStart).toBe(thaiDay.toISOString());
    expect(new Date(status.resetsAt as string).getTime()).toBeGreaterThan(Date.now());
    expect(status.used).toBe(0);
  });
});
