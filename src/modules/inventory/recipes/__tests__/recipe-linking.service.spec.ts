import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { RecipeLinkingService } from '../recipe-linking.service';
import { PrismaService } from '../../../../prisma/prisma.service';

describe('RecipeLinkingService', () => {
  let service: RecipeLinkingService;

  const prismaMock = {
    menuItemRecipe: { findMany: jest.fn() },
    restaurant: { findMany: jest.fn() },
    warehouse: { findFirst: jest.fn(), create: jest.fn() },
    inventoryItem: { findMany: jest.fn(), create: jest.fn() },
    recipeIngredient: { update: jest.fn() },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        RecipeLinkingService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();
    service = moduleRef.get(RecipeLinkingService);
  });

  it('ต้องมี tenantId', async () => {
    await expect(service.linkIngredients('')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('ผูกวัตถุดิบกับ item เดิมตามชื่อ (ตัดช่องว่าง/ตัวพิมพ์) + แปลงหน่วย กรัม→KG', async () => {
    prismaMock.menuItemRecipe.findMany.mockResolvedValue([
      {
        id: 'rec-1',
        menuItem: { restaurantId: 'res-1' },
        ingredients: [
          { id: 'ing-1', name: ' เต้าหู้แข็ง ', quantity: 200, unit: 'กรัม' },
          { id: 'ing-2', name: 'น้ำมันหอย', quantity: 1.5, unit: 'ช้อนโต๊ะ' },
        ],
      },
    ]);
    prismaMock.restaurant.findMany.mockResolvedValue([{ propertyId: 'prop-1' }]);
    prismaMock.warehouse.findFirst.mockResolvedValue({ id: 'wh-1' }); // มีคลังอยู่แล้ว
    prismaMock.inventoryItem.findMany.mockResolvedValue([
      { id: 'item-tofu', name: 'เต้าหู้แข็ง', unit: 'KG', sku: 'ING-TOFU' },
      { id: 'item-oyster', name: 'น้ำมันหอย', unit: 'BOTTLE', sku: 'ING-OYSTER' },
    ]);
    prismaMock.recipeIngredient.update.mockResolvedValue({});

    const result = await service.linkIngredients('t-1');

    expect(result.scanned).toBe(2);
    expect(result.linkedExisting).toBe(2);
    expect(result.createdItems).toBe(0);
    expect(result.unmatched).toEqual([]);
    expect(result.warehousesCreated).toBe(0);
    // กรัม → KG หาร 1000
    expect(prismaMock.recipeIngredient.update).toHaveBeenCalledWith({
      where: { id: 'ing-1' },
      data: { itemId: 'item-tofu', quantity: 0.2, unit: 'KG' },
    });
    // หน่วยไม่ตรงกติกาแปลง → คงค่าเดิม
    expect(prismaMock.recipeIngredient.update).toHaveBeenCalledWith({
      where: { id: 'ing-2' },
      data: { itemId: 'item-oyster', quantity: 1.5, unit: 'ช้อนโต๊ะ' },
    });
  });

  it('createMissing: สร้าง item ใหม่พร้อม SKU อัตโนมัติ + reuse สำหรับชื่อซ้ำข้ามสูตร', async () => {
    prismaMock.menuItemRecipe.findMany.mockResolvedValue([
      {
        id: 'rec-1',
        menuItem: { restaurantId: 'res-1' },
        ingredients: [{ id: 'ing-1', name: 'ใบกะเพราแดง', quantity: 1, unit: 'กำมือ' }],
      },
      {
        id: 'rec-2',
        menuItem: { restaurantId: 'res-1' },
        ingredients: [{ id: 'ing-2', name: 'ใบกะเพราแดง', quantity: 2, unit: 'กำมือ' }],
      },
    ]);
    prismaMock.restaurant.findMany.mockResolvedValue([{ propertyId: 'prop-1' }]);
    prismaMock.warehouse.findFirst.mockResolvedValue({ id: 'wh-1' });
    prismaMock.inventoryItem.findMany.mockResolvedValue([
      { id: 'x', name: 'อื่นๆ', unit: 'PIECE', sku: 'ING-AUTO-0007' },
    ]);
    prismaMock.inventoryItem.create.mockResolvedValue({
      id: 'item-new',
      name: 'ใบกะเพราแดง',
      unit: 'PIECE',
      sku: 'ING-AUTO-0008',
    });
    prismaMock.recipeIngredient.update.mockResolvedValue({});

    const result = await service.linkIngredients('t-1');

    // สร้างครั้งเดียว (ชื่อซ้ำใช้ item เดิม) และ SKU ต่อจากเลขสูงสุดเดิม
    expect(prismaMock.inventoryItem.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.inventoryItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ sku: 'ING-AUTO-0008', unit: 'PIECE' }),
      }),
    );
    expect(result.createdItems).toBe(1);
    expect(result.linkedExisting).toBe(0); // ทั้งสองแถวผูกกับ item ที่สร้างรอบนี้
    expect(prismaMock.recipeIngredient.update).toHaveBeenCalledTimes(2);
  });

  it('createMissing=false: ชื่อที่ไม่พบต้องอยู่ใน unmatched และไม่สร้าง item', async () => {
    prismaMock.menuItemRecipe.findMany.mockResolvedValue([
      {
        id: 'rec-1',
        menuItem: { restaurantId: 'res-1' },
        ingredients: [{ id: 'ing-1', name: 'พริกหยวกแดง', quantity: 0.5, unit: 'ลูก' }],
      },
    ]);
    prismaMock.restaurant.findMany.mockResolvedValue([{ propertyId: 'prop-1' }]);
    prismaMock.warehouse.findFirst.mockResolvedValue({ id: 'wh-1' });
    prismaMock.inventoryItem.findMany.mockResolvedValue([]);

    const result = await service.linkIngredients('t-1', { createMissing: false });

    expect(prismaMock.inventoryItem.create).not.toHaveBeenCalled();
    expect(prismaMock.recipeIngredient.update).not.toHaveBeenCalled();
    expect(result.unmatched).toEqual(['พริกหยวกแดง']);
  });

  it('property ไม่มี warehouse เลย → สร้างคลังครัว KITCHEN ให้อัตโนมัติ', async () => {
    prismaMock.menuItemRecipe.findMany.mockResolvedValue([
      {
        id: 'rec-1',
        menuItem: { restaurantId: 'res-1' },
        ingredients: [{ id: 'ing-1', name: 'เต้าหู้แข็ง', quantity: 200, unit: 'กรัม' }],
      },
    ]);
    prismaMock.restaurant.findMany.mockResolvedValue([{ propertyId: 'prop-1' }]);
    prismaMock.warehouse.findFirst.mockResolvedValue(null); // ไม่มีคลัง
    prismaMock.warehouse.create.mockResolvedValue({ id: 'wh-new' });
    prismaMock.inventoryItem.findMany.mockResolvedValue([]);
    prismaMock.inventoryItem.create.mockResolvedValue({
      id: 'item-new',
      name: 'เต้าหู้แข็ง',
      unit: 'G',
      sku: 'ING-AUTO-0001',
    });
    prismaMock.recipeIngredient.update.mockResolvedValue({});

    const result = await service.linkIngredients('t-1');

    expect(prismaMock.warehouse.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 't-1',
        propertyId: 'prop-1',
        type: 'KITCHEN',
        isDefault: true,
      }),
    });
    expect(result.warehousesCreated).toBe(1);
    // item ใหม่หน่วย G ตรงกับหน่วยสูตร → ไม่แปลงปริมาณ
    expect(prismaMock.recipeIngredient.update).toHaveBeenCalledWith({
      where: { id: 'ing-1' },
      data: { itemId: 'item-new', quantity: 200, unit: 'กรัม' },
    });
  });

  it('ทุกวัตถุดิบผูกแล้ว → no-op (ไม่แตะ item/ingredient)', async () => {
    prismaMock.menuItemRecipe.findMany.mockResolvedValue([
      { id: 'rec-1', menuItem: { restaurantId: 'res-1' }, ingredients: [] },
    ]);
    prismaMock.restaurant.findMany.mockResolvedValue([{ propertyId: 'prop-1' }]);
    prismaMock.warehouse.findFirst.mockResolvedValue({ id: 'wh-1' });

    const result = await service.linkIngredients('t-1');

    expect(result.scanned).toBe(0);
    expect(prismaMock.inventoryItem.findMany).not.toHaveBeenCalled();
    expect(prismaMock.recipeIngredient.update).not.toHaveBeenCalled();
  });
});
