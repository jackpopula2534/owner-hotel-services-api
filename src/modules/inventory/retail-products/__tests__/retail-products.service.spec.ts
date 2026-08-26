import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { RetailProductsService } from '../retail-products.service';

/**
 * หน้า "สินค้าหน้าร้าน" — ตัวเลขที่คนตั้งราคาใช้ตัดสินใจ
 *
 * จุดที่พลาดง่ายที่สุดคือต้นทุนเฉลี่ย: ต้องถ่วงด้วยจำนวนของแต่ละคลัง
 * ไม่ใช่เอาค่าเฉลี่ยของคลังมาเฉลี่ยกันอีกที (คลังที่มีของ 1 ชิ้นจะดันต้นทุนทั้งใบ)
 */
describe('RetailProductsService', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prismaMock: any;
  let service: RetailProductsService;

  const TENANT_ID = 'tenant-1';

  const product = (over: Record<string, unknown> = {}) => ({
    id: 'item-water',
    sku: 'RTL-202608-0001',
    name: 'น้ำดื่ม 600ml',
    unit: 'BOTTLE',
    imageUrl: null,
    isActive: true,
    categoryId: 'cat-1',
    sellingPrice: 20,
    category: { name: 'เครื่องดื่ม' },
    warehouseStocks: [],
    menuItems: [],
    ...over,
  });

  beforeEach(async () => {
    prismaMock = {
      inventoryItem: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([product()]),
        findFirst: jest.fn(),
      },
      menuCategory: { findFirst: jest.fn().mockResolvedValue({ id: 'cat-1' }) },
      menuItem: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }) => ({ id: 'menu-new', ...data })),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [RetailProductsService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();

    service = module.get(RetailProductsService);
  });

  describe('findAll', () => {
    it('only ever looks at finished goods', async () => {
      await service.findAll(TENANT_ID, {});

      expect(prismaMock.inventoryItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: TENANT_ID,
            deletedAt: null,
            itemType: 'FINISHED_GOOD',
          }),
        }),
      );
    });

    it('weights average cost by quantity across warehouses', async () => {
      prismaMock.inventoryItem.findMany.mockResolvedValue([
        product({
          warehouseStocks: [
            { warehouseId: 'wh-1', quantity: 90, avgCost: 6, warehouse: { name: 'คลังครัว' } },
            { warehouseId: 'wh-2', quantity: 10, avgCost: 16, warehouse: { name: 'คลังบาร์' } },
          ],
        }),
      ]);

      const { data } = await service.findAll(TENANT_ID, {});

      // (90×6 + 10×16) / 100 = 7 — ไม่ใช่ (6+16)/2 = 11
      expect(data[0].avgCost).toBe(7);
      expect(data[0].totalQty).toBe(100);
      expect(data[0].stockValue).toBe(700);
      expect(data[0].marginPerUnit).toBe(13);
      expect(data[0].marginPercent).toBe(65);
    });

    it('reports no margin when the cost or the price is unknown', async () => {
      prismaMock.inventoryItem.findMany.mockResolvedValue([
        product({ sellingPrice: null, warehouseStocks: [] }),
      ]);

      const { data } = await service.findAll(TENANT_ID, {});

      expect(data[0].avgCost).toBeNull();
      expect(data[0].sellingPrice).toBeNull();
      expect(data[0].marginPerUnit).toBeNull();
      expect(data[0].marginPercent).toBeNull();
    });

    it('lists the menus each product is already sold as', async () => {
      prismaMock.inventoryItem.findMany.mockResolvedValue([
        product({
          menuItems: [{ id: 'm1', name: 'น้ำเปล่า', restaurantId: 'rest-1', price: 25 }],
        }),
      ]);

      const { data } = await service.findAll(TENANT_ID, {});

      expect(data[0].linkedMenuCount).toBe(1);
      expect(data[0].linkedMenus[0]).toEqual({
        id: 'm1',
        name: 'น้ำเปล่า',
        restaurantId: 'rest-1',
        price: 25,
      });
    });

    it('narrows to one warehouse when asked', async () => {
      await service.findAll(TENANT_ID, { warehouseId: 'wh-2' });

      const select = prismaMock.inventoryItem.findMany.mock.calls[0][0].select;
      expect(select.warehouseStocks.where).toEqual({ warehouseId: 'wh-2' });
    });

    it('filters to products not yet sold anywhere', async () => {
      await service.findAll(TENANT_ID, { unlinkedOnly: 'true', unpricedOnly: 'true' });

      const where = prismaMock.inventoryItem.findMany.mock.calls[0][0].where;
      expect(where.menuItems).toEqual({ none: {} });
      expect(where.sellingPrice).toBeNull();
    });
  });

  describe('summary', () => {
    it('counts oversold products apart from products that merely ran out', async () => {
      prismaMock.inventoryItem.findMany.mockResolvedValue([
        {
          sellingPrice: 20,
          warehouseStocks: [{ quantity: -3, avgCost: 6 }],
          _count: { menuItems: 1 },
        },
        {
          sellingPrice: null,
          warehouseStocks: [{ quantity: 0, avgCost: 0 }],
          _count: { menuItems: 0 },
        },
        {
          sellingPrice: 15,
          warehouseStocks: [{ quantity: 10, avgCost: 5 }],
          _count: { menuItems: 2 },
        },
      ]);

      await expect(service.summary(TENANT_ID)).resolves.toEqual({
        totalProducts: 3,
        linkedProducts: 2,
        unlinkedProducts: 1,
        unpricedProducts: 1,
        outOfStock: 1,
        negativeStock: 1,
        stockValue: 32, // (-3×6) + 0 + (10×5)
      });
    });
  });

  describe('createMenuItem', () => {
    beforeEach(() => {
      prismaMock.inventoryItem.findFirst.mockResolvedValue({
        id: 'item-water',
        name: 'น้ำดื่ม 600ml',
        itemType: 'FINISHED_GOOD',
        sellingPrice: 20,
        warehouseStocks: [
          { quantity: 100, avgCost: 6 },
          { quantity: 50, avgCost: 9 },
        ],
      });
    });

    it('creates a READY_MADE menu linked 1:1 and never counting its own stock', async () => {
      const created = await service.createMenuItem(TENANT_ID, 'item-water', {
        restaurantId: 'rest-1',
        categoryId: 'cat-1',
      });

      expect(created).toEqual(
        expect.objectContaining({
          name: 'น้ำดื่ม 600ml',
          price: 20,
          itemKind: 'READY_MADE',
          inventoryItemId: 'item-water',
          trackStock: false,
        }),
      );
    });

    it('lets the caller override the price and the name', async () => {
      const created = await service.createMenuItem(TENANT_ID, 'item-water', {
        restaurantId: 'rest-1',
        categoryId: 'cat-1',
        name: 'น้ำเปล่าเย็น',
        price: 25,
      });

      expect(created).toEqual(expect.objectContaining({ name: 'น้ำเปล่าเย็น', price: 25 }));
    });

    it('appends to the end of the category instead of colliding at 0', async () => {
      prismaMock.menuItem.findFirst
        .mockResolvedValueOnce(null) // ยังไม่มีเมนูที่ผูกสินค้าตัวนี้
        .mockResolvedValueOnce({ displayOrder: 4 });

      const created = await service.createMenuItem(TENANT_ID, 'item-water', {
        restaurantId: 'rest-1',
        categoryId: 'cat-1',
      });

      expect(created).toEqual(expect.objectContaining({ displayOrder: 5 }));
    });

    it('ต้นทุนติดไปกับเมนูตั้งแต่แรก ถัวเฉลี่ยข้ามคลังตามจำนวน', async () => {
      const created = await service.createMenuItem(TENANT_ID, 'item-water', {
        restaurantId: 'rest-1',
        categoryId: 'cat-1',
      });

      // (100×6 + 50×9) / 150 = 7
      expect(created).toEqual(expect.objectContaining({ cost: 7 }));
    });

    it('ไม่มีของในคลังก็ไม่เดาต้นทุน — ปล่อยเป็น null ดีกว่าใส่ 0 ให้กำไรอ่านเป็น 100%', async () => {
      prismaMock.inventoryItem.findFirst.mockResolvedValue({
        id: 'item-water',
        name: 'น้ำดื่ม 600ml',
        itemType: 'FINISHED_GOOD',
        sellingPrice: 20,
        warehouseStocks: [],
      });

      const created = await service.createMenuItem(TENANT_ID, 'item-water', {
        restaurantId: 'rest-1',
        categoryId: 'cat-1',
      });

      expect(created).toEqual(expect.objectContaining({ cost: null }));
    });

    it('refuses a raw material — it has no business on the menu', async () => {
      prismaMock.inventoryItem.findFirst.mockResolvedValue({
        id: 'item-flour',
        name: 'แป้ง',
        itemType: 'RAW_MATERIAL',
        sellingPrice: null,
        warehouseStocks: [],
      });

      await expect(
        service.createMenuItem(TENANT_ID, 'item-flour', {
          restaurantId: 'rest-1',
          categoryId: 'cat-1',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses when nothing supplies a price', async () => {
      prismaMock.inventoryItem.findFirst.mockResolvedValue({
        id: 'item-water',
        name: 'น้ำดื่ม',
        itemType: 'FINISHED_GOOD',
        sellingPrice: null,
      });

      await expect(
        service.createMenuItem(TENANT_ID, 'item-water', {
          restaurantId: 'rest-1',
          categoryId: 'cat-1',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses a category that belongs to a different restaurant', async () => {
      prismaMock.menuCategory.findFirst.mockResolvedValue(null);

      await expect(
        service.createMenuItem(TENANT_ID, 'item-water', {
          restaurantId: 'rest-1',
          categoryId: 'cat-other',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses a second menu for the same product in the same restaurant', async () => {
      prismaMock.menuItem.findFirst.mockResolvedValue({ id: 'menu-existing' });

      await expect(
        service.createMenuItem(TENANT_ID, 'item-water', {
          restaurantId: 'rest-1',
          categoryId: 'cat-1',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('404s on a product from another tenant', async () => {
      prismaMock.inventoryItem.findFirst.mockResolvedValue(null);

      await expect(
        service.createMenuItem(TENANT_ID, 'item-x', {
          restaurantId: 'rest-1',
          categoryId: 'cat-1',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
