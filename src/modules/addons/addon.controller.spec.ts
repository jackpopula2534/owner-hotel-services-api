import { Test, TestingModule } from '@nestjs/testing';
import { AddonController } from './addon.controller';
import { AddonService, AddonEntity } from './addon.service';
import { AddonBillingCycle } from './dto/create-addon.dto';

describe('AddonController', () => {
  let controller: AddonController;

  const sample: AddonEntity = {
    id: 'addon-1',
    code: 'BASIC_REPORT',
    name: 'Basic Report',
    description: null,
    price: 0,
    billingCycle: AddonBillingCycle.MONTHLY,
    category: null,
    icon: null,
    displayOrder: 0,
    minQuantity: 1,
    maxQuantity: 1,
    isActive: true,
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
  };

  const serviceMock = {
    list: jest.fn().mockResolvedValue({ items: [sample], meta: { page: 1, limit: 20, total: 1 } }),
    listActive: jest.fn().mockResolvedValue([sample]),
    findOne: jest.fn().mockResolvedValue(sample),
    create: jest.fn().mockResolvedValue(sample),
    update: jest.fn().mockResolvedValue(sample),
    toggleActive: jest.fn().mockResolvedValue({ ...sample, isActive: false }),
    remove: jest.fn().mockResolvedValue(undefined),
    getActiveAddons: jest
      .fn()
      .mockResolvedValue([{ code: 'HR_MODULE', name: 'HR', isActive: true, expiresAt: null }]),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AddonController],
      providers: [{ provide: AddonService, useValue: serviceMock }],
    }).compile();

    controller = module.get(AddonController);
    jest.clearAllMocks();
  });

  it('GET /addons returns paginated list', async () => {
    const res = await controller.list({});
    expect(res.success).toBe(true);
    expect(res.data).toHaveLength(1);
    expect(res.meta.total).toBe(1);
  });

  it('GET /addons/public returns active list', async () => {
    const res = await controller.listPublic();
    expect(res.success).toBe(true);
    expect(res.data[0].code).toBe('BASIC_REPORT');
  });

  it('GET /addons/status returns tenant addons', async () => {
    const res = await controller.getAddonStatus({ user: { tenantId: 't-1' } });
    expect(res.success).toBe(true);
    expect(res.data[0].code).toBe('HR_MODULE');
  });

  it('POST /addons creates', async () => {
    const res = await controller.create({
      code: 'BASIC_REPORT',
      name: 'Basic Report',
      price: 0,
    });
    expect(res.data.code).toBe('BASIC_REPORT');
    expect(serviceMock.create).toHaveBeenCalled();
  });

  it('PUT /addons/:id updates', async () => {
    const res = await controller.update('addon-1', { name: 'New' });
    expect(res.data.code).toBe('BASIC_REPORT');
    expect(serviceMock.update).toHaveBeenCalledWith('addon-1', { name: 'New' });
  });

  it('PATCH /addons/:id/toggle-active toggles', async () => {
    const res = await controller.toggleActive('addon-1');
    expect(res.data.isActive).toBe(false);
  });

  it('DELETE /addons/:id removes', async () => {
    await expect(controller.remove('addon-1')).resolves.toBeUndefined();
    expect(serviceMock.remove).toHaveBeenCalledWith('addon-1');
  });
});
