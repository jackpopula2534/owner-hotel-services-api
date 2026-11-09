import { WebsiteEntitlementService } from './website-entitlement.service';

describe('WebsiteEntitlementService', () => {
  const build = (opts: { status?: string | null; lineOk?: boolean; addon?: boolean }) => {
    const prisma = {
      subscriptions: {
        findFirst: jest
          .fn()
          .mockResolvedValue(opts.status === null ? null : { status: opts.status ?? 'active' }),
      },
    };
    const addonService = {
      isAddonAllowedForTenant: jest.fn().mockResolvedValue(opts.lineOk ?? true),
      hasActiveAddon: jest.fn().mockResolvedValue(opts.addon ?? true),
    };
    return {
      svc: new WebsiteEntitlementService(prisma as never, addonService as never),
      prisma,
      addonService,
    };
  };

  it('blocks trial even when add-on looks active (trial is entitled in AddonService)', async () => {
    const { svc, addonService } = build({ status: 'trial', addon: true });
    await expect(svc.checkPublishable('t1')).resolves.toEqual({ ok: false, reason: 'TRIAL' });
    expect(addonService.hasActiveAddon).not.toHaveBeenCalled();
    await expect(svc.isLive('t1')).resolves.toBe(false);
  });

  it('blocks wrong product line', async () => {
    const { svc } = build({ lineOk: false });
    await expect(svc.checkPublishable('t1')).resolves.toEqual({
      ok: false,
      reason: 'WRONG_PRODUCT_LINE',
    });
  });

  it('blocks when add-on not owned/lapsed', async () => {
    const { svc } = build({ addon: false });
    await expect(svc.checkPublishable('t1')).resolves.toEqual({
      ok: false,
      reason: 'ADDON_REQUIRED',
    });
  });

  it('allows paid tenant with add-on', async () => {
    const { svc, prisma, addonService } = build({ status: 'active' });
    await expect(svc.checkPublishable('t1')).resolves.toEqual({ ok: true });
    expect(prisma.subscriptions.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenant_id: 't1' }, orderBy: { created_at: 'desc' } }),
    );
    expect(addonService.hasActiveAddon).toHaveBeenCalledWith('t1', 'WEBSITE_BUILDER');
  });
});
