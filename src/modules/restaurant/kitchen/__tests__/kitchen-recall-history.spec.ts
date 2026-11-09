/**
 * ประวัติครัว + ดึงกลับเข้าครัว
 */
import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { KitchenService, RECALL_STATION } from '../kitchen.service';
import { RecallBillDto } from '../dto/recall-bill.dto';
import { PrismaService } from '../../../../prisma/prisma.service';
import { AuditLogService } from '../../../../audit-log/audit-log.service';
import { menuStockProvider } from '../../order/__tests__/menu-stock.stub';

const R = 'rest-1';
const T = 'tenant-1';
const I1 = '11111111-1111-4111-8111-111111111111';
const I2 = '22222222-2222-4222-8222-222222222222';

describe('KitchenService — history and recall', () => {
  let service: KitchenService;
  const tx = {
    orderItem: { updateMany: jest.fn(), findMany: jest.fn() },
    order: { findFirst: jest.fn(), update: jest.fn() },
    kitchenOrder: { updateMany: jest.fn(), create: jest.fn() },
  };
  const prisma = {
    order: { findFirst: jest.fn(), findMany: jest.fn() },
    $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };

  const bill = (over: Record<string, unknown> = {}) => ({
    id: 'o1', status: 'SERVED', paymentStatus: 'UNPAID', table: { tableNumber: 'L1' },
    items: [
      { id: I1, status: 'SERVED', sentToKitchen: true },
      { id: I2, status: 'SERVED', sentToKitchen: true },
    ],
    ...over,
  });

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
    tx.order.findFirst.mockResolvedValue({ status: 'SERVED' });
  });

  it('remake sends served items back to waiting with a RUSH recall ticket', async () => {
    prisma.order.findFirst.mockResolvedValue(bill());
    tx.orderItem.findMany.mockResolvedValue([{ status: 'SENT' }, { status: 'SENT' }]);
    const res = await service.recallBill(R, 'o1', { reason: 'REMAKE' }, T);
    expect(res.recalledItemIds).toEqual([I1, I2]);
    expect(tx.orderItem.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [I1, I2] } },
      data: { status: 'SENT', servedAt: null, preparedAt: null },
    });
    expect(tx.kitchenOrder.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ orderId: 'o1', priority: 'RUSH', status: 'PREPARING', stationName: RECALL_STATION, notes: 'REMAKE' }),
    });
    expect(tx.order.update).toHaveBeenCalledWith({ where: { id: 'o1' }, data: { status: 'PREPARING' } });
  });

  it('served by mistake puts the items back at the pass, not on the stove', async () => {
    prisma.order.findFirst.mockResolvedValue(bill());
    tx.orderItem.findMany.mockResolvedValue([{ status: 'READY' }, { status: 'READY' }]);
    await service.recallBill(R, 'o1', { reason: 'MISSED_SERVE' }, T);
    expect(tx.orderItem.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'READY', servedAt: null } }));
    expect(tx.kitchenOrder.create).toHaveBeenCalledWith({ data: expect.objectContaining({ status: 'READY' }) });
    expect(tx.order.update).toHaveBeenCalledWith({ where: { id: 'o1' }, data: { status: 'READY' } });
  });

  it('only the named items come back', async () => {
    prisma.order.findFirst.mockResolvedValue(bill());
    tx.orderItem.findMany.mockResolvedValue([{ status: 'SENT' }, { status: 'SERVED' }]);
    const res = await service.recallBill(R, 'o1', { reason: 'WRONG_ITEM', itemIds: [I2] }, T);
    expect(res.recalledItemIds).toEqual([I2]);
  });

  it('refuses a paid bill, an unserved item, or nothing to recall', async () => {
    prisma.order.findFirst.mockResolvedValue(bill({ paymentStatus: 'PAID' }));
    await expect(service.recallBill(R, 'o1', { reason: 'REMAKE' }, T)).rejects.toBeInstanceOf(BadRequestException);

    prisma.order.findFirst.mockResolvedValue(bill({ items: [{ id: I1, status: 'READY', sentToKitchen: true }] }));
    await expect(service.recallBill(R, 'o1', { reason: 'REMAKE', itemIds: [I1] }, T)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.recallBill(R, 'o1', { reason: 'REMAKE' }, T)).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.kitchenOrder.create).not.toHaveBeenCalled();
  });

  it('history: newest served first, with its recalls and whether the bill is closed', async () => {
    const at = (h: number) => new Date(2026, 9, 28, h, 0);
    prisma.order.findMany.mockResolvedValue([
      { id: 'a', status: 'SERVED', paymentStatus: 'UNPAID', items: [{ servedAt: at(10) }, { servedAt: at(11) }], kitchenOrders: [] },
      {
        id: 'b', status: 'COMPLETED', paymentStatus: 'PAID', items: [{ servedAt: at(12) }],
        kitchenOrders: [{ stationName: null, createdAt: at(9) }, { stationName: RECALL_STATION, notes: 'REMAKE', createdAt: at(11) }],
      },
    ]);
    const rows = await service.getHistory(R, T, at(0));
    expect(rows.map((r) => r.id)).toEqual(['b', 'a']);
    expect(rows[0]).toMatchObject({ closed: true, servedAt: at(12), recalls: [{ at: at(11), reason: 'REMAKE' }] });
    expect(rows[1]).toMatchObject({ closed: false, servedAt: at(11), recalls: [] });
    const where = prisma.order.findMany.mock.calls[0][0].where;
    expect(where.AND[0].items.some.servedAt).toEqual({ gte: at(0) });
  });

  it('the recall DTO only takes known reasons', async () => {
    expect(await validate(plainToInstance(RecallBillDto, { reason: 'REMAKE' }))).toHaveLength(0);
    expect(await validate(plainToInstance(RecallBillDto, { reason: 'OOPS' }))).not.toHaveLength(0);
    expect(await validate(plainToInstance(RecallBillDto, { reason: 'REMAKE', itemIds: ['x'] }))).not.toHaveLength(0);
  });
});
