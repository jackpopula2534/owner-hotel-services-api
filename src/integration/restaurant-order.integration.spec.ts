import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { OrderService } from '../modules/restaurant/order/order.service';
import { PrismaService } from '../prisma/prisma.service';
import { KitchenGateway } from '../modules/restaurant/kitchen/kitchen.gateway';
import { MenuService } from '../modules/restaurant/menu/menu.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { INVENTORY_EVENTS } from '../modules/inventory/events/inventory.events';

// ─── Shared mock helpers ──────────────────────────────────────────────────────

const makePrismaMock = () => ({
  restaurant: { findFirst: jest.fn() },
  restaurantTable: { findFirst: jest.fn(), update: jest.fn() },
  // A dine-in order links itself back to whichever party is seated at the table,
  // and closing the bill closes that booking.
  tableReservation: { findFirst: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
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
  // Bill numbers come from the shared counter table, not from counting rows.
  documentSequence: { findFirst: jest.fn(), create: jest.fn(), upsert: jest.fn() },
  $transaction: jest.fn(),
});

/** The counter table as the order service sees it: hands out `next` and grows. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const stubOrderSequence = (prismaMock: any, next: number) => {
  prismaMock.documentSequence.findFirst.mockResolvedValue({ id: 'seq-1' });
  prismaMock.documentSequence.upsert.mockResolvedValue({ lastNumber: next });
};

/** What MySQL raises when two tills reach for the same bill number at once. */
const duplicateOrderNumberError = () =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '5.0.0',
    meta: { target: 'orders_tenantId_orderNumber_key' },
  });

const makeGatewayMock = () => ({
  emitNewOrder: jest.fn(),
  emitOrderUpdated: jest.fn(),
  emitOrderCompleted: jest.fn(),
  emitItemStatusChanged: jest.fn(),
  emitOrderStatusToGuest: jest.fn(),
});

const makeAuditMock = () => ({
  logOrderCreate: jest.fn(),
  logOrderUpdate: jest.fn(),
});

const makeMenuServiceMock = () => ({});

const makeConfigMock = () => ({ get: jest.fn().mockReturnValue('http://localhost:9010') });

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let eventEmitterMock: any;
  let orderService: OrderService;

  beforeEach(async () => {
    prismaMock = makePrismaMock();
    // Bill numbering is exercised on its own below; every other test just needs
    // a working counter so create() can draw a number.
    stubOrderSequence(prismaMock, 1);
    gatewayMock = makeGatewayMock();
    eventEmitterMock = { emit: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: KitchenGateway, useValue: gatewayMock },
        { provide: MenuService, useValue: makeMenuServiceMock() },
        { provide: AuditLogService, useValue: makeAuditMock() },
        { provide: ConfigService, useValue: makeConfigMock() },
        { provide: EventEmitter2, useValue: eventEmitterMock },
      ],
    }).compile();

    orderService = module.get<OrderService>(OrderService);
  });

  // ── generateOrderNumber ───────────────────────────────────────────────────

  describe('generateOrderNumber (via create)', () => {
    /** Arrange the happy path for a dine-in order that carries no items. */
    const arrangeCreate = () => {
      prismaMock.restaurant.findFirst.mockResolvedValue(mockRestaurant);
      prismaMock.restaurantTable.findFirst.mockResolvedValue(mockTable);
      prismaMock.menuItem.findMany.mockResolvedValue([]);
      prismaMock.restaurantTable.update.mockResolvedValue({});
    };

    /** Echo back whatever number the service drew, the way MySQL would. */
    const echoOrderNumber = () =>
      prismaMock.order.create.mockImplementation(({ data }: any) =>
        Promise.resolve(makeOrder({ orderNumber: data.orderNumber, items: [] })),
      );

    const createDineIn = () =>
      orderService.create(
        RESTAURANT_ID,
        { tableId: TABLE_ID, orderType: 'DINE_IN' as any },
        TENANT_ID,
      );

    it('generates ORD-YYYYMMDD-0001 for first order of the day', async () => {
      arrangeCreate();
      stubOrderSequence(prismaMock, 1); // counter is empty for today
      echoOrderNumber();

      const result = await createDineIn();

      expect(result.orderNumber).toMatch(/^ORD-\d{8}-0001$/);
    });

    it('pads sequence to 4 digits — e.g. ORD-YYYYMMDD-0012', async () => {
      arrangeCreate();
      stubOrderSequence(prismaMock, 12);
      echoOrderNumber();

      const result = await createDineIn();

      expect(result.orderNumber).toMatch(/0012$/);
    });

    it('draws the number from this tenant own counter row', async () => {
      arrangeCreate();
      stubOrderSequence(prismaMock, 1);
      echoOrderNumber();

      await createDineIn();

      // Two tenants opening their first bill of the day must land on separate
      // counter rows — that is what keeps them off each other's numbers.
      expect(prismaMock.documentSequence.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenantId_docType_yearMonth: {
              tenantId: TENANT_ID,
              docType: 'ORD',
              yearMonth: TODAY,
            },
          },
          update: { lastNumber: { increment: 1 } },
        }),
      );
    });

    it('seeds a fresh counter past the numbers already written today', async () => {
      arrangeCreate();
      // No counter row yet — orders predating the counter must not be reissued.
      prismaMock.documentSequence.findFirst.mockResolvedValue(null);
      prismaMock.order.findMany.mockResolvedValue([
        { orderNumber: `ORD-${TODAY}-0003` },
        { orderNumber: `ORD-${TODAY}-0007` },
        { orderNumber: `ORD-${TODAY}-junk` },
      ]);
      prismaMock.documentSequence.create.mockResolvedValue({});
      prismaMock.documentSequence.upsert.mockResolvedValue({ lastNumber: 8 });
      echoOrderNumber();

      const result = await createDineIn();

      expect(prismaMock.documentSequence.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ tenantId: TENANT_ID, lastNumber: 7 }),
        }),
      );
      expect(result.orderNumber).toBe(`ORD-${TODAY}-0008`);
    });

    it('looks the counter row up with findFirst, which the tenant guard allows', async () => {
      arrangeCreate();
      stubOrderSequence(prismaMock, 1);
      echoOrderNumber();

      await createDineIn();

      // tenant-scope.middleware throws outright on findUnique for tenant-scoped
      // models, so the lookup has to carry its own tenant filter.
      expect(prismaMock.documentSequence.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: TENANT_ID, docType: 'ORD', yearMonth: TODAY },
        }),
      );
    });

    it('retries with the next number when one is taken mid-flight', async () => {
      arrangeCreate();
      prismaMock.documentSequence.findFirst.mockResolvedValue({ id: 'seq-1' });
      prismaMock.documentSequence.upsert
        .mockResolvedValueOnce({ lastNumber: 4 })
        .mockResolvedValueOnce({ lastNumber: 5 });
      prismaMock.order.create
        .mockRejectedValueOnce(duplicateOrderNumberError())
        .mockImplementation(({ data }: any) =>
          Promise.resolve(makeOrder({ orderNumber: data.orderNumber, items: [] })),
        );

      const result = await createDineIn();

      expect(result.orderNumber).toBe(`ORD-${TODAY}-0005`);
      expect(prismaMock.order.create).toHaveBeenCalledTimes(2);
    });

    it('gives up with a readable message after repeated collisions', async () => {
      arrangeCreate();
      stubOrderSequence(prismaMock, 1);
      prismaMock.order.create.mockRejectedValue(duplicateOrderNumberError());

      await expect(createDineIn()).rejects.toThrow(BadRequestException);
      // The raw Prisma target must never reach the POS as the error text.
      await expect(createDineIn()).rejects.toThrow(/เลขบิล/);
    });

    it('lets non-duplicate database errors through untouched', async () => {
      arrangeCreate();
      stubOrderSequence(prismaMock, 1);
      prismaMock.order.create.mockRejectedValue(new Error('connection reset'));

      await expect(createDineIn()).rejects.toThrow('connection reset');
      expect(prismaMock.order.create).toHaveBeenCalledTimes(1);
    });
  });

  // ── create ────────────────────────────────────────────────────────────────

  describe('create', () => {
    it('creates order with correct subtotal when items supplied', async () => {
      prismaMock.restaurant.findFirst.mockResolvedValue(mockRestaurant);
      prismaMock.restaurantTable.findFirst.mockResolvedValue(mockTable);
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

    // A second round is now one tap away in the POS, so the bills it can reach
    // matter: a settled one would silently owe money again on a receipt the
    // guest is already holding.
    it.each(['PAID', 'REFUNDED'])(
      'refuses a second round on a %s bill and never writes the item',
      async (paymentStatus) => {
        prismaMock.order.findFirst.mockResolvedValue(
          makeOrder({ status: 'SERVED', paymentStatus }),
        );

        await expect(
          orderService.addItem(
            RESTAURANT_ID,
            ORDER_ID,
            { menuItemId: 'mi-1', quantity: 1 },
            TENANT_ID,
          ),
        ).rejects.toThrow(BadRequestException);
        expect(prismaMock.orderItem.create).not.toHaveBeenCalled();
      },
    );

    it('lets a part-paid bill keep ordering — the party has not left', async () => {
      prismaMock.order.findFirst.mockResolvedValue(
        makeOrder({ status: 'SERVED', paymentStatus: 'PARTIAL' }),
      );
      prismaMock.menuItem.findFirst.mockResolvedValue(mockMenuItem);
      prismaMock.orderItem.create.mockResolvedValue({ id: 'oi-2', totalPrice: 120 });
      prismaMock.orderItem.findMany.mockResolvedValue([{ totalPrice: 120 }]);
      prismaMock.order.update.mockResolvedValue({});

      await expect(
        orderService.addItem(
          RESTAURANT_ID,
          ORDER_ID,
          { menuItemId: 'mi-1', quantity: 1 },
          TENANT_ID,
        ),
      ).resolves.toBeDefined();
    });

    // Adding to a bill mid-service is the whole point of the new POS action.
    it('accepts a round on a bill that is already SERVED', async () => {
      prismaMock.order.findFirst.mockResolvedValue(
        makeOrder({ status: 'SERVED', paymentStatus: 'UNPAID' }),
      );
      prismaMock.menuItem.findFirst.mockResolvedValue(mockMenuItem);
      prismaMock.orderItem.create.mockResolvedValue({ id: 'oi-3', totalPrice: 120 });
      prismaMock.orderItem.findMany.mockResolvedValue([{ totalPrice: 120 }]);
      prismaMock.order.update.mockResolvedValue({});

      await expect(
        orderService.addItem(
          RESTAURANT_ID,
          ORDER_ID,
          { menuItemId: 'mi-1', quantity: 1 },
          TENANT_ID,
        ),
      ).resolves.toBeDefined();
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

    it('sends a second round on a bill that is already cooking', async () => {
      // Round two goes onto the bill that is already open, so a PREPARING order
      // must still accept a new ticket — otherwise the POS is forced to open a
      // second bill for the same table.
      prismaMock.order.findFirst
        .mockResolvedValueOnce(makeOrder({ status: 'PREPARING', items: [pendingItem] }))
        .mockResolvedValueOnce(
          makeOrder({
            status: 'PREPARING',
            items: [{ ...pendingItem, sentToKitchen: true, status: 'SENT' }],
          }),
        );

      prismaMock.$transaction.mockResolvedValue([
        { count: 1 },
        makeOrder({ status: 'PREPARING' }),
        { id: 'ko-2', orderId: ORDER_ID },
      ]);

      await orderService.sendToKitchen(RESTAURANT_ID, ORDER_ID, TENANT_ID);

      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
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
      // No other bill is running on that table, so it is free to be cleaned.
      prismaMock.order.count.mockResolvedValue(0);

      await orderService.updateStatus(RESTAURANT_ID, ORDER_ID, 'COMPLETED' as any, TENANT_ID);

      expect(prismaMock.restaurantTable.update).toHaveBeenCalledWith({
        where: { id: TABLE_ID },
        data: { status: 'CLEANING' },
      });
    });

    it('leaves the table OCCUPIED while a real split bill is still open', async () => {
      prismaMock.order.findFirst.mockResolvedValue(
        makeOrder({ status: 'SERVED', tableId: TABLE_ID }),
      );
      prismaMock.order.update.mockResolvedValue(makeOrder({ status: 'COMPLETED' }));
      // A second party's bill (with items on it) is still open on the same table.
      prismaMock.order.count.mockResolvedValue(1);

      await orderService.updateStatus(RESTAURANT_ID, ORDER_ID, 'COMPLETED' as any, TENANT_ID);

      expect(prismaMock.restaurantTable.update).not.toHaveBeenCalled();
      // An item-less order must never be what holds the table, so the count query
      // only looks at orders that actually carry food.
      expect(prismaMock.order.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ items: { some: {} } }),
        }),
      );
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

    it('emits restaurant.order.completed with ordered items when COMPLETED (drives stock deduction)', async () => {
      prismaMock.order.findFirst.mockResolvedValue(
        makeOrder({ status: 'SERVED', tableId: null }),
      );
      prismaMock.order.update.mockResolvedValue(
        makeOrder({
          status: 'COMPLETED',
          items: [
            { menuItemId: 'mi-1', quantity: 2 },
            { menuItemId: 'mi-2', quantity: 1 },
          ],
        }),
      );
      prismaMock.restaurant.findFirst.mockResolvedValue({ propertyId: 'prop-1' });

      await orderService.updateStatus(RESTAURANT_ID, ORDER_ID, 'COMPLETED' as any, TENANT_ID, 'user-1');

      expect(eventEmitterMock.emit).toHaveBeenCalledWith(
        INVENTORY_EVENTS.RESTAURANT_ORDER_COMPLETED,
        expect.objectContaining({
          orderId: ORDER_ID,
          tenantId: TENANT_ID,
          restaurantId: RESTAURANT_ID,
          propertyId: 'prop-1',
          completedBy: 'user-1',
          items: [
            { menuItemId: 'mi-1', quantity: 2 },
            { menuItemId: 'mi-2', quantity: 1 },
          ],
        }),
      );
    });

    it('does NOT emit restaurant.order.completed for non-COMPLETED transitions', async () => {
      prismaMock.order.findFirst.mockResolvedValue(makeOrder({ status: 'PENDING' }));
      prismaMock.order.update.mockResolvedValue(makeOrder({ status: 'CONFIRMED' }));

      await orderService.updateStatus(RESTAURANT_ID, ORDER_ID, 'CONFIRMED' as any, TENANT_ID);

      expect(eventEmitterMock.emit).not.toHaveBeenCalled();
    });

    it('completes the order even if propertyId is missing (no emit, no throw)', async () => {
      prismaMock.order.findFirst.mockResolvedValue(
        makeOrder({ status: 'SERVED', tableId: null }),
      );
      prismaMock.order.update.mockResolvedValue(
        makeOrder({ status: 'COMPLETED', items: [{ menuItemId: 'mi-1', quantity: 1 }] }),
      );
      prismaMock.restaurant.findFirst.mockResolvedValue(null);

      const result = await orderService.updateStatus(
        RESTAURANT_ID,
        ORDER_ID,
        'COMPLETED' as any,
        TENANT_ID,
      );

      expect(result.status).toBe('COMPLETED');
      expect(eventEmitterMock.emit).not.toHaveBeenCalled();
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
