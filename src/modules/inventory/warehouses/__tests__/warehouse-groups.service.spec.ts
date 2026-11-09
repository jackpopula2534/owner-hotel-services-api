import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { WarehouseGroupsService } from '../warehouse-groups.service';

const TENANT = 'tenant-1';

function buildPrisma() {
  const prisma: any = {
    warehouseGroup: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      create: jest.fn().mockResolvedValue({ id: 'g1' }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    warehouse: {
      count: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  prisma.$transaction = jest.fn((arg: unknown) =>
    typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(prisma) : Promise.all(arg as unknown[]),
  );
  return prisma;
}

const groupRow = (over: Record<string, unknown> = {}) => ({
  id: 'g1',
  tenantId: TENANT,
  name: 'หน้าร้าน',
  code: 'GRP-POS',
  description: null,
  channels: ['POS'],
  sortOrder: 0,
  isActive: true,
  warehouses: [],
  ...over,
});

describe('WarehouseGroupsService', () => {
  it('create: normalises code, assigns warehouses inside the tenant only', async () => {
    const prisma = buildPrisma();
    prisma.warehouseGroup.findFirst
      .mockResolvedValueOnce(null) // code free
      .mockResolvedValueOnce(groupRow()); // findOne after create
    prisma.warehouse.count.mockResolvedValue(2);
    const service = new WarehouseGroupsService(prisma);

    const out = await service.create(
      { name: ' หน้าร้าน ', code: 'grp-pos', channels: ['POS'], warehouseIds: ['w1', 'w2'] },
      TENANT,
    );

    expect(prisma.warehouseGroup.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ tenantId: TENANT, code: 'GRP-POS', name: 'หน้าร้าน' }) }),
    );
    expect(prisma.warehouse.updateMany).toHaveBeenCalledWith({
      where: { tenantId: TENANT, id: { in: ['w1', 'w2'] } },
      data: { groupId: 'g1' },
    });
    expect(out.channels).toEqual(['POS']);
  });

  it('create: rejects warehouses from another tenant', async () => {
    const prisma = buildPrisma();
    prisma.warehouseGroup.findFirst.mockResolvedValue(null);
    prisma.warehouse.count.mockResolvedValue(1);
    const service = new WarehouseGroupsService(prisma);
    await expect(
      service.create({ name: 'x', code: 'X', channels: [], warehouseIds: ['mine', 'theirs'] }, TENANT),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.warehouseGroup.create).not.toHaveBeenCalled();
  });

  it('create: rejects a duplicate code', async () => {
    const prisma = buildPrisma();
    prisma.warehouseGroup.findFirst.mockResolvedValue({ id: 'other' });
    const service = new WarehouseGroupsService(prisma);
    await expect(service.create({ name: 'x', code: 'GRP-POS', channels: [] }, TENANT)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('update: replacing warehouseIds releases the ones left out', async () => {
    const prisma = buildPrisma();
    prisma.warehouseGroup.findFirst.mockResolvedValue(groupRow());
    prisma.warehouse.count.mockResolvedValue(1);
    const service = new WarehouseGroupsService(prisma);

    await service.update('g1', { warehouseIds: ['w1'] }, TENANT);

    expect(prisma.warehouse.updateMany).toHaveBeenCalledWith({
      where: { tenantId: TENANT, groupId: 'g1', id: { notIn: ['w1'] } },
      data: { groupId: null },
    });
    expect(prisma.warehouse.updateMany).toHaveBeenCalledWith({
      where: { tenantId: TENANT, id: { in: ['w1'] } },
      data: { groupId: 'g1' },
    });
  });

  it('remove: ungroups warehouses then deletes the group, tenant-scoped', async () => {
    const prisma = buildPrisma();
    prisma.warehouseGroup.findFirst.mockResolvedValue(groupRow());
    const service = new WarehouseGroupsService(prisma);

    await service.remove('g1', TENANT);

    expect(prisma.warehouse.updateMany).toHaveBeenCalledWith({
      where: { tenantId: TENANT, groupId: 'g1' },
      data: { groupId: null },
    });
    expect(prisma.warehouseGroup.deleteMany).toHaveBeenCalledWith({ where: { id: 'g1', tenantId: TENANT } });
  });

  it('findOne: another tenant\'s group is not found', async () => {
    const prisma = buildPrisma();
    prisma.warehouseGroup.findFirst.mockResolvedValue(null);
    const service = new WarehouseGroupsService(prisma);
    await expect(service.findOne('g1', TENANT)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.warehouseGroup.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'g1', tenantId: TENANT } }),
    );
  });
});
