/**
 * ย้ายโต๊ะ — moving a booking (and its open bills) to another table.
 * The only way to move a seated party: a reason is required, the bills move
 * with the party, the old table goes to CLEANING and the move is logged.
 */
import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { ReservationService } from '../reservation.service';
import { PrismaService } from '../../../../prisma/prisma.service';
import { AuditLogService } from '../../../../audit-log/audit-log.service';

describe('ReservationService.moveTable', () => {
  let service: ReservationService;
  const RESTAURANT = 'rest-1';
  const TENANT = 'tenant-1';
  const op = (name: string) => jest.fn((a) => ({ op: name, ...a }));
  const prisma = {
    restaurantTable: { findFirst: jest.fn(), update: op('table.update') },
    tableReservation: { findFirst: jest.fn(), findMany: jest.fn(), update: op('reservation.update') },
    order: { count: jest.fn(), updateMany: op('order.updateMany') },
    user: { findUnique: jest.fn() },
    $transaction: jest.fn(async (ops: unknown[]) => ops),
  };

  const seatedAtL4 = {
    id: 'res-1', restaurantId: RESTAURANT, tenantId: TENANT, guestName: 'พิชัย', partySize: 4,
    reservationDate: new Date('2026-10-27T00:00:00Z'), startTime: '19:30', endTime: '21:30', status: 'SEATED',
    tableId: 'l4', table: { id: 'l4', tableNumber: 'L4', status: 'OCCUPIED' }, tableMoves: null, orders: [],
  };
  const L1 = { id: 'l1', tableNumber: 'L1', capacity: 4, status: 'AVAILABLE' };

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
    prisma.tableReservation.findFirst.mockResolvedValue(seatedAtL4);
    prisma.tableReservation.findMany.mockResolvedValue([]);
    prisma.restaurantTable.findFirst.mockResolvedValue(L1);
    prisma.order.count.mockResolvedValue(0);
    prisma.user.findUnique.mockResolvedValue({ firstName: 'Premium', lastName: 'Tester', email: 'p@x.io' });
  });

  it('moves the party, its bills and the table statuses, and logs who and why', async () => {
    await service.moveTable(RESTAURANT, 'res-1', { tableId: 'l1', reason: 'ลูกค้าขอย้าย' }, TENANT, 'u1');
    const ops = prisma.$transaction.mock.calls[0][0] as Array<Record<string, any>>;
    expect(ops[0]).toMatchObject({ op: 'reservation.update', data: { tableId: 'l1' } });
    expect(ops[0].data.tableMoves).toEqual([
      expect.objectContaining({ fromTableNumber: 'L4', toTableNumber: 'L1', reason: 'ลูกค้าขอย้าย', byName: 'Premium Tester' }),
    ]);
    expect(ops).toEqual(expect.arrayContaining([
      expect.objectContaining({ op: 'order.updateMany', data: { tableId: 'l1' } }),
      expect.objectContaining({ op: 'table.update', where: { id: 'l4' }, data: { status: 'CLEANING' } }),
      expect.objectContaining({ op: 'table.update', where: { id: 'l1' }, data: { status: 'OCCUPIED' } }),
    ]));
  });

  it('keeps the old table occupied when another bill is still running there', async () => {
    prisma.order.count.mockImplementation(({ where }) => Promise.resolve(where.tableId === 'l4' ? 1 : 0));
    await service.moveTable(RESTAURANT, 'res-1', { tableId: 'l1', reason: 'โต๊ะมีปัญหา' }, TENANT);
    const ops = prisma.$transaction.mock.calls[0][0] as Array<Record<string, any>>;
    expect(ops.find((o) => o.op === 'table.update' && o.where.id === 'l4')).toBeUndefined();
  });

  it('appends to earlier moves', async () => {
    prisma.tableReservation.findFirst.mockResolvedValue({
      ...seatedAtL4,
      tableMoves: [{ fromTableNumber: 'P1', toTableNumber: 'L4', reason: 'x' }],
    });
    await service.moveTable(RESTAURANT, 'res-1', { tableId: 'l1', reason: 'จัดที่นั่งใหม่' }, TENANT);
    const ops = prisma.$transaction.mock.calls[0][0] as Array<Record<string, any>>;
    expect(ops[0].data.tableMoves.map((m: { toTableNumber: string }) => m.toTableNumber)).toEqual(['L4', 'L1']);
  });

  it('refuses the same table, a booking without a table, a closed booking', async () => {
    await expect(service.moveTable(RESTAURANT, 'res-1', { tableId: 'l4', reason: 'x' }, TENANT)).rejects.toBeInstanceOf(BadRequestException);
    prisma.tableReservation.findFirst.mockResolvedValue({ ...seatedAtL4, tableId: null, table: null });
    await expect(service.moveTable(RESTAURANT, 'res-1', { tableId: 'l1', reason: 'x' }, TENANT)).rejects.toBeInstanceOf(BadRequestException);
    prisma.tableReservation.findFirst.mockResolvedValue({ ...seatedAtL4, status: 'COMPLETED' });
    await expect(service.moveTable(RESTAURANT, 'res-1', { tableId: 'l1', reason: 'x' }, TENANT)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a table someone is eating at, one too small, or one booked in the slot', async () => {
    prisma.restaurantTable.findFirst.mockResolvedValue({ ...L1, status: 'OCCUPIED' });
    await expect(service.moveTable(RESTAURANT, 'res-1', { tableId: 'l1', reason: 'x' }, TENANT)).rejects.toBeInstanceOf(ConflictException);

    prisma.restaurantTable.findFirst.mockResolvedValue({ ...L1, capacity: 2 });
    await expect(service.moveTable(RESTAURANT, 'res-1', { tableId: 'l1', reason: 'x' }, TENANT)).rejects.toBeInstanceOf(BadRequestException);

    prisma.restaurantTable.findFirst.mockResolvedValue(L1);
    prisma.tableReservation.findMany.mockResolvedValue([{ startTime: '20:30', endTime: '22:00' }]);
    await expect(service.moveTable(RESTAURANT, 'res-1', { tableId: 'l1', reason: 'x' }, TENANT)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('a party not seated yet just moves its hold: old table released, new one held today', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-27T10:00:00Z'));
    prisma.tableReservation.findFirst.mockResolvedValue({
      ...seatedAtL4, status: 'CONFIRMED', table: { id: 'l4', tableNumber: 'L4', status: 'RESERVED' },
    });
    await service.moveTable(RESTAURANT, 'res-1', { tableId: 'l1', reason: 'จัดที่นั่งใหม่' }, TENANT);
    jest.useRealTimers();
    const ops = prisma.$transaction.mock.calls[0][0];
    expect(ops).toEqual(expect.arrayContaining([
      expect.objectContaining({ op: 'table.update', where: { id: 'l4' }, data: { status: 'AVAILABLE' } }),
      expect.objectContaining({ op: 'table.update', where: { id: 'l1' }, data: { status: 'RESERVED' } }),
    ]));
  });
});
