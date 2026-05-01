import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { CacheService } from '@/cache/cache.service';
import { PrismaService } from '@/prisma/prisma.service';
import { AddonService } from './addon.service';
import { AddonBillingCycle } from './dto/create-addon.dto';

describe('AddonService - Catalog CRUD', () => {
  let service: AddonService;

  const buildRecord = (over: Partial<Record<string, unknown>> = {}) => ({
    id: 'addon-1',
    code: 'BASIC_REPORT',
    name: 'Basic Report',
    description: 'desc',
    price: new Prisma.Decimal(0),
    billing_cycle: AddonBillingCycle.MONTHLY,
    category: 'reports',
    icon: 'bar-chart',
    display_order: 1,
    min_quantity: 1,
    max_quantity: 1,
    is_active: 1,
    created_at: new Date('2026-05-01T00:00:00Z'),
    updated_at: new Date('2026-05-01T00:00:00Z'),
    ...over,
  });

  const prismaMock = {
    add_ons: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    subscription_features: { findFirst: jest.fn(), findMany: jest.fn() },
    $transaction: jest.fn(),
  };

  const cacheMock = {
    getOrSet: jest.fn().mockImplementation((_k, fn) => fn()),
    del: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AddonService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: CacheService, useValue: cacheMock },
      ],
    }).compile();

    service = module.get(AddonService);
    jest.clearAllMocks();
  });

  describe('list', () => {
    it('returns paginated add-ons with default page/limit', async () => {
      const records = [buildRecord()];
      prismaMock.$transaction.mockResolvedValue([records, 1]);

      const result = await service.list({});

      expect(result.meta).toEqual({ page: 1, limit: 20, total: 1 });
      expect(result.items).toHaveLength(1);
      expect(result.items[0].code).toBe('BASIC_REPORT');
      expect(result.items[0].isActive).toBe(true);
      expect(result.items[0].price).toBe(0);
    });

    it('applies search and isActive filter', async () => {
      prismaMock.$transaction.mockResolvedValue([[], 0]);
      await service.list({ search: 'report', isActive: false, page: 2, limit: 5 });

      expect(prismaMock.$transaction).toHaveBeenCalled();
      const findManyArgs = prismaMock.add_ons.findMany.mock.calls[0][0];
      expect(findManyArgs.where.is_active).toBe(0);
      expect(findManyArgs.where.OR).toEqual([
        { code: { contains: 'report' } },
        { name: { contains: 'report' } },
      ]);
      expect(findManyArgs.skip).toBe(5);
      expect(findManyArgs.take).toBe(5);
    });
  });

  describe('listActive', () => {
    it('returns only active add-ons (cached)', async () => {
      prismaMock.add_ons.findMany.mockResolvedValue([buildRecord()]);
      const result = await service.listActive();
      expect(result).toHaveLength(1);
      expect(prismaMock.add_ons.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { is_active: 1 } }),
      );
    });
  });

  describe('findOne', () => {
    it('returns the entity if found', async () => {
      prismaMock.add_ons.findUnique.mockResolvedValue(buildRecord());
      const result = await service.findOne('addon-1');
      expect(result.code).toBe('BASIC_REPORT');
    });

    it('throws NotFound if missing', async () => {
      prismaMock.add_ons.findUnique.mockResolvedValue(null);
      await expect(service.findOne('missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('create', () => {
    it('creates a new add-on with defaults', async () => {
      prismaMock.add_ons.findUnique.mockResolvedValue(null);
      prismaMock.add_ons.create.mockResolvedValue(buildRecord());

      const result = await service.create({
        code: 'BASIC_REPORT',
        name: 'Basic Report',
        price: 0,
      });

      expect(result.code).toBe('BASIC_REPORT');
      expect(prismaMock.add_ons.create).toHaveBeenCalled();
      const data = prismaMock.add_ons.create.mock.calls[0][0].data;
      expect(data.is_active).toBe(1);
      expect(data.billing_cycle).toBe(AddonBillingCycle.MONTHLY);
      expect(cacheMock.del).toHaveBeenCalled();
    });

    it('throws Conflict if code already exists', async () => {
      prismaMock.add_ons.findUnique.mockResolvedValue(buildRecord());
      await expect(
        service.create({ code: 'BASIC_REPORT', name: 'x', price: 0 }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('honors isActive=false', async () => {
      prismaMock.add_ons.findUnique.mockResolvedValue(null);
      prismaMock.add_ons.create.mockResolvedValue(buildRecord({ is_active: 0 }));
      await service.create({
        code: 'X',
        name: 'X',
        price: 100,
        isActive: false,
      });
      const data = prismaMock.add_ons.create.mock.calls[0][0].data;
      expect(data.is_active).toBe(0);
    });
  });

  describe('update', () => {
    it('updates fields and invalidates cache', async () => {
      prismaMock.add_ons.findUnique
        .mockResolvedValueOnce(buildRecord()) // existence check
        .mockResolvedValueOnce(null); // code conflict check skipped (no code change)
      prismaMock.add_ons.update.mockResolvedValue(buildRecord({ name: 'Updated' }));

      const result = await service.update('addon-1', { name: 'Updated', price: 200 });
      expect(result.name).toBe('Updated');
      const data = prismaMock.add_ons.update.mock.calls[0][0].data;
      expect(data.name).toBe('Updated');
      expect(cacheMock.del).toHaveBeenCalled();
    });

    it('throws NotFound if record missing', async () => {
      prismaMock.add_ons.findUnique.mockResolvedValue(null);
      await expect(
        service.update('missing', { name: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws Conflict when changing to existing code', async () => {
      prismaMock.add_ons.findUnique
        .mockResolvedValueOnce(buildRecord())
        .mockResolvedValueOnce(buildRecord({ id: 'addon-2', code: 'OTHER' }));

      await expect(
        service.update('addon-1', { code: 'OTHER' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('toggleActive', () => {
    it('flips is_active flag', async () => {
      prismaMock.add_ons.findUnique.mockResolvedValue(buildRecord({ is_active: 1 }));
      prismaMock.add_ons.update.mockResolvedValue(buildRecord({ is_active: 0 }));

      const result = await service.toggleActive('addon-1');
      expect(result.isActive).toBe(false);
      const data = prismaMock.add_ons.update.mock.calls[0][0].data;
      expect(data.is_active).toBe(0);
    });
  });

  describe('remove', () => {
    it('deletes the add-on', async () => {
      prismaMock.add_ons.findUnique.mockResolvedValue(buildRecord());
      prismaMock.add_ons.delete.mockResolvedValue(buildRecord());
      await service.remove('addon-1');
      expect(prismaMock.add_ons.delete).toHaveBeenCalledWith({ where: { id: 'addon-1' } });
    });

    it('throws NotFound if missing', async () => {
      prismaMock.add_ons.findUnique.mockResolvedValue(null);
      await expect(service.remove('missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
