import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { MenuService } from '../modules/restaurant/menu/menu.service';
import { TableService } from '../modules/restaurant/table/table.service';
import { ReservationService } from '../modules/restaurant/reservation/reservation.service';
import { OrderService } from '../modules/restaurant/order/order.service';
import { KitchenService } from '../modules/restaurant/kitchen/kitchen.service';
import { PrismaService } from '../prisma/prisma.service';

// ─── Prisma Mock Factory ──────────────────────────────────────────────────────

const makePrismaMock = () => ({
  restaurant: {
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    findMany: jest.fn(),
  },
  menuCategory: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    delete: jest.fn(),
    aggregate: jest.fn(),
    count: jest.fn(),
  },
  menuItem: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    aggregate: jest.fn(),
    count: jest.fn(),
  },
  restaurantTable: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    delete: jest.fn(),
  },
  tableReservation: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
  },
  order: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
  },
  orderItem: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
  },
  kitchenOrder: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
    findUnique: jest.fn(),
  },
  $transaction: jest.fn((ops) => {
    if (Array.isArray(ops)) return Promise.all(ops);
    return ops(prismaMock);
  }),
});

// Shared mock instance
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let prismaMock: any;

// ─── Menu Service Tests ───────────────────────────────────────────────────────

describe('MenuService', () => {
  let menuService: MenuService;

  const RESTAURANT_ID = 'rest-1';
  const TENANT_ID = 'tenant-1';
  const mockRestaurant = { id: RESTAURANT_ID, tenantId: TENANT_ID, name: 'Test Restaurant' };
  const mockCategory = {
    id: 'cat-1',
    name: 'Starters',
    restaurantId: RESTAURANT_ID,
    tenantId: TENANT_ID,
    displayOrder: 0,
    isActive: true,
  };

  beforeEach(async () => {
    prismaMock = makePrismaMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MenuService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    menuService = module.get<MenuService>(MenuService);
  });

  describe('findAllCategories', () => {
    it('returns categories for a valid restaurant', async () => {
      prismaMock.restaurant.findFirst.mockResolvedValue(mockRestaurant);
      prismaMock.menuCategory.findMany.mockResolvedValue([mockCategory]);

      const result = await menuService.findAllCategories(RESTAURANT_ID, TENANT_ID);

      expect(result).toEqual([mockCategory]);
      expect(prismaMock.menuCategory.findMany).toHaveBeenCalledWith({
        where: { restaurantId: RESTAURANT_ID, tenantId: TENANT_ID },
        orderBy: { displayOrder: 'asc' },
        include: { _count: { select: { items: true } } },
      });
    });

    it('throws NotFoundException for unknown restaurant', async () => {
      prismaMock.restaurant.findFirst.mockResolvedValue(null);

      await expect(
        menuService.findAllCategories(RESTAURANT_ID, TENANT_ID),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('createCategory', () => {
    it('creates a category with auto-incremented displayOrder', async () => {
      prismaMock.restaurant.findFirst.mockResolvedValue(mockRestaurant);
      prismaMock.menuCategory.aggregate.mockResolvedValue({ _max: { displayOrder: 2 } });
      prismaMock.menuCategory.create.mockResolvedValue({ ...mockCategory, displayOrder: 3 });

      const result = await menuService.createCategory(
        RESTAURANT_ID,
        { name: 'Mains' },
        TENANT_ID,
      );

      expect(result.displayOrder).toBe(3);
      expect(prismaMock.menuCategory.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ displayOrder: 3 }) }),
      );
    });
  });

  describe('removeCategory', () => {
    it('deletes a category with no active items', async () => {
      prismaMock.menuCategory.findFirst.mockResolvedValue(mockCategory);
      prismaMock.menuItem.count.mockResolvedValue(0);
      prismaMock.menuCategory.delete.mockResolvedValue(mockCategory);

      await expect(
        menuService.removeCategory(RESTAURANT_ID, 'cat-1', TENANT_ID),
      ).resolves.not.toThrow();
    });

    it('throws BadRequestException when category has active items', async () => {
      prismaMock.menuCategory.findFirst.mockResolvedValue(mockCategory);
      prismaMock.menuItem.count.mockResolvedValue(3);

      await expect(
        menuService.removeCategory(RESTAURANT_ID, 'cat-1', TENANT_ID),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException for missing category', async () => {
      prismaMock.menuCategory.findFirst.mockResolvedValue(null);

      await expect(
        menuService.removeCategory(RESTAURANT_ID, 'cat-999', TENANT_ID),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('toggleAvailability', () => {
    it('updates isAvailable flag', async () => {
      const mockItem = { id: 'item-1', restaurantId: RESTAURANT_ID, tenantId: TENANT_ID };
      prismaMock.menuItem.findFirst.mockResolvedValue(mockItem);
      prismaMock.menuItem.update.mockResolvedValue({ ...mockItem, isAvailable: false });

      const result = await menuService.toggleAvailability(RESTAURANT_ID, 'item-1', false, TENANT_ID);

      expect(result.isAvailable).toBe(false);
      expect(prismaMock.menuItem.update).toHaveBeenCalledWith({
        where: { id: 'item-1' },
        data: { isAvailable: false },
      });
    });
  });
});

// ─── Table Service Tests ──────────────────────────────────────────────────────

describe('TableService', () => {
  let tableService: TableService;

  const RESTAURANT_ID = 'rest-1';
  const TENANT_ID = 'tenant-1';
  const mockRestaurant = { id: RESTAURANT_ID, tenantId: TENANT_ID };
  const mockTable = {
    id: 'tbl-1',
    tableNumber: 'T01',
    capacity: 4,
    status: 'AVAILABLE',
    restaurantId: RESTAURANT_ID,
    tenantId: TENANT_ID,
    isActive: true,
  };

  beforeEach(async () => {
    prismaMock = makePrismaMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TableService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    tableService = module.get<TableService>(TableService);
  });

  describe('create', () => {
    it('creates a new table', async () => {
      prismaMock.restaurant.findFirst.mockResolvedValue(mockRestaurant);
      prismaMock.restaurantTable.findFirst.mockResolvedValue(null); // no conflict
      prismaMock.restaurantTable.create.mockResolvedValue(mockTable);

      const result = await tableService.create(
        RESTAURANT_ID,
        { tableNumber: 'T01', capacity: 4 },
        TENANT_ID,
      );

      expect(result).toEqual(mockTable);
    });

    it('throws ConflictException for duplicate table number', async () => {
      prismaMock.restaurant.findFirst.mockResolvedValue(mockRestaurant);
      prismaMock.restaurantTable.findFirst.mockResolvedValue(mockTable); // conflict exists

      await expect(
        tableService.create(RESTAURANT_ID, { tableNumber: 'T01', capacity: 4 }, TENANT_ID),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('remove', () => {
    it('deletes an available table', async () => {
      prismaMock.restaurantTable.findFirst.mockResolvedValue(mockTable);
      prismaMock.restaurantTable.delete.mockResolvedValue(mockTable);

      await expect(
        tableService.remove(RESTAURANT_ID, 'tbl-1', TENANT_ID),
      ).resolves.not.toThrow();
    });

    it('throws BadRequestException for occupied table', async () => {
      prismaMock.restaurantTable.findFirst.mockResolvedValue({ ...mockTable, status: 'OCCUPIED' });

      await expect(
        tableService.remove(RESTAURANT_ID, 'tbl-1', TENANT_ID),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('checkAvailability', () => {
    it('marks tables without conflicting reservations as available', async () => {
      prismaMock.restaurant.findFirst.mockResolvedValue(mockRestaurant);
      prismaMock.restaurantTable.findMany.mockResolvedValue([mockTable]);
      prismaMock.tableReservation.findMany.mockResolvedValue([]); // no reservations

      const result = await tableService.checkAvailability(
        RESTAURANT_ID,
        { date: '2026-04-10', startTime: '19:00' },
        TENANT_ID,
      );

      expect(result[0].isAvailable).toBe(true);
    });

    it('marks tables with active reservations as unavailable', async () => {
      prismaMock.restaurant.findFirst.mockResolvedValue(mockRestaurant);
      prismaMock.restaurantTable.findMany.mockResolvedValue([mockTable]);
      prismaMock.tableReservation.findMany.mockResolvedValue([{ tableId: 'tbl-1' }]);

      const result = await tableService.checkAvailability(
        RESTAURANT_ID,
        { date: '2026-04-10', startTime: '19:00' },
        TENANT_ID,
      );

      expect(result[0].isAvailable).toBe(false);
    });
  });
});

// ─── Reservation Service Tests ────────────────────────────────────────────────

describe('ReservationService', () => {
  let reservationService: ReservationService;

  const RESTAURANT_ID = 'rest-1';
  const TENANT_ID = 'tenant-1';
  const mockTable = { id: 'tbl-1', tableNumber: 'T01', capacity: 4, restaurantId: RESTAURANT_ID, tenantId: TENANT_ID, isActive: true };
  const mockReservation = {
    id: 'rsv-1',
    tableId: 'tbl-1',
    restaurantId: RESTAURANT_ID,
    tenantId: TENANT_ID,
    status: 'PENDING',
    partySize: 2,
    reservationDate: new Date('2026-04-15'),
    startTime: '19:00',
  };

  beforeEach(async () => {
    prismaMock = makePrismaMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReservationService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    reservationService = module.get<ReservationService>(ReservationService);
  });

  describe('create', () => {
    it('creates reservation when no conflict exists', async () => {
      prismaMock.restaurantTable.findFirst.mockResolvedValue(mockTable);
      prismaMock.tableReservation.findFirst.mockResolvedValue(null); // no conflict
      prismaMock.tableReservation.create.mockResolvedValue(mockReservation);

      const result = await reservationService.create(
        RESTAURANT_ID,
        {
          tableId: 'tbl-1',
          partySize: 2,
          reservationDate: '2026-04-15',
          startTime: '19:00',
          guestName: 'John Doe',
          guestPhone: '+66812345678',
        },
        TENANT_ID,
      );

      expect(result).toEqual(mockReservation);
    });

    it('throws BadRequestException when party size exceeds capacity', async () => {
      prismaMock.restaurantTable.findFirst.mockResolvedValue({ ...mockTable, capacity: 2 });

      await expect(
        reservationService.create(
          RESTAURANT_ID,
          { tableId: 'tbl-1', partySize: 6, reservationDate: '2026-04-15', startTime: '19:00', guestName: 'A', guestPhone: 'B' },
          TENANT_ID,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ConflictException for duplicate time slot', async () => {
      prismaMock.restaurantTable.findFirst.mockResolvedValue(mockTable);
      prismaMock.tableReservation.findFirst.mockResolvedValue(mockReservation); // conflict

      await expect(
        reservationService.create(
          RESTAURANT_ID,
          { tableId: 'tbl-1', partySize: 2, reservationDate: '2026-04-15', startTime: '19:00', guestName: 'A', guestPhone: 'B' },
          TENANT_ID,
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('markAsNoShow', () => {
    it('marks a CONFIRMED reservation as NO_SHOW', async () => {
      prismaMock.tableReservation.findFirst.mockResolvedValue({ ...mockReservation, status: 'CONFIRMED' });
      prismaMock.tableReservation.update.mockResolvedValue({ ...mockReservation, status: 'NO_SHOW' });

      const result = await reservationService.markAsNoShow(RESTAURANT_ID, 'rsv-1', TENANT_ID);

      expect(result.status).toBe('NO_SHOW');
    });

    it('throws BadRequestException for already SEATED reservation', async () => {
      prismaMock.tableReservation.findFirst.mockResolvedValue({ ...mockReservation, status: 'SEATED' });

      await expect(
        reservationService.markAsNoShow(RESTAURANT_ID, 'rsv-1', TENANT_ID),
      ).rejects.toThrow(BadRequestException);
    });
  });
});

// ─── Kitchen Service Tests ────────────────────────────────────────────────────

describe('KitchenService', () => {
  let kitchenService: KitchenService;

  const RESTAURANT_ID = 'rest-1';
  const TENANT_ID = 'tenant-1';
  const ORDER_ID = 'ord-1';
  const KO_ID = 'ko-1';
  const now = new Date();

  const mockKitchenOrder = {
    id: KO_ID,
    orderId: ORDER_ID,
    tenantId: TENANT_ID,
    status: 'SENT',
    priority: 'NORMAL',
    stationName: null,
    notes: null,
    createdAt: now,
    startedAt: null,
    completedAt: null,
    order: { restaurantId: RESTAURANT_ID },
  };

  beforeEach(async () => {
    prismaMock = makePrismaMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KitchenService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    kitchenService = module.get<KitchenService>(KitchenService);
  });

  describe('startOrder', () => {
    it('transitions SENT kitchen order to PREPARING', async () => {
      prismaMock.kitchenOrder.findFirst.mockResolvedValue(mockKitchenOrder);
      const updatedKO = { ...mockKitchenOrder, status: 'PREPARING', startedAt: now };
      prismaMock.$transaction.mockResolvedValue([updatedKO, { count: 2 }]);

      const result = await kitchenService.startOrder(RESTAURANT_ID, KO_ID, TENANT_ID);

      expect(result.status).toBe('PREPARING');
    });

    it('throws BadRequestException if order is already PREPARING', async () => {
      prismaMock.kitchenOrder.findFirst.mockResolvedValue({
        ...mockKitchenOrder,
        status: 'PREPARING',
      });

      await expect(
        kitchenService.startOrder(RESTAURANT_ID, KO_ID, TENANT_ID),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('completeOrder', () => {
    it('marks order and items as READY', async () => {
      prismaMock.kitchenOrder.findFirst.mockResolvedValue({
        ...mockKitchenOrder,
        status: 'PREPARING',
        startedAt: now,
      });
      prismaMock.$transaction.mockResolvedValue([undefined, undefined, undefined]);
      prismaMock.kitchenOrder.findUnique.mockResolvedValue({
        ...mockKitchenOrder,
        status: 'READY',
        completedAt: now,
      });

      const result = await kitchenService.completeOrder(RESTAURANT_ID, KO_ID, TENANT_ID);

      expect(result.status).toBe('READY');
    });

    it('throws BadRequestException if order is already READY', async () => {
      prismaMock.kitchenOrder.findFirst.mockResolvedValue({
        ...mockKitchenOrder,
        status: 'READY',
      });

      await expect(
        kitchenService.completeOrder(RESTAURANT_ID, KO_ID, TENANT_ID),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getStats', () => {
    it('returns queue and completion stats', async () => {
      prismaMock.kitchenOrder.count
        .mockResolvedValueOnce(3)  // inQueue
        .mockResolvedValueOnce(12); // completedToday
      prismaMock.kitchenOrder.findMany.mockResolvedValue([
        { startedAt: new Date(now.getTime() - 8 * 60 * 1000), completedAt: now },
        { startedAt: new Date(now.getTime() - 12 * 60 * 1000), completedAt: now },
      ]);

      const result = await kitchenService.getStats(RESTAURANT_ID, TENANT_ID);

      expect(result.inQueue).toBe(3);
      expect(result.completedToday).toBe(12);
      expect(result.avgPrepTimeMinutes).toBe(10); // avg of 8 and 12 = 10 min
      expect(result.sampleSize).toBe(2);
    });
  });

  describe('updateItemStatus', () => {
    it('updates item to READY with preparedAt timestamp', async () => {
      const mockItem = {
        id: 'item-1',
        order: { restaurantId: RESTAURANT_ID, tenantId: TENANT_ID },
      };
      prismaMock.orderItem.findFirst.mockResolvedValue(mockItem);
      prismaMock.orderItem.update.mockResolvedValue({ ...mockItem, status: 'READY', preparedAt: now });

      const result = await kitchenService.updateItemStatus(RESTAURANT_ID, 'item-1', 'READY', TENANT_ID);

      expect(prismaMock.orderItem.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'READY', preparedAt: expect.any(Date) }),
        }),
      );
    });

    it('throws BadRequestException for invalid status', async () => {
      const mockItem = {
        id: 'item-1',
        order: { restaurantId: RESTAURANT_ID, tenantId: TENANT_ID },
      };
      prismaMock.orderItem.findFirst.mockResolvedValue(mockItem);

      await expect(
        kitchenService.updateItemStatus(RESTAURANT_ID, 'item-1', 'INVALID' as any, TENANT_ID),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
