/**
 * ครัวกดยกเลิกรายการ — ของที่หยิบออกจากตู้ไปแล้วต้องกลับเข้าสต๊อก
 *
 * ของสำเร็จรูปถูกหักตั้งแต่ตอนสั่ง ถ้าครัวยกเลิกแล้วไม่คืน ยอดจะหายทั้งที่ของ
 * ไม่เคยออกจากร้าน และไม่มีใครเห็นจนกว่าจะนับสต๊อกสิ้นเดือน
 */

import { Test } from '@nestjs/testing';
import { KitchenService } from '../kitchen.service';
import { PrismaService } from '../../../../prisma/prisma.service';
import { AuditLogService } from '../../../../audit-log/audit-log.service';
import { buildMenuStockStub, menuStockProvider } from '../../order/__tests__/menu-stock.stub';

const RESTAURANT = 'rest-1';
const TENANT = 'tenant-1';
const ITEM = 'oi-1';
const ORDER_ID = 'order-1';

describe('KitchenService — ยกเลิกรายการแล้วคืนสต๊อก', () => {
  let service: KitchenService;
  let menuStock: ReturnType<typeof buildMenuStockStub>;

  const tx = { orderItem: { update: jest.fn() } };
  const prisma = {
    orderItem: { findFirst: jest.fn() },
    $transaction: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    menuStock = buildMenuStockStub();

    const moduleRef = await Test.createTestingModule({
      providers: [
        KitchenService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogService, useValue: { log: jest.fn() } },
        menuStockProvider(menuStock),
      ],
    }).compile();
    service = moduleRef.get(KitchenService);

    prisma.orderItem.findFirst.mockResolvedValue({
      id: ITEM,
      orderId: ORDER_ID,
      order: { id: ORDER_ID, restaurantId: RESTAURANT, tenantId: TENANT },
    });
    prisma.$transaction.mockImplementation(async (fn: any) => fn(tx));
    tx.orderItem.update.mockResolvedValue({ id: ITEM, status: 'CANCELLED' });
  });

  it('ยกเลิกแล้วคืนเฉพาะบรรทัดนั้น — ไม่ใช่ทั้งบิล', async () => {
    await service.updateItemStatus(RESTAURANT, ITEM, 'CANCELLED' as never, TENANT, 'user-1');

    expect(menuStock.returnPlacedLines.mock.calls[0][1]).toMatchObject({
      tenantId: TENANT,
      restaurantId: RESTAURANT,
      orderId: ORDER_ID,
      orderItemIds: [ITEM],
      userId: 'user-1',
    });
  });

  it('คืนของกับเปลี่ยนสถานะอยู่ในทรานแซกชันเดียวกัน — คืนแล้วแต่สถานะไม่เปลี่ยนคือของงอก', async () => {
    await service.updateItemStatus(RESTAURANT, ITEM, 'CANCELLED' as never, TENANT, 'user-1');

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(menuStock.returnPlacedLines.mock.calls[0][0]).toBe(tx);
    expect(tx.orderItem.update).toHaveBeenCalledWith({
      where: { id: ITEM },
      data: { status: 'CANCELLED' },
    });
  });

  it('เปลี่ยนเป็นสถานะอื่นไม่คืนของ', async () => {
    await service.updateItemStatus(RESTAURANT, ITEM, 'READY' as never, TENANT, 'user-1');

    expect(menuStock.returnPlacedLines).not.toHaveBeenCalled();
    expect(tx.orderItem.update.mock.calls[0][0].data.preparedAt).toBeInstanceOf(Date);
  });
});
