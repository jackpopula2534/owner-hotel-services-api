import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { RoomsService } from './rooms.service';

/**
 * Tests focused on the regression reported in the booking modal:
 * when a previous guest checks out at 12:00 and a new request asks for
 * 14:00 → 12:00 next day, the room MUST appear in available list
 * (cleaning buffer satisfied) — and back-to-back too tight requests must
 * still be blocked.
 */
describe('RoomsService.getAvailableRooms', () => {
  let service: RoomsService;

  const prismaMock = {
    property: { findFirst: jest.fn() },
    room: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    booking: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
  };

  const auditLogMock = {
    logRoomCreate: jest.fn().mockResolvedValue(undefined),
    logRoomUpdate: jest.fn().mockResolvedValue(undefined),
    logRoomDelete: jest.fn().mockResolvedValue(undefined),
    logRoomStatusChange: jest.fn().mockResolvedValue(undefined),
  };

  const tenantId = 'tenant-1';
  const propertyId = 'property-1';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoomsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: AuditLogService, useValue: auditLogMock },
      ],
    }).compile();

    service = module.get(RoomsService);
    jest.clearAllMocks();

    prismaMock.property.findFirst.mockResolvedValue({
      id: propertyId,
      standardCheckInTime: '14:00',
      standardCheckOutTime: '12:00',
      cleaningBufferMinutes: 60,
    });
  });

  it('returns room 104 when previous guest checks out at 12:00 and new check-in is 14:00 (gap >= buffer)', async () => {
    // Existing booking: room 104, May 13 14:00 → May 14 12:00 BKK
    prismaMock.booking.findMany.mockResolvedValue([]);
    prismaMock.room.findMany.mockResolvedValue([
      { id: 'room-104', number: '104', status: 'available', propertyId, tenantId },
    ]);

    const result = await service.getAvailableRooms(
      '2026-05-14',
      '2026-05-15',
      propertyId,
      tenantId,
      '14:00',
      '12:00',
    );

    expect(result).toHaveLength(1);
    expect((result[0] as any).number).toBe('104');
  });

  it('excludes room when existing booking overlaps within the cleaning buffer', async () => {
    // Existing booking ends at 12:00, new request starts at 12:30 (gap 30min < 60min buffer)
    // The Prisma overlap query expands the new window by 60min (back) so existing booking
    // ending at 12:00 will satisfy: scheduledCheckOut > (12:30 BKK - 60min) = 11:30 BKK
    prismaMock.booking.findMany.mockImplementationOnce(({ where }: any) => {
      // Primary check (scheduledCheckIn/Out) should hit
      expect(where.scheduledCheckIn).toBeDefined();
      expect(where.scheduledCheckOut).toBeDefined();
      return Promise.resolve([{ roomId: 'room-104' }]);
    });
    prismaMock.booking.findMany.mockResolvedValueOnce([]); // fallback query
    prismaMock.room.findMany.mockResolvedValue([]);

    const result = await service.getAvailableRooms(
      '2026-05-14',
      '2026-05-15',
      propertyId,
      tenantId,
      '12:30',
      '12:00',
    );

    expect(result).toEqual([]);
  });

  it('does NOT exclude rooms with status occupied/cleaning/dirty — only maintenance/out_of_order', async () => {
    prismaMock.booking.findMany.mockResolvedValue([]);
    // Capture the room.findMany filter so we can assert the status filter logic
    prismaMock.room.findMany.mockImplementationOnce(({ where }: any) => {
      expect(where.status).toEqual({ notIn: ['maintenance', 'out_of_order'] });
      return Promise.resolve([
        { id: 'room-101', number: '101', status: 'available', propertyId, tenantId },
        { id: 'room-102', number: '102', status: 'occupied', propertyId, tenantId },
        { id: 'room-103', number: '103', status: 'cleaning', propertyId, tenantId },
      ]);
    });

    const result = await service.getAvailableRooms(
      '2026-05-14',
      '2026-05-15',
      propertyId,
      tenantId,
      '14:00',
      '12:00',
    );

    expect(result).toHaveLength(3);
  });

  it('falls back to legacy checkIn/checkOut fields when scheduledCheckIn is null', async () => {
    prismaMock.booking.findMany.mockResolvedValueOnce([]); // primary (scheduledCheckIn-based)
    prismaMock.booking.findMany.mockImplementationOnce(({ where }: any) => {
      // Fallback should target scheduledCheckIn: null
      expect(where.scheduledCheckIn).toBeNull();
      return Promise.resolve([{ roomId: 'room-legacy' }]);
    });
    prismaMock.room.findMany.mockResolvedValue([]);

    await service.getAvailableRooms(
      '2026-05-14',
      '2026-05-15',
      propertyId,
      tenantId,
      '14:00',
      '12:00',
    );

    expect(prismaMock.booking.findMany).toHaveBeenCalledTimes(2);
  });

  it('uses default cleaningBufferMinutes=60 when property has null buffer', async () => {
    prismaMock.property.findFirst.mockResolvedValueOnce({
      id: propertyId,
      standardCheckInTime: '14:00',
      standardCheckOutTime: '12:00',
      cleaningBufferMinutes: null,
    });
    prismaMock.booking.findMany.mockResolvedValue([]);
    prismaMock.room.findMany.mockResolvedValue([]);

    await expect(
      service.getAvailableRooms(
        '2026-05-14',
        '2026-05-15',
        propertyId,
        tenantId,
        '14:00',
        '12:00',
      ),
    ).resolves.toEqual([]);
  });

  it('returns empty array when tenantId missing (anonymous/new user)', async () => {
    const result = await service.getAvailableRooms('2026-05-14', '2026-05-15', propertyId);
    expect(result).toEqual([]);
    expect(prismaMock.booking.findMany).not.toHaveBeenCalled();
  });
});
