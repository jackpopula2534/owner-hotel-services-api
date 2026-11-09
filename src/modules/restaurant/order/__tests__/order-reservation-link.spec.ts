/**
 * A bill opened for a table booking belongs to that booking.
 *
 * The link column was already written on create, but the party's name was not —
 * so the POS showed "ลูกค้า —" on a bill it knew belonged to ปิยะ's booking, and
 * staff had to retype the name they had already taken over the phone. These specs
 * pin the two halves of the fix: the bill inherits the booking's guest, and both
 * read paths hand the booking back so the till can show it.
 */

import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import { OrderService } from '../order.service';
import { PrismaService } from '../../../../prisma/prisma.service';
import { MenuService } from '../../menu/menu.service';
import { menuStockProvider } from './menu-stock.stub';
import { AuditLogService } from '../../../../audit-log/audit-log.service';
import { FolioPostingService } from '@/modules/accounts-receivable/folio-posting/folio-posting.service';
import { buildFolioPostingStub } from './folio-posting.stub';
import { RevenuePostingService } from '@/modules/revenue/revenue-posting.service';
import { buildRevenuePostingStub } from '@/modules/revenue/__tests__/revenue-posting.stub';
import { OrderTypeEnum } from '../dto/create-order.dto';

describe('OrderService — reservation ↔ order link', () => {
  let service: OrderService;

  const prisma = {
    restaurant: { findFirst: jest.fn() },
    restaurantTable: { findFirst: jest.fn(), update: jest.fn() },
    tableReservation: { findFirst: jest.fn() },
    menuItem: { findMany: jest.fn() },
    order: { findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn(), create: jest.fn() },
    documentSequence: { findFirst: jest.fn(), create: jest.fn(), upsert: jest.fn() },
  };

  const audit = { logOrderCreate: jest.fn() };

  const RESTAURANT = 'rest-1';
  const TENANT = 'tenant-1';
  const TABLE = 'table-a1';
  const BOOKING = {
    id: 'res-1',
    guestName: 'ปิยะ ประสิทธิ์',
    partySize: 5,
  };

  /** The `data` Prisma was asked to write for the new bill. */
  const createdData = () => prisma.order.create.mock.calls[0][0].data;

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleRef = await Test.createTestingModule({
      providers: [
        OrderService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: () => 'http://localhost:9010' } },
        { provide: MenuService, useValue: {} },
        menuStockProvider(),
        { provide: AuditLogService, useValue: audit },
        { provide: FolioPostingService, useValue: buildFolioPostingStub() },
        { provide: RevenuePostingService, useValue: buildRevenuePostingStub() },
      ],
    }).compile();
    service = moduleRef.get(OrderService);

    prisma.restaurant.findFirst.mockResolvedValue({ id: RESTAURANT, tenantId: TENANT });
    prisma.restaurantTable.findFirst.mockResolvedValue({ id: TABLE, tenantId: TENANT });
    prisma.tableReservation.findFirst.mockResolvedValue(null);
    prisma.menuItem.findMany.mockResolvedValue([]);
    prisma.order.count.mockResolvedValue(0);
    // generateOrderNumber draws from the per-tenant counter row.
    prisma.documentSequence.findFirst.mockResolvedValue({ id: 'seq-1' });
    prisma.documentSequence.upsert.mockResolvedValue({ lastNumber: 1 });
    prisma.order.create.mockImplementation(({ data }: any) => ({ id: 'order-1', ...data }));
    prisma.order.findMany.mockResolvedValue([]);
  });

  describe('create — inheriting the party from the booking', () => {
    it('copies the seated booking’s guest and party size onto a bill that names neither', async () => {
      prisma.tableReservation.findFirst.mockResolvedValue(BOOKING);

      await service.create(
        RESTAURANT,
        { orderType: OrderTypeEnum.DINE_IN, tableId: TABLE } as any,
        TENANT,
      );

      expect(createdData()).toMatchObject({
        reservationId: BOOKING.id,
        guestName: BOOKING.guestName,
        partySize: BOOKING.partySize,
      });
    });

    it('adopts by table only — the seated party at that table, latest seating first', async () => {
      prisma.tableReservation.findFirst.mockResolvedValue(BOOKING);

      await service.create(
        RESTAURANT,
        { orderType: OrderTypeEnum.DINE_IN, tableId: TABLE } as any,
        TENANT,
      );

      expect(prisma.tableReservation.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tableId: TABLE, status: 'SEATED', tenantId: TENANT }),
          orderBy: { seatedAt: 'desc' },
        }),
      );
    });

    it('keeps what the floor typed — a name on the order is not overwritten by the booking', async () => {
      prisma.tableReservation.findFirst.mockResolvedValue(BOOKING);

      await service.create(
        RESTAURANT,
        {
          orderType: OrderTypeEnum.DINE_IN,
          tableId: TABLE,
          guestName: 'คุณสมชาย',
          partySize: 2,
        } as any,
        TENANT,
      );

      expect(createdData()).toMatchObject({
        reservationId: BOOKING.id,
        guestName: 'คุณสมชาย',
        partySize: 2,
      });
    });

    it('honours an explicit reservationId and inherits from it', async () => {
      prisma.tableReservation.findFirst.mockResolvedValue(BOOKING);

      await service.create(
        RESTAURANT,
        { orderType: OrderTypeEnum.DINE_IN, tableId: TABLE, reservationId: BOOKING.id } as any,
        TENANT,
      );

      expect(prisma.tableReservation.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: BOOKING.id }) }),
      );
      expect(createdData()).toMatchObject({
        reservationId: BOOKING.id,
        guestName: BOOKING.guestName,
      });
    });

    it('rejects a reservationId from another restaurant instead of silently unlinking', async () => {
      prisma.tableReservation.findFirst.mockResolvedValue(null);

      await expect(
        service.create(
          RESTAURANT,
          { orderType: OrderTypeEnum.DINE_IN, tableId: TABLE, reservationId: 'res-elsewhere' } as any,
          TENANT,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('leaves a walk-in unlinked and un-named', async () => {
      await service.create(
        RESTAURANT,
        { orderType: OrderTypeEnum.DINE_IN, tableId: TABLE } as any,
        TENANT,
      );

      expect(createdData()).toMatchObject({ reservationId: null });
      expect(createdData().guestName).toBeUndefined();
      expect(createdData().partySize).toBeUndefined();
    });

    it('never looks for a booking when there is no table (takeaway / delivery)', async () => {
      await service.create(RESTAURANT, { orderType: OrderTypeEnum.TAKEAWAY } as any, TENANT);

      expect(prisma.tableReservation.findFirst).not.toHaveBeenCalled();
      expect(createdData().reservationId).toBeNull();
    });

    it('hands the booking back on the created bill so the till can show it at once', async () => {
      prisma.tableReservation.findFirst.mockResolvedValue(BOOKING);

      await service.create(
        RESTAURANT,
        { orderType: OrderTypeEnum.DINE_IN, tableId: TABLE } as any,
        TENANT,
      );

      const { include } = prisma.order.create.mock.calls[0][0];
      expect(include.reservation.select).toMatchObject({ guestName: true, partySize: true });
    });
  });

  describe('read paths — the link has to survive the trip to the POS', () => {
    it('includes the booking on every row of the order list', async () => {
      await service.findAll(RESTAURANT, {}, TENANT);

      const { include } = prisma.order.findMany.mock.calls[0][0];
      expect(include.reservation.select).toMatchObject({
        id: true,
        guestName: true,
        partySize: true,
        status: true,
      });
    });

    it('includes the booking on a single bill', async () => {
      prisma.order.findFirst.mockResolvedValue({ id: 'order-1' });

      await service.findOne(RESTAURANT, 'order-1', TENANT);

      const { include } = prisma.order.findFirst.mock.calls[0][0];
      expect(include.reservation.select).toMatchObject({ id: true, guestName: true });
    });

    it('does not leak the booking’s e-mail address onto the bill', async () => {
      await service.findAll(RESTAURANT, {}, TENANT);

      const { include } = prisma.order.findMany.mock.calls[0][0];
      expect(include.reservation.select).not.toHaveProperty('guestEmail');
      expect(include.reservation.select).not.toHaveProperty('notes');
    });
  });
});
