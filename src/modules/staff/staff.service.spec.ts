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
      // มีไว้เพื่อ "ดักว่าห้ามเรียก" — ไม่ใช่เพื่อใช้งาน (ดูเทสต์ linkEmployee)
      findUnique: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    housekeepingTask: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
    // แม่บ้านคนเดียวกันรับได้ทั้งงานทำความสะอาดและงานซ่อม — การลบต้องดูทั้งสองใบ
    maintenanceTask: {
      count: jest.fn(),
    },
    employee: {
      findFirst: jest.fn(),
    },
    $transaction: jest.fn(),
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
      prismaMock.maintenanceTask.count.mockResolvedValue(0);

      await expect(service.remove('staff-1', 'tenant-1')).rejects.toThrow(BadRequestException);
      expect(prismaMock.staff.delete).not.toHaveBeenCalled();
    });

    /**
     * ใบงานซ่อมที่ค้างอยู่ก็ต้องกันการลบเหมือนกัน
     *
     * ของเดิมนับเฉพาะงานทำความสะอาด ช่างที่กำลังซ่อมแอร์อยู่จึงถูกลบทิ้งได้ แล้ว
     * ใบงานนั้นก็ชี้ไปยังคนที่ไม่มีอยู่จริง
     */
    it('blocks deletion when an open maintenance job is still assigned', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue({
        id: 'staff-1',
        email: 'alice@example.com',
        housekeepingTasks: [],
      } as any);
      prismaMock.housekeepingTask.count.mockResolvedValue(0);
      prismaMock.maintenanceTask.count.mockResolvedValue(1);

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
      prismaMock.maintenanceTask.count.mockResolvedValue(0);
      prismaMock.staff.delete.mockResolvedValue({ id: 'staff-1' });

      await service.remove('staff-1', 'tenant-1');

      expect(prismaMock.staff.delete).toHaveBeenCalledWith({ where: { id: 'staff-1' } });
    });
  });

  /**
   * ประตูเดียวของการขึ้นทะเบียนพนักงาน — ใช้ร่วมกันทั้งทางที่มาจากฝ่ายบุคคล (HR)
   * และทางที่โรงแรมกรอกเอง/สร้างบัญชีผู้ใช้ ถ้าไม่รวมทางกัน คนคนเดียวจะมีสองแถว
   */
  describe('provision', () => {
    beforeEach(() => {
      prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
    });

    it('creates a row for someone who is not on the roster yet', async () => {
      prismaMock.staff.findFirst.mockResolvedValue(null);
      prismaMock.staff.create.mockResolvedValue({ id: 'staff-new', email: 'new@example.com' });

      const result = await service.provision(
        {
          firstName: 'Nok',
          lastName: 'Sri',
          email: 'new@example.com',
          role: StaffRole.HOUSEKEEPER,
          department: StaffDepartment.HOUSEKEEPING,
        },
        'tenant-1',
      );

      expect(result.action).toBe('created');
      expect(prismaMock.staff.create).toHaveBeenCalled();
    });

    /**
     * เคสสำคัญที่สุดของ "ไร้รอยต่อ": โรงแรมกรอกพนักงานเองไว้ก่อน แล้วค่อยซื้อส่วนเสริม
     * HR ทีหลัง — ตอนนำเข้าต้องผูกกับแถวเดิม ไม่ใช่สร้างแถวที่สองของคนคนเดียวกัน
     */
    it('adopts the row the hotel typed in by hand instead of duplicating the person', async () => {
      prismaMock.staff.findFirst
        .mockResolvedValueOnce(null) // ยังไม่มีใครผูกกับพนักงาน HR คนนี้
        .mockResolvedValueOnce({ id: 'staff-1', email: 'alice@example.com', employeeId: null });
      prismaMock.staff.update.mockResolvedValue({ id: 'staff-1', employeeId: 'emp-1' });

      const result = await service.provision(
        {
          firstName: 'Alice',
          lastName: 'Ng',
          email: 'alice@example.com',
          role: StaffRole.HOUSEKEEPER,
          employeeId: 'emp-1',
        },
        'tenant-1',
      );

      expect(result.action).toBe('linked');
      expect(prismaMock.staff.create).not.toHaveBeenCalled();
      expect(prismaMock.staff.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'staff-1' } }),
      );
    });

    it('leaves an already-linked person alone', async () => {
      prismaMock.staff.findFirst.mockResolvedValueOnce({ id: 'staff-1', employeeId: 'emp-1' });

      const result = await service.provision(
        {
          firstName: 'Alice',
          lastName: 'Ng',
          email: 'alice@example.com',
          role: StaffRole.HOUSEKEEPER,
          employeeId: 'emp-1',
        },
        'tenant-1',
      );

      expect(result.action).toBe('existing');
      expect(prismaMock.staff.create).not.toHaveBeenCalled();
      expect(prismaMock.staff.update).not.toHaveBeenCalled();
    });
  });

  describe('linkEmployee', () => {
    /**
     * Staff เป็น tenant-scoped model — middleware โยน error ทิ้งทั้ง request เมื่อเจอ
     * findUnique ทำให้ปุ่ม "เชื่อมกับ HR" ตอบ 500 มาตลอดโดยที่เทสต์เขียว เพราะ mock
     * Prisma ไม่ได้ผ่าน middleware เทสต์นี้จึงดักที่ "ห้ามเรียก findUnique" ตรง ๆ
     */
    it('never reaches for findUnique on the tenant-scoped staff table', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue({
        id: 'staff-1',
        email: 'alice@example.com',
        employeeId: null,
      } as any);
      prismaMock.employee.findFirst.mockResolvedValue({ id: 'emp-1', tenantId: 'tenant-1' });
      prismaMock.staff.findFirst.mockResolvedValue(null);
      prismaMock.staff.update.mockResolvedValue({ id: 'staff-1', employeeId: 'emp-1' });

      await service.linkEmployee('staff-1', { employeeId: 'emp-1' } as any, 'tenant-1');

      expect(prismaMock.staff.findUnique).not.toHaveBeenCalled();
      expect(prismaMock.staff.findFirst).toHaveBeenCalledWith({
        where: { employeeId: 'emp-1', tenantId: 'tenant-1' },
      });
    });

    it('refuses to hand one HR employee to a second staff record', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue({
        id: 'staff-2',
        email: 'bob@example.com',
        employeeId: null,
      } as any);
      prismaMock.employee.findFirst.mockResolvedValue({ id: 'emp-1', tenantId: 'tenant-1' });
      prismaMock.staff.findFirst.mockResolvedValue({ id: 'staff-1' });

      await expect(
        service.linkEmployee('staff-2', { employeeId: 'emp-1' } as any, 'tenant-1'),
      ).rejects.toThrow(ConflictException);
      expect(prismaMock.staff.update).not.toHaveBeenCalled();
    });
  });
});
