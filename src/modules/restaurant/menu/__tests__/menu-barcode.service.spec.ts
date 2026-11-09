/**
 * ยิงบาร์โค้ดที่ POS ร้านอาหาร → เมนูที่ผูกกับสินค้าชิ้นนั้น
 *
 * บาร์โค้ดอยู่ที่ตัวสินค้าในคลัง ไม่ได้อยู่ที่เมนู เมนูของสำเร็จรูปเป็นแค่หน้าร้าน
 * ของสินค้าตัวเดียวกัน — ที่นี่จึงต้องวิ่งย้อนจากบาร์โค้ดกลับมาที่เมนู และต้อง
 * ผูกร้าน+กิจการไว้ทุกครั้ง ไม่งั้นยิงที่ร้าน A แล้วได้เมนูราคาของร้าน B
 */

import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { MenuService } from '../menu.service';
import { PrismaService } from '../../../../prisma/prisma.service';
import { AuditLogService } from '../../../../audit-log/audit-log.service';

describe('MenuService — ยิงบาร์โค้ด', () => {
  let service: MenuService;

  const prisma = {
    restaurant: { findFirst: jest.fn() },
    menuItem: { findMany: jest.fn() },
  };

  const tenantId = 'tenant-1';
  const restaurantId = 'rest-1';

  const MENU_ROW = {
    id: 'menu-water',
    name: 'น้ำดื่ม 600ml',
    price: 20,
    allergens: '[]',
    inventoryItemId: 'item-water',
    category: { id: 'cat-1', name: 'เครื่องดื่ม' },
    inventoryItem: {
      id: 'item-water',
      name: 'น้ำดื่ม 600ml',
      sku: 'SKU-W',
      unit: 'BOTTLE',
      barcode: '8850001000011',
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma.restaurant.findFirst.mockResolvedValue({ id: restaurantId, tenantId });
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MenuService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogService, useValue: { log: jest.fn() } },
      ],
    }).compile();
    service = module.get<MenuService>(MenuService);
  });

  it('ค้นด้วยร้าน + กิจการ + บาร์โค้ดที่เท่ากันเป๊ะ', async () => {
    prisma.menuItem.findMany.mockResolvedValue([MENU_ROW]);

    await service.findItemByBarcode(restaurantId, '8850001000011', tenantId);

    const args = prisma.menuItem.findMany.mock.calls[0][0];
    expect(args.where).toMatchObject({
      restaurantId,
      tenantId,
      inventoryItem: { barcode: '8850001000011', tenantId, deletedAt: null },
    });
    expect(args.take).toBe(2);
  });

  it('ร้านไม่ใช่ของกิจการนี้ = 404 ตั้งแต่ก่อนแตะเมนู', async () => {
    prisma.restaurant.findFirst.mockResolvedValue(null);

    await expect(
      service.findItemByBarcode(restaurantId, '8850001000011', tenantId),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.menuItem.findMany).not.toHaveBeenCalled();
  });

  it('บาร์โค้ดสั้นเกินไป = 400 ไม่ใช่ยิงคิวรีกวาดทั้งตาราง', async () => {
    await expect(service.findItemByBarcode(restaurantId, '1', tenantId)).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.menuItem.findMany).not.toHaveBeenCalled();
  });

  it('ไม่มีเมนูผูกกับบาร์โค้ดนี้ = 404', async () => {
    prisma.menuItem.findMany.mockResolvedValue([]);

    await expect(
      service.findItemByBarcode(restaurantId, '8850009999999', tenantId),
    ).rejects.toThrow(NotFoundException);
  });

  it('ของชิ้นเดียวถูกผูกไว้สองเมนู = หยุด เพราะไม่รู้ว่าจะคิดราคาไหน', async () => {
    prisma.menuItem.findMany.mockResolvedValue([MENU_ROW, { ...MENU_ROW, id: 'menu-2', price: 25 }]);

    await expect(
      service.findItemByBarcode(restaurantId, '8850001000011', tenantId),
    ).rejects.toThrow(ConflictException);
  });

  it('คืนเมนูที่ allergens แปลงเป็น array แล้ว หน้าขายจะได้ใช้ต่อได้ทันที', async () => {
    prisma.menuItem.findMany.mockResolvedValue([{ ...MENU_ROW, allergens: '["nuts"]' }]);

    const result = await service.findItemByBarcode(restaurantId, '8850001000011', tenantId);

    expect(result.id).toBe('menu-water');
    expect(result.allergens).toEqual(['nuts']);
  });
});
