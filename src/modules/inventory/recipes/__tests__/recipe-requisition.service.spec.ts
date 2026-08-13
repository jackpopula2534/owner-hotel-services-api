import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { RecipeRequisitionService } from '../recipe-requisition.service';
import { PrismaService } from '../../../../prisma/prisma.service';
import { IntegrationsService } from '../../../integrations/integrations.service';

// Planning only — turning a plan into a document lives in MaterialRequisitionService
// and is covered by material-requisition.service.spec.ts.
describe('RecipeRequisitionService', () => {
  let service: RecipeRequisitionService;

  const prismaMock = {
    menuItemRecipe: { findMany: jest.fn() },
    restaurant: { findMany: jest.fn() },
    warehouse: { findMany: jest.fn(), findFirst: jest.fn() },
    warehouseStock: { findMany: jest.fn() },
  };
  const integrationsMock = { isEnabled: jest.fn() };

  const KITCHEN = {
    id: 'wh-kitchen',
    name: 'คลังครัว',
    code: 'KIT',
    type: 'KITCHEN',
    isDefault: false,
  };
  const CENTRAL = {
    id: 'wh-central',
    name: 'คลังกลาง',
    code: 'CEN',
    type: 'GENERAL',
    isDefault: true,
  };

  /** Som Tum: 2 tracked ingredients + 1 free-text, 1 serving per recipe. */
  const RECIPE = {
    id: 'rec-1',
    servings: 1,
    menuItem: { id: 'menu-1', name: 'ส้มตำไทย', restaurantId: 'res-1' },
    ingredients: [
      {
        itemId: 'item-papaya',
        name: 'มะละกอดิบ',
        quantity: 0.2,
        unit: 'KG',
        wastagePercent: 10,
        item: { id: 'item-papaya', name: 'มะละกอดิบ', sku: 'ING-PAPAYA', unit: 'KG' },
      },
      {
        itemId: 'item-peanut',
        name: 'ถั่วลิสง',
        quantity: 0.03,
        unit: 'KG',
        wastagePercent: 0,
        item: { id: 'item-peanut', name: 'ถั่วลิสง', sku: 'ING-PEANUT', unit: 'KG' },
      },
      { itemId: null, name: 'ใบโหระพา', quantity: 5, unit: 'ใบ', wastagePercent: 0, item: null },
    ],
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        RecipeRequisitionService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: IntegrationsService, useValue: integrationsMock },
      ],
    }).compile();
    service = moduleRef.get(RecipeRequisitionService);

    integrationsMock.isEnabled.mockResolvedValue(true);
    prismaMock.menuItemRecipe.findMany.mockResolvedValue([RECIPE]);
    prismaMock.restaurant.findMany.mockResolvedValue([{ propertyId: 'prop-1' }]);
    prismaMock.warehouse.findMany.mockResolvedValue([CENTRAL, KITCHEN]);
    prismaMock.warehouseStock.findMany.mockResolvedValue([]);
  });

  const plan = () => service.plan('t-1', { targets: [{ menuItemId: 'menu-1', plates: 50 }] });

  it('refuses to plan when the warehouse connection is off', async () => {
    integrationsMock.isEnabled.mockResolvedValue(false);
    await expect(plan()).rejects.toBeInstanceOf(BadRequestException);
    expect(prismaMock.menuItemRecipe.findMany).not.toHaveBeenCalled();
  });

  describe('plan', () => {
    it('applies wastage and rounds the requisition up to whole units', async () => {
      const result = await plan();

      const papaya = result.lines.find((l) => l.itemId === 'item-papaya')!;
      // 0.2kg × 1.10 wastage × 50 plates = 11kg exactly.
      expect(papaya.requiredQty).toBe(11);
      expect(papaya.suggestedQty).toBe(11);

      // 0.03 × 50 = 1.5kg — StockMovement.quantity is an Int, so it ships as 2.
      const peanut = result.lines.find((l) => l.itemId === 'item-peanut')!;
      expect(peanut.requiredQty).toBe(1.5);
      expect(peanut.suggestedQty).toBe(2);
    });

    it('nets off what the kitchen already holds', async () => {
      prismaMock.warehouseStock.findMany.mockResolvedValue([
        { warehouseId: KITCHEN.id, itemId: 'item-papaya', quantity: 4 },
        { warehouseId: CENTRAL.id, itemId: 'item-papaya', quantity: 30 },
      ]);

      const papaya = (await plan()).lines.find((l) => l.itemId === 'item-papaya')!;
      expect(papaya.onHandQty).toBe(4);
      expect(papaya.shortageQty).toBe(7);
      expect(papaya.suggestedQty).toBe(7);
      expect(papaya.sourceQty).toBe(30);
      expect(papaya.enough).toBe(true);
    });

    it('flags lines the source warehouse cannot cover', async () => {
      prismaMock.warehouseStock.findMany.mockResolvedValue([
        { warehouseId: CENTRAL.id, itemId: 'item-papaya', quantity: 3 },
      ]);

      const result = await plan();
      expect(result.lines.find((l) => l.itemId === 'item-papaya')!.enough).toBe(false);
      expect(result.warnings.some((w) => w.includes('ไม่พอ'))).toBe(true);
    });

    it('reports free-text ingredients separately instead of silently dropping them', async () => {
      const result = await plan();
      expect(result.lines.some((l) => l.itemName === 'ใบโหระพา')).toBe(false);
      expect(result.unlinked).toEqual([{ name: 'ใบโหระพา', menus: ['ส้มตำไทย'] }]);
    });

    it('picks the kitchen as destination and a different warehouse as source', async () => {
      const result = await plan();
      expect(result.kitchenWarehouse?.id).toBe(KITCHEN.id);
      expect(result.sourceWarehouseId).toBe(CENTRAL.id);
      expect(result.sourceWarehouses.map((w) => w.id)).not.toContain(KITCHEN.id);
    });

    it('merges the same ingredient across two menus onto one line', async () => {
      prismaMock.menuItemRecipe.findMany.mockResolvedValue([
        RECIPE,
        {
          ...RECIPE,
          id: 'rec-2',
          menuItem: { id: 'menu-2', name: 'ส้มตำปู', restaurantId: 'res-1' },
          ingredients: [RECIPE.ingredients[0]],
        },
      ]);

      const result = await service.plan('t-1', {
        targets: [
          { menuItemId: 'menu-1', plates: 50 },
          { menuItemId: 'menu-2', plates: 50 },
        ],
      });

      const papaya = result.lines.filter((l) => l.itemId === 'item-papaya');
      expect(papaya).toHaveLength(1);
      expect(papaya[0].requiredQty).toBe(22);
      expect(papaya[0].usedBy).toHaveLength(2);
    });

    it('warns instead of guessing when no kitchen warehouse exists', async () => {
      prismaMock.warehouse.findMany.mockResolvedValue([]);
      const result = await plan();
      expect(result.kitchenWarehouse).toBeNull();
      expect(result.warnings.some((w) => w.includes('คลังครัว'))).toBe(true);
    });

    it('rejects menus that span two properties', async () => {
      prismaMock.restaurant.findMany.mockResolvedValue([
        { propertyId: 'prop-1' },
        { propertyId: 'prop-2' },
      ]);
      await expect(plan()).rejects.toThrow(/คนละสาขา/);
    });

    it('rejects menus whose recipes link to nothing in the warehouse', async () => {
      prismaMock.menuItemRecipe.findMany.mockResolvedValue([
        { ...RECIPE, ingredients: [RECIPE.ingredients[2]] },
      ]);
      await expect(plan()).rejects.toThrow(/ยังไม่ได้ผูกกับสินค้าในคลัง/);
    });
  });
});
