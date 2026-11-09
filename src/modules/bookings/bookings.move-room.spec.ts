import { BadRequestException, ConflictException } from '@nestjs/common';
import { BookingsService } from './bookings.service';
import { TaskType } from '../housekeeping/dto/create-housekeeping-task.dto';

/* eslint-disable @typescript-eslint/no-explicit-any */
function setup(booking: Record<string, any>, target: Record<string, any> | null = { id: 'r2', number: '305', status: 'available' }, clash: unknown = null) {
  const prisma: any = {
    booking: {
      findFirst: jest.fn().mockResolvedValueOnce(booking).mockResolvedValueOnce(clash),
      update: jest.fn().mockImplementation(({ data }) => ({ ...booking, ...data, room: { id: data.roomId, number: '305' }, guest: null, property: {} })),
    },
    room: { findFirst: jest.fn().mockResolvedValue(target), update: jest.fn().mockResolvedValue({}) },
  };
  prisma.$transaction = jest.fn(async (fn: (tx: unknown) => unknown) => fn(prisma));
  const hk = { createTask: jest.fn().mockResolvedValue({}) };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const svc = new BookingsService(prisma, { emit: jest.fn() } as any, {} as any, audit as any, {} as any, hk as any, {} as any, {} as any, {} as any, {} as any);
  return { svc, prisma, hk, audit };
}

const base = {
  id: 'b1',
  tenantId: 't1',
  propertyId: 'p1',
  roomId: 'r1',
  room: { id: 'r1', number: '304' },
  guestFirstName: 'Daniel',
  guestLastName: 'K',
  checkIn: new Date('2026-10-22T07:00:00Z'),
  checkOut: new Date('2026-10-25T05:00:00Z'),
};

describe('BookingsService.moveRoom', () => {
  it('in-house guest: new room occupied, old room dirty, housekeeping task + audit', async () => {
    const { svc, prisma, hk, audit } = setup({ ...base, status: 'checked_in' });
    await svc.moveRoom('b1', 'r2', 't1', 'u1', 'แอร์เสีย');
    expect(prisma.booking.update).toHaveBeenCalledWith(expect.objectContaining({ data: { roomId: 'r2' } }));
    expect(prisma.room.update).toHaveBeenCalledWith({ where: { id: 'r2' }, data: { status: 'occupied' } });
    expect(prisma.room.update).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { status: 'dirty' } });
    expect(hk.createTask).toHaveBeenCalledWith(expect.objectContaining({ roomId: 'r1', type: TaskType.CHECKOUT }), 't1');
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ description: expect.stringContaining('304 → 305') }));
  });

  it('future booking: only the room changes', async () => {
    const { svc, prisma, hk } = setup({ ...base, status: 'confirmed' });
    await svc.moveRoom('b1', 'r2', 't1');
    expect(prisma.room.update).not.toHaveBeenCalled();
    expect(hk.createTask).not.toHaveBeenCalled();
  });

  it('refuses closed rooms, clashes and finished bookings', async () => {
    await expect(setup({ ...base, status: 'confirmed' }, { id: 'r2', number: '305', status: 'maintenance' }).svc.moveRoom('b1', 'r2', 't1')).rejects.toBeInstanceOf(BadRequestException);
    await expect(setup({ ...base, status: 'confirmed' }, undefined, { guestFirstName: 'X' }).svc.moveRoom('b1', 'r2', 't1')).rejects.toBeInstanceOf(ConflictException);
    await expect(setup({ ...base, status: 'checked_out' }).svc.moveRoom('b1', 'r2', 't1')).rejects.toBeInstanceOf(BadRequestException);
  });
});
