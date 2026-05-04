import { BadRequestException, ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { PrismaService } from '../../prisma/prisma.service';
import { mockAuditLogService } from '../../common/test/mock-providers';
import { StaffDepartment, StaffRole, StaffStatus } from './dto/create-staff.dto';
import { StaffService } from './staff.service';

describe('StaffService', () => {
  let service: StaffService;

  const prismaMock = {
    staff: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    housekeepingTask: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StaffService,
        {
          provide: PrismaService,
          useValue: prismaMock,
        },
        { provide: AuditLogService, useValue: mockAuditLogService() },
      ],
    }).compile();

    service = module.get(StaffService);
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('returns staff with computed task metrics', async () => {
      prismaMock.staff.findMany.mockResolvedValue([
        {
          id: 'staff-1',
          firstName: 'Alice',
          lastName: 'Ng',
          email: 'alice@example.com',
          role: StaffRole.HOUSEKEEPER,
          status: StaffStatus.ACTIVE,
          rating: '4.5',
          efficiency: 92,
          housekeepingTasks: [
            { id: 'task-1', status: 'completed' },
            { id: 'task-2', status: 'pending' },
          ],
        },
      ]);
      prismaMock.staff.count.mockResolvedValue(1);

      const result = await service.findAll({ page: 1, limit: 10 }, 'tenant-1');

      expect(result.total).toBe(1);
      expect(result.data[0]).toMatchObject({
        id: 'staff-1',
        tasksToday: 2,
        completedToday: 1,
        rating: 4.5,
        efficiency: 92,
      });
    });

    it('throws when tenantId is missing', async () => {
      await expect(service.findAll({ page: 1, limit: 10 }, '' as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('falls back to safe defaults when page or limit are invalid', async () => {
      prismaMock.staff.findMany.mockResolvedValue([]);
      prismaMock.staff.count.mockResolvedValue(0);

      const result = await service.findAll({ page: Number.NaN, limit: Number.NaN }, 'tenant-1');

      expect(prismaMock.staff.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0,
          take: 20,
        }),
      );
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
    });
  });

  describe('create', () => {
    it('creates a new staff member with defaults and serialized specializations', async () => {
      prismaMock.staff.findFirst.mockResolvedValue(null);
      prismaMock.staff.create.mockImplementation(async ({ data }) => ({ id: 'staff-1', ...data }));

      const result = await service.create(
        {
          firstName: 'Alice',
          lastName: 'Ng',
          email: 'alice@example.com',
          role: StaffRole.HOUSEKEEPER,
          department: StaffDepartment.HOUSEKEEPING,
          specializations: ['deep-cleaning', 'inspection'],
        },
        'tenant-1',
      );

      expect(prismaMock.staff.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: 'tenant-1',
          status: StaffStatus.ACTIVE,
          maxTasksPerShift: 8,
          specializations: JSON.stringify(['deep-cleaning', 'inspection']),
          efficiency: 100,
        }),
      });
      expect(result.id).toBe('staff-1');
    });

    it('rejects duplicate email inside the same tenant', async () => {
      prismaMock.staff.findFirst.mockResolvedValue({ id: 'staff-existing' });

      await expect(
        service.create(
          {
            firstName: 'Alice',
            lastName: 'Ng',
            email: 'alice@example.com',
            role: StaffRole.HOUSEKEEPER,
          },
          'tenant-1',
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('remove', () => {
    it('blocks deletion when active tasks still exist', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue({
        id: 'staff-1',
        email: 'alice@example.com',
        housekeepingTasks: [],
      } as any);
      prismaMock.housekeepingTask.count.mockResolvedValue(2);

      await expect(service.remove('staff-1', 'tenant-1')).rejects.toThrow(BadRequestException);
      expect(prismaMock.staff.delete).not.toHaveBeenCalled();
    });

    it('deletes the staff member when no active tasks remain', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue({
        id: 'staff-1',
        email: 'alice@example.com',
        housekeepingTasks: [],
      } as any);
      prismaMock.housekeepingTask.count.mockResolvedValue(0);
      prismaMock.staff.delete.mockResolvedValue({ id: 'staff-1' });

      await service.remove('staff-1', 'tenant-1');

      expect(prismaMock.staff.delete).toHaveBeenCalledWith({ where: { id: 'staff-1' } });
    });
  });
});
