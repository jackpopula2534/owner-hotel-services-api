import { BadRequestException, ConflictException } from '@nestjs/common';
import { MenuInventoryLinkService } from '../menu-inventory-link.service';
import { PrismaService } from '../../../../prisma/prisma.service';

/**
 * เปลี่ยนสินค้าในคลังที่เมนูผูกอยู่ — ไม่ขยับสต็อก แต่ต้องปลอดภัยและตรวจย้อนได้
 */
describe('MenuInventoryLinkService.relink', () => {
  const TENANT = 't1';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  let service: MenuInventoryLinkService;

  beforeEach(() => {
    const tx = {
      menuItem: { update: jest.fn() },
      menuItemInventoryLinkLog: { create: jest.fn() },
    };
    prisma = {
      menuItem: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'm1', name: 'ชาเย็น', inventoryItemId: 'inv-old' }),
      },
      inventoryItem: {
        findFirst: jest.fn(({ where }: { where: { id: string } }) =>
          Promise.resolve(
            where.id === 'inv-old'
              ? { id: 'inv-old', name: 'ชาเย็น 350ml', sku: 'RT-ICED-TEA' }
              : where.id === 'inv-raw'
                ? { id: 'inv-raw', name: 'ใบชา', sku: 'RAW-TEA', itemType: 'RAW_MATERIAL' }
                : {
                    id: 'inv-new',
                    name: 'ชาเย็น 500ml',
                    sku: 'RT-ICED-TEA-500',
                    itemType: 'FINISHED_GOOD',
                  },
          ),
        ),
      },
      orderItem: { count: jest.fn().mockResolvedValue(0) },
      user: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ firstName: 'Premium', lastName: 'Camper', email: 'x' }),
      },
      menuItemInventoryLinkLog: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)),
      tx,
    };
    service = new MenuInventoryLinkService(prisma as unknown as PrismaService);
  });

  it('moves the link without touching stock and writes a RELINK log with both sides', async () => {
    const res = await service.relink(
      'r1',
      'm1',
      { inventoryItemId: 'inv-new', reason: 'เปลี่ยนเป็นขวด 500ml' },
      TENANT,
      'u1',
    );

    expect(res.inventoryItemId).toBe('inv-new');
    expect(prisma.tx.menuItem.update).toHaveBeenCalledWith({
      where: { id: 'm1' },
      data: { inventoryItemId: 'inv-new', trackStock: false, stockQty: 0 },
    });
    expect(prisma.tx.menuItemInventoryLinkLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: TENANT,
        menuItemId: 'm1',
        action: 'RELINK',
        fromInventoryItemId: 'inv-old',
        fromItemName: 'ชาเย็น 350ml',
        toInventoryItemId: 'inv-new',
        toItemSku: 'RT-ICED-TEA-500',
        reason: 'เปลี่ยนเป็นขวด 500ml',
        changedByName: 'Premium Camper',
      }),
    });
  });

  it('refuses while an open bill still has this menu', async () => {
    prisma.orderItem.count.mockResolvedValue(2);
    await expect(
      service.relink('r1', 'm1', { inventoryItemId: 'inv-new', reason: 'เปลี่ยนขนาด' }, TENANT),
    ).rejects.toThrow(ConflictException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('requires a reason', async () => {
    await expect(
      service.relink('r1', 'm1', { inventoryItemId: 'inv-new', reason: ' ' }, TENANT),
    ).rejects.toThrow(BadRequestException);
  });

  it('only links finished goods, and not the same item again', async () => {
    await expect(
      service.relink('r1', 'm1', { inventoryItemId: 'inv-raw', reason: 'ทดสอบ' }, TENANT),
    ).rejects.toThrow(/วัตถุดิบ/);
    await expect(
      service.relink('r1', 'm1', { inventoryItemId: 'inv-old', reason: 'ทดสอบ' }, TENANT),
    ).rejects.toThrow(/ตัวเดิม/);
  });

  it('refuses a menu that is not linked yet (normal edit handles first link)', async () => {
    prisma.menuItem.findFirst.mockResolvedValue({ id: 'm1', name: 'ชา', inventoryItemId: null });
    await expect(
      service.relink('r1', 'm1', { inventoryItemId: 'inv-new', reason: 'ทดสอบ' }, TENANT),
    ).rejects.toThrow(ConflictException);
  });
});
