import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  mockAuditLogService,
  mockEventEmitter,
} from '../../common/test/mock-providers';
import {
  CreateMaintenanceTaskDto,
  MaintenanceCategory,
  MaintenancePriority,
} from './dto/create-maintenance-task.dto';
import { MaintenanceTaskStatus } from './dto/update-maintenance-task.dto';
import { MaintenanceService } from './maintenance.service';

describe('MaintenanceService', () => {
  let service: MaintenanceService;

  const prismaMock = {
    property: {
      findFirst: jest.fn(),
    },
    room: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    maintenanceTask: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MaintenanceService,
        {
          provide: PrismaService,
          useValue: prismaMock,
        },
        { provide: AuditLogService, useValue: mockAuditLogService() },
        { provide: EventEmitter2, useValue: mockEventEmitter() },
      ],
    }).compile();

    service = module.get(MaintenanceService);
    jest.clearAllMocks();
  });

  describe('create', () => {
    const dto: CreateMaintenanceTaskDto = {
      propertyId: 'property-1',
      roomId: 'room-1',
      title: 'AC unit not cooling',
      category: MaintenanceCategory.AC,
      priority: MaintenancePriority.HIGH,
      estimatedCost: '500.50',
      estimatedDuration: 60,
    };

    it('creates a task and marks the room as maintenance', async () => {
      prismaMock.property.findFirst.mockResolvedValue({ id: 'property-1', tenantId: 'tenant-1' });
      prismaMock.room.findFirst.mockResolvedValue({ id: 'room-1', propertyId: 'property-1' });
      prismaMock.maintenanceTask.create.mockImplementation(async ({ data }) => ({
        id: 'task-1',
        ...data,
      }));
      prismaMock.room.update.mockResolvedValue({ id: 'room-1', status: 'maintenance' });

      const result = await service.create(dto, 'tenant-1');

      expect(prismaMock.maintenanceTask.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: 'tenant-1',
            status: 'pending',
            estimatedCost: 500.5,
          }),
        }),
      );
      expect(prismaMock.room.update).toHaveBeenCalledWith({
        where: { id: 'room-1' },
        data: { status: 'maintenance' },
      });
      expect(result.id).toBe('task-1');
    });

    it('throws when property does not belong to tenant', async () => {
      prismaMock.property.findFirst.mockResolvedValue(null);

      await expect(service.create(dto, 'tenant-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('marks room available again when task is completed', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue({
        id: 'task-1',
        roomId: 'room-1',
        tenantId: 'tenant-1',
      } as any);
      prismaMock.maintenanceTask.update.mockResolvedValue({
        id: 'task-1',
        roomId: 'room-1',
        status: MaintenanceTaskStatus.COMPLETED,
      });
      prismaMock.room.update.mockResolvedValue({ id: 'room-1', status: 'available' });

      const result = await service.update(
        'task-1',
        {
          status: MaintenanceTaskStatus.COMPLETED,
          actualCost: '450.25',
          completedAt: '2026-04-05T09:30:00.000Z',
        },
        'tenant-1',
      );

      expect(prismaMock.maintenanceTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'task-1' },
          data: expect.objectContaining({
            status: MaintenanceTaskStatus.COMPLETED,
            actualCost: 450.25,
            completedAt: new Date('2026-04-05T09:30:00.000Z'),
          }),
        }),
      );
      expect(prismaMock.room.update).toHaveBeenCalledWith({
        where: { id: 'room-1' },
        data: { status: 'available' },
      });
      expect(result.status).toBe(MaintenanceTaskStatus.COMPLETED);
    });
  });

  describe('remove', () => {
    it('rejects deleting an in-progress task', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue({
        id: 'task-1',
        status: 'in_progress',
      } as any);

      await expect(service.remove('task-1', 'tenant-1')).rejects.toThrow(BadRequestException);
      expect(prismaMock.maintenanceTask.delete).not.toHaveBeenCalled();
    });
  });
});
