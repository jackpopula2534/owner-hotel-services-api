import { BadRequestException } from '@nestjs/common';
import { CouponsService } from './coupons.service';

// ─────────────────────────────────────────────────────────────────────────────
// CouponsService.redeem - in-transaction cap enforcement (SALES-05)
//
// The per-tenant and global caps must be re-checked INSIDE the redeem
// transaction so two concurrent redeems can't both slip past validate().
// ─────────────────────────────────────────────────────────────────────────────

describe('CouponsService.redeem - caps enforced inside the transaction', () => {
  const COUPON = {
    id: 'coupon-1',
    code: 'SAVE10',
    name: '10% off',
    discount_type: 'percent',
    discount_value: 10,
    is_active: 1,
    valid_from: null,
    valid_until: null,
    max_redemptions: 100,
    redemptions_count: 0,
    max_redemptions_per_tenant: 1,
    applies_to: 'all',
  };

  const buildService = (txState: {
    coupon: any;
    tenantUsageInTx: number;
    globalBump?: { count: number };
  }) => {
    const tx: any = {
      subscription_coupons: {
        findUnique: jest.fn().mockResolvedValue(txState.coupon),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue(txState.globalBump ?? { count: 1 }),
      },
      subscription_coupon_redemptions: {
        count: jest.fn().mockResolvedValue(txState.tenantUsageInTx),
        create: jest.fn().mockResolvedValue({}),
      },
    };
    const prismaMock: any = {
      // validate() reads
      subscription_coupons: { findUnique: jest.fn().mockResolvedValue(txState.coupon) },
      subscription_coupon_redemptions: { count: jest.fn().mockResolvedValue(0) },
      $transaction: jest.fn(async (fn: any) => fn(tx)),
    };
    return { service: new CouponsService(prismaMock), tx };
  };

  const input = {
    code: 'SAVE10',
    tenantId: 'tenant-1',
    invoiceAmount: 1000,
    invoiceId: 'inv-1',
  } as any;

  it('redeems when caps are still available inside the transaction', async () => {
    const { service, tx } = buildService({ coupon: { ...COUPON }, tenantUsageInTx: 0 });

    await service.redeem(input);

    expect(tx.subscription_coupons.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'coupon-1', redemptions_count: { lt: 100 } },
      }),
    );
    expect(tx.subscription_coupon_redemptions.create).toHaveBeenCalledTimes(1);
  });

  it('rejects when the per-tenant cap is already hit at transaction time', async () => {
    // validate() saw 0 (stale), but inside the tx the tenant already has 1
    const { service, tx } = buildService({ coupon: { ...COUPON }, tenantUsageInTx: 1 });

    await expect(service.redeem(input)).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.subscription_coupon_redemptions.create).not.toHaveBeenCalled();
  });

  it('rejects when the global cap is exhausted (atomic bump returns count=0)', async () => {
    const { service, tx } = buildService({
      coupon: { ...COUPON, max_redemptions: 1 },
      tenantUsageInTx: 0,
      globalBump: { count: 0 },
    });

    await expect(service.redeem(input)).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.subscription_coupon_redemptions.create).not.toHaveBeenCalled();
  });
});
