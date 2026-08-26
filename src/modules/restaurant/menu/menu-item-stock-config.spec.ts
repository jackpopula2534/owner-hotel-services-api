import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { MenuService } from './menu.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogService } from '../../../audit-log/audit-log.service';

/**
 * ตั้งค่าสต๊อกของเมนูสำเร็จรูป — กฎ "แหล่งความจริงเดียว"
 *
 * สองแหล่ง (ผูกคลังกลาง + นับในเมนู) พร้อมกันคือยอดที่เชื่อไม่ได้ทั้งคู่
 * และเมนูปรุงที่ผูกสินค้าคลังตรง ๆ จะตัดของซ้ำกับสูตรอาหาร
 */

const RESTAURANT_ID = 'rest-1';
const TENANT_ID = 'tenant-1';

const makePrismaMock = () => ({
  restaurant: { findFirst: jest.fn().mockResolvedValue({ id: RESTAURANT_ID, tenantId: TENANT_ID }) },
  menuCategory: { findFirst: jest.fn().mockResolvedValue({ id: 'cat-1' }) },
  menuItem: {
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    aggregate: jest.fn().mockResolvedValue({ _max: { displayOrder: 0 } }),
  },
  menuItemRecipe: { findUnique: jest.fn().mockResolvedValue(null) },
  menuItemStockMovement: { create: jest.fn().mockResolvedValue({}) },
  inventoryItem: { findFirst: jest.fn().mockResolvedValue({ id: 'inv-1' }) },
});

const baseDto = {
  name: 'น้ำดื่ม 600 มล.',
  categoryId: 'cat-1',
  price: 20,
  itemKind: 'READY_MADE' as const,
};

describe('MenuService — ตั้งค่าสต๊อกของรายการเมนู', () => {
  let service: MenuService;
  let prisma: ReturnType<typeof makePrismaMock>;

  beforeEach(async () => {
    prisma = makePrismaMock();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MenuService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogService, useValue: { log: jest.fn() } },
      ],
    }).compile();
    service = module.get(MenuService);
  });

  const create = (dto: Record<string, unknown>) =>
    service.createItem(RESTAURANT_ID, { ...baseDto, ...dto } as any, TENANT_ID, 'u1');

  describe('createItem', () => {
    it('ผูกคลังกลางพร้อมเปิดนับในเมนูไม่ได้', async () => {
      await expect(create({ inventoryItemId: 'inv-1', trackStock: true })).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.menuItem.create).not.toHaveBeenCalled();
    });

    it('เมนูปรุงผูกสินค้าคลังตรง ๆ ไม่ได้ — ต้องตัดผ่านสูตรอาหาร', async () => {
      await expect(
        create({ itemKind: 'COOKED', inventoryItemId: 'inv-1' }),
      ).rejects.toThrow(/สินค้าสำเร็จรูป/);
    });

    it('ตั้งเกณฑ์เตือนใกล้หมดโดยไม่นับสต๊อกไม่ได้', async () => {
      await expect(create({ lowStockThreshold: 5 })).rejects.toThrow(/นับสต๊อกในเมนูนี้/);
    });

    it('ยอดยกมาต้องมีบรรทัดในสมุดเดินสต๊อก ไม่ใช่โผล่มาเฉย ๆ', async () => {
      prisma.menuItem.create.mockResolvedValue({
        id: 'm1', name: baseDto.name, trackStock: true, stockQty: 24, allergens: null,
      });

      await create({ trackStock: true, stockQty: 24 });

      expect(prisma.menuItemStockMovement.create.mock.calls[0][0].data).toMatchObject({
        menuItemId: 'm1', type: 'OPENING', quantity: 24, balanceAfter: 24, createdBy: 'u1',
      });
    });

    it('เปิดนับแต่ยอดยกมาเป็นศูนย์ไม่ต้องมีบรรทัด', async () => {
      prisma.menuItem.create.mockResolvedValue({
        id: 'm1', name: baseDto.name, trackStock: true, stockQty: 0, allergens: null,
      });

      await create({ trackStock: true, stockQty: 0 });

      expect(prisma.menuItemStockMovement.create).not.toHaveBeenCalled();
    });
  });

  describe('updateItem', () => {
    const existing = {
      id: 'm1', restaurantId: RESTAURANT_ID, tenantId: TENANT_ID, name: 'น้ำดื่ม',
      itemKind: 'READY_MADE', trackStock: true, stockQty: 24, inventoryItemId: null,
      lowStockThreshold: null, allergens: null,
    };

    beforeEach(() => {
      prisma.menuItem.findFirst.mockResolvedValue(existing);
      prisma.menuItem.update.mockResolvedValue({ ...existing, allergens: null });
    });

    it('แก้จำนวนคงเหลือตรง ๆ ผ่าน PATCH ไม่ได้ — ต้องเดินผ่านใบรับของ/ปรับยอด', async () => {
      await service.updateItem(RESTAURANT_ID, 'm1', { stockQty: 999 } as any, TENANT_ID, 'u1');

      expect(prisma.menuItem.update.mock.calls[0][0].data).not.toHaveProperty('stockQty');
    });

    it('เพิ่งเปิดการนับ ให้ตั้งยอดยกมาได้ครั้งเดียว', async () => {
      prisma.menuItem.findFirst.mockResolvedValue({ ...existing, trackStock: false, stockQty: 0 });

      await service.updateItem(
        RESTAURANT_ID, 'm1', { trackStock: true, stockQty: 12 } as any, TENANT_ID, 'u1',
      );

      expect(prisma.menuItem.update.mock.calls[0][0].data).toMatchObject({ stockQty: 12 });
    });

    it('ตรวจกฎโดยรวมค่าเดิมกับค่าใหม่ — ผูกคลังทับเมนูที่นับเองอยู่ไม่ได้', async () => {
      await expect(
        service.updateItem(RESTAURANT_ID, 'm1', { inventoryItemId: 'inv-1' } as any, TENANT_ID),
      ).rejects.toThrow(/เลือกอย่างใดอย่างหนึ่ง/);
    });

    it('เมนูที่มีสูตรอาหารอยู่แล้วผูกสินค้าคลังตรง ๆ ไม่ได้ (ตัดของซ้ำ)', async () => {
      prisma.menuItem.findFirst.mockResolvedValue({ ...existing, trackStock: false });
      prisma.menuItemRecipe.findUnique.mockResolvedValue({ id: 'r1' });

      await expect(
        service.updateItem(RESTAURANT_ID, 'm1', { inventoryItemId: 'inv-1' } as any, TENANT_ID),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
