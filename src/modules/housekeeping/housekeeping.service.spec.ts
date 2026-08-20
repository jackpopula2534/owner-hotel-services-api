import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { PrismaService } from '../../prisma/prisma.service';
import { mockEventEmitter } from '../../common/test/mock-providers';
import {
  TaskPriority,
  TaskStatus,
  TaskType,
} from './dto/create-housekeeping-task.dto';
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
        { provide: EventEmitter2, useValue: mockEventEmitter() },
      ],
    }).compile();

    service = module.get(HousekeepingService);
    jest.clearAllMocks();
  });

  /**
   * งานทำความสะอาดหลังเช็คเอาต์ซ้ำ — บอร์ดแม่บ้านเคยขึ้นการ์ดห้องเดียวกันสองใบ
   * เพราะทั้ง endpoint เช็คเอาต์และหน้าจอต่างยิงสร้างงานคนละครั้ง
   */
  describe('createTask — checkout dedupe', () => {
    const checkoutDto = {
      roomId: 'room-1',
      type: TaskType.CHECKOUT,
      priority: TaskPriority.HIGH,
      bookingId: 'booking-1',
      estimatedDuration: 60,
    } as any;

    beforeEach(() => {
      prismaMock.room.findFirst.mockResolvedValue({
        id: 'room-1',
        number: '149',
        tenantId: 'tenant-1',
        property: { id: 'property-1' },
      });
    });

    it('returns the task that already exists instead of creating a second card', async () => {
      const existing = { id: 'task-existing', roomId: 'room-1', status: 'pending' };
      prismaMock.housekeepingTask.findFirst.mockResolvedValue(existing);

      const result = await service.createTask(checkoutDto, 'tenant-1');

      expect(result).toBe(existing);
      expect(prismaMock.housekeepingTask.create).not.toHaveBeenCalled();
      expect(prismaMock.housekeepingTask.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: 'tenant-1',
            bookingId: 'booking-1',
            type: TaskType.CHECKOUT,
            status: { in: [TaskStatus.PENDING, TaskStatus.IN_PROGRESS] },
          }),
        }),
      );
    });

    it('creates the task when the booking has no open checkout task yet', async () => {
      prismaMock.housekeepingTask.findFirst.mockResolvedValue(null);
      prismaMock.housekeepingTask.create.mockResolvedValue({ id: 'task-new' });

      const result = await service.createTask(checkoutDto, 'tenant-1');

      expect(result).toEqual({ id: 'task-new' });
      expect(prismaMock.housekeepingTask.create).toHaveBeenCalledTimes(1);
    });

    it('does not dedupe daily cleaning — a long stay needs one per day', async () => {
      prismaMock.housekeepingTask.create.mockResolvedValue({ id: 'task-daily' });

      await service.createTask({ ...checkoutDto, type: TaskType.DAILY }, 'tenant-1');

      expect(prismaMock.housekeepingTask.findFirst).not.toHaveBeenCalled();
      expect(prismaMock.housekeepingTask.create).toHaveBeenCalledTimes(1);
    });
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
      await expect(service.completeTask('task-1', 100, '', '')).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
