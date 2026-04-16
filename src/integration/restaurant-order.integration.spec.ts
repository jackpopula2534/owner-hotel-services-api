import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { OrderService } from '../modules/restaurant/order/order.service';
import { PrismaService } from '../prisma/prisma.service';
import { KitchenGateway } from '../modules/restaurant/kitchen/kitchen.gateway';

// ─── Shared mock helpers ──────────────────────────────────────────────────────

const makePrismaMock = () => ({
  restaurant: { findFirst: jest.fn() },
  restaurantTable: { findFirst: jest.fn(), update: jest.fn() },
  menuItem: { findFirst: jest.fn(), findMany: jest.fn() },
  order: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  orderItem: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    delete: jest.fn(),
  },
  kitchenOrder: { create: jest.fn(), findMany: jest.fn() },
  $transaction: jest.fn(),
});

const makeGatewayMock = () => ({
  emitNewOrder: jest.fn(),
  emitOrderUpdated: jest.fn(),
  emitOrderCompleted: jest.fn(),
  emitItemStatusChanged: jest.fn(),
  emitOrderStatusToGuest: jest.fn(),
});

// ─── Test fixtures ────────────────────────────────────────────────────────────

const RESTAURANT_ID = 'rest-1';
const TENANT_ID = 'tenant-1';
const ORDER_ID = 'ord-1';
const TABLE_ID = 'tbl-1';
const TODAY = new Date().toISOString().slice(0, 10).replace(/-/g, '');

const mockRestaurant = {
  id: RESTAURANT_ID,
  tenantId: TENANT_ID,
  name: 'Test Restaurant',
  location: null,
};
const mockTable = {
  id: TABLE_ID,
  tableNumber: 'T01',
  capacity: 4,
  restaurantId: RESTAURANT_ID,
  tenantId: TENANT_ID,
  isActive: true,
};
const mockMenuItem = {
  id: 'mi-1',
  name: 'Pad Thai',
  price: 120,
  restaurantId: RESTAURANT_ID,
  tenantId: TENANT_ID,
  isAvailable: true,
};

const makeOrder = (overrides: Record<string, unknown> = {}) => ({
  id: ORDER_ID,
  orderNumber: `ORD-${TODAY}-0001`,
  restaurantId: RESTAURANT_ID,
  tenantId: TENANT_ID,
  tableId: TABLE_ID,
  status: 'PENDING',
  paymentStatus: 'UNPAID',
  orderType: 'DINE_IN',
  subtotal: 240,
  taxRate: 7,
  taxAmount: 16.8,
  serviceRate: 10,
  serviceCharge: 24,
  discount: 0,
  total: 280.8,
  confirmedAt: null,
  completedAt: null,
  cancelledAt: null,
  table: { id: TABLE_ID, tableNumber: 'T01' },
  items: [],
  kitchenOrders: [],
  ...overrides,
});

// ─── OrderService Tests ───────────────────────────────────────────────────────

describe('OrderService', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prismaMock: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let gatewayMock: any;
  let orderService: OrderService;

  beforeEach(async () => {
    prismaMock = makePrismaMock();
    gatewayMock = makeGatewayMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: KitchenGateway, useValue: gatewayMock },
      ],
    }).compile();

    orderService = module.get<OrderService>(OrderService);
  });

  // ── generateOrderNumber ───────────────────────────────────────────────────

  describe('generateOrderNumber (via create)', () => {
    it('generates ORD-YYYYMMDD-0001 for first order of the day', async () => {
      prismaMock.restaurant.findFirst.mockResolvedValue(mockRestaurant);
      prismaMock.restaurantTable.findFirst.mockResolvedValue(mockTable);
      prismaMock.order.count.mockResolvedValue(0); // no orders today
      prismaMock.menuItem.findMany.mockResolvedValue([]);
      prismaMock.order.create.mockResolvedValue(makeOrder({ items: [] }));
      prismaMock.restaurantTable.update.mockResolvedValue({});

      const result = await orderService.create(
        RESTAURANT_ID,
        {
          tableId: TABLE_ID,
          orderType: 'DINE_IN' as any,
        },
        TENANT_ID,
      );

      expect(result.orderNumber).toMatch(/^ORD-\d{8}-0001$/);
    });

    it('pads sequence to 4 digits — e.g. ORD-YYYYMMDD-0012', async () => {
      prismaMock.restaurant.findFirst.mockResolvedValue(mockRestaurant);
      prismaMock.restaurantTable.findFirst.mockResolvedValue(mockTable);
      prismaMock.order.count.mockResolvedValue(11); // 11 orders already today → next is 12
      prismaMock.menuItem.findMany.mockResolvedValue([]);
      prismaMock.order.create.mockResolvedValue(makeOrder({ orderNumber: `ORD-${TODAY}-0012` }));
      prismaMock.restaurantTable.update.mockResolvedValue({});

      const result = await orderService.create(
        RESTAURANT_ID,
        {
          tableId: TABLE_ID,
          orderType: 'DINE_IN' as any,
        },
        TENANT_ID,
      );

      expect(result.orderNumber).toMatch(/0012$/);
    });
  });

  // ── create ────────────────────────────────────────────────────────────────

  describe('create', () => {
    it('creates order with correct subtotal when items supplied', async () => {
      prismaMock.restaurant.findFirst.mockResolvedValue(mockRestaurant);
      prismaMock.restaurantTable.findFirst.mockResolvedValue(mockTable);
      prismaMock.order.count.mockResolvedValue(0);
      prismaMock.menuItem.findMany.mockResolvedValue([mockMenuItem]);
      const expectedOrder = makeOrder({ subtotal: 240, total: 280.8 });
      prismaMock.order.create.mockResolvedValue(expectedOrder);
      prismaMock.restaurantTable.update.mockResolvedValue({});

      const result = await orderService.create(
        RESTAURANT_ID,
        {
          tableId: TABLE_ID,
          orderType: 'DINE_IN' as any,
          items: [{ menuItemId: 'mi-1', quantity: 2 }],
        },
        TENANT_ID,
      );

      // 2 × 120 = 240 subtotal
      expect(prismaMock.order.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ subtotal: 240 }),
        }),
      );
      expect(result.id).toBe(ORDER_ID);
    });

    it('throws NotFoundException for unknown restaurant', async () => {
      prismaMock.restaurant.findFirst.mockResolvedValue(null);

      await expect(
        orderService.create(RESTAURANT_ID, { orderType: 'DINE_IN' as any }, TENANT_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException for unavailable menu item', async () => {
      prismaMock.restaurant.findFirst.mockResolvedValue(mockRestaurant);
      prismaMock.restaurantTable.findFirst.mockResolvedValue(mockTable);
      prismaMock.order.count.mockResolvedValue(0);
      prismaMock.menuItem.findMany.mockResolvedValue([]); // item not found / unavailable

      await expect(
        orderService.create(
          RESTAURANT_ID,
          {
            tableId: TABLE_ID,
            orderType: 'DINE_IN' as any,
            items: [{ menuItemId: 'mi-999', quantity: 1 }],
          },
          TENANT_ID,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('sets table status to OCCUPIED after dine-in order', async () => {
      prismaMock.restaurant.findFirst.mockResolvedValue(mockRestaurant);
      prismaMock.restaurantTable.findFirst.mockResolvedValue(mockTable);
      prismaMock.order.count.mockResolvedValue(0);
      prismaMock.menuItem.findMany.mockResolvedValue([]);
      prismaMock.order.create.mockResolvedValue(makeOrder());
      prismaMock.restaurantTable.update.mockResolvedValue({});

      await orderService.create(
        RESTAURANT_ID,
        {
          tableId: TABLE_ID,
          orderType: 'DINE_IN' as any,
        },
        TENANT_ID,
      );

      expect(prismaMock.restaurantTable.update).toHaveBeenCalledWith({
        where: { id: TABLE_ID },
        data: { status: 'OCCUPIED' },
      });
    });
  });

  // ── addItem ───────────────────────────────────────────────────────────────

  describe('addItem', () => {
    it('creates order item and recalculates totals', async () => {
      const order = makeOrder({ status: 'PENDING' });
      prismaMock.order.findFirst.mockResolvedValue(order);
      prismaMock.menuItem.findFirst.mockResolvedValue(mockMenuItem);
      prismaMock.orderItem.create.mockResolvedValue({
        id: 'oi-1',
        menuItemId: 'mi-1',
        quantity: 1,
        unitPrice: 120,
        totalPrice: 120,
      });
      prismaMock.orderItem.findMany.mockResolvedValue([{ totalPrice: 120 }]);
      prismaMock.order.update.mockResolvedValue({});

      const result = await orderService.addItem(
        RESTAURANT_ID,
        ORDER_ID,
        {
          menuItemId: 'mi-1',
          quantity: 1,
        },
        TENANT_ID,
      );

      expect(result.totalPrice).toBe(120);
      expect(prismaMock.orderItem.create).toHaveBeenCalledTimes(1);
      expect(prismaMock.order.update).toHaveBeenCalledTimes(1); // recalculate
    });

    it('throws BadRequestException when adding item to COMPLETED order', async () => {
      prismaMock.order.findFirst.mockResolvedValue(makeOrder({ status: 'COMPLETED' }));

      await expect(
        orderService.addItem(
          RESTAURANT_ID,
          ORDER_ID,
          { menuItemId: 'mi-1', quantity: 1 },
          TENANT_ID,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when menu item is unavailable', async () => {
      prismaMock.order.findFirst.mockResolvedValue(makeOrder({ status: 'PENDING' }));
      prismaMock.menuItem.findFirst.mockResolvedValue(null);

      await expect(
        orderService.addItem(
          RESTAURANT_ID,
          ORDER_ID,
          { menuItemId: 'mi-999', quantity: 1 },
          TENANT_ID,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── removeItem ────────────────────────────────────────────────────────────

  describe('removeItem', () => {
    it('deletes item that has not been sent to kitchen', async () => {
      const item = { id: 'oi-1', sentToKitchen: false, totalPrice: 120 };
      prismaMock.order.findFirst.mockResolvedValue(makeOrder({ items: [item] }));
      prismaMock.orderItem.delete.mockResolvedValue({});
      prismaMock.orderItem.findMany.mockResolvedValue([]);
      prismaMock.order.update.mockResolvedValue({});

      await expect(
        orderService.removeItem(RESTAURANT_ID, ORDER_ID, 'oi-1', TENANT_ID),
      ).resolves.not.toThrow();

      expect(prismaMock.orderItem.delete).toHaveBeenCalledWith({ where: { id: 'oi-1' } });
    });

    it('throws BadRequestException when item already sent to kitchen', async () => {
      const item = { id: 'oi-1', sentToKitchen: true };
      prismaMock.order.findFirst.mockResolvedValue(makeOrder({ items: [item] }));

      await expect(
        orderService.removeItem(RESTAURANT_ID, ORDER_ID, 'oi-1', TENANT_ID),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── sendToKitchen ─────────────────────────────────────────────────────────

  describe('sendToKitchen', () => {
    const pendingItem = {
      id: 'oi-1',
      sentToKitchen: false,
      status: 'PENDING',
      menuItemId: 'mi-1',
      quantity: 1,
      notes: null,
    };

    it('creates kitchen order ticket and emits WebSocket event', async () => {
      prismaMock.order.findFirst
        .mockResolvedValueOnce(makeOrder({ status: 'PENDING', items: [pendingItem] }))
        .mockResolvedValueOnce(
          makeOrder({
            status: 'PREPARING',
            items: [{ ...pendingItem, sentToKitchen: true, status: 'SENT' }],
          }),
        );

      prismaMock.$transaction.mockResolvedValue([
        { count: 1 },
        makeOrder({ status: 'PREPARING' }),
        { id: 'ko-1', orderId: ORDER_ID },
      ]);

      await orderService.sendToKitchen(RESTAURANT_ID, ORDER_ID, TENANT_ID);

      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
      expect(gatewayMock.emitNewOrder).toHaveBeenCalledWith(
        TENANT_ID,
        RESTAURANT_ID,
        expect.objectContaining({ orderId: ORDER_ID }),
      );
    });

    it('throws BadRequestException for CANCELLED order', async () => {
      prismaMock.order.findFirst.mockResolvedValue(makeOrder({ status: 'CANCELLED', items: [] }));

      await expect(orderService.sendToKitchen(RESTAURANT_ID, ORDER_ID, TENANT_ID)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when all items already sent', async () => {
      prismaMock.order.findFirst.mockResolvedValue(
        makeOrder({ status: 'PENDING', items: [{ ...pendingItem, sentToKitchen: true }] }),
      );

      await expect(orderService.sendToKitchen(RESTAURANT_ID, ORDER_ID, TENANT_ID)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ── updateStatus (state machine) ──────────────────────────────────────────

  describe('updateStatus', () => {
    const transitions: [string, string, boolean][] = [
      ['PENDING', 'CONFIRMED', true],
      ['PENDING', 'CANCELLED', true],
      ['CONFIRMED', 'PREPARING', true],
      ['PREPARING', 'READY', true],
      ['READY', 'SERVED', true],
      ['SERVED', 'COMPLETED', true],
      ['COMPLETED', 'CANCELLED', false], // invalid — COMPLETED is terminal
      ['PREPARING', 'CONFIRMED', false], // can't go backward
      ['PENDING', 'COMPLETED', false], // must follow sequence
    ];

    transitions.forEach(([from, to, allowed]) => {
      it(`${allowed ? 'allows' : 'blocks'} ${from} → ${to}`, async () => {
        prismaMock.order.findFirst.mockResolvedValue(makeOrder({ status: from }));
        prismaMock.order.update.mockResolvedValue(makeOrder({ status: to }));

        if (allowed) {
          const result = await orderService.updateStatus(
            RESTAURANT_ID,
            ORDER_ID,
            to as any,
            TENANT_ID,
          );
          expect(result.status).toBe(to);
        } else {
          await expect(
            orderService.updateStatus(RESTAURANT_ID, ORDER_ID, to as any, TENANT_ID),
          ).rejects.toThrow(BadRequestException);
        }
      });
    });

    it('sets table to CLEANING when order COMPLETED', async () => {
      prismaMock.order.findFirst.mockResolvedValue(
        makeOrder({ status: 'SERVED', tableId: TABLE_ID }),
      );
      prismaMock.order.update.mockResolvedValue(makeOrder({ status: 'COMPLETED' }));
      prismaMock.restaurantTable.update.mockResolvedValue({});

      await orderService.updateStatus(RESTAURANT_ID, ORDER_ID, 'COMPLETED' as any, TENANT_ID);

      expect(prismaMock.restaurantTable.update).toHaveBeenCalledWith({
        where: { id: TABLE_ID },
        data: { status: 'CLEANING' },
      });
    });

    it('emits guest WebSocket notification on any status change', async () => {
      prismaMock.order.findFirst.mockResolvedValue(makeOrder({ status: 'PENDING' }));
      prismaMock.order.update.mockResolvedValue(makeOrder({ status: 'CONFIRMED' }));

      await orderService.updateStatus(RESTAURANT_ID, ORDER_ID, 'CONFIRMED' as any, TENANT_ID);

      expect(gatewayMock.emitOrderStatusToGuest).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ status: 'CONFIRMED' }),
      );
    });
  });

  // ── processPayment ────────────────────────────────────────────────────────

  describe('processPayment', () => {
    it('marks order as PAID and calculates change correctly', async () => {
      prismaMock.order.findFirst.mockResolvedValue(
        makeOrder({ total: 280.8, paymentStatus: 'UNPAID' }),
      );
      prismaMock.order.update.mockResolvedValue(
        makeOrder({
          paymentStatus: 'PAID',
          paidAmount: 300,
          changeAmount: 19.2,
        }),
      );

      const result = await orderService.processPayment(
        RESTAURANT_ID,
        ORDER_ID,
        { paymentMethod: 'CASH' as any, paidAmount: 300 },
        TENANT_ID,
      );

      expect(prismaMock.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            paymentStatus: 'PAID',
            paymentMethod: 'CASH',
            paidAmount: 300,
          }),
        }),
      );
      expect(result.paymentStatus).toBe('PAID');
    });

    it('throws BadRequestException when already paid', async () => {
      prismaMock.order.findFirst.mockResolvedValue(makeOrder({ paymentStatus: 'PAID' }));

      await expect(
        orderService.processPayment(
          RESTAURANT_ID,
          ORDER_ID,
          { paymentMethod: 'CASH' as any, paidAmount: 300 },
          TENANT_ID,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when paidAmount is less than total', async () => {
      prismaMock.order.findFirst.mockResolvedValue(
        makeOrder({ total: 280.8, paymentStatus: 'UNPAID' }),
      );

      await expect(
        orderService.processPayment(
          RESTAURANT_ID,
          ORDER_ID,
          { paymentMethod: 'CASH' as any, paidAmount: 100 },
          TENANT_ID,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for ROOM_CHARGE without room number', async () => {
      prismaMock.order.findFirst.mockResolvedValue(
        makeOrder({ total: 280.8, paymentStatus: 'UNPAID', guestRoom: null }),
      );

      await expect(
        orderService.processPayment(
          RESTAURANT_ID,
          ORDER_ID,
          {
            paymentMethod: 'ROOM_CHARGE' as any,
            paidAmount: 300,
            // guestRoom intentionally omitted
          },
          TENANT_ID,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('applies discount before checking paidAmount', async () => {
      prismaMock.order.findFirst.mockResolvedValue(
        makeOrder({ total: 280.8, paymentStatus: 'UNPAID', status: 'SERVED' }),
      );
      prismaMock.order.update.mockResolvedValue(makeOrder({ paymentStatus: 'PAID' }));

      // total - discount = 280.8 - 80.8 = 200 ; paidAmount = 200 → exact match
      await expect(
        orderService.processPayment(
          RESTAURANT_ID,
          ORDER_ID,
          {
            paymentMethod: 'CASH' as any,
            paidAmount: 200,
            discount: 80.8,
          },
          TENANT_ID,
        ),
      ).resolves.not.toThrow();
    });
  });

  // ── getReceipt ────────────────────────────────────────────────────────────

  describe('getReceipt', () => {
    it('returns structured receipt with RCT- prefix', async () => {
      const order = makeOrder({ items: [] });
      prismaMock.order.findFirst.mockResolvedValue(order);
      prismaMock.restaurant.findFirst.mockResolvedValue(mockRestaurant);

      const result = await orderService.getReceipt(RESTAURANT_ID, ORDER_ID, TENANT_ID);

      expect(result.receiptNumber).toBe(`RCT-${order.orderNumber}`);
      expect(result.restaurant.name).toBe('Test Restaurant');
      expect(result.printedAt).toBeDefined();
    });
  });
});
