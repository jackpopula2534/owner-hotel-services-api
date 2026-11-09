import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AddonQuotaAdminService } from './addon-quota-admin.service';

const baseConfig = {
  id: 'c1',
  addonCode: 'CAMP_3D_MAP',
  metricCode: 'CAMP_3D_AI_EXTRACT',
  includedPerPeriod: 3,
  overageUnitPriceThb: new Prisma.Decimal(79),
  maxOveragePerPeriod: 20,
  trialDays: 14,
  trialIncluded: 1,
  rateLimitPerMinute: 5,
  refundOnFailure: true,
  updatedBy: null,
  createdAt: new Date('2026-10-19T00:00:00Z'),
  updatedAt: new Date('2026-10-19T00:00:00Z'),
};

function setup() {
  const prisma = {
    addonQuotaConfig: {
      findUnique: jest.fn().mockResolvedValue(baseConfig),
      findMany: jest.fn().mockResolvedValue([baseConfig]),
      update: jest.fn(({ data }) => Promise.resolve({ ...baseConfig, ...data })),
    },
    add_ons: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'a1',
        name: '3D Map',
        price: new Prisma.Decimal(790),
        is_active: 1,
      }),
    },
    features: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    subscription_features: { findMany: jest.fn().mockResolvedValue([]) },
    plan_addons: { findMany: jest.fn().mockResolvedValue([]) },
    subscriptions: { findMany: jest.fn().mockResolvedValue([]) },
    addon_trial_requests: { findMany: jest.fn().mockResolvedValue([]) },
    addonUsageReservation: { groupBy: jest.fn().mockResolvedValue([]) },
    usage_overage_charges: { create: jest.fn().mockResolvedValue({}) },
  };
  const addonService = { update: jest.fn().mockResolvedValue({}) };
  const tenantContext = { runUnscoped: (fn: () => unknown) => fn() };
  const service = new AddonQuotaAdminService(
    prisma as never,
    addonService as never,
    tenantContext as never,
  );
  return { service, prisma, addonService };
}

describe('AddonQuotaAdminService', () => {
  it('assertQuotaAddon: add-on ที่ไม่มีโควตา → 404', () => {
    const { service } = setup();
    expect(service.assertQuotaAddon('CAMP_3D_MAP')).toBe('CAMP_3D_MAP');
    expect(() => service.assertQuotaAddon('HR_MODULE')).toThrow(NotFoundException);
  });

  it('getConfig รวมราคาจาก add_ons', async () => {
    const { service } = setup();
    await expect(service.getConfig('CAMP_3D_MAP')).resolves.toMatchObject({
      priceMonthlyThb: 790,
      includedPerPeriod: 3,
      overageUnitPriceThb: 79,
      addonActive: true,
    });
  });

  it('เปลี่ยนราคา → อัปเดต add_ons ผ่าน AddonService (ล้าง cache) + features แถว module', async () => {
    const { service, prisma, addonService } = setup();
    const view = await service.updateConfig(
      'CAMP_3D_MAP',
      { priceMonthlyThb: 890, includedPerPeriod: 5 },
      'admin-1',
    );
    expect(addonService.update).toHaveBeenCalledWith('a1', { price: 890 });
    expect(prisma.features.updateMany.mock.calls[0][0]).toMatchObject({
      where: { code: 'CAMP_3D_MAP', type: 'module' },
    });
    expect(prisma.addonQuotaConfig.update.mock.calls[0][0].data).toMatchObject({
      includedPerPeriod: 5,
      updatedBy: 'admin-1',
    });
    expect(view).toMatchObject({ priceMonthlyThb: 890, includedPerPeriod: 5 });
  });

  it('ราคาไม่เปลี่ยน → ไม่แตะ add_ons', async () => {
    const { service, addonService } = setup();
    await service.updateConfig('CAMP_3D_MAP', { priceMonthlyThb: 790, maxOveragePerPeriod: null });
    expect(addonService.update).not.toHaveBeenCalled();
  });

  it('ปฏิเสธ โควตา 0 + ราคาส่วนเกิน 0 (ซื้อแล้วใช้ไม่ได้)', async () => {
    const { service } = setup();
    await expect(
      service.updateConfig('CAMP_3D_MAP', { includedPerPeriod: 0, overageUnitPriceThb: 0 }),
    ).rejects.toThrow(BadRequestException);
  });

  it('สรุปรายรับ: ราคาที่ล็อกใน subscription + ส่วนเกิน, แยก paid/bundled/trial ไม่นับซ้ำ', async () => {
    const { service, prisma } = setup();
    prisma.subscription_features.findMany.mockResolvedValue([
      { price: new Prisma.Decimal(790), quantity: 1, subscriptions: { tenant_id: 't-1' } },
      { price: new Prisma.Decimal(690), quantity: 1, subscriptions: { tenant_id: 't-2' } },
    ]);
    prisma.plan_addons.findMany.mockResolvedValue([{ plan_id: 'p-plus' }]);
    prisma.subscriptions.findMany.mockResolvedValue([{ tenant_id: 't-3' }, { tenant_id: 't-1' }]);
    prisma.addon_trial_requests.findMany.mockResolvedValue([
      { tenant_id: 't-4' },
      { tenant_id: 't-2' },
    ]);
    prisma.addonUsageReservation.groupBy.mockResolvedValue([
      { status: 'committed', source: 'paid', isOverage: false, _count: { _all: 6 } },
      { status: 'committed', source: 'paid', isOverage: true, _count: { _all: 2 } },
      { status: 'committed', source: 'trial', isOverage: false, _count: { _all: 1 } },
      { status: 'refunded', source: 'paid', isOverage: true, _count: { _all: 3 } },
      { status: 'reserved', source: 'paid', isOverage: false, _count: { _all: 1 } },
      // ยังไม่ commit → ยังไม่นับเป็นรายรับ
      { status: 'reserved', source: 'paid', isOverage: true, _count: { _all: 1 } },
    ]);

    const s = await service.getSummary('CAMP_3D_MAP', '2026-10');
    expect(s).toMatchObject({
      period: '2026-10',
      paidSubscribers: 2,
      bundledSubscribers: 1,
      trialTenants: 1,
      subscriptionRevenueThb: 1480,
      overageRevenueThb: 158,
      totalRevenueThb: 1638,
      usage: { committed: 9, refunded: 3, pending: 2, trial: 1, overage: 3 },
    });
  });

  it('ปิดงวด: เขียนส่วนเกินเฉพาะ tenant ที่เกิน, แถวซ้ำ (P2002) ข้ามไป', async () => {
    const { service, prisma } = setup();
    prisma.addonUsageReservation.groupBy.mockResolvedValue([
      { tenantId: 't-1', isOverage: false, _count: { _all: 3 } },
      { tenantId: 't-1', isOverage: true, _count: { _all: 2 } },
      { tenantId: 't-2', isOverage: false, _count: { _all: 1 } },
      { tenantId: 't-3', isOverage: true, _count: { _all: 1 } },
    ]);
    prisma.usage_overage_charges.create
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }),
      );

    await expect(service.settlePeriod('2026-09')).resolves.toBe(1);
    const data = prisma.usage_overage_charges.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      tenant_id: 't-1',
      metric_code: 'CAMP_3D_AI_EXTRACT',
      usage_amount: 5,
      included_amount: 3,
      overage_amount: 2,
    });
    expect(Number(data.total_charge)).toBe(158);
    expect(prisma.usage_overage_charges.create).toHaveBeenCalledTimes(2);
  });
});
