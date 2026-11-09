import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PositionKitService } from './position-kit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../audit-log/audit-log.service';

describe('PositionKitService', () => {
  let prisma: any;
  let service: PositionKitService;

  beforeEach(() => {
    prisma = {
      hrPosition: { findFirst: jest.fn(), update: jest.fn().mockResolvedValue({}) },
      inventoryItem: { count: jest.fn().mockResolvedValue(1) },
    };
    service = new PositionKitService(
      prisma as PrismaService,
      { log: jest.fn().mockResolvedValue(undefined) } as unknown as AuditLogService,
    );
  });

  it('get returns [] when no kit is set (tenant-scoped lookup)', async () => {
    prisma.hrPosition.findFirst.mockResolvedValue({ id: 'p1', equipmentKit: null });
    await expect(service.get('p1', 't1')).resolves.toEqual({ positionId: 'p1', items: [] });
    expect(prisma.hrPosition.findFirst.mock.calls[0][0].where).toEqual({ id: 'p1', tenantId: 't1' });
  });

  it('get 404s for a position of another tenant', async () => {
    prisma.hrPosition.findFirst.mockResolvedValue(null);
    await expect(service.get('p1', 't1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('update normalizes and stores items', async () => {
    prisma.hrPosition.findFirst.mockResolvedValue({ id: 'p1', equipmentKit: null });
    const res = await service.update(
      'p1',
      { items: [{ name: ' Uniform ', qty: 2, note: '  ' }, { itemId: 'i1', name: 'Knife set', qty: 1, note: 'size M' }] },
      't1',
      'u1',
    );
    expect(res.items).toEqual([
      { name: 'Uniform', qty: 2 },
      { itemId: 'i1', name: 'Knife set', qty: 1, note: 'size M' },
    ]);
    expect(prisma.hrPosition.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { equipmentKit: res.items } });
    expect(prisma.inventoryItem.count).toHaveBeenCalledWith({ where: { tenantId: 't1', id: { in: ['i1'] } } });
  });

  it('update rejects inventory items of another tenant', async () => {
    prisma.hrPosition.findFirst.mockResolvedValue({ id: 'p1' });
    prisma.inventoryItem.count.mockResolvedValue(0);
    await expect(
      service.update('p1', { items: [{ itemId: 'iX', name: 'x', qty: 1 }] }, 't1', 'u1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
