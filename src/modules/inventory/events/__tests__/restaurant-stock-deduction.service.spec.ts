import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../../prisma/prisma.service';
import { IntegrationsService } from '../../../integrations/integrations.service';
import { RestaurantStockDeductionService } from '../restaurant-stock-deduction.service';
import { SourceWarehouseResolver } from '../../warehouses/source-warehouse.resolver';
import { WarehouseIssueService } from '../../warehouses/warehouse-issue.service';
import { RestaurantOrderCompletedEvent } from '../inventory.events';

/**
 * คณิตศาสตร์ของการตัดสต๊อกคลังกลางเมื่อปิดบิลร้านอาหาร
 *
 * สามเรื่องที่ล็อกไว้ที่นี่:
 *   • คลังต้นทางมาจากร้าน (Restaurant.warehouseId) ก่อนเสมอ แล้วค่อยไล่ลำดับสำรอง
 *   • ตัด **เต็มจำนวนที่ขาย** ไม่ clamp — ส่วนที่เกินไปโผล่เป็น shortfallQty และยอดติดลบ
 *   • เมนูที่ผูกสินค้าคลังไว้แล้วห้ามถูกคิดสูตรซ้ำ (ไม่งั้นตัดสองต่อ)
 */
describe('RestaurantStockDeductionService', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prismaMock: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let integrationsMock: any;
  let service: RestaurantStockDeductionService;

  const TENANT_ID = 'tenant-1';

  const makeTxMock = () => ({
    warehouseStock: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn() },
    stockMovement: { create: jest.fn() },
  });

  const baseEvent = (
    items: { menuItemId: string; quantity: number }[] = [{ menuItemId: 'mi-1', quantity: 3 }],
  ): RestaurantOrderCompletedEvent => ({
    orderId: 'ord-1',
    tenantId: TENANT_ID,
    restaurantId: 'rest-1',
    propertyId: 'prop-1',
    items,
    completedBy: 'user-1',
  });

  beforeEach(async () => {
    prismaMock = {
      restaurant: {
        findFirst: jest.fn().mockResolvedValue({ warehouseId: null, propertyId: 'prop-1' }),
      },
      warehouse: { findFirst: jest.fn().mockResolvedValue(null) },
      menuItem: { findMany: jest.fn().mockResolvedValue([]) },
      menuItemRecipe: { findMany: jest.fn().mockResolvedValue([]) },
      warehouseStock: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    integrationsMock = { isEnabled: jest.fn().mockResolvedValue(true) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RestaurantStockDeductionService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: IntegrationsService, useValue: integrationsMock },
        // ตัวจริงบน prisma ปลอม — ลำดับการเลือกคลังคือสิ่งที่สเปกนี้ตรึงไว้
        {
          provide: SourceWarehouseResolver,
          useFactory: () => new SourceWarehouseResolver(prismaMock),
        },
        WarehouseIssueService,
      ],
    }).compile();

    service = module.get(RestaurantStockDeductionService);
  });

  // ─── เลือกคลังต้นทาง ────────────────────────────────────────────────────────

  describe('resolveWarehouseId', () => {
    it('uses the warehouse the outlet picked for itself', async () => {
      prismaMock.restaurant.findFirst.mockResolvedValue({ warehouseId: 'wh-bar', propertyId: 'prop-1' });
      prismaMock.warehouse.findFirst.mockResolvedValue({ id: 'wh-bar' });

      await expect(service.resolveWarehouseId(baseEvent())).resolves.toBe('wh-bar');

      // ถามครั้งเดียว — ไม่ต้องไล่ KITCHEN/default ต่อ
      expect(prismaMock.warehouse.findFirst).toHaveBeenCalledTimes(1);
      expect(prismaMock.warehouse.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'wh-bar', isActive: true, deletedAt: null }),
        }),
      );
    });

    it('falls back down the chain when the chosen warehouse was deactivated', async () => {
      prismaMock.restaurant.findFirst.mockResolvedValue({ warehouseId: 'wh-closed', propertyId: 'prop-1' });
      prismaMock.warehouse.findFirst
        .mockResolvedValueOnce(null) // คลังที่เลือกไว้ปิดไปแล้ว
        .mockResolvedValueOnce({ id: 'wh-kitchen' }); // ตกไปที่ครัว

      await expect(service.resolveWarehouseId(baseEvent())).resolves.toBe('wh-kitchen');
      expect(prismaMock.warehouse.findFirst).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ where: expect.objectContaining({ type: 'KITCHEN' }) }),
      );
    });

    it('walks KITCHEN → isDefault → oldest active when the outlet picked nothing', async () => {
      prismaMock.warehouse.findFirst
        .mockResolvedValueOnce(null) // ไม่มีคลังครัว
        .mockResolvedValueOnce(null) // ไม่มีคลังตั้งต้น
        .mockResolvedValueOnce({ id: 'wh-any' });

      await expect(service.resolveWarehouseId(baseEvent())).resolves.toBe('wh-any');
      expect(prismaMock.warehouse.findFirst).toHaveBeenNthCalledWith(
        3,
        expect.objectContaining({ orderBy: { createdAt: 'asc' } }),
      );
    });

    it('returns null when the property has no warehouse at all', async () => {
      await expect(service.resolveWarehouseId(baseEvent())).resolves.toBeNull();
    });
  });

  // ─── วางแผนว่าจะตัดอะไร ─────────────────────────────────────────────────────

  describe('planDeduction', () => {
    it('plans a 1:1 line for a ready-made item linked to the warehouse', async () => {
      prismaMock.menuItem.findMany.mockResolvedValue([
        {
          id: 'mi-1',
          name: 'น้ำดื่ม 600ml',
          inventoryItemId: 'item-water',
          inventoryItem: { name: 'น้ำดื่มขวดเล็ก' },
        },
      ]);

      prismaMock.warehouse.findFirst.mockResolvedValue({ id: 'wh-kitchen' });

      const lines = await service.planDeduction(baseEvent(), true);

      // บรรทัดพกคลังของตัวเองมาด้วย — ตัวเดียวกับที่ตอนกดสั่งใช้อ่านยอดมากันขายเกิน
      expect(lines).toEqual([
        {
          itemId: 'item-water',
          quantity: 3,
          label: 'น้ำดื่มขวดเล็ก',
          kind: 'retail',
          warehouseId: 'wh-kitchen',
        },
      ]);
      // ผูกคลังแล้ว = ยอดอยู่ที่สินค้าตัวเดียว ไม่ต้องไปคิดสูตรของเมนูนี้อีก
      expect(prismaMock.menuItemRecipe.findMany).not.toHaveBeenCalled();
    });

    it('sums repeated lines of the same menu item into one deduction', async () => {
      prismaMock.menuItem.findMany.mockResolvedValue([
        { id: 'mi-1', name: 'น้ำดื่ม', inventoryItemId: 'item-water', inventoryItem: null },
      ]);

      const lines = await service.planDeduction(
        baseEvent([
          { menuItemId: 'mi-1', quantity: 2 },
          { menuItemId: 'mi-1', quantity: 4 },
        ]),
        false,
      );

      expect(lines).toEqual([
        { itemId: 'item-water', quantity: 6, label: 'น้ำดื่ม', kind: 'retail', warehouseId: null },
      ]);
    });

    it('ตัดจากคลังที่มีของจริง ไม่ใช่คลังตั้งต้นที่ไม่เคยมีของชิ้นนี้', async () => {
      // ของขายหน้าร้านมักกองอยู่คลังร้านขายของ ส่วนคลังครัวมีแต่วัตถุดิบ
      // ถ้ายืนยันจะตัดจากคลังครัวอย่างเดียว คลังที่มีของจริงจะไม่เคยลดเลย
      prismaMock.menuItem.findMany.mockResolvedValue([
        { id: 'mi-1', name: 'โค้ก', inventoryItemId: 'item-coke', inventoryItem: null },
      ]);
      prismaMock.warehouse.findFirst.mockResolvedValue({ id: 'wh-kitchen' });
      prismaMock.warehouseStock.findFirst
        .mockResolvedValueOnce(null) // คลังครัวไม่มีของชิ้นนี้เลย
        .mockResolvedValueOnce({ warehouseId: 'wh-shop' }); // คลังร้านขายของมี

      const lines = await service.planDeduction(baseEvent(), false);

      expect(lines[0].warehouseId).toBe('wh-shop');
    });

    it('plans nothing from recipes when the Hub connection is OFF', async () => {
      const lines = await service.planDeduction(baseEvent(), false);

      expect(lines).toEqual([]);
      expect(prismaMock.menuItemRecipe.findMany).not.toHaveBeenCalled();
    });

    it('scales recipe ingredients by servings, order quantity and wastage', async () => {
      prismaMock.menuItemRecipe.findMany.mockResolvedValue([
        {
          menuItemId: 'mi-1',
          servings: 2, // สูตรนี้ทำได้ 2 จาน
          ingredients: [
            {
              itemId: 'item-noodle',
              name: 'เส้นจันท์',
              quantity: 4, // 4 หน่วยต่อ 2 จาน = 2 ต่อจาน
              wastagePercent: 0,
              item: { name: 'เส้นจันท์แห้ง' },
            },
            {
              itemId: 'item-shrimp',
              name: 'กุ้ง',
              quantity: 2, // 1 ต่อจาน × 3 จาน × 1.10 = 3.3 → ปัดขึ้น 4
              wastagePercent: 10,
              item: null,
            },
          ],
        },
      ]);

      const lines = await service.planDeduction(baseEvent(), true);

      expect(lines).toEqual([
        { itemId: 'item-noodle', quantity: 6, label: 'เส้นจันท์แห้ง', kind: 'recipe' },
        { itemId: 'item-shrimp', quantity: 4, label: 'กุ้ง', kind: 'recipe' },
      ]);
    });

    it('treats a recipe with no servings as one plate per batch', async () => {
      prismaMock.menuItemRecipe.findMany.mockResolvedValue([
        {
          menuItemId: 'mi-1',
          servings: null,
          ingredients: [
            { itemId: 'item-rice', name: 'ข้าว', quantity: 1, wastagePercent: 0, item: null },
          ],
        },
      ]);

      const lines = await service.planDeduction(baseEvent(), true);

      expect(lines).toEqual([
        { itemId: 'item-rice', quantity: 3, label: 'ข้าว', kind: 'recipe' },
      ]);
    });

    it('never plans both a direct link and a recipe for the same menu item', async () => {
      prismaMock.menuItem.findMany.mockResolvedValue([
        { id: 'mi-1', name: 'น้ำดื่ม', inventoryItemId: 'item-water', inventoryItem: null },
      ]);
      prismaMock.menuItemRecipe.findMany.mockResolvedValue([
        {
          menuItemId: 'mi-1',
          servings: 1,
          ingredients: [
            { itemId: 'item-water', name: 'น้ำ', quantity: 1, wastagePercent: 0, item: null },
          ],
        },
      ]);

      const lines = await service.planDeduction(baseEvent(), true);

      expect(lines).toHaveLength(1);
      expect(lines[0].kind).toBe('retail');
    });

    it('ignores lines with no menu item or a non-positive quantity', async () => {
      const lines = await service.planDeduction(
        baseEvent([
          { menuItemId: '', quantity: 5 },
          { menuItemId: 'mi-1', quantity: 0 },
        ]),
        true,
      );

      expect(lines).toEqual([]);
      expect(prismaMock.menuItem.findMany).not.toHaveBeenCalled();
    });
  });

  // ─── ลงมือตัด ───────────────────────────────────────────────────────────────

  describe('applyPlan', () => {
    it('บรรทัดที่รู้คลังของตัวเองต้องชนะคลังตั้งต้นของบิล', async () => {
      const tx = makeTxMock();

      await service.applyPlan(tx as never, baseEvent(), 'wh-kitchen', [
        {
          itemId: 'item-coke',
          quantity: 2,
          label: 'โค้ก',
          kind: 'retail',
          warehouseId: 'wh-shop',
        },
      ]);

      expect(tx.stockMovement.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ warehouseId: 'wh-shop', itemId: 'item-coke' }),
      });
      expect(tx.warehouseStock.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { warehouseId_itemId: { warehouseId: 'wh-shop', itemId: 'item-coke' } },
        }),
      );
    });

    it('writes a GOODS_ISSUE at avg cost and moves the balance down', async () => {
      const tx = makeTxMock();
      tx.warehouseStock.findUnique.mockResolvedValue({ quantity: 24, avgCost: 7 });

      await service.applyPlan(tx as never, baseEvent(), 'wh-1', [
        { itemId: 'item-water', quantity: 3, label: 'น้ำดื่ม', kind: 'retail' },
      ]);

      expect(tx.stockMovement.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: TENANT_ID,
          warehouseId: 'wh-1',
          itemId: 'item-water',
          type: 'GOODS_ISSUE',
          quantity: 3,
          shortfallQty: 0,
          unitCost: 7,
          totalCost: 21,
          referenceType: 'restaurant_order',
          referenceId: 'ord-1',
          createdBy: 'user-1',
        }),
      });
      expect(tx.warehouseStock.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { warehouseId_itemId: { warehouseId: 'wh-1', itemId: 'item-water' } },
          update: { quantity: 21, totalValue: 147 },
        }),
      );
    });

    it('deducts the full sold quantity and records the shortfall instead of clamping', async () => {
      const tx = makeTxMock();
      tx.warehouseStock.findUnique.mockResolvedValue({ quantity: 2, avgCost: 5 });

      await service.applyPlan(tx as never, baseEvent(), 'wh-1', [
        { itemId: 'item-water', quantity: 3, label: 'น้ำดื่ม', kind: 'retail' },
      ]);

      // ของออกจากตู้ไป 3 ขวดจริง ๆ — สมุดต้องบอกว่า 3 ไม่ใช่ 2
      const movement = tx.stockMovement.create.mock.calls[0][0].data;
      expect(movement.quantity).toBe(3);
      expect(movement.shortfallQty).toBe(1);
      expect(movement.notes).toContain('ขายเกินสต๊อก 1');

      // ยอดติดลบคือสัญญาณให้ไปตรวจนับ ไม่ใช่ปัดขึ้นเป็น 0
      expect(tx.warehouseStock.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: { quantity: -1, totalValue: -5 } }),
      );
    });

    it('creates the stock row when the item was sold from a warehouse that never held it', async () => {
      const tx = makeTxMock();
      tx.warehouseStock.findUnique.mockResolvedValue(null);

      await service.applyPlan(tx as never, baseEvent(), 'wh-1', [
        { itemId: 'item-ice', quantity: 2, label: 'ไอติม', kind: 'retail' },
      ]);

      expect(tx.warehouseStock.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: { warehouseId: 'wh-1', itemId: 'item-ice', quantity: -2, avgCost: 0, totalValue: -0 },
        }),
      );
      expect(tx.stockMovement.create.mock.calls[0][0].data.shortfallQty).toBe(2);
    });

    it('issues every planned line', async () => {
      const tx = makeTxMock();

      await service.applyPlan(tx as never, baseEvent(), 'wh-1', [
        { itemId: 'a', quantity: 1, label: 'A', kind: 'recipe' },
        { itemId: 'b', quantity: 2, label: 'B', kind: 'recipe' },
      ]);

      expect(tx.stockMovement.create).toHaveBeenCalledTimes(2);
      expect(tx.warehouseStock.upsert).toHaveBeenCalledTimes(2);
    });
  });

  it('reads the recipe toggle from the Integration Hub', async () => {
    await expect(service.isRecipeDeductionEnabled(TENANT_ID)).resolves.toBe(true);
    expect(integrationsMock.isEnabled).toHaveBeenCalledWith(
      TENANT_ID,
      'restaurant-inventory-autodeduct',
    );
  });
});
