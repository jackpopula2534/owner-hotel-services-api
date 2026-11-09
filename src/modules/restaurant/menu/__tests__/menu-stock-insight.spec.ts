import { MenuService } from '../menu.service';
import { PrismaService } from '../../../../prisma/prisma.service';
import { AuditLogService } from '../../../../audit-log/audit-log.service';
import { MenuStockService } from '../menu-stock.service';

/**
 * หน้าจัดการเมนูต้องเห็น "ต้นทุนตอนนี้" และ "ขายแล้วคลังจะลดไหม" — ไม่ใช่ต้นทุนที่ถ่ายไว้ตอนสร้างเมนู
 */
describe('MenuService.findAllItems — stock insight', () => {
  const TENANT = 'tenant-1';

  const menuRows = [
    { id: 'm-water', name: 'น้ำดื่ม', cost: 4, allergens: null, inventoryItemId: 'inv-water' },
    { id: 'm-padthai', name: 'ผัดไทย', cost: 50, allergens: null, inventoryItemId: null },
    { id: 'm-curry', name: 'แกงเขียว', cost: 60, allergens: null, inventoryItemId: null },
    { id: 'm-tea', name: 'ชาร้อน', cost: null, allergens: null, inventoryItemId: null },
  ];

  const costRows = [
    { id: 'm-water', name: 'น้ำดื่ม', cost: 4, inventoryItemId: 'inv-water', recipe: null },
    {
      id: 'm-padthai',
      name: 'ผัดไทย',
      cost: 50,
      inventoryItemId: null,
      recipe: {
        servings: 1,
        ingredients: [
          {
            name: 'เส้น',
            quantity: 150,
            unit: 'กรัม',
            wastagePercent: 0,
            itemId: 'inv-noodle',
            item: { id: 'inv-noodle', unit: 'KG' },
          },
        ],
      },
    },
    {
      id: 'm-curry',
      name: 'แกงเขียว',
      cost: 60,
      inventoryItemId: null,
      recipe: {
        servings: 1,
        ingredients: [
          {
            name: 'ไก่',
            quantity: 0.2,
            unit: 'KG',
            wastagePercent: 0,
            itemId: 'inv-chicken',
            item: { id: 'inv-chicken', unit: 'KG' },
          },
          {
            name: 'พริกแกง',
            quantity: 1,
            unit: 'ช้อนโต๊ะ',
            wastagePercent: 0,
            itemId: null,
            item: null,
          },
        ],
      },
    },
    { id: 'm-tea', name: 'ชาร้อน', cost: null, inventoryItemId: null, recipe: null },
  ];

  const prisma = {
    restaurant: { findFirst: jest.fn().mockResolvedValue({ id: 'r1', tenantId: TENANT }) },
    menuItem: {
      findMany: jest.fn((args: { include?: unknown }) =>
        Promise.resolve(args.include ? menuRows : costRows),
      ),
      count: jest.fn().mockResolvedValue(menuRows.length),
    },
    menuItemRecipe: {
      findMany: jest.fn().mockResolvedValue([
        { menuItemId: 'm-padthai', _count: { ingredients: 1 } },
        { menuItemId: 'm-curry', _count: { ingredients: 2 } },
      ]),
    },
    warehouseStock: {
      findMany: jest.fn().mockResolvedValue([
        { itemId: 'inv-water', quantity: 40, avgCost: 7, reservedQty: 0 },
        { itemId: 'inv-noodle', quantity: 10, avgCost: 80 },
        { itemId: 'inv-chicken', quantity: 5, avgCost: 120 },
      ]),
    },
  };

  const availableCentralQty = jest.fn().mockResolvedValue(new Map([['inv-water', 37]]));
  const service = new MenuService(
    prisma as unknown as PrismaService,
    {} as AuditLogService,
    { availableCentralQty } as unknown as MenuStockService,
  );

  it('returns live cost and recipe status per menu', async () => {
    const res = await service.findAllItems('r1', {}, TENANT);
    const byId = Object.fromEntries(res.data.map((d: { id: string }) => [d.id, d]));

    expect(byId['m-water']).toMatchObject({
      liveCost: 7,
      costSource: 'STOCK',
      recipeStatus: 'LINKED',
    });
    // 150 g = 0.15 KG × 80 = 12
    expect(byId['m-padthai']).toMatchObject({
      liveCost: 12,
      costSource: 'RECIPE',
      recipeStatus: 'COMPLETE',
    });
    expect(byId['m-curry']).toMatchObject({
      liveCost: 24,
      recipeStatus: 'INCOMPLETE',
      unstockedIngredients: ['พริกแกง'],
    });
    expect(byId['m-tea']).toMatchObject({
      liveCost: null,
      costSource: 'NONE',
      recipeStatus: 'NONE',
    });
  });
});
