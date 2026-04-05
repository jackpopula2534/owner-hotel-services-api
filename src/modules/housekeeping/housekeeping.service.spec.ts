import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { PrismaService } from '../../prisma/prisma.service';
import { HousekeepingService } from './housekeeping.service';

describe('HousekeepingService', () => {
  let service: HousekeepingService;

  const prismaMock = {
    room: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    housekeepingTask: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };

  const auditLogServiceMock = {
    logHousekeepingTaskCompletion: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HousekeepingService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: AuditLogService, useValue: auditLogServiceMock },
      ],
    }).compile();

    service = module.get(HousekeepingService);
    jest.clearAllMocks();
  });

  describe('completeTask', () => {
    it('completes the task, marks the room available, and writes an audit log', async () => {
      const now = new Date('2026-04-05T11:30:00.000Z');
      jest.useFakeTimers().setSystemTime(now);

      prismaMock.housekeepingTask.findFirst.mockResolvedValue({
        id: 'task-1',
        roomId: 'room-1',
        tenantId: 'tenant-1',
        status: 'in_progress',
        actualStartTime: new Date('2026-04-05T11:00:00.000Z'),
        room: { id: 'room-1', number: '101', status: 'cleaning' },
      });
      prismaMock.housekeepingTask.update.mockImplementation(async ({ data }) => ({
        id: 'task-1',
        roomId: 'room-1',
        tenantId: 'tenant-1',
        room: { id: 'room-1', number: '101' },
        assignedTo: null,
        ...data,
      }));
      prismaMock.room.update.mockResolvedValue({ id: 'room-1', status: 'available' });

      const result = await service.completeTask(
        'task-1',
        100,
        'Finished and inspected',
        'tenant-1',
        'user-1',
      );

      expect(result.status).toBe('completed');
      expect(result.actualDuration).toBe(30);
      expect(result.roomReadyAt).toEqual(now);
      expect(prismaMock.room.update).toHaveBeenCalledWith({
        where: { id: 'room-1' },
        data: { status: 'available' },
      });
      expect(auditLogServiceMock.logHousekeepingTaskCompletion).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'task-1',
          previousStatus: 'in_progress',
          previousRoomStatus: 'cleaning',
          actualDuration: 30,
        }),
        'user-1',
        'tenant-1',
      );

      jest.useRealTimers();
    });

    it('throws when tenantId is missing', async () => {
      await expect(service.completeTask('task-1', 100, '', '')).rejects.toThrow(BadRequestException);
    });
  });
});
