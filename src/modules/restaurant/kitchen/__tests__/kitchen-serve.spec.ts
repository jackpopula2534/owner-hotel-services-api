/**
 * จอครัวแบบใหม่: ทีละรายการ → บิลเดินสถานะเอง → ส่งเสิร์ฟ (ทั้งบิลหรือเฉพาะที่พร้อม)
 */
import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { KitchenService } from '../kitchen.service';
import { PrismaService } from '../../../../prisma/prisma.service';
import { AuditLogService } from '../../../../audit-log/audit-log.service';
import { menuStockProvider } from '../../order/__tests__/menu-stock.stub';
import { resolveKitchenStation } from '../kitchen-station';

const R = 'rest-1';
const T = 'tenant-1';

describe('KitchenService — item flow and serving', () => {
  let service: KitchenService;
  const tx = {
    orderItem: { update: jest.fn(), updateMany: jest.fn(), findMany: jest.fn() },
    order: { findFirst: jest.fn(), update: jest.fn() },
    kitchenOrder: { updateMany: jest.fn() },
  };
  const prisma = {
    orderItem: { findFirst: jest.fn() },
    order: { findFirst: jest.fn() },
    $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        KitchenService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogService, useValue: { log: jest.fn() } },
        menuStockProvider(),
      ],
    }).compile();
    service = moduleRef.get(KitchenService);
    tx.order.findFirst.mockResolvedValue({ status: 'PREPARING' });
    prisma.orderItem.findFirst.mockResolvedValue({
      id: 'i1', orderId: 'o1', status: 'PREPARING', order: { restaurantId: R, tenantId: T },
    });
  });

  it('the last item done turns the bill READY and closes its kitchen ticket', async () => {
    tx.orderItem.findMany.mockResolvedValue([{ status: 'READY' }, { status: 'READY' }]);
    await service.updateItemStatus(R, 'i1', 'READY' as never, T);
    expect(tx.order.update).toHaveBeenCalledWith({ where: { id: 'o1' }, data: { status: 'READY' } });
    expect(tx.kitchenOrder.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'READY' }) }));
  });

  it('an item still cooking keeps the bill PREPARING', async () => {
    tx.order.findFirst.mockResolvedValue({ status: 'READY' });
    tx.orderItem.findMany.mockResolvedValue([{ status: 'READY' }, { status: 'PREPARING' }]);
    await service.updateItemStatus(R, 'i1', 'PREPARING' as never, T);
    expect(tx.order.update).toHaveBeenCalledWith({ where: { id: 'o1' }, data: { status: 'PREPARING' } });
  });

  it('an item can be put back to waiting, but not one already served', async () => {
    tx.orderItem.findMany.mockResolvedValue([{ status: 'SENT' }]);
    await service.updateItemStatus(R, 'i1', 'SENT' as never, T);
    expect(tx.orderItem.update.mock.calls[0][0].data).toMatchObject({ status: 'SENT', preparedAt: null });

    prisma.orderItem.findFirst.mockResolvedValue({ id: 'i1', orderId: 'o1', status: 'SERVED', order: { restaurantId: R, tenantId: T } });
    await expect(service.updateItemStatus(R, 'i1', 'SENT' as never, T)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('serves every ready item; the bill becomes SERVED when nothing is left', async () => {
    prisma.order.findFirst.mockResolvedValue({ id: 'o1', items: [{ id: 'a', status: 'READY' }, { id: 'b', status: 'READY' }], table: { tableNumber: 'P1' } });
    tx.orderItem.findMany.mockResolvedValue([{ status: 'SERVED' }, { status: 'SERVED' }]);
    const res = await service.serveItems(R, 'o1', undefined, T);
    expect(res.servedItemIds).toEqual(['a', 'b']);
    expect(tx.orderItem.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['a', 'b'] } }, data: { status: 'SERVED', servedAt: expect.any(Date) } });
    expect(tx.order.update).toHaveBeenCalledWith({ where: { id: 'o1' }, data: { status: 'SERVED' } });
  });

  it('ส่งที่พร้อมก่อน: only the named ready items; a cooking one is refused', async () => {
    prisma.order.findFirst.mockResolvedValue({ id: 'o1', items: [{ id: 'a', status: 'READY' }, { id: 'b', status: 'PREPARING' }], table: null });
    tx.orderItem.findMany.mockResolvedValue([{ status: 'SERVED' }, { status: 'PREPARING' }]);
    await service.serveItems(R, 'o1', ['a'], T);
    expect(tx.orderItem.updateMany.mock.calls[0][0].where).toEqual({ id: { in: ['a'] } });
    expect(tx.order.update).not.toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'SERVED' } }));

    await expect(service.serveItems(R, 'o1', ['b'], T)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('nothing ready → refuse', async () => {
    prisma.order.findFirst.mockResolvedValue({ id: 'o1', items: [{ id: 'a', status: 'PREPARING' }], table: null });
    await expect(service.serveItems(R, 'o1', undefined, T)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('resolveKitchenStation', () => {
  it('item override → category → revenue type', () => {
    expect(resolveKitchenStation({ kitchenStation: 'BAR', category: { kitchenStation: 'KITCHEN' } })).toBe('BAR');
    expect(resolveKitchenStation({ kitchenStation: null, category: { kitchenStation: 'BAR' } })).toBe('BAR');
    expect(resolveKitchenStation({ category: { revenueType: 'BEVERAGE' } })).toBe('BAR');
    expect(resolveKitchenStation({ category: { revenueType: 'FOOD' } })).toBe('KITCHEN');
    expect(resolveKitchenStation({ kitchenStation: 'nonsense' })).toBe('KITCHEN');
  });
});

describe('KitchenService.acceptBill', () => {
  it('opens the round tickets and leaves the items alone', async () => {
    const prisma = {
      order: { findFirst: jest.fn().mockResolvedValue({ id: 'o1' }) },
      kitchenOrder: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        KitchenService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogService, useValue: { log: jest.fn() } },
        menuStockProvider(),
      ],
    }).compile();
    const svc = moduleRef.get(KitchenService);
    await svc.acceptBill(R, 'o1', T);
    expect(prisma.kitchenOrder.updateMany).toHaveBeenCalledWith({
      where: { orderId: 'o1', tenantId: T, status: 'SENT' },
      data: { status: 'PREPARING', startedAt: expect.any(Date) },
    });
  });
});
