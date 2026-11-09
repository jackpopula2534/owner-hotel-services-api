import { BadRequestException, ConflictException } from '@nestjs/common';
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
      updateMany: jest.fn(),
    },
    housekeepingTask: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      updateMany: jest.fn(),
    },
    housekeepingTaskStatusLog: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    user: { findFirst: jest.fn() },
    $transaction: jest.fn(),
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
    prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prismaMock));
    prismaMock.user.findFirst.mockResolvedValue({ firstName: 'สมศรี', lastName: 'ใจดี', email: 'x@y.z' });
    prismaMock.housekeepingTaskStatusLog.count.mockResolvedValue(0);
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
  /**
   * ลากการ์ดย้อนสถานะบนกระดาน — ย้อนได้ทีละขั้น ต้องมีเหตุผล และต้องเข้าประวัติว่าใครทำ
   */
  describe('revertTask', () => {
    const baseTask = {
      id: 'task-1',
      roomId: 'room-1',
      tenantId: 'tenant-1',
    };

    it('completed → in_progress: ล้างเวลาเสร็จ คืนห้องเป็นสถานะก่อนส่งงาน และบันทึกประวัติ', async () => {
      prismaMock.housekeepingTask.findFirst
        .mockResolvedValueOnce({ ...baseTask, status: 'completed', room: { id: 'room-1', status: 'available' } })
        .mockResolvedValueOnce({ ...baseTask, status: 'in_progress' });
      prismaMock.housekeepingTaskStatusLog.findFirst.mockResolvedValue({ roomStatusBefore: 'cleaning' });
      prismaMock.housekeepingTask.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.revertTask('task-1', 'in_progress', ' ห้องน้ำยังไม่สะอาด ', 'tenant-1', 'user-1');

      expect(result.status).toBe('in_progress');
      expect(prismaMock.housekeepingTask.updateMany).toHaveBeenCalledWith({
        where: { id: 'task-1', tenantId: 'tenant-1', status: 'completed' },
        data: expect.objectContaining({ status: 'in_progress', actualEndTime: null, roomReadyAt: null }),
      });
      expect(prismaMock.room.updateMany).toHaveBeenCalledWith({
        where: { id: 'room-1', tenantId: 'tenant-1', status: 'available' },
        data: { status: 'cleaning' },
      });
      expect(prismaMock.housekeepingTaskStatusLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'revert',
          fromStatus: 'completed',
          toStatus: 'in_progress',
          reason: 'ห้องน้ำยังไม่สะอาด',
          changedById: 'user-1',
          changedByName: 'สมศรี ใจดี',
          roomStatusBefore: 'available',
          roomStatusAfter: 'cleaning',
        }),
      });
    });

    it('ห้องมีแขกเข้าพักแล้ว (occupied) — ย้อนงานได้แต่ไม่ไปแตะสถานะห้อง', async () => {
      prismaMock.housekeepingTask.findFirst
        .mockResolvedValueOnce({ ...baseTask, status: 'completed', room: { id: 'room-1', status: 'occupied' } })
        .mockResolvedValueOnce({ ...baseTask, status: 'in_progress' });
      prismaMock.housekeepingTask.updateMany.mockResolvedValue({ count: 1 });

      await service.revertTask('task-1', 'in_progress', 'ส่งงานผิด', 'tenant-1', 'user-1');

      expect(prismaMock.room.updateMany).not.toHaveBeenCalled();
    });

    it('inspected → completed ล้างผลตรวจ', async () => {
      prismaMock.housekeepingTask.findFirst
        .mockResolvedValueOnce({ ...baseTask, status: 'inspected', room: { id: 'room-1', status: 'available' } })
        .mockResolvedValueOnce({ ...baseTask, status: 'completed' });
      prismaMock.housekeepingTask.updateMany.mockResolvedValue({ count: 1 });

      await service.revertTask('task-1', 'completed', 'อนุมัติผิดห้อง', 'tenant-1', 'user-1');

      expect(prismaMock.housekeepingTask.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'completed', rating: null, inspectedById: null }),
        }),
      );
      expect(prismaMock.room.updateMany).not.toHaveBeenCalled();
    });

    it('ย้อนข้ามขั้น (completed → pending) → 409', async () => {
      prismaMock.housekeepingTask.findFirst.mockResolvedValue({ ...baseTask, status: 'completed', room: null });
      await expect(
        service.revertTask('task-1', 'pending', 'x', 'tenant-1', 'user-1'),
      ).rejects.toThrow(ConflictException);
      expect(prismaMock.housekeepingTask.updateMany).not.toHaveBeenCalled();
    });

    it('งาน pending ย้อนไม่ได้', async () => {
      prismaMock.housekeepingTask.findFirst.mockResolvedValue({ ...baseTask, status: 'pending', room: null });
      await expect(
        service.revertTask('task-1', 'pending', 'x', 'tenant-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('ไม่ใส่เหตุผล → 400', async () => {
      await expect(service.revertTask('task-1', 'pending', '   ', 'tenant-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('มีคนเปลี่ยนสถานะไปก่อน (updateMany ได้ 0 แถว) → 409 และไม่เขียนประวัติ', async () => {
      prismaMock.housekeepingTask.findFirst.mockResolvedValue({ ...baseTask, status: 'in_progress', room: null });
      prismaMock.housekeepingTask.updateMany.mockResolvedValue({ count: 0 });
      await expect(
        service.revertTask('task-1', 'pending', 'กดผิด', 'tenant-1', 'user-1'),
      ).rejects.toThrow(ConflictException);
      expect(prismaMock.housekeepingTaskStatusLog.create).not.toHaveBeenCalled();
    });
  });

  describe('status history', () => {
    it('startTask บันทึกว่าใครเริ่มงาน', async () => {
      prismaMock.housekeepingTask.findFirst.mockResolvedValue({ id: 'task-1', tenantId: 'tenant-1', status: 'pending', room: null });
      prismaMock.housekeepingTask.update.mockResolvedValue({ id: 'task-1', status: 'in_progress' });

      await service.startTask('task-1', 'tenant-1', 'user-1');

      expect(prismaMock.housekeepingTaskStatusLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'start',
          fromStatus: 'pending',
          toStatus: 'in_progress',
          changedById: 'user-1',
          changedByName: 'สมศรี ใจดี',
        }),
      });
    });

    it('ส่งงานซ้ำหลังย้อน → ไม่ตัดของใช้ในห้องซ้ำ', async () => {
      prismaMock.housekeepingTask.findFirst.mockResolvedValue({
        id: 'task-1', roomId: 'room-1', tenantId: 'tenant-1', status: 'in_progress',
        room: { id: 'room-1', number: '101', status: 'cleaning', type: 'deluxe', propertyId: 'p1' },
      });
      prismaMock.housekeepingTask.update.mockResolvedValue({
        id: 'task-1', status: 'completed', room: { id: 'room-1', number: '101', type: 'deluxe', propertyId: 'p1' },
      });
      prismaMock.housekeepingTaskStatusLog.count.mockResolvedValue(2);
      const emitter = (service as unknown as { eventEmitter: { emit: jest.Mock } }).eventEmitter;

      await service.completeTask('task-1', 100, '', 'tenant-1', 'user-1');

      expect(emitter.emit).not.toHaveBeenCalled();
    });

    it('ส่งงานครั้งแรก → ตัดของใช้ตามปกติ', async () => {
      prismaMock.housekeepingTask.findFirst.mockResolvedValue({
        id: 'task-1', roomId: 'room-1', tenantId: 'tenant-1', status: 'in_progress',
        room: { id: 'room-1', number: '101', status: 'cleaning', type: 'deluxe', propertyId: 'p1' },
      });
      prismaMock.housekeepingTask.update.mockResolvedValue({
        id: 'task-1', status: 'completed', room: { id: 'room-1', number: '101', type: 'deluxe', propertyId: 'p1' },
      });
      const emitter = (service as unknown as { eventEmitter: { emit: jest.Mock } }).eventEmitter;

      await service.completeTask('task-1', 100, '', 'tenant-1', 'user-1');

      expect(emitter.emit).toHaveBeenCalledTimes(1);
    });

    it('PATCH :id ที่เปลี่ยนสถานะตรง ๆ ก็ต้องเข้าประวัติ', async () => {
      prismaMock.housekeepingTask.findFirst.mockResolvedValue({ id: 'task-1', tenantId: 'tenant-1', status: 'pending', room: null });
      prismaMock.housekeepingTask.update.mockResolvedValue({ id: 'task-1', status: 'in_progress' });

      await service.updateTask('task-1', { status: 'in_progress' } as any, 'tenant-1', 'user-1');

      expect(prismaMock.housekeepingTaskStatusLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'update', fromStatus: 'pending', toStatus: 'in_progress' }),
      });
    });
  });
});
