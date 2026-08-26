import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { MenuStockService, resolveStockMode } from './menu-stock.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AddonService } from '../../addons/addon.service';
import { SourceWarehouseResolver } from '../../inventory/warehouses/source-warehouse.resolver';
import { WarehouseIssueService } from '../../inventory/warehouses/warehouse-issue.service';

/**
 * สต๊อกของเมนูสำเร็จรูปที่ร้านนับเอง (ไม่ได้ซื้อโมดูลคลัง)
 *
 * เทสต์ชุดนี้ตรึงสามเรื่องที่พังแล้วเจ็บ:
 *  1. สิทธิ์คลังหมดอายุต้องไม่ทำให้ขายของไม่ได้ (UNTRACKED ไม่ใช่ LOCAL)
 *  2. ปิดบิลสองทาง (จ่ายเงิน / เปลี่ยนสถานะ) ต้องตัดสต๊อกครั้งเดียว
 *  3. ADJUST คือ "ยอดที่นับได้" ไม่ใช่ส่วนต่าง — คิดผิดคือสต๊อกเพี้ยนทั้งร้าน
 */

const TENANT = 'tenant-1';
const RESTAURANT = 'rest-1';

const makePrismaMock = () => ({
  menuItem: {
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  menuItemStockMovement: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
  },
  orderItem: {
    aggregate: jest.fn().mockResolvedValue({ _sum: { quantity: 0 } }),
  },
  warehouseStock: {
    findFirst: jest.fn().mockResolvedValue(null),
  },
  $transaction: jest.fn((ops: any) => (Array.isArray(ops) ? Promise.all(ops) : ops)),
});

/** transaction client ปลอมสำหรับ deductForOrder — บันทึกทุกการเขียนไว้ให้ตรวจ */
const makeTxMock = () => ({
  menuItem: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
  menuItemStockMovement: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn() },
  orderItem: { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn() },
});

describe('resolveStockMode', () => {
  it('ผูกคลัง + มีสิทธิ์ = CENTRAL', () => {
    expect(resolveStockMode({ inventoryItemId: 'inv-1' }, true)).toBe('CENTRAL');
  });

  it('ผูกคลังแต่สิทธิ์หมด = UNTRACKED — สิทธิ์ที่หมดห้ามกั้นการขาย', () => {
    expect(resolveStockMode({ inventoryItemId: 'inv-1', trackStock: true }, false)).toBe('UNTRACKED');
  });

  it('นับในเมนู = LOCAL', () => {
    expect(resolveStockMode({ trackStock: true }, false)).toBe('LOCAL');
    expect(resolveStockMode({ trackStock: true }, true)).toBe('LOCAL');
  });

  it('ไม่ผูกไม่นับ = UNTRACKED', () => {
    expect(resolveStockMode({}, true)).toBe('UNTRACKED');
  });
});

describe('MenuStockService', () => {
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
        // ตัวจริง — ไม่มี state ของตัวเอง เขียนผ่าน tx ที่ส่งเข้าไป สเปกนี้จึงตรึงรูปแบบการเขียนสมุดจริง
        WarehouseIssueService,
      ],
    }).compile();

    service = module.get(MenuStockService);
  });

  // ── สิทธิ์อ่านไม่ได้ต้องไม่ล้มการขาย ───────────────────────────────────────
  describe('hasInventoryAddon', () => {
    it('ถ้าอ่านสิทธิ์ไม่ได้ให้ถือว่าไม่มี add-on แทนที่จะโยน error ใส่หน้าขาย', async () => {
      addons.hasActiveAddon.mockRejectedValue(new Error('redis down'));
      await expect(service.hasInventoryAddon(TENANT)).resolves.toBe(false);
    });
  });

  // ── กันขายเกินตั้งแต่เพิ่มลงบิล ───────────────────────────────────────────
  /** เมนูที่คลังกลางเป็นเจ้าของยอด — stockQty ในเมนูเป็น 0 เสมอโดยตั้งใจ */
  const centralMenu = () =>
    prisma.menuItem.findFirst.mockResolvedValue({
      id: 'm1',
      name: 'น้ำดื่ม',
      trackStock: false,
      stockQty: 0,
      inventoryItemId: 'inv-1',
      restaurantId: RESTAURANT,
    });

  describe('assertCanSell', () => {
    it('เกินยอดคงเหลือ → 409 พร้อมบอกจำนวนที่เหลือจริง', async () => {
      prisma.menuItem.findFirst.mockResolvedValue({
        id: 'm1', name: 'ไอศกรีมแท่ง', trackStock: true, stockQty: 3, inventoryItemId: null,
      });

      await expect(service.assertCanSell(TENANT, 'm1', 5)).rejects.toThrow(ConflictException);
      await expect(service.assertCanSell(TENANT, 'm1', 5)).rejects.toThrow(/เหลือ 3/);
    });

    it('หักของที่ค้างอยู่ในบิลที่ยังไม่ปิดด้วย — สองโต๊ะจองขวดสุดท้ายพร้อมกันไม่ได้', async () => {
      prisma.menuItem.findFirst.mockResolvedValue({
        id: 'm1', name: 'น้ำดื่ม', trackStock: true, stockQty: 5, inventoryItemId: null,
      });
      prisma.orderItem.aggregate.mockResolvedValue({ _sum: { quantity: 4 } });

      await expect(service.assertCanSell(TENANT, 'm1', 2)).rejects.toThrow(/ค้างในบิลที่ยังไม่ปิด 4/);
      await expect(service.assertCanSell(TENANT, 'm1', 1)).resolves.toBeUndefined();
    });

    it('เมนูปกติที่ไม่นับสต๊อกขายได้ไม่จำกัด', async () => {
      prisma.menuItem.findFirst.mockResolvedValue({
        id: 'm1', name: 'ผัดไทย', trackStock: false, stockQty: 0, inventoryItemId: null,
      });
      await expect(service.assertCanSell(TENANT, 'm1', 99)).resolves.toBeUndefined();
    });

    it('เมนูที่ผูกคลังกลางไม่ถูกกั้นด้วยยอดในเมนู — ไปอ่านยอดจากคลังแทน', async () => {
      addons.hasActiveAddon.mockResolvedValue(true);
      centralMenu();
      prisma.warehouseStock.findFirst.mockResolvedValue({ quantity: 50, reservedQty: 0 });

      // stockQty ในเมนูเป็น 0 แต่ในคลังมี 50 — ต้องขายได้
      await expect(service.assertCanSell(TENANT, 'm1', 10)).resolves.toBeUndefined();
    });
  });

  // ── โหมด CENTRAL: ยอดอยู่ที่คลัง ──────────────────────────────────────────
  //
  // เดิมโหมดนี้ไม่กันอะไรเลย ผลคือยิ่งซื้อโมดูลคลังยิ่งได้การป้องกันน้อยลง
  // (ระดับ 1 กันได้ ระดับ 2 กันไม่ได้) รู้ตัวอีกทีตอนยอดในคลังติดลบไปแล้ว
  describe('assertCanSell — โหมดคลังกลาง', () => {
    beforeEach(() => {
      addons.hasActiveAddon.mockResolvedValue(true);
      centralMenu();
    });

    it('ขายเกินยอดในคลังไม่ได้ — ต้องกันตั้งแต่ตอนกดสั่ง ไม่ใช่ไปติดลบตอนปิดบิล', async () => {
      prisma.warehouseStock.findFirst.mockResolvedValue({ quantity: 3, reservedQty: 0 });

      await expect(service.assertCanSell(TENANT, 'm1', 5)).rejects.toThrow(ConflictException);
      await expect(service.assertCanSell(TENANT, 'm1', 5)).rejects.toThrow(/เหลือ 3/);
      await expect(service.assertCanSell(TENANT, 'm1', 3)).resolves.toBeUndefined();
    });

    it('อ่านยอดจากคลังใบเดียวกับที่ตอนปิดบิลจะไปหัก', async () => {
      prisma.warehouseStock.findFirst.mockResolvedValue({ quantity: 10, reservedQty: 0 });

      await service.assertCanSell(TENANT, 'm1', 1);

      // ถามเป็นรายสินค้า ไม่ใช่รายร้าน — ของแต่ละอย่างไม่ได้อยู่คลังเดียวกัน
      expect(sourceWarehouse.resolveForItem).toHaveBeenCalledWith(TENANT, RESTAURANT, 'inv-1');
      expect(prisma.warehouseStock.findFirst.mock.calls[0][0].where).toMatchObject({
        warehouseId: 'wh-1',
        itemId: 'inv-1',
      });
    });

    it('ของที่คลังกันไว้ให้งานอื่น (reservedQty) ไม่ใช่ของที่หน้าร้านหยิบขายได้', async () => {
      prisma.warehouseStock.findFirst.mockResolvedValue({ quantity: 10, reservedQty: 8 });

      await expect(service.assertCanSell(TENANT, 'm1', 5)).rejects.toThrow(/เหลือ 2/);
    });

    it('หักของที่ค้างในบิลที่ยังไม่ปิดด้วย — นับข้ามเมนูที่ผูกสินค้าตัวเดียวกัน', async () => {
      prisma.warehouseStock.findFirst.mockResolvedValue({ quantity: 10, reservedQty: 0 });
      prisma.orderItem.aggregate.mockResolvedValue({ _sum: { quantity: 9 } });

      await expect(service.assertCanSell(TENANT, 'm1', 2)).rejects.toThrow(/ค้างในบิลที่ยังไม่ปิด 9/);

      // จองต้องมองที่ "สินค้าในคลัง" ไม่ใช่ "เมนู" เพราะร้านหนึ่งมีหลายเมนู
      // ที่กินยอดของขวดเดียวกันได้ และต้องไม่เหมาเอาบิลของร้านอื่นมานับ
      expect(prisma.orderItem.aggregate.mock.calls[0][0].where.menuItem).toMatchObject({
        restaurantId: RESTAURANT,
        inventoryItemId: 'inv-1',
      });
    });

    it('ยังไม่มีแถวสต๊อกในคลัง = ไม่มีของ ห้ามปล่อยขาย', async () => {
      prisma.warehouseStock.findFirst.mockResolvedValue(null);

      await expect(service.assertCanSell(TENANT, 'm1', 1)).rejects.toThrow(/เหลือ 0/);
    });

    it('หาคลังต้นทางไม่เจอ → ปล่อยขาย ไม่มีข้อมูลพอจะบอกว่าเกิน', async () => {
      sourceWarehouse.resolveForItem.mockResolvedValue(null);

      await expect(service.assertCanSell(TENANT, 'm1', 99)).resolves.toBeUndefined();
      expect(prisma.warehouseStock.findFirst).not.toHaveBeenCalled();
    });

    it('อ่านคลังพังต้องไม่ลามเป็น "ขายอะไรไม่ได้เลย" ที่หน้าเคาน์เตอร์', async () => {
      prisma.warehouseStock.findFirst.mockRejectedValue(new Error('db down'));

      await expect(service.assertCanSell(TENANT, 'm1', 99)).resolves.toBeUndefined();
    });

    it('สิทธิ์คลังหมดอายุ → UNTRACKED ขายต่อได้ ห้ามไปอ่านยอดคลังมากั้น', async () => {
      addons.hasActiveAddon.mockResolvedValue(false);

      await expect(service.assertCanSell(TENANT, 'm1', 99)).resolves.toBeUndefined();
      expect(sourceWarehouse.resolveForItem).not.toHaveBeenCalled();
    });
  });

  // ── ตัดสต๊อกตอนปิดบิล ─────────────────────────────────────────────────────
  describe('deductForOrder', () => {
    it('รวมบรรทัดที่เป็นเมนูเดียวกันก่อนตัด', async () => {
      const tx = makeTxMock();
      tx.menuItem.findMany.mockResolvedValue([{ id: 'm1', name: 'น้ำดื่ม', stockQty: 10, cost: 8 }]);

      await service.deductForOrder(tx as any, {
        tenantId: TENANT,
        orderId: 'ord-1',
        items: [
          { menuItemId: 'm1', quantity: 2 },
          { menuItemId: 'm1', quantity: 3 },
        ],
      });

      expect(tx.menuItem.update).toHaveBeenCalledWith({ where: { id: 'm1' }, data: { stockQty: 5 } });
      expect(tx.menuItemStockMovement.create).toHaveBeenCalledTimes(1);
      expect(tx.menuItemStockMovement.create.mock.calls[0][0].data).toMatchObject({
        type: 'SALE', quantity: -5, balanceAfter: 5, referenceId: 'ord-1',
      });
    });

    it('ยิงซ้ำบิลเดิมไม่ตัดซ้ำ — ปิดบิลผ่านจ่ายเงินกับเปลี่ยนสถานะเรียกจุดเดียวกัน', async () => {
      const tx = makeTxMock();
      // บรรทัดนี้ถูกประทับไปแล้ว (หักตอนสั่ง หรือปิดบิลรอบก่อน) — รอบนี้ต้องไม่แตะสต๊อกอีก
      tx.orderItem.findMany.mockResolvedValue([{ id: 'oi-1' }]);
      tx.menuItem.findMany.mockResolvedValue([{ id: 'm1', name: 'น้ำดื่ม', stockQty: 10, cost: 8 }]);

      await service.deductForOrder(tx as any, {
        tenantId: TENANT,
        orderId: 'ord-1',
        items: [{ orderItemId: 'oi-1', menuItemId: 'm1', quantity: 1 }],
      });

      expect(tx.menuItem.update).not.toHaveBeenCalled();
      expect(tx.menuItemStockMovement.create).not.toHaveBeenCalled();
    });

    it('บิลเดิมที่หักไปแค่บางบรรทัด ปิดบิลแล้วต้องเก็บบรรทัดที่เหลือ ไม่ใช่ข้ามทั้งใบ', async () => {
      const tx = makeTxMock();
      tx.orderItem.findMany.mockResolvedValue([{ id: 'oi-1' }]);
      tx.menuItem.findMany.mockResolvedValue([{ id: 'm1', name: 'น้ำดื่ม', stockQty: 10, cost: 8 }]);

      await service.deductForOrder(tx as any, {
        tenantId: TENANT,
        orderId: 'ord-1',
        items: [
          { orderItemId: 'oi-1', menuItemId: 'm1', quantity: 4 },
          { orderItemId: 'oi-2', menuItemId: 'm1', quantity: 1 },
        ],
      });

      // หักเฉพาะ 1 ของบรรทัดที่ยังไม่ถูกประทับ
      expect(tx.menuItem.update).toHaveBeenCalledWith({ where: { id: 'm1' }, data: { stockQty: 9 } });
      expect(tx.orderItem.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: { in: ['oi-2'] } } }),
      );
    });

    it('ขายเกินสต๊อกบันทึกยอดติดลบพร้อมหมายเหตุ ไม่ตัดแค่เท่าที่มีแล้วปล่อยส่วนต่างหาย', async () => {
      const tx = makeTxMock();
      tx.menuItem.findMany.mockResolvedValue([{ id: 'm1', name: 'น้ำดื่ม', stockQty: 1, cost: 8 }]);

      await service.deductForOrder(tx as any, {
        tenantId: TENANT, orderId: 'ord-2', items: [{ menuItemId: 'm1', quantity: 3 }],
      });

      expect(tx.menuItem.update).toHaveBeenCalledWith({ where: { id: 'm1' }, data: { stockQty: -2 } });
      expect(tx.menuItemStockMovement.create.mock.calls[0][0].data).toMatchObject({
        balanceAfter: -2,
        note: 'ขายเกินสต๊อก 2 หน่วย — ต้องตรวจนับ',
      });
    });

    it('ดึงเฉพาะเมนูที่นับเองและไม่ได้ผูกคลัง', async () => {
      const tx = makeTxMock();
      tx.menuItem.findMany.mockResolvedValue([]);

      await service.deductForOrder(tx as any, {
        tenantId: TENANT, orderId: 'ord-3', items: [{ menuItemId: 'm1', quantity: 1 }],
      });

      expect(tx.menuItem.findMany.mock.calls[0][0].where).toMatchObject({
        tenantId: TENANT, trackStock: true, inventoryItemId: null,
      });
    });

    it('บิลที่ไม่มีรายการไม่แตะฐานข้อมูลเลย', async () => {
      const tx = makeTxMock();
      await service.deductForOrder(tx as any, { tenantId: TENANT, orderId: 'ord-4', items: [] });
      expect(tx.menuItemStockMovement.findFirst).not.toHaveBeenCalled();
    });
  });

  // ── รับของ / ปรับยอด / ตัดของเสีย ─────────────────────────────────────────
  describe('applyMovement', () => {
    const localItem = {
      id: 'm1', name: 'น้ำดื่ม', trackStock: true, stockQty: 10,
      inventoryItemId: null, itemKind: 'READY_MADE',
    };

    beforeEach(() => {
      prisma.menuItemStockMovement.create.mockImplementation((args: any) => args.data);
      prisma.menuItem.update.mockResolvedValue({});
    });

    it('RECEIVE บวกเข้ายอด', async () => {
      prisma.menuItem.findFirst.mockResolvedValue(localItem);

      const res = await service.applyMovement(RESTAURANT, 'm1', { type: 'RECEIVE', quantity: 5 } as any, TENANT, 'u1');

      expect(res.stockQty).toBe(15);
      expect(res).toMatchObject({ quantity: 5, balanceAfter: 15, createdBy: 'u1' });
    });

    it('WASTE ตัดออกจากยอด', async () => {
      prisma.menuItem.findFirst.mockResolvedValue(localItem);

      const res = await service.applyMovement(RESTAURANT, 'm1', { type: 'WASTE', quantity: 4 } as any, TENANT);

      expect(res).toMatchObject({ quantity: -4, balanceAfter: 6 });
    });

    it('ADJUST คิดส่วนต่างจากยอดที่นับได้ ไม่ใช่เอา quantity ไปบวกตรง ๆ', async () => {
      prisma.menuItem.findFirst.mockResolvedValue(localItem);

      const res = await service.applyMovement(RESTAURANT, 'm1', { type: 'ADJUST', quantity: 7 } as any, TENANT);

      expect(res).toMatchObject({ quantity: -3, balanceAfter: 7 });
    });

    it('ยอดคงเหลือติดลบไม่ได้', async () => {
      prisma.menuItem.findFirst.mockResolvedValue(localItem);

      await expect(
        service.applyMovement(RESTAURANT, 'm1', { type: 'WASTE', quantity: 11 } as any, TENANT),
      ).rejects.toThrow(BadRequestException);
    });

    it('บันทึก SALE ด้วยมือไม่ได้ — รายการขายมาจากการปิดบิลเท่านั้น', async () => {
      prisma.menuItem.findFirst.mockResolvedValue(localItem);

      await expect(
        service.applyMovement(RESTAURANT, 'm1', { type: 'SALE', quantity: 1 } as any, TENANT),
      ).rejects.toThrow(/ปิดบิล/);
    });

    it('เมนูที่ผูกคลังกลางต้องไปทำใบรับของในระบบคลัง', async () => {
      addons.hasActiveAddon.mockResolvedValue(true);
      prisma.menuItem.findFirst.mockResolvedValue({ ...localItem, inventoryItemId: 'inv-1' });

      await expect(
        service.applyMovement(RESTAURANT, 'm1', { type: 'RECEIVE', quantity: 1 } as any, TENANT),
      ).rejects.toThrow(/ระบบคลัง/);
    });

    it('เมนูที่ยังไม่เปิดนับสต๊อกบันทึกรับของไม่ได้', async () => {
      prisma.menuItem.findFirst.mockResolvedValue({ ...localItem, trackStock: false });

      await expect(
        service.applyMovement(RESTAURANT, 'm1', { type: 'RECEIVE', quantity: 1 } as any, TENANT),
      ).rejects.toThrow(/นับสต๊อกในเมนูนี้/);
    });
  });

  describe('listMovements', () => {
    it('คืนยอดปัจจุบันพร้อมโหมด เพื่อให้หน้าจอรู้ว่ากดแก้ได้ไหม', async () => {
      prisma.menuItem.findFirst.mockResolvedValue({
        id: 'm1', stockQty: 12, trackStock: true, inventoryItemId: null,
      });
      prisma.menuItemStockMovement.findMany.mockResolvedValue([{ id: 'mv1' }]);

      const res = await service.listMovements(RESTAURANT, 'm1', TENANT);

      expect(res).toMatchObject({ stockQty: 12, mode: 'LOCAL' });
      expect(res.movements).toHaveLength(1);
    });

    it('จำกัดจำนวนแถวสูงสุด 200 ไม่ว่าจะขอมาเท่าไร', async () => {
      prisma.menuItem.findFirst.mockResolvedValue({
        id: 'm1', stockQty: 0, trackStock: true, inventoryItemId: null,
      });
      prisma.menuItemStockMovement.findMany.mockResolvedValue([]);

      await service.listMovements(RESTAURANT, 'm1', TENANT, 9999);

      expect(prisma.menuItemStockMovement.findMany.mock.calls[0][0].take).toBe(200);
    });
  });
});
