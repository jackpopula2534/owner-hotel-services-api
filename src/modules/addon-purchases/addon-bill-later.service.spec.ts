import { ConflictException } from '@nestjs/common';
import { AddonBillLaterService } from './addon-bill-later.service';

const NOW = new Date('2026-10-19T03:00:00Z'); // 19 ต.ค. 10:00 เวลาไทย
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

interface SetupOpts {
  sub?: Record<string, unknown> | null;
  existing?: Record<string, unknown> | null;
  previousFreeWindow?: boolean;
  trial?: boolean;
  paidInvoices?: number;
  outstanding?: number;
  others?: unknown[];
  unbilledInTx?: unknown[];
  owned?: unknown[];
}

function setup(opts: SetupOpts = {}) {
  const sub =
    opts.sub === null
      ? null
      : {
          id: 'sub-1',
          status: 'active',
          billing_cycle: 'monthly',
          end_date: d('2026-11-01'),
          plans_subscriptions_plan_idToplans: { name: 'Camp Plus', price_monthly: 500 },
          ...opts.sub,
        };
  const prisma = {
    features: { findFirst: jest.fn().mockResolvedValue({ id: 'f-3d' }) },
    subscriptions: { findFirst: jest.fn().mockResolvedValue(sub) },
    subscription_features: {
      findFirst: jest
        .fn()
        .mockImplementation(({ where }) =>
          Promise.resolve(
            where.billing_mode
              ? opts.previousFreeWindow
                ? { id: 'old' }
                : null
              : (opts.existing ?? null),
          ),
        ),
      findMany: jest
        .fn()
        .mockImplementation(({ where }) =>
          Promise.resolve(
            where.billed_through === null ? (opts.unbilledInTx ?? []) : (opts.others ?? []),
          ),
        ),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      create: jest.fn().mockResolvedValue({}),
    },
    addon_trial_requests: {
      findFirst: jest.fn().mockResolvedValue(opts.trial ? { id: 'tr' } : null),
    },
    invoices: {
      count: jest
        .fn()
        .mockImplementation(({ where }) =>
          Promise.resolve(
            where.status === 'paid' ? (opts.paidInvoices ?? 3) : (opts.outstanding ?? 0),
          ),
        ),
    },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma));
  const addonService = {
    listActive: jest
      .fn()
      .mockResolvedValue([
        {
          code: 'CAMP_3D_MAP',
          name: 'แผนผัง 3D',
          price: 200,
          billingCycle: 'monthly',
          isActive: true,
        },
      ]),
    assertAddonAllowedForTenant: jest.fn().mockResolvedValue(undefined),
    getActiveAddons: jest.fn().mockResolvedValue(opts.owned ?? []),
    invalidateAddonCache: jest.fn().mockResolvedValue(undefined),
  };
  return {
    svc: new AddonBillLaterService(prisma as never, addonService as never),
    prisma,
    addonService,
  };
}

describe('AddonBillLaterService.preview', () => {
  it('Oct 19 example: Nov 1 bill is plan only, Dec 1 bill adds the add-on + VAT', async () => {
    const { svc } = setup();
    const p = await svc.preview('t1', 'CAMP_3D_MAP', NOW);
    expect(p.mode).toBe('bill_later');
    expect(p.freeUntil).toBe('2026-12-01');
    expect(p.committedUntil).toBe('2027-01-01');
    expect(p.nextBill).toEqual(
      expect.objectContaining({ date: '2026-11-01', subtotal: 500, total: 535 }),
    );
    expect(p.firstChargeBill).toEqual(
      expect.objectContaining({ date: '2026-12-01', subtotal: 700, vatAmount: 49, total: 749 }),
    );
  });

  it('re-activation after using the free window is billed in arrears on the next bill', async () => {
    const { svc } = setup({ previousFreeWindow: true });
    const p = await svc.preview('t1', 'CAMP_3D_MAP', NOW);
    expect(p.arrears).toBe(true);
    expect(p.freeUntil).toBeNull();
    expect(p.billingStartsOn).toBe('2026-10-01');
    expect(p.nextBill).toEqual(expect.objectContaining({ date: '2026-11-01', subtotal: 900 }));
  });

  it.each<[string, SetupOpts, string]>([
    ['no subscription', { sub: null }, 'NO_ACTIVE_PLAN'],
    ['trial subscription', { sub: { status: 'trial' } }, 'NO_ACTIVE_PLAN'],
    ['yearly cycle', { sub: { billing_cycle: 'yearly' } }, 'NOT_MONTHLY'],
    ['prepaid far ahead', { sub: { end_date: d('2027-10-19') } }, 'PREPAID_AHEAD'],
    ['never paid a bill', { paidInvoices: 0 }, 'NO_PAID_INVOICE'],
    ['outstanding bill', { outstanding: 1 }, 'OUTSTANDING_INVOICE'],
    [
      'already prepaid purchase',
      { owned: [{ code: 'CAMP_3D_MAP', source: 'purchase', isActive: true }] },
      'PREPAID_ACTIVE',
    ],
    [
      'credit limit (unbilled add-ons > plan price)',
      {
        others: [
          {
            price: 400,
            billing_mode: 'bill_later',
            billed_through: null,
            billing_starts_on: d('2026-12-01'),
            features: { name: 'X' },
          },
        ],
      },
      'CREDIT_LIMIT',
    ],
  ])('%s → prepaid (%s)', async (_label, opts, reason) => {
    const { svc } = setup(opts);
    const p = await svc.preview('t1', 'CAMP_3D_MAP', NOW);
    expect(p.mode).toBe('prepaid');
    expect(p.reason).toBe(reason);
  });
});

describe('AddonBillLaterService.activate', () => {
  it('creates the row with the window, acceptance snapshot, then invalidates the cache', async () => {
    const { svc, prisma, addonService } = setup();
    await svc.activate('t1', 'u1', 'CAMP_3D_MAP', NOW);
    expect(prisma.subscription_features.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        subscription_id: 'sub-1',
        feature_id: 'f-3d',
        price: 200,
        billing_mode: 'bill_later',
        billing_starts_on: d('2026-12-01'),
        committed_until: d('2027-01-01'),
        accepted_by: 'u1',
        accepted_at: NOW,
      }),
    });
    expect(addonService.invalidateAddonCache).toHaveBeenCalledWith('t1');
  });

  it('refuses ineligible tenants with a reason code', async () => {
    const { svc, prisma } = setup({ outstanding: 2 });
    await expect(svc.activate('t1', 'u1', 'CAMP_3D_MAP', NOW)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.subscription_features.create).not.toHaveBeenCalled();
  });

  it('re-checks the credit limit inside the transaction', async () => {
    const { svc, prisma, addonService } = setup({ unbilledInTx: [{ price: 350 }] });
    await expect(svc.activate('t1', 'u1', 'CAMP_3D_MAP', NOW)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.subscription_features.create).not.toHaveBeenCalled();
    expect(addonService.invalidateAddonCache).not.toHaveBeenCalled();
  });

  it('re-activating a cancelled-but-running add-on clears cancel_at', async () => {
    const { svc, prisma } = setup({
      existing: {
        id: 'sf-1',
        is_active: 1,
        billing_mode: 'bill_later',
        billing_starts_on: d('2026-12-01'),
        committed_until: d('2027-01-01'),
        billed_through: null,
        cancel_at: d('2027-01-01'),
        activated_at: NOW,
      },
    });
    await svc.activate('t1', 'u1', 'CAMP_3D_MAP', NOW);
    expect(prisma.subscription_features.update).toHaveBeenCalledWith({
      where: { id: 'sf-1' },
      data: expect.objectContaining({ cancel_at: null }),
    });
    expect(prisma.subscription_features.create).not.toHaveBeenCalled();
  });
});

describe('AddonBillLaterService.cancel / deactivateCancelled', () => {
  it('cancel takes effect at the end of the commitment', async () => {
    const { svc, prisma } = setup({
      existing: {
        id: 'sf-1',
        is_active: 1,
        billing_mode: 'bill_later',
        billing_starts_on: d('2026-12-01'),
        committed_until: d('2027-01-01'),
        billed_through: null,
        cancel_at: null,
      },
    });
    await svc.cancel('t1', 'CAMP_3D_MAP', NOW);
    expect(prisma.subscription_features.update).toHaveBeenCalledWith({
      where: { id: 'sf-1' },
      data: expect.objectContaining({ cancel_at: d('2027-01-01') }),
    });
  });

  it('deactivates rows whose cancel date has arrived (Thai calendar)', async () => {
    const { svc, prisma, addonService } = setup();
    prisma.subscription_features.findMany.mockResolvedValueOnce([
      { id: 'sf-1', subscriptions: { tenant_id: 't9' } },
    ]);
    const n = await svc.deactivateCancelled(new Date('2026-12-31T17:30:00Z'));
    expect(n).toBe(1);
    expect(prisma.subscription_features.findMany.mock.calls[0][0].where.cancel_at).toEqual({
      lte: d('2027-01-01'),
    });
    expect(prisma.subscription_features.updateMany).toHaveBeenCalledWith({
      where: { id: 'sf-1', is_active: 1 },
      data: expect.objectContaining({ is_active: 0 }),
    });
    expect(addonService.invalidateAddonCache).toHaveBeenCalledWith('t9');
  });
});
