/**
 * จังหวะที่ของออกจากสต๊อก — ต้องเป็น "ตอนสั่ง" ไม่ใช่ "ตอนปิดบิล"
 *
 * น้ำขวดถูกหยิบออกจากตู้ตอนพนักงานกดรับออร์เดอร์ ไม่ใช่ตอนโต๊ะจ่ายเงิน บิลโต๊ะหนึ่ง
 * เปิดค้างได้เป็นชั่วโมง ระหว่างนั้นยอดบนจอกับของจริงในตู้ไม่ตรงกัน
 *
 * สเปกชุดนี้ตรึงการต่อสายของ OrderService:
 *  - เปิดบิล / เพิ่มรายการ = หักทันที
 *  - ลบรายการ / ยกเลิกบิล = คืนของ (และคืนก่อนลบแถว ไม่งั้นไม่เหลือข้อมูลว่าคืนเท่าไร)
 *  - ระบบคลังล่มต้องไม่ทำให้เปิดบิลไม่ได้ที่หน้าเคาน์เตอร์
 */

import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { OrderService } from '../order.service';
import { PrismaService } from '../../../../prisma/prisma.service';
import { MenuService } from '../../menu/menu.service';
import { buildMenuStockStub, menuStockProvider } from './menu-stock.stub';
import { AuditLogService } from '../../../../audit-log/audit-log.service';
import { FolioPostingService } from '@/modules/accounts-receivable/folio-posting/folio-posting.service';
import { buildFolioPostingStub } from './folio-posting.stub';
import { RevenuePostingService } from '@/modules/revenue/revenue-posting.service';
import { buildRevenuePostingStub } from '@/modules/revenue/__tests__/revenue-posting.stub';

const RESTAURANT = 'rest-1';
const TENANT = 'tenant-1';
const MENU_ITEM = 'menu-1';
const ORDER_ID = 'order-1';

describe('OrderService — ตัดสต๊อกตอนสั่ง', () => {
  let service: OrderService;
  let menuStock: ReturnType<typeof buildMenuStockStub>;

  const prisma = {
    restaurant: { findFirst: jest.fn() },
    restaurantTable: { findFirst: jest.fn(), update: jest.fn() },
    tableReservation: { findFirst: jest.fn() },
    menuItem: { findFirst: jest.fn(), findMany: jest.fn() },
    orderItem: {
      findMany: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
      updateMany: jest.fn(),
    },
    order: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    documentSequence: { findFirst: jest.fn(), create: jest.fn(), upsert: jest.fn() },
    $transaction: jest.fn(),
  };

  /** ตัวแทน tx — จับได้ว่าอะไรถูกเรียกในทรานแซกชันเดียวกัน และเรียงลำดับยังไง */
  const tx = {
    order: { update: jest.fn() },
    orderItem: { delete: jest.fn() },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    menuStock = buildMenuStockStub();

    const moduleRef = await Test.createTestingModule({
      providers: [
        OrderService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: () => 'http://localhost:9010' } },
        { provide: MenuService, useValue: {} },
        menuStockProvider(menuStock),
        {
          provide: AuditLogService,
          useValue: { logOrderCreate: jest.fn(), logOrderUpdate: jest.fn() },
        },
        { provide: FolioPostingService, useValue: buildFolioPostingStub() },
        { provide: RevenuePostingService, useValue: buildRevenuePostingStub() },
      ],
    }).compile();
    service = moduleRef.get(OrderService);

    prisma.restaurant.findFirst.mockResolvedValue({
      id: RESTAURANT,
      tenantId: TENANT,
      vatEnabled: true,
      vatRate: '7.00',
      serviceChargeEnabled: true,
      serviceRate: '10.00',
    });
    prisma.tableReservation.findFirst.mockResolvedValue(null);
    prisma.menuItem.findMany.mockResolvedValue([
      { id: MENU_ITEM, price: '20.00', restaurantId: RESTAURANT, tenantId: TENANT },
    ]);
    prisma.order.count.mockResolvedValue(0);
    prisma.documentSequence.findFirst.mockResolvedValue({ id: 'seq-1' });
    prisma.documentSequence.upsert.mockResolvedValue({ lastNumber: 1 });
    prisma.order.create.mockImplementation(({ data }: any) => ({
      id: ORDER_ID,
      ...data,
      items: [{ id: 'oi-1', menuItemId: MENU_ITEM, quantity: 2 }],
    }));
    prisma.orderItem.findMany.mockResolvedValue([]);
    prisma.order.update.mockResolvedValue({ id: ORDER_ID });
    prisma.$transaction.mockImplementation(async (fn: any) =>
      typeof fn === 'function' ? fn(tx) : Promise.all(fn),
    );
  });

  const createBill = () =>
    service.create(RESTAURANT, { items: [{ menuItemId: MENU_ITEM, quantity: 2 }] }, TENANT);

  describe('เปิดบิล', () => {
    it('หักของทันทีที่บิลถูกเปิด ไม่รอปิดบิล', async () => {
      await createBill();

      expect(menuStock.deductPlacedLines).toHaveBeenCalledTimes(1);
      expect(menuStock.deductPlacedLines.mock.calls[0][1]).toMatchObject({
        tenantId: TENANT,
        restaurantId: RESTAURANT,
        orderId: ORDER_ID,
        lines: [{ orderItemId: 'oi-1', menuItemId: MENU_ITEM, quantity: 2 }],
      });
    });

    it('ระบบคลังล่มต้องไม่ทำให้เปิดบิลไม่ได้ — บิลยังออก แล้วไปหักตอนปิดบิลแทน', async () => {
      menuStock.deductPlacedLines.mockRejectedValue(new Error('inventory down'));

      const order = await createBill();

      expect(order).toBeDefined();
      expect(prisma.order.create).toHaveBeenCalled();
    });

    it('บิลที่ระบบคืนมาโดยไม่มีรายการ (ชนิดกว้างของ Prisma) ต้องไม่ล้ม', async () => {
      prisma.order.create.mockImplementation(({ data }: any) => ({ id: ORDER_ID, ...data }));

      await expect(createBill()).resolves.toBeDefined();
      expect(menuStock.deductPlacedLines).not.toHaveBeenCalled();
    });
  });

  describe('เพิ่มรายการเข้าบิลที่เปิดอยู่', () => {
    beforeEach(() => {
      prisma.order.findFirst.mockResolvedValue({
        id: ORDER_ID,
        restaurantId: RESTAURANT,
        tenantId: TENANT,
        status: 'PENDING',
        paymentStatus: 'PENDING',
        taxRate: '7.00',
        serviceRate: '10.00',
        items: [{ id: 'oi-1', menuItemId: MENU_ITEM, quantity: 2, sentToKitchen: false }],
      });
      prisma.menuItem.findFirst.mockResolvedValue({
        id: MENU_ITEM,
        price: '20.00',
        restaurantId: RESTAURANT,
        tenantId: TENANT,
        isAvailable: true,
      });
      prisma.orderItem.create.mockResolvedValue({
        id: 'oi-2',
        menuItemId: MENU_ITEM,
        quantity: 1,
      });
    });

    it('บรรทัดใหม่ถูกหักทันที', async () => {
      await service.addItem(RESTAURANT, ORDER_ID, { menuItemId: MENU_ITEM, quantity: 1 }, TENANT);

      expect(menuStock.deductPlacedLines.mock.calls[0][1]).toMatchObject({
        orderId: ORDER_ID,
        lines: [{ orderItemId: 'oi-2', menuItemId: MENU_ITEM, quantity: 1 }],
      });
    });
  });

  describe('ลบรายการ', () => {
    it('คืนของก่อนลบแถวทิ้ง — ในทรานแซกชันเดียวกัน', async () => {
      prisma.order.findFirst.mockResolvedValue({
        id: ORDER_ID,
        restaurantId: RESTAURANT,
        tenantId: TENANT,
        status: 'PENDING',
        paymentStatus: 'PENDING',
        taxRate: '7.00',
        serviceRate: '10.00',
        items: [{ id: 'oi-1', menuItemId: MENU_ITEM, quantity: 2, sentToKitchen: false }],
      });

      await service.removeItem(RESTAURANT, ORDER_ID, 'oi-1', TENANT);

      expect(menuStock.returnPlacedLines.mock.calls[0][1]).toMatchObject({
        tenantId: TENANT,
        restaurantId: RESTAURANT,
        orderId: ORDER_ID,
        orderItemIds: ['oi-1'],
      });
      expect(tx.orderItem.delete).toHaveBeenCalledWith({ where: { id: 'oi-1' } });
      // คืนก่อน ลบทีหลัง — สลับลำดับแล้วจะไม่เหลือข้อมูลว่าต้องคืนเท่าไร
      expect(menuStock.returnPlacedLines.mock.invocationCallOrder[0]).toBeLessThan(
        tx.orderItem.delete.mock.invocationCallOrder[0],
      );
    });
  });

  describe('เปลี่ยนสถานะบิล', () => {
    const openOrder = (status: string) => ({
      id: ORDER_ID,
      restaurantId: RESTAURANT,
      tenantId: TENANT,
      status,
      paymentStatus: 'PENDING',
      tableId: null,
      items: [{ id: 'oi-1', menuItemId: MENU_ITEM, quantity: 2 }],
    });

    it('ยกเลิกบิล = คืนของที่หยิบออกจากตู้ไปแล้ว', async () => {
      prisma.order.findFirst.mockResolvedValue(openOrder('PENDING'));
      tx.order.update.mockResolvedValue({ ...openOrder('CANCELLED'), items: [] });

      await service.updateStatus(RESTAURANT, ORDER_ID, 'CANCELLED' as never, TENANT, 'user-1');

      expect(menuStock.returnPlacedLines.mock.calls[0][1]).toMatchObject({
        orderId: ORDER_ID,
        userId: 'user-1',
      });
      expect(menuStock.returnPlacedLines.mock.calls[0][1].orderItemIds).toBeUndefined();
    });

    it('ปิดบิลไม่หักซ้ำบรรทัดที่ประทับไว้แล้ว — เหลือแค่บรรทัดที่ยังค้าง', async () => {
      prisma.order.findFirst.mockResolvedValue(openOrder('SERVED'));
      tx.order.update.mockResolvedValue({
        ...openOrder('COMPLETED'),
        items: [
          { id: 'oi-1', menuItemId: MENU_ITEM, quantity: 2, stockDeductedAt: new Date() },
          { id: 'oi-2', menuItemId: 'menu-2', quantity: 1, stockDeductedAt: null },
        ],
      });

      await service.updateStatus(RESTAURANT, ORDER_ID, 'COMPLETED' as never, TENANT, 'user-1');

      expect(menuStock.deductForOrder.mock.calls[0][1].items).toEqual([
        { orderItemId: 'oi-2', menuItemId: 'menu-2', quantity: 1 },
      ]);
    });

    it('บรรทัดที่ถูกยกเลิกไม่ถูกนับเป็นของขาย', async () => {
      prisma.order.findFirst.mockResolvedValue(openOrder('SERVED'));
      tx.order.update.mockResolvedValue({
        ...openOrder('COMPLETED'),
        items: [
          { id: 'oi-1', menuItemId: MENU_ITEM, quantity: 2, status: 'CANCELLED' },
          { id: 'oi-2', menuItemId: 'menu-2', quantity: 1, status: 'SERVED' },
        ],
      });

      await service.updateStatus(RESTAURANT, ORDER_ID, 'COMPLETED' as never, TENANT, 'user-1');

      expect(menuStock.deductForOrder.mock.calls[0][1].items).toEqual([
        { orderItemId: 'oi-2', menuItemId: 'menu-2', quantity: 1 },
      ]);
    });
  });
});
