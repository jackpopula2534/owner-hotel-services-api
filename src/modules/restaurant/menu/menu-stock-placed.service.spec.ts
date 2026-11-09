import { Test, TestingModule } from '@nestjs/testing';
import { MenuStockService } from './menu-stock.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AddonService } from '../../addons/addon.service';
import { SourceWarehouseResolver } from '../../inventory/warehouses/source-warehouse.resolver';
import { WarehouseIssueService } from '../../inventory/warehouses/warehouse-issue.service';

/**
 * ตัดสต๊อกตอนสั่ง (ไม่ใช่ตอนปิดบิล)
 *
 * ของสำเร็จรูปถูกหยิบออกจากตู้ตอนพนักงานกดรับออร์เดอร์ บิลโต๊ะหนึ่งเปิดค้างได้เป็นชั่วโมง
 * ถ้ารอปิดบิลค่อยหัก ยอดบนจอกับของในตู้จะไม่ตรงกันตลอดช่วงนั้น
 *
 * เทสต์ชุดนี้ตรึงสี่เรื่องที่พังแล้วเงินหาย:
 *  1. หักครั้งเดียว — ประทับ stockDeductedAt ไว้ ตาข่ายตอนปิดบิลต้องไม่หักซ้ำ
 *  2. หาคลังไม่เจอต้องไม่เดา — ปล่อยไม่ประทับ แล้วให้ตอนปิดบิลรับไป
 *  3. ยกเลิกบรรทัดที่หักแล้วต้องคืนของ และล้างรอยประทับ
 *  4. บรรทัดที่ยังไม่เคยหักต้องไม่ถูกคืน — ของงอกจากอากาศ
 */

const TENANT = 'tenant-1';
const RESTAURANT = 'rest-1';
const ORDER = 'ord-1';

const makePrismaMock = () => ({
  menuItem: { findFirst: jest.fn(), update: jest.fn() },
  menuItemStockMovement: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn() },
  orderItem: { aggregate: jest.fn().mockResolvedValue({ _sum: { quantity: 0 } }) },
  warehouseStock: { findFirst: jest.fn().mockResolvedValue(null) },
  $transaction: jest.fn((ops: any) => (Array.isArray(ops) ? Promise.all(ops) : ops)),
});

const makeTxMock = () => ({
  menuItem: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
  menuItemStockMovement: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn() },
  orderItem: { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn() },
  stockMovement: { create: jest.fn() },
  warehouseStock: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn() },
});

/** เมนูของสำเร็จรูปที่ร้านนับสต๊อกเอง (ไม่ได้ซื้อโมดูลคลัง) */
const localItem = (over: Record<string, unknown> = {}) => ({
  id: 'm1',
  name: 'น้ำดื่ม 600ml',
  trackStock: true,
  stockQty: 10,
  cost: 8,
  inventoryItemId: null,
  restaurantId: RESTAURANT,
  inventoryItem: null,
  ...over,
});

/** เมนูที่ผูกกับสินค้าในคลังกลาง */
const centralItem = (over: Record<string, unknown> = {}) => ({
  id: 'm2',
  name: 'โค้กกระป๋อง',
  trackStock: false,
  stockQty: 0,
  cost: 12,
  inventoryItemId: 'inv-9',
  restaurantId: RESTAURANT,
  inventoryItem: { name: 'Coke 325ml' },
  ...over,
});

describe('MenuStockService — ตัดสต๊อกตอนสั่ง', () => {
  let service: MenuStockService;
  let prisma: ReturnType<typeof makePrismaMock>;
  let addons: { hasActiveAddon: jest.Mock };
  let sourceWarehouse: { resolve: jest.Mock; resolveForItem: jest.Mock };

  beforeEach(async () => {
    prisma = makePrismaMock();
    addons = { hasActiveAddon: jest.fn().mockResolvedValue(false) };
    sourceWarehouse = {
      resolve: jest.fn().mockResolvedValue('wh-1'),
      resolveForItem: jest.fn().mockResolvedValue('wh-1'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MenuStockService,
        { provide: PrismaService, useValue: prisma },
        { provide: AddonService, useValue: addons },
        { provide: SourceWarehouseResolver, useValue: sourceWarehouse },
        WarehouseIssueService,
      ],
    }).compile();

    service = module.get(MenuStockService);
  });

  const deduct = (tx: any, lines: { orderItemId: string; menuItemId: string; quantity: number }[]) =>
    service.deductPlacedLines(tx, {
      tenantId: TENANT,
      restaurantId: RESTAURANT,
      orderId: ORDER,
      lines,
      userId: 'user-1',
    });

  describe('deductPlacedLines — โหมดนับเอง (LOCAL)', () => {
    it('หักยอดในเมนูทันทีที่บรรทัดเข้าบิล พร้อมประทับเวลาไว้ที่บรรทัด', async () => {
      const tx = makeTxMock();
      tx.menuItem.findMany.mockResolvedValue([localItem()]);

      await deduct(tx, [{ orderItemId: 'oi-1', menuItemId: 'm1', quantity: 2 }]);

      expect(tx.menuItem.update).toHaveBeenCalledWith({ where: { id: 'm1' }, data: { stockQty: 8 } });
      expect(tx.menuItemStockMovement.create.mock.calls[0][0].data).toMatchObject({
        type: 'SALE',
        quantity: -2,
        balanceAfter: 8,
        referenceId: ORDER,
      });
      expect(tx.orderItem.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: { in: ['oi-1'] } } }),
      );
      expect(tx.orderItem.updateMany.mock.calls[0][0].data.stockDeductedAt).toBeInstanceOf(Date);
    });

    it('เมนูที่ไม่ได้นับสต๊อกและไม่ผูกคลัง ไม่แตะอะไรและไม่ประทับ', async () => {
      const tx = makeTxMock();
      tx.menuItem.findMany.mockResolvedValue([
        localItem({ trackStock: false, inventoryItemId: null }),
      ]);

      await deduct(tx, [{ orderItemId: 'oi-1', menuItemId: 'm1', quantity: 1 }]);

      expect(tx.menuItem.update).not.toHaveBeenCalled();
      expect(tx.orderItem.updateMany).not.toHaveBeenCalled();
    });

    it('ยิงบรรทัดเดิมซ้ำสองครั้งหักสองรอบไม่ได้ — ตาข่ายตอนปิดบิลต้องมองข้ามบรรทัดที่ประทับแล้ว', async () => {
      const tx = makeTxMock();
      tx.menuItem.findMany.mockResolvedValue([localItem()]);
      tx.orderItem.findMany.mockResolvedValue([{ id: 'oi-1' }]); // ประทับแล้วจากตอนสั่ง

      await service.deductForOrder(tx as any, {
        tenantId: TENANT,
        orderId: ORDER,
        items: [{ orderItemId: 'oi-1', menuItemId: 'm1', quantity: 2 }],
      });

      expect(tx.menuItem.update).not.toHaveBeenCalled();
      expect(tx.menuItemStockMovement.create).not.toHaveBeenCalled();
    });
  });

  describe('deductPlacedLines — โหมดคลังกลาง (CENTRAL)', () => {
    beforeEach(() => addons.hasActiveAddon.mockResolvedValue(true));

    it('เขียนใบเบิกออกจากคลังใบเดียวกับที่ตอนกันขายเกินไปอ่านยอดมา', async () => {
      const tx = makeTxMock();
      tx.menuItem.findMany.mockResolvedValue([centralItem()]);
      tx.warehouseStock.findUnique.mockResolvedValue({ quantity: 24, avgCost: 10 });

      await deduct(tx, [{ orderItemId: 'oi-2', menuItemId: 'm2', quantity: 3 }]);

      expect(sourceWarehouse.resolveForItem).toHaveBeenCalledWith(TENANT, RESTAURANT, 'inv-9');
      expect(tx.stockMovement.create.mock.calls[0][0].data).toMatchObject({
        warehouseId: 'wh-1',
        itemId: 'inv-9',
        type: 'GOODS_ISSUE',
        quantity: 3,
        shortfallQty: 0,
        referenceType: 'restaurant_order',
        referenceId: ORDER,
      });
      expect(tx.warehouseStock.upsert).toHaveBeenCalled();
      expect(tx.orderItem.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: { in: ['oi-2'] } } }),
      );
    });

    it('ขายเกินของในคลังบันทึกยอดติดลบพร้อมส่วนต่าง ไม่ตัดแค่เท่าที่มี', async () => {
      const tx = makeTxMock();
      tx.menuItem.findMany.mockResolvedValue([centralItem()]);
      tx.warehouseStock.findUnique.mockResolvedValue({ quantity: 1, avgCost: 10 });

      await deduct(tx, [{ orderItemId: 'oi-2', menuItemId: 'm2', quantity: 4 }]);

      expect(tx.stockMovement.create.mock.calls[0][0].data).toMatchObject({
        quantity: 4,
        shortfallQty: 3,
      });
    });

    it('หาคลังต้นทางไม่เจอ → ไม่เดาคลัง ไม่ประทับ ปล่อยให้ตอนปิดบิลรับไปหัก', async () => {
      const tx = makeTxMock();
      tx.menuItem.findMany.mockResolvedValue([centralItem()]);
      sourceWarehouse.resolveForItem.mockResolvedValue(null);

      await deduct(tx, [{ orderItemId: 'oi-2', menuItemId: 'm2', quantity: 1 }]);

      expect(tx.stockMovement.create).not.toHaveBeenCalled();
      expect(tx.orderItem.updateMany).not.toHaveBeenCalled();
    });

    it('อ่านคลังพังต้องไม่ลามเป็นเปิดบิลไม่ได้ — ข้ามบรรทัดนั้นเงียบ ๆ', async () => {
      const tx = makeTxMock();
      tx.menuItem.findMany.mockResolvedValue([centralItem()]);
      sourceWarehouse.resolveForItem.mockRejectedValue(new Error('inventory down'));

      await expect(
        deduct(tx, [{ orderItemId: 'oi-2', menuItemId: 'm2', quantity: 1 }]),
      ).resolves.toBeUndefined();
      expect(tx.stockMovement.create).not.toHaveBeenCalled();
      expect(tx.orderItem.updateMany).not.toHaveBeenCalled();
    });

    it('สิทธิ์คลังหมดอายุ → UNTRACKED ห้ามไปแตะยอดในคลัง', async () => {
      addons.hasActiveAddon.mockResolvedValue(false);
      const tx = makeTxMock();
      tx.menuItem.findMany.mockResolvedValue([centralItem()]);

      await deduct(tx, [{ orderItemId: 'oi-2', menuItemId: 'm2', quantity: 1 }]);

      expect(tx.stockMovement.create).not.toHaveBeenCalled();
      expect(tx.orderItem.updateMany).not.toHaveBeenCalled();
    });

    it('รวมบรรทัดเมนูเดียวกันเป็นใบเบิกใบเดียว', async () => {
      const tx = makeTxMock();
      tx.menuItem.findMany.mockResolvedValue([centralItem()]);
      tx.warehouseStock.findUnique.mockResolvedValue({ quantity: 24, avgCost: 10 });

      await deduct(tx, [
        { orderItemId: 'oi-2', menuItemId: 'm2', quantity: 1 },
        { orderItemId: 'oi-3', menuItemId: 'm2', quantity: 2 },
      ]);

      expect(tx.stockMovement.create).toHaveBeenCalledTimes(1);
      expect(tx.stockMovement.create.mock.calls[0][0].data.quantity).toBe(3);
      expect(tx.orderItem.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: { in: ['oi-2', 'oi-3'] } } }),
      );
    });
  });

  describe('returnPlacedLines — ยกเลิกบรรทัดที่หักไปแล้ว', () => {
    const returnLines = (tx: any, orderItemIds?: string[]) =>
      service.returnPlacedLines(tx, {
        tenantId: TENANT,
        restaurantId: RESTAURANT,
        orderId: ORDER,
        orderItemIds,
        userId: 'user-1',
      });

    it('คืนยอดเข้าเมนูโหมดนับเอง พร้อมล้างรอยประทับ', async () => {
      const tx = makeTxMock();
      tx.orderItem.findMany.mockResolvedValue([{ id: 'oi-1', menuItemId: 'm1', quantity: 2 }]);
      tx.menuItem.findMany.mockResolvedValue([localItem({ stockQty: 8 })]);

      await returnLines(tx, ['oi-1']);

      expect(tx.menuItem.update).toHaveBeenCalledWith({ where: { id: 'm1' }, data: { stockQty: 10 } });
      expect(tx.menuItemStockMovement.create.mock.calls[0][0].data).toMatchObject({
        type: 'RETURN',
        quantity: 2,
        balanceAfter: 10,
      });
      expect(tx.orderItem.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['oi-1'] } },
        data: { stockDeductedAt: null },
      });
    });

    it('คืนของเข้าคลังกลางเป็นรายการรับเข้า ไม่ใช่ลบใบเบิกทิ้ง', async () => {
      addons.hasActiveAddon.mockResolvedValue(true);
      const tx = makeTxMock();
      tx.orderItem.findMany.mockResolvedValue([{ id: 'oi-2', menuItemId: 'm2', quantity: 3 }]);
      tx.menuItem.findMany.mockResolvedValue([centralItem()]);
      tx.warehouseStock.findUnique.mockResolvedValue({ quantity: 21, avgCost: 10 });

      await returnLines(tx, ['oi-2']);

      expect(tx.stockMovement.create.mock.calls[0][0].data).toMatchObject({
        warehouseId: 'wh-1',
        itemId: 'inv-9',
        type: 'ADJUSTMENT_IN',
        quantity: 3,
      });
      expect(tx.warehouseStock.upsert).toHaveBeenCalled();
    });

    it('บรรทัดที่ยังไม่เคยถูกหักต้องไม่ถูกคืน — ไม่งั้นของงอกจากอากาศ', async () => {
      const tx = makeTxMock();
      tx.orderItem.findMany.mockResolvedValue([]); // ไม่มีบรรทัดที่ประทับไว้เลย

      await returnLines(tx);

      expect(tx.menuItem.update).not.toHaveBeenCalled();
      expect(tx.menuItemStockMovement.create).not.toHaveBeenCalled();
      expect(tx.stockMovement.create).not.toHaveBeenCalled();
      expect(tx.orderItem.updateMany).not.toHaveBeenCalled();
    });

    it('ยกเลิกทั้งบิลไม่ต้องระบุรายบรรทัด — คืนทุกบรรทัดที่ประทับไว้ของบิลนั้น', async () => {
      const tx = makeTxMock();
      tx.orderItem.findMany.mockResolvedValue([{ id: 'oi-1', menuItemId: 'm1', quantity: 1 }]);
      tx.menuItem.findMany.mockResolvedValue([localItem({ stockQty: 9 })]);

      await returnLines(tx);

      expect(tx.orderItem.findMany.mock.calls[0][0].where).toMatchObject({
        orderId: ORDER,
        stockDeductedAt: { not: null },
      });
      expect(tx.orderItem.findMany.mock.calls[0][0].where.id).toBeUndefined();
      expect(tx.menuItem.update).toHaveBeenCalledWith({ where: { id: 'm1' }, data: { stockQty: 10 } });
    });
  });

  describe('การกันขายเกิน ต้องไม่นับของที่หักไปแล้วซ้ำ', () => {
    it('ยอดที่ค้างในบิล นับเฉพาะบรรทัดที่ยังไม่ถูกหัก', async () => {
      prisma.menuItem.findFirst.mockResolvedValue({
        id: 'm1',
        name: 'น้ำดื่ม 600ml',
        trackStock: true,
        stockQty: 5,
        inventoryItemId: null,
        restaurantId: RESTAURANT,
      });

      await service.assertCanSell(TENANT, 'm1', 1);

      expect(prisma.orderItem.aggregate.mock.calls[0][0].where).toMatchObject({
        stockDeductedAt: null,
      });
    });
  });
});
