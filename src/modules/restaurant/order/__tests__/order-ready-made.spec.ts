/**
 * บิลที่มีของสำเร็จรูป (น้ำขวด ขนม ไอศกรีม) ตอนกด "ส่งเข้าครัว"
 *
 * บั๊กที่สเปกชุดนี้กันไว้:
 *  - บิลที่มีแต่ของสำเร็จรูปเคยส่งเข้าครัวไม่ได้เลย พนักงานจึงปิดบิลไม่ได้
 *  - ถ้าปล่อยของสำเร็จรูปขึ้นจอครัว ตั๋วจะค้างรอเชฟกด ready ทั้งที่ไม่มีอะไรต้องทำ
 *  - บิลผสมต้องออกตั๋วครัวใบเดียวที่มีเฉพาะของที่ต้องปรุง
 */

import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { OrderService } from '../order.service';
import { PrismaService } from '../../../../prisma/prisma.service';
import { MenuService } from '../../menu/menu.service';
import { menuStockProvider } from './menu-stock.stub';
import { AuditLogService } from '../../../../audit-log/audit-log.service';
import { FolioPostingService } from '@/modules/accounts-receivable/folio-posting/folio-posting.service';
import { buildFolioPostingStub } from './folio-posting.stub';
import { RevenuePostingService } from '@/modules/revenue/revenue-posting.service';
import { buildRevenuePostingStub } from '@/modules/revenue/__tests__/revenue-posting.stub';
import { KitchenGateway } from '../../kitchen/kitchen.gateway';

const RESTAURANT = 'rest-1';
const TENANT = 'tenant-1';
const ORDER_ID = 'order-1';

const line = (id: string, kind: 'COOKED' | 'READY_MADE', name: string) => ({
  id,
  menuItemId: `menu-${id}`,
  quantity: 1,
  notes: null,
  sentToKitchen: false,
  status: 'PENDING',
  menuItem: { id: `menu-${id}`, name, itemKind: kind },
});

describe('OrderService — sendToKitchen กับของสำเร็จรูป', () => {
  let service: OrderService;
  let kitchenGateway: { emitNewOrder: jest.Mock };

  const prisma = {
    order: { findFirst: jest.fn(), update: jest.fn() },
    orderItem: { updateMany: jest.fn() },
    kitchenOrder: { create: jest.fn() },
    $transaction: jest.fn(async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
  };

  const orderWith = (items: ReturnType<typeof line>[], status = 'PENDING') => ({
    id: ORDER_ID,
    orderNumber: 'ORD-1',
    restaurantId: RESTAURANT,
    tenantId: TENANT,
    status,
    confirmedAt: null,
    table: { tableNumber: 'A1' },
    items,
    kitchenOrders: [],
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    kitchenGateway = { emitNewOrder: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        OrderService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: () => 'http://localhost:9010' } },
        { provide: MenuService, useValue: {} },
        menuStockProvider(),
        { provide: AuditLogService, useValue: { logOrderUpdate: jest.fn() } },
        { provide: FolioPostingService, useValue: buildFolioPostingStub() },
        { provide: RevenuePostingService, useValue: buildRevenuePostingStub() },
        { provide: KitchenGateway, useValue: kitchenGateway },
      ],
    }).compile();
    service = moduleRef.get(OrderService);

    prisma.orderItem.updateMany.mockResolvedValue({ count: 1 });
    prisma.order.update.mockResolvedValue({ id: ORDER_ID });
    prisma.kitchenOrder.create.mockResolvedValue({ id: 'kitchen-1' });
  });

  /** ค่าที่สั่งเขียนของ updateMany ครั้งที่ n */
  const updateCall = (n: number) => prisma.orderItem.updateMany.mock.calls[n][0];

  it('บิลที่มีแต่ของสำเร็จรูป: เสิร์ฟทันที ไม่ออกตั๋วครัว และไม่ดันบิลไป PREPARING', async () => {
    const items = [line('i1', 'READY_MADE', 'น้ำดื่ม'), line('i2', 'READY_MADE', 'ไอศกรีมแท่ง')];
    prisma.order.findFirst.mockResolvedValue(orderWith(items));

    await service.sendToKitchen(RESTAURANT, ORDER_ID, TENANT);

    expect(prisma.kitchenOrder.create).not.toHaveBeenCalled();
    expect(kitchenGateway.emitNewOrder).not.toHaveBeenCalled();
    expect(updateCall(0).data).toMatchObject({ sentToKitchen: true, status: 'SERVED' });
    expect(updateCall(0).data.servedAt).toBeInstanceOf(Date);
    expect(prisma.order.update.mock.calls[0][0].data.status).toBe('PENDING');
  });

  it('บิลผสม: ตั๋วครัวใบเดียวที่มีเฉพาะของที่ต้องปรุง ส่วนของสำเร็จรูปเสิร์ฟไปเลย', async () => {
    const items = [
      line('i1', 'READY_MADE', 'น้ำดื่ม'),
      line('i2', 'COOKED', 'ผัดไทยกุ้งสด'),
    ];
    prisma.order.findFirst.mockResolvedValue(orderWith(items));

    await service.sendToKitchen(RESTAURANT, ORDER_ID, TENANT);

    expect(prisma.kitchenOrder.create).toHaveBeenCalledTimes(1);
    expect(updateCall(0)).toMatchObject({ where: { id: { in: ['i1'] } } });
    expect(updateCall(0).data).toMatchObject({ status: 'SERVED' });
    expect(updateCall(1)).toMatchObject({ where: { id: { in: ['i2'] } } });
    expect(updateCall(1).data).toMatchObject({ status: 'SENT' });
    expect(prisma.order.update.mock.calls[0][0].data.status).toBe('PREPARING');

    const emitted = kitchenGateway.emitNewOrder.mock.calls[0][2];
    expect(emitted.items.map((i: { name: string }) => i.name)).toEqual(['ผัดไทยกุ้งสด']);
  });

  it('บิลที่ปรุงอย่างเดียวยังทำงานเหมือนเดิม', async () => {
    prisma.order.findFirst.mockResolvedValue(orderWith([line('i1', 'COOKED', 'ต้มยำกุ้ง')]));

    await service.sendToKitchen(RESTAURANT, ORDER_ID, TENANT);

    expect(prisma.kitchenOrder.create).toHaveBeenCalledTimes(1);
    expect(updateCall(0).data).toMatchObject({ status: 'SENT' });
    expect(kitchenGateway.emitNewOrder).toHaveBeenCalledTimes(1);
  });

  it('ไม่มีรายการใหม่ให้ส่ง = 400 (เดิม)', async () => {
    prisma.order.findFirst.mockResolvedValue(
      orderWith([{ ...line('i1', 'READY_MADE', 'น้ำดื่ม'), sentToKitchen: true }]),
    );

    await expect(service.sendToKitchen(RESTAURANT, ORDER_ID, TENANT)).rejects.toThrow(
      'No new items to send to kitchen',
    );
  });
});
