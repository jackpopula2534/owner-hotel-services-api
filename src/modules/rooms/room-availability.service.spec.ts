import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { RoomAvailabilityService } from './room-availability.service';

describe('RoomAvailabilityService', () => {
  let service: RoomAvailabilityService;

  const prismaMock = {
    room: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    booking: {
      findMany: jest.fn(),
    },
    property: {
      findFirst: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoomAvailabilityService,
        {
          provide: PrismaService,
          useValue: prismaMock,
        },
      ],
    }).compile();

    service = module.get(RoomAvailabilityService);
    jest.clearAllMocks();
  });

  describe('checkRoomAvailable', () => {
    it('throws when tenantId is missing', async () => {
      await expect(
        service.checkRoomAvailable(
          'room-1',
          new Date('2026-04-10T14:00:00.000Z'),
          new Date('2026-04-11T11:00:00.000Z'),
          '',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('returns unavailable when requested stay overlaps an existing scheduled booking', async () => {
      prismaMock.room.findFirst.mockResolvedValue({
        id: 'room-1',
        tenantId: 'tenant-1',
        property: { cleaningBufferMinutes: 90 },
      });
      prismaMock.booking.findMany.mockResolvedValue([
        {
          id: 'booking-1',
          scheduledCheckIn: new Date('2026-04-10T14:00:00.000Z'),
          scheduledCheckOut: new Date('2026-04-11T11:00:00.000Z'),
          actualCheckOut: null,
          status: 'confirmed',
        },
      ]);

      const result = await service.checkRoomAvailable(
        'room-1',
        new Date('2026-04-10T16:00:00.000Z'),
        new Date('2026-04-10T18:00:00.000Z'),
        'tenant-1',
      );

      // nextAvailableAt = scheduledCheckOut + 90min cleaning buffer
      expect(result).toEqual({
        available: false,
        reason: 'Booking booking-1 (incl. cleaning buffer)',
        nextAvailableAt: new Date('2026-04-11T12:30:00.000Z'),
      });
    });

    it('allows back-to-back booking when gap >= cleaning buffer', async () => {
      // Existing checkout 12:00 + 60min buffer = available at 13:00
      // New check-in at 14:00 → OK
      prismaMock.room.findFirst.mockResolvedValue({
        id: 'room-1',
        tenantId: 'tenant-1',
        property: { cleaningBufferMinutes: 60 },
      });
      prismaMock.booking.findMany.mockResolvedValue([
        {
          id: 'prev-booking',
          scheduledCheckIn: new Date('2026-05-13T07:00:00.000Z'), // May 13 14:00 BKK
          scheduledCheckOut: new Date('2026-05-14T05:00:00.000Z'), // May 14 12:00 BKK
          actualCheckOut: null,
          status: 'confirmed',
        },
      ]);

      const result = await service.checkRoomAvailable(
        'room-1',
        new Date('2026-05-14T07:00:00.000Z'), // May 14 14:00 BKK
        new Date('2026-05-15T05:00:00.000Z'), // May 15 12:00 BKK
        'tenant-1',
      );

      expect(result.available).toBe(true);
    });

    it('blocks back-to-back booking when gap < cleaning buffer', async () => {
      // Existing checkout 12:00 + 60min buffer = available at 13:00
      // New check-in at 12:30 → BLOCKED (only 30min gap, need 60min)
      prismaMock.room.findFirst.mockResolvedValue({
        id: 'room-1',
        tenantId: 'tenant-1',
        property: { cleaningBufferMinutes: 60 },
      });
      prismaMock.booking.findMany.mockResolvedValue([
        {
          id: 'prev-booking',
          scheduledCheckIn: new Date('2026-05-13T07:00:00.000Z'),
          scheduledCheckOut: new Date('2026-05-14T05:00:00.000Z'), // May 14 12:00 BKK
          actualCheckOut: null,
          status: 'confirmed',
        },
      ]);

      const result = await service.checkRoomAvailable(
        'room-1',
        new Date('2026-05-14T05:30:00.000Z'), // May 14 12:30 BKK (only 30min after checkout)
        new Date('2026-05-15T05:00:00.000Z'),
        'tenant-1',
      );

      expect(result.available).toBe(false);
      expect(result.reason).toContain('cleaning buffer');
      expect(result.nextAvailableAt).toEqual(new Date('2026-05-14T06:00:00.000Z')); // 13:00 BKK
    });

    it('blocks a checked-out room until cleaning buffer ends', async () => {
      prismaMock.room.findFirst.mockResolvedValue({
        id: 'room-1',
        tenantId: 'tenant-1',
        property: { cleaningBufferMinutes: 60 },
      });
      prismaMock.booking.findMany.mockResolvedValue([
        {
          id: 'booking-2',
          scheduledCheckIn: new Date('2026-04-08T14:00:00.000Z'),
          scheduledCheckOut: new Date('2026-04-09T11:00:00.000Z'),
          actualCheckOut: new Date('2026-04-09T11:30:00.000Z'),
          status: 'checked_out',
        },
      ]);

      const result = await service.checkRoomAvailable(
        'room-1',
        new Date('2026-04-09T12:00:00.000Z'),
        new Date('2026-04-09T13:00:00.000Z'),
        'tenant-1',
      );

      expect(result.available).toBe(false);
      expect(result.reason).toBe('Cleaning buffer after booking booking-2');
      expect(result.nextAvailableAt).toEqual(new Date('2026-04-09T12:30:00.000Z'));
    });

    it('throws when room is not found', async () => {
      prismaMock.room.findFirst.mockResolvedValue(null);

      await expect(
        service.checkRoomAvailable(
          'missing-room',
          new Date('2026-04-10T14:00:00.000Z'),
          new Date('2026-04-11T11:00:00.000Z'),
          'tenant-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getAvailableRooms', () => {
    it('returns only rooms that pass availability checks and exposes property time settings', async () => {
      prismaMock.property.findFirst.mockResolvedValue({
        id: 'property-1',
        standardCheckInTime: '15:00',
        standardCheckOutTime: '12:00',
        cleaningBufferMinutes: 45,
      });
      prismaMock.room.findMany.mockResolvedValue([
        { id: 'room-1', number: '101', propertyId: 'property-1', tenantId: 'tenant-1' },
        { id: 'room-2', number: '102', propertyId: 'property-1', tenantId: 'tenant-1' },
      ]);
      prismaMock.booking.findMany.mockResolvedValue([]);

      const availabilitySpy = jest
        .spyOn(service, 'checkRoomAvailable')
        .mockResolvedValueOnce({ available: true })
        .mockResolvedValueOnce({ available: false, reason: 'Booking booking-1' });

      const result = await service.getAvailableRooms(
        'property-1',
        new Date('2026-04-10T15:00:00.000Z'),
        new Date('2026-04-11T12:00:00.000Z'),
        'tenant-1',
      );

      expect(result.rooms).toEqual([
        { id: 'room-1', number: '101', propertyId: 'property-1', tenantId: 'tenant-1' },
      ]);
      expect(result.propertyTimeSettings).toEqual({
        standardCheckInTime: '15:00',
        standardCheckOutTime: '12:00',
        cleaningBufferMinutes: 45,
      });
      expect(availabilitySpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('buildScheduledDateTime', () => {
    it('builds a check-in datetime using property defaults (Bangkok TZ, machine-independent)', async () => {
      prismaMock.property.findFirst.mockResolvedValue({
        standardCheckInTime: '15:30',
        standardCheckOutTime: '12:00',
      });

      const result = await service.buildScheduledDateTime('2026-04-15', 'checkIn', 'property-1');

      // 15:30 Bangkok = 08:30 UTC — assert via ISO string for TZ independence
      expect(result.toISOString()).toBe('2026-04-15T08:30:00.000Z');
    });

    it('throws on invalid date format', async () => {
      await expect(
        service.buildScheduledDateTime('15/04/2026', 'checkOut', 'property-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
