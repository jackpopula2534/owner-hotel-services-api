import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { HrService } from './hr.service';
import { EmployeeCodeConfigService } from './employee-code-config.service';
import { PrismaService } from '../../prisma/prisma.service';

function createMockPrisma() {
  return {
    employee: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(),
      update: jest.fn(),
    },
    hrDepartment: {
      findUnique: jest.fn(),
    },
  };
}

describe('HrService', () => {
  let service: HrService;
  let prisma: ReturnType<typeof createMockPrisma>;
  let codeConfigService: { generateNextCode: jest.Mock };

  beforeEach(async () => {
    prisma = createMockPrisma();
    codeConfigService = { generateNextCode: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HrService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmployeeCodeConfigService, useValue: codeConfigService },
      ],
    }).compile();

    service = module.get<HrService>(HrService);
  });

  describe('create', () => {
    it('should auto-generate code when employeeCode is not provided', async () => {
      codeConfigService.generateNextCode.mockResolvedValue('EMP-0013');
      prisma.employee.create.mockResolvedValue({ id: 'new-1', employeeCode: 'EMP-0013' });

      const result = await service.create(
        {
          firstName: 'Test',
          lastName: 'User',
          email: 'test@example.com',
          propertyId: 'prop-1',
          startDate: '2026-04-01',
        } as any,
        'tenant-1',
      );

      expect(codeConfigService.generateNextCode).toHaveBeenCalledWith('tenant-1', '', 'prop-1');
      expect(prisma.employee.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ employeeCode: 'EMP-0013' }),
        }),
      );
    });

    it('should throw ConflictException when manual code already exists', async () => {
      prisma.employee.findFirst.mockResolvedValue({ id: 'existing-1' });

      await expect(
        service.create(
          {
            firstName: 'Test',
            lastName: 'User',
            email: 'test@example.com',
            employeeCode: 'EMP-0001',
            propertyId: 'prop-1',
            startDate: '2026-04-01',
          } as any,
          'tenant-1',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('should accept manual code when it does not conflict', async () => {
      prisma.employee.findFirst.mockResolvedValue(null);
      prisma.employee.create.mockResolvedValue({ id: 'new-2', employeeCode: 'CUSTOM-001' });

      await service.create(
        {
          firstName: 'Test',
          lastName: 'User',
          email: 'test@example.com',
          employeeCode: 'CUSTOM-001',
          propertyId: 'prop-1',
          startDate: '2026-04-01',
        } as any,
        'tenant-1',
      );

      expect(codeConfigService.generateNextCode).not.toHaveBeenCalled();
      expect(prisma.employee.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ employeeCode: 'CUSTOM-001' }),
        }),
      );
    });
  });

  describe('update', () => {
    const existingEmployee = {
      id: 'emp-1',
      tenantId: 'tenant-1',
      propertyId: 'prop-1',
      employeeCode: 'EMP-0001',
      firstName: 'Old',
      lastName: 'Name',
    };

    beforeEach(() => {
      prisma.employee.findFirst.mockResolvedValue(existingEmployee);
    });

    it('should throw ConflictException when changing to an already-used code', async () => {
      // findFirst is called twice: once for findOne, once for conflict check
      prisma.employee.findFirst
        .mockResolvedValueOnce(existingEmployee) // findOne
        .mockResolvedValueOnce({ id: 'emp-other' }); // conflict

      await expect(
        service.update('emp-1', { employeeCode: 'EMP-0002' } as any, 'tenant-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('should allow update when new code is unique', async () => {
      prisma.employee.findFirst
        .mockResolvedValueOnce(existingEmployee) // findOne
        .mockResolvedValueOnce(null); // no conflict
      prisma.employee.update.mockResolvedValue({
        ...existingEmployee,
        employeeCode: 'CUSTOM-999',
        staff: null,
      });

      const result = await service.update(
        'emp-1',
        { employeeCode: 'CUSTOM-999' } as any,
        'tenant-1',
      );

      expect(result.employeeCode).toBe('CUSTOM-999');
    });

    it('should skip conflict check when code is not changed', async () => {
      prisma.employee.findFirst.mockResolvedValueOnce(existingEmployee);
      prisma.employee.update.mockResolvedValue({
        ...existingEmployee,
        firstName: 'Updated',
        staff: null,
      });

      await service.update(
        'emp-1',
        { employeeCode: 'EMP-0001', firstName: 'Updated' } as any,
        'tenant-1',
      );

      // findFirst called only once (for findOne), not a second time for conflict
      expect(prisma.employee.findFirst).toHaveBeenCalledTimes(1);
    });
  });
});
