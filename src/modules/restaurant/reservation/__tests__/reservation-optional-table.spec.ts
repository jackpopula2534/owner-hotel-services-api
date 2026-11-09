/**
 * Bookings taken without a table.
 *
 * A party can be booked by name, time and head-count only; staff choose the
 * table when the party orders (POS order dialog), which writes the table back
 * onto the booking. Until then nothing on the floor is held for it.
 */

import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { ReservationService } from '../reservation.service';
import { PrismaService } from '../../../../prisma/prisma.service';
import { AuditLogService } from '../../../../audit-log/audit-log.service';

describe('ReservationService — booking without a table', () => {
  let service: ReservationService;
  const RESTAURANT = 'rest-1';
  const TENANT = 'tenant-1';

  const prisma = {
    restaurantTable: { findFirst: jest.fn(), update: jest.fn((a) => ({ op: 'table.update', ...a })), updateMany: jest.fn((a) => ({ op: 'table.updateMany', ...a })) },
    tableReservation: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn((a) => ({ op: 'reservation.update', ...a })),
    },
    order: { count: jest.fn(), findFirst: jest.fn(), updateMany: jest.fn((a) => ({ op: 'order.updateMany', ...a })) },
    $transaction: jest.fn(async (ops: unknown[]) => ops),
  };

  const seatedNoTable = {
    id: 'res-1',
    restaurantId: RESTAURANT,
    tenantId: TENANT,
    tableId: null,
    table: null,
    guestName: 'สมหญิง มั่นคง',
    partySize: 6,
    reservationDate: new Date('2026-10-27T00:00:00Z'),
    startTime: '19:00',
    endTime: '21:00',
    status: 'SEATED',
    orders: [],
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        ReservationService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogService, useValue: { log: jest.fn() } },
      ],
    }).compile();
    service = moduleRef.get(ReservationService);
    prisma.tableReservation.findMany.mockResolvedValue([]);
    prisma.order.count.mockResolvedValue(0);
  });

  it('creates a booking with no table and checks no table', async () => {
    prisma.tableReservation.create.mockResolvedValue({ id: 'res-1', tableId: null });
    await service.create(
      RESTAURANT,
      { guestName: 'สมหญิง', partySize: 6, reservationDate: '2026-10-27', startTime: '19:00', endTime: '21:00' },
      TENANT,
    );
    expect(prisma.restaurantTable.findFirst).not.toHaveBeenCalled();
    expect(prisma.tableReservation.create.mock.calls[0][0].data).not.toHaveProperty('tableId');
  });

  it('still rejects a bad time when there is no table to check against', async () => {
    await expect(
      service.create(RESTAURANT, { guestName: 'x', partySize: 2, reservationDate: '2026-10-27', startTime: '25:00' }, TENANT),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('seats a party that has no table yet without touching the floor', async () => {
    prisma.tableReservation.findFirst.mockResolvedValue({ ...seatedNoTable, status: 'CONFIRMED' });
    await service.seat(RESTAURANT, 'res-1', TENANT);
    const ops = prisma.$transaction.mock.calls[0][0];
    expect(ops).toHaveLength(1);
    expect(prisma.restaurantTable.update).not.toHaveBeenCalled();
    expect(prisma.order.findFirst).not.toHaveBeenCalled();
  });

  it('assigning a table to a seated party occupies it and moves its live bills there', async () => {
    prisma.tableReservation.findFirst.mockResolvedValue(seatedNoTable);
    prisma.restaurantTable.findFirst.mockResolvedValue({ id: 'b1', tableNumber: 'B1', capacity: 6 });
    await service.update(RESTAURANT, 'res-1', { tableId: 'b1' }, TENANT);

    const ops = prisma.$transaction.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(ops[0]).toMatchObject({ op: 'reservation.update', data: { tableId: 'b1' } });
    expect(ops).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ op: 'order.updateMany', data: { tableId: 'b1' } }),
        expect.objectContaining({ op: 'table.update', where: { id: 'b1' }, data: { status: 'OCCUPIED' } }),
      ]),
    );
  });

  it('refuses a table that is too small or already booked for the slot', async () => {
    prisma.tableReservation.findFirst.mockResolvedValue(seatedNoTable);
    prisma.restaurantTable.findFirst.mockResolvedValue({ id: 't3', tableNumber: 'T3', capacity: 4 });
    await expect(service.update(RESTAURANT, 'res-1', { tableId: 't3' }, TENANT)).rejects.toBeInstanceOf(BadRequestException);

    prisma.restaurantTable.findFirst.mockResolvedValue({ id: 'b2', tableNumber: 'B2', capacity: 6 });
    prisma.tableReservation.findMany.mockResolvedValue([{ startTime: '20:30', endTime: '22:00' }]);
    await expect(service.update(RESTAURANT, 'res-1', { tableId: 'b2' }, TENANT)).rejects.toBeInstanceOf(ConflictException);
  });

  it('a plain edit cannot move a seated party off its table — that goes through moveTable', async () => {
    prisma.tableReservation.findFirst.mockResolvedValue({
      ...seatedNoTable,
      tableId: 'p1',
      table: { id: 'p1', tableNumber: 'P1', status: 'OCCUPIED' },
    });
    await expect(service.update(RESTAURANT, 'res-1', { tableId: 'b1' }, TENANT)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
