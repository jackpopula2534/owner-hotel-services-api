import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AddonService } from '../../addons/addon.service';
import { IntegrationsService } from '../integrations.service';

const RESTAURANT_KEY = 'restaurant-inventory-autodeduct';
const TENANT = 'tenant-1';

describe('IntegrationsService', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prismaMock: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let addonMock: any;
  let service: IntegrationsService;

  beforeEach(async () => {
    prismaMock = {
      tenantIntegration: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
        create: jest.fn(),
      },
    };
    addonMock = { hasActiveAddon: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IntegrationsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: AddonService, useValue: addonMock },
      ],
    }).compile();

    service = module.get<IntegrationsService>(IntegrationsService);
  });

  describe('list', () => {
    it('marks restaurant→inventory available when both add-ons active (default ON)', async () => {
      addonMock.hasActiveAddon.mockResolvedValue(true);

      const list = await service.list(TENANT);
      const item = list.find((i) => i.key === RESTAURANT_KEY)!;

      expect(item.available).toBe(true);
      expect(item.missingAddons).toEqual([]);
      expect(item.enabled).toBe(true); // defaultEnabled, no stored row
    });

    it('reports missing add-ons and forces enabled=false when not available', async () => {
      // RESTAURANT active, INVENTORY missing
      addonMock.hasActiveAddon.mockImplementation((_t: string, code: string) =>
        Promise.resolve(code === 'RESTAURANT_MODULE'),
      );

      const list = await service.list(TENANT);
      const item = list.find((i) => i.key === RESTAURANT_KEY)!;

      expect(item.available).toBe(false);
      expect(item.missingAddons).toContain('INVENTORY_MODULE');
      expect(item.enabled).toBe(false); // effective off despite default
    });

    it('respects a stored OFF setting even when available', async () => {
      addonMock.hasActiveAddon.mockResolvedValue(true);
      prismaMock.tenantIntegration.findMany.mockResolvedValue([
        { integrationKey: RESTAURANT_KEY, enabled: false, connectedAt: null },
      ]);

      const list = await service.list(TENANT);
      const item = list.find((i) => i.key === RESTAURANT_KEY)!;

      expect(item.available).toBe(true);
      expect(item.enabled).toBe(false);
    });
  });

  describe('isEnabled', () => {
    it('returns false for an unknown key', async () => {
      expect(await service.isEnabled(TENANT, 'nope')).toBe(false);
    });

    it('returns false when required add-ons are missing', async () => {
      addonMock.hasActiveAddon.mockResolvedValue(false);
      expect(await service.isEnabled(TENANT, RESTAURANT_KEY)).toBe(false);
    });

    it('returns catalog default (true) when available and no stored row', async () => {
      addonMock.hasActiveAddon.mockResolvedValue(true);
      prismaMock.tenantIntegration.findFirst.mockResolvedValue(null);
      expect(await service.isEnabled(TENANT, RESTAURANT_KEY)).toBe(true);
    });

    it('returns stored value (false) when available', async () => {
      addonMock.hasActiveAddon.mockResolvedValue(true);
      prismaMock.tenantIntegration.findFirst.mockResolvedValue({ enabled: false });
      expect(await service.isEnabled(TENANT, RESTAURANT_KEY)).toBe(false);
    });
  });

  describe('setEnabled', () => {
    it('throws NotFound for unknown key', async () => {
      await expect(service.setEnabled(TENANT, 'nope', true)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws Forbidden when enabling without required add-ons', async () => {
      addonMock.hasActiveAddon.mockResolvedValue(false);
      await expect(service.setEnabled(TENANT, RESTAURANT_KEY, true)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prismaMock.tenantIntegration.create).not.toHaveBeenCalled();
    });

    it('creates a row when enabling and none exists', async () => {
      addonMock.hasActiveAddon.mockResolvedValue(true);
      prismaMock.tenantIntegration.findFirst.mockResolvedValue(null);

      await service.setEnabled(TENANT, RESTAURANT_KEY, true);

      expect(prismaMock.tenantIntegration.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: TENANT,
            integrationKey: RESTAURANT_KEY,
            enabled: true,
          }),
        }),
      );
    });

    it('updates existing row by id when disabling (no add-on check required)', async () => {
      addonMock.hasActiveAddon.mockResolvedValue(true);
      prismaMock.tenantIntegration.findFirst
        .mockResolvedValueOnce({ id: 'row-1' }) // setEnabled lookup
        .mockResolvedValue(null); // list() internal lookups

      await service.setEnabled(TENANT, RESTAURANT_KEY, false);

      expect(prismaMock.tenantIntegration.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'row-1' },
          data: expect.objectContaining({ enabled: false, connectedAt: null }),
        }),
      );
    });
  });
});
