import { ConflictException } from '@nestjs/common';
import { SubscriptionAutoRenewalService } from './subscription-auto-renewal.service';

function setup(flag?: string) {
  const prisma = {
    subscriptions: {
      findMany: jest.fn().mockResolvedValue([
        { id: 's1', tenant_id: 't1' },
        { id: 's2', tenant_id: 't2' },
      ]),
    },
  };
  const billing = { renewSubscription: jest.fn().mockResolvedValue({}) };
  const config = { get: jest.fn((_k: string, def: string) => flag ?? def) };
  return {
    svc: new SubscriptionAutoRenewalService(prisma as never, billing as never, config as never),
    prisma,
    billing,
  };
}

describe('SubscriptionAutoRenewalService.issueDueRenewals', () => {
  it('targets active monthly auto-renew subscriptions ending within 7 Thai days', async () => {
    const { svc, prisma, billing } = setup();
    const res = await svc.issueDueRenewals(new Date('2026-10-24T18:00:00Z')); // 25 ต.ค. เวลาไทย
    expect(prisma.subscriptions.findMany.mock.calls[0][0].where).toEqual({
      status: 'active',
      billing_cycle: 'monthly',
      auto_renew: 1,
      end_date: { lte: new Date('2026-11-01T00:00:00Z') },
    });
    expect(billing.renewSubscription).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({ periodMonths: 1, createInvoice: true }),
    );
    expect(res).toEqual({ issued: 2, skipped: 0 });
  });

  it('skips subscriptions that still have an outstanding invoice', async () => {
    const { svc, billing } = setup();
    billing.renewSubscription.mockRejectedValueOnce(new ConflictException('outstanding'));
    expect(await svc.issueDueRenewals(new Date('2026-10-24T18:00:00Z'))).toEqual({
      issued: 1,
      skipped: 1,
    });
  });

  it('can be disabled via AUTO_RENEWAL_INVOICES_ENABLED=false', async () => {
    const { svc, prisma } = setup('false');
    expect(await svc.issueDueRenewals()).toEqual({ issued: 0, skipped: 0 });
    expect(prisma.subscriptions.findMany).not.toHaveBeenCalled();
  });
});
