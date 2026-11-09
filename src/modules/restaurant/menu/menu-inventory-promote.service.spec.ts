import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AddonService } from '../../addons/addon.service';
import { MenuInventoryPromoteService } from './menu-inventory-promote.service';
import { SourceWarehouseResolver } from '../../inventory/warehouses/source-warehouse.resolver';

/**
 * "ย้ายเข้าคลังกลาง" — ทางเดียวจากสต๊อกในเมนู ไปเป็นสต๊อกที่คลังเป็นเจ้าของ
 *
 * สิ่งที่ห้ามพลาด: ของที่ค้างอยู่ในเมนูต้องโผล่ที่คลังในรายการเดียวกับที่เมนูถูกปิดนับ
 * ไม่งั้นจะมีช่วงที่ของหายจากทั้งสองที่ หรือถูกนับซ้ำสองที่
 */
describe('MenuInventoryPromoteService', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prismaMock: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let addonMock: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let tx: any;
  let service: MenuInventoryPromoteService;

  const TENANT_ID = 'tenant-1';
  const REST_ID = 'rest-1';
  const ITEM_ID = 'mi-1';

  const menuItem = (over: Record<string, unknown> = {}) => ({
    id: ITEM_ID,
    name: 'น้ำดื่ม 600ml',
    price: 20,
    cost: 6,
    trackStock: true,
    stockQty: 12,
    inventoryItemId: null,
    ...over,
  });

  beforeEach(async () => {
    tx = {
      documentSequence: { upsert: jest.fn().mockResolvedValue({ lastNumber: 7 }) },
      inventoryItem: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }) => ({ id: 'item-new', ...data })),
      },
      stockMovement: { create: jest.fn() },
      warehouseStock: { upsert: jest.fn(), update: jest.fn() },
      menuItemStockMovement: { create: jest.fn() },
      menuItem: { update: jest.fn() },
    };

    prismaMock = {
      menuItem: {
        findFirst: jest.fn().mockResolvedValue(menuItem()),
        count: jest.fn().mockResolvedValue(0),
      },
      restaurant: {
        findFirst: jest.fn().mockResolvedValue({ propertyId: 'prop-1', warehouseId: null }),
      },
      warehouse: { findFirst: jest.fn().mockResolvedValue({ id: 'wh-kitchen' }) },
      warehouseStock: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ quantity: 12, reservedQty: 0, totalValue: 72, avgCost: 6 }),
      },
      itemCategory: { findFirst: jest.fn().mockResolvedValue({ id: 'cat-1' }) },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      $transaction: jest.fn((cb: (client: any) => unknown) => cb(tx)),
    };
    addonMock = { hasActiveAddon: jest.fn().mockResolvedValue(true) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MenuInventoryPromoteService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: AddonService, useValue: addonMock },
        // ตัวจริงบน prisma ปลอม — ลำดับการเลือกคลังต้องถูกทดสอบด้วย ไม่ใช่ mock ทิ้ง
        {
          provide: SourceWarehouseResolver,
          useFactory: () => new SourceWarehouseResolver(prismaMock),
        },
      ],
    }).compile();

    service = module.get(MenuInventoryPromoteService);
  });

  it('creates a FINISHED_GOOD carrying the menu price as its selling price', async () => {
    const result = await service.promote(REST_ID, ITEM_ID, {}, TENANT_ID, 'user-1');

    expect(tx.inventoryItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: TENANT_ID,
        name: 'น้ำดื่ม 600ml',
        itemType: 'FINISHED_GOOD',
        sellingPrice: 20,
        unit: 'PIECE',
      }),
    });
    expect(result).toEqual({
      inventoryItemId: 'item-new',
      sku: expect.stringMatching(/^RTL-\d{6}-0007$/),
      warehouseId: 'wh-kitchen',
      movedQty: 12,
      mode: 'CENTRAL',
    });
  });

  it('carries the leftover quantity across as a receipt at the menu cost', async () => {
    await service.promote(REST_ID, ITEM_ID, {}, TENANT_ID, 'user-1');

    expect(tx.stockMovement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'GOODS_RECEIVE',
        quantity: 12,
        unitCost: 6,
        totalCost: 72,
        referenceType: 'menu_promotion',
        referenceId: ITEM_ID,
      }),
    });
    expect(tx.warehouseStock.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ quantity: 12, avgCost: 6, totalValue: 72 }),
      }),
    );
  });

  it('closes the menu-side ledger with an ADJUST to zero instead of deleting history', async () => {
    await service.promote(REST_ID, ITEM_ID, {}, TENANT_ID, 'user-1');

    expect(tx.menuItemStockMovement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ type: 'ADJUST', quantity: -12, balanceAfter: 0 }),
    });
    expect(tx.menuItem.update).toHaveBeenCalledWith({
      where: { id: ITEM_ID },
      data: { inventoryItemId: 'item-new', trackStock: false, stockQty: 0 },
    });
  });

  it('promotes a menu item that never counted stock without writing any movement', async () => {
    prismaMock.menuItem.findFirst.mockResolvedValue(
      menuItem({ trackStock: false, stockQty: 0 }),
    );

    const result = await service.promote(REST_ID, ITEM_ID, {}, TENANT_ID);

    expect(result.movedQty).toBe(0);
    expect(tx.stockMovement.create).not.toHaveBeenCalled();
    expect(tx.menuItemStockMovement.create).not.toHaveBeenCalled();
    expect(tx.menuItem.update).toHaveBeenCalled();
  });

  it('does everything inside one transaction', async () => {
    await service.promote(REST_ID, ITEM_ID, {}, TENANT_ID);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });

  it('prefers the warehouse the outlet picked over the kitchen', async () => {
    prismaMock.restaurant.findFirst.mockResolvedValue({
      propertyId: 'prop-1',
      warehouseId: 'wh-bar',
    });
    prismaMock.warehouse.findFirst.mockResolvedValue({ id: 'wh-bar' });

    const result = await service.promote(REST_ID, ITEM_ID, {}, TENANT_ID);

    expect(result.warehouseId).toBe('wh-bar');
    expect(prismaMock.warehouse.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'wh-bar' }) }),
    );
  });

  it('uses the caller-supplied SKU verbatim when one is given', async () => {
    const result = await service.promote(REST_ID, ITEM_ID, { sku: ' WATER-600 ' }, TENANT_ID);

    expect(result.sku).toBe('WATER-600');
    expect(tx.documentSequence.upsert).not.toHaveBeenCalled();
  });

  it('rejects a SKU already used by another item in the tenant', async () => {
    tx.inventoryItem.findFirst.mockResolvedValue({ id: 'item-existing' });

    await expect(
      service.promote(REST_ID, ITEM_ID, { sku: 'WATER-600' }, TENANT_ID),
    ).rejects.toThrow(ConflictException);
  });

  it('refuses a menu item that is already linked to the warehouse', async () => {
    prismaMock.menuItem.findFirst.mockResolvedValue(menuItem({ inventoryItemId: 'item-x' }));

    await expect(service.promote(REST_ID, ITEM_ID, {}, TENANT_ID)).rejects.toThrow(
      ConflictException,
    );
  });

  it('refuses when the tenant has no INVENTORY_MODULE', async () => {
    addonMock.hasActiveAddon.mockResolvedValue(false);

    await expect(service.promote(REST_ID, ITEM_ID, {}, TENANT_ID)).rejects.toThrow(
      BadRequestException,
    );
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('refuses when the tenant has no usable warehouse yet', async () => {
    prismaMock.warehouse.findFirst.mockResolvedValue(null);

    await expect(service.promote(REST_ID, ITEM_ID, {}, TENANT_ID)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('404s on a menu item from another restaurant or tenant', async () => {
    prismaMock.menuItem.findFirst.mockResolvedValue(null);

    await expect(service.promote(REST_ID, ITEM_ID, {}, TENANT_ID)).rejects.toThrow(
      NotFoundException,
    );
  });
  // ─── ทางกลับ: คลังกลาง → นับในเมนู ─────────────────────────────────────────
  //
  // เดิมมีแต่ขาขึ้น ขาลงเป็นการล้าง inventoryItemId ทิ้งเฉย ๆ ของค้างอยู่ในคลัง
  // ส่วนเมนูเงียบ ๆ กลายเป็นขายไม่จำกัด
  describe('demote', () => {
    const linked = (over: Record<string, unknown> = {}) => ({
      id: ITEM_ID,
      name: 'น้ำดื่ม 600ml',
      cost: 6,
      inventoryItemId: 'item-water',
      ...over,
    });

    beforeEach(() => {
      prismaMock.menuItem.findFirst.mockResolvedValue(linked());
    });

    it('ดึงของกลับมาเป็นยอดของเมนู แล้วเปิดนับให้ทันที', async () => {
      const result = await service.demote(REST_ID, ITEM_ID, {}, TENANT_ID, 'user-1');

      expect(result).toMatchObject({ movedQty: 12, mode: 'LOCAL', warehouseId: 'wh-kitchen' });
      expect(tx.menuItem.update).toHaveBeenCalledWith({
        where: { id: ITEM_ID },
        data: { inventoryItemId: null, trackStock: true, stockQty: 12 },
      });
    });

    it('เบิกออกจากคลังด้วยใบเบิกจริง ไม่ใช่แก้ยอดเงียบ ๆ', async () => {
      await service.demote(REST_ID, ITEM_ID, {}, TENANT_ID, 'user-1');

      expect(tx.stockMovement.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          warehouseId: 'wh-kitchen',
          itemId: 'item-water',
          type: 'GOODS_ISSUE',
          quantity: 12,
          referenceType: 'menu_demotion',
        }),
      });
      expect(tx.warehouseStock.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { warehouseId_itemId: { warehouseId: 'wh-kitchen', itemId: 'item-water' } },
        }),
      );
    });

    it('เปิดสมุดฝั่งเมนูด้วย OPENING เท่ายอดที่รับกลับมา', async () => {
      await service.demote(REST_ID, ITEM_ID, {}, TENANT_ID, 'user-1');

      expect(tx.menuItemStockMovement.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ type: 'OPENING', quantity: 12, balanceAfter: 12 }),
      });
    });

    // ช่อง cost ของเมนูตามจริงแทบไม่มีใครกรอก — ยึดตามนั้นแล้วของออกจากคลัง
    // แต่ยอดเงินไม่ลด คลังจะเหลือของน้อยลงโดยมูลค่าเท่าเดิม
    it('หักมูลค่าตามที่คลังตีไว้เอง ไม่ใช่ต้นทุนที่ตั้งในเมนู', async () => {
      await service.demote(REST_ID, ITEM_ID, { quantity: 5 }, TENANT_ID, 'user-1');

      expect(tx.warehouseStock.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { quantity: { decrement: 5 }, totalValue: { decrement: 30 } },
        }),
      );
    });

    it('ดึงออกหมดต้องหักมูลค่าที่ค้างอยู่ทั้งก้อน ไม่ใช่คูณกลับแล้วเหลือเศษ', async () => {
      prismaMock.warehouseStock.findFirst.mockResolvedValue({
        quantity: 3,
        reservedQty: 0,
        totalValue: 20,
        avgCost: 6,
      });

      await service.demote(REST_ID, ITEM_ID, {}, TENANT_ID, 'user-1');

      expect(tx.warehouseStock.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { quantity: { decrement: 3 }, totalValue: { decrement: 20 } },
        }),
      );
    });

    it('ของที่คลังกันไว้ให้งานอื่นดึงกลับมาไม่ได้', async () => {
      prismaMock.warehouseStock.findFirst.mockResolvedValue({
        quantity: 12,
        reservedQty: 5,
        totalValue: 72,
        avgCost: 6,
      });

      const result = await service.demote(REST_ID, ITEM_ID, {}, TENANT_ID, 'user-1');

      expect(result.movedQty).toBe(7);
    });

    it('ดึงเกินของที่มีไม่ได้ — กดปุ่มเดียวห้ามทำคลังติดลบ', async () => {
      await expect(
        service.demote(REST_ID, ITEM_ID, { quantity: 99 }, TENANT_ID, 'user-1'),
      ).rejects.toThrow(BadRequestException);
      expect(tx.menuItem.update).not.toHaveBeenCalled();
    });

    it('มีเมนูอื่นผูกสินค้าตัวเดียวกันอยู่ ต้องให้คนระบุจำนวนเอง', async () => {
      prismaMock.menuItem.count.mockResolvedValue(2);

      await expect(service.demote(REST_ID, ITEM_ID, {}, TENANT_ID, 'user-1')).rejects.toThrow(
        /ระบุจำนวน/,
      );

      // ระบุมาเองแล้วทำได้ตามปกติ
      await expect(
        service.demote(REST_ID, ITEM_ID, { quantity: 4 }, TENANT_ID, 'user-1'),
      ).resolves.toMatchObject({ movedQty: 4 });
    });

    it('returnStock=false ตัดสายอย่างเดียว ของยังอยู่ในคลัง', async () => {
      const result = await service.demote(
        REST_ID,
        ITEM_ID,
        { returnStock: false },
        TENANT_ID,
        'user-1',
      );

      expect(result).toMatchObject({ movedQty: 0, mode: 'UNTRACKED' });
      expect(tx.stockMovement.create).not.toHaveBeenCalled();
      expect(tx.menuItem.update).toHaveBeenCalledWith({
        where: { id: ITEM_ID },
        data: { inventoryItemId: null, trackStock: false, stockQty: 0 },
      });
    });

    it('สิทธิ์คลังหมดอายุก็ยังถอดออกได้ — ห้ามขังเมนูไว้ในโหมดที่ออกไม่ได้', async () => {
      addonMock.hasActiveAddon.mockResolvedValue(false);

      await expect(service.demote(REST_ID, ITEM_ID, {}, TENANT_ID, 'user-1')).resolves.toMatchObject(
        { mode: 'LOCAL' },
      );
    });

    it('เมนูที่ไม่ได้ผูกคลังอยู่แล้วถอดซ้ำไม่ได้', async () => {
      prismaMock.menuItem.findFirst.mockResolvedValue(linked({ inventoryItemId: null }));

      await expect(service.demote(REST_ID, ITEM_ID, {}, TENANT_ID, 'user-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('404 เมนูของร้านอื่นหรือ tenant อื่น', async () => {
      prismaMock.menuItem.findFirst.mockResolvedValue(null);

      await expect(service.demote(REST_ID, ITEM_ID, {}, TENANT_ID, 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
