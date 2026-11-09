/**
 * ปุ่มเปลี่ยนสถานะบิลที่หน้า POS ต้องพารายการไปด้วย — จอครัวเดินบิลตามรายการ
 * ถ้าบิลเป็น "เสิร์ฟแล้ว" แต่รายการยังค้าง "พร้อม" พอครัวแตะอะไรบิลจะเด้งกลับ
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

describe('OrderService.updateStatus keeps items in step', () => {
  let service: OrderService;
  const tx = {
    order: { update: jest.fn().mockResolvedValue({ id: 'o1', items: [] }) },
    orderItem: { updateMany: jest.fn() },
    kitchenOrder: { updateMany: jest.fn() },
  };
  const prisma = {
    order: { findFirst: jest.fn() },
    $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        OrderService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: () => 'http://localhost' } },
        { provide: MenuService, useValue: {} },
        menuStockProvider(),
        { provide: AuditLogService, useValue: { logOrderUpdate: jest.fn() } },
        { provide: FolioPostingService, useValue: buildFolioPostingStub() },
        { provide: RevenuePostingService, useValue: buildRevenuePostingStub() },
        { provide: KitchenGateway, useValue: { emitOrderStatusToGuest: jest.fn() } },
      ],
    }).compile();
    service = moduleRef.get(OrderService);
  });

  const at = (status: string) =>
    prisma.order.findFirst.mockResolvedValue({ id: 'o1', orderNumber: 'ORD-1', status, items: [], table: null });

  it('พร้อมเสิร์ฟ from the till readies what the kitchen has not finished', async () => {
    at('PREPARING');
    await service.updateStatus('r1', 'o1', 'READY' as never, 't1');
    expect(tx.orderItem.updateMany).toHaveBeenCalledWith({
      where: { orderId: 'o1', sentToKitchen: true, status: { in: ['SENT', 'PREPARING'] } },
      data: { status: 'READY', preparedAt: expect.any(Date) },
    });
  });

  it('เสิร์ฟแล้ว serves the items too', async () => {
    at('READY');
    await service.updateStatus('r1', 'o1', 'SERVED' as never, 't1');
    expect(tx.orderItem.updateMany).toHaveBeenCalledWith({
      where: { orderId: 'o1', sentToKitchen: true, status: { in: ['SENT', 'PREPARING', 'READY'] } },
      data: { status: 'SERVED', servedAt: expect.any(Date) },
    });
  });

  it('other steps leave the items alone', async () => {
    at('PENDING');
    await service.updateStatus('r1', 'o1', 'CONFIRMED' as never, 't1');
    expect(tx.orderItem.updateMany).not.toHaveBeenCalled();
  });
});
