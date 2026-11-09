import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '@/prisma/prisma.service';
import { AddonService } from '@/modules/addons/addon.service';
import { AddonTrialExpiryService } from './addon-trial-expiry.service';

/**
 * The job doesn't gate access — getActiveAddons() already ignores a trial past
 * its expires_at. What it must get right is settling the row's status and
 * dropping the tenant's addon cache, otherwise the module keeps showing in the
 * sidebar for up to the 5-minute TTL after the trial ends.
 */
describe('AddonTrialExpiryService', () => {
  let service: AddonTrialExpiryService;

  const trialRequests = {
    findMany: jest.fn(),
    updateMany: jest.fn(),
  };

  const prismaMock = { addon_trial_requests: trialRequests };

  const addonServiceMock = {
    invalidateAddonCache: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AddonTrialExpiryService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: AddonService, useValue: addonServiceMock },
      ],
    }).compile();

    service = module.get(AddonTrialExpiryService);
    jest.clearAllMocks();
    trialRequests.updateMany.mockResolvedValue({ count: 0 });
  });

  it('marks approved trials whose expiry has passed as expired', async () => {
    trialRequests.findMany.mockResolvedValue([
      { id: 'req-1', tenant_id: 'tenant-a', addon_code: 'CAMP_MODULE' },
      { id: 'req-2', tenant_id: 'tenant-b', addon_code: 'HR_MODULE' },
    ]);

    await expect(service.expireDueTrials()).resolves.toBe(2);

    const where = trialRequests.findMany.mock.calls[0][0].where;
    expect(where.status).toBe('approved');
    expect(where.expires_at.lte).toBeInstanceOf(Date);

    expect(trialRequests.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['req-1', 'req-2'] } },
      data: { status: 'expired' },
    });
  });

  it('invalidates the addon cache once per affected tenant', async () => {
    // Two trials lapsing for the same tenant is one cache to drop, not two.
    trialRequests.findMany.mockResolvedValue([
      { id: 'req-1', tenant_id: 'tenant-a', addon_code: 'CAMP_MODULE' },
      { id: 'req-2', tenant_id: 'tenant-a', addon_code: 'HR_MODULE' },
      { id: 'req-3', tenant_id: 'tenant-b', addon_code: 'HR_MODULE' },
    ]);

    await service.expireDueTrials();

    expect(addonServiceMock.invalidateAddonCache).toHaveBeenCalledTimes(2);
    expect(addonServiceMock.invalidateAddonCache).toHaveBeenCalledWith('tenant-a');
    expect(addonServiceMock.invalidateAddonCache).toHaveBeenCalledWith('tenant-b');
  });

  it('writes nothing when no trial is due', async () => {
    trialRequests.findMany.mockResolvedValue([]);

    await expect(service.expireDueTrials()).resolves.toBe(0);

    expect(trialRequests.updateMany).not.toHaveBeenCalled();
    expect(addonServiceMock.invalidateAddonCache).not.toHaveBeenCalled();
  });

  it('swallows a database failure so the hourly schedule survives it', async () => {
    trialRequests.findMany.mockRejectedValue(new Error('db down'));

    await expect(service.handleExpiredTrials()).resolves.toBeUndefined();
  });
});
