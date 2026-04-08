import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { EmployeeCodeConfigService } from './employee-code-config.service';
import { PrismaService } from '../../prisma/prisma.service';

// ─── Mock helpers ──────────────────────────────────────────────────────────────

/** Build a fake Prisma client whose methods we can control per-test. */
function createMockPrisma() {
  return {
    employeeCodeConfig: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
    },
    employee: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    $transaction: jest.fn((fn: (tx: any) => Promise<any>) =>
      fn({
        employeeCodeConfig: {
          findUnique: jest.fn(),
          create: jest.fn(),
          update: jest.fn(),
        },
        employee: {
          findMany: jest.fn().mockResolvedValue([]),
          findFirst: jest.fn().mockResolvedValue(null),
        },
      }),
    ),
  };
}

describe('EmployeeCodeConfigService', () => {
  let service: EmployeeCodeConfigService;
  let prisma: ReturnType<typeof createMockPrisma>;

  beforeEach(async () => {
    prisma = createMockPrisma();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmployeeCodeConfigService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<EmployeeCodeConfigService>(EmployeeCodeConfigService);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // previewNextCode
  // ──────────────────────────────────────────────────────────────────────────

  describe('previewNextCode', () => {
    it('should return default EMP-0001 when no config and no existing employees', async () => {
      prisma.employeeCodeConfig.findUnique.mockResolvedValue(null);
      prisma.employee.findMany.mockResolvedValue([]);

      const code = await service.previewNextCode('tenant-1');
      expect(code).toBe('EMP-0001');
    });

    it('should sync with existing employees and skip used numbers', async () => {
      prisma.employeeCodeConfig.findUnique.mockResolvedValue({
        pattern: '{PREFIX}-{NNNN}',
        prefix: 'EMP',
        separator: '-',
        digitLength: 4,
        yearFormat: 'YYYY',
        resetCycle: 'NEVER',
        nextNumber: 1,
        lastResetDate: null,
      });

      // DB already has EMP-0001 and EMP-0002
      prisma.employee.findMany.mockResolvedValue([
        { employeeCode: 'EMP-0001' },
        { employeeCode: 'EMP-0002' },
      ]);

      const code = await service.previewNextCode('tenant-1');
      expect(code).toBe('EMP-0003');
    });

    it('should consider codes with different prefixes when syncing max number', async () => {
      prisma.employeeCodeConfig.findUnique.mockResolvedValue({
        pattern: '{PREFIX}-{NNNN}',
        prefix: 'EMP',
        separator: '-',
        digitLength: 4,
        yearFormat: 'YYYY',
        resetCycle: 'NEVER',
        nextNumber: 1,
        lastResetDate: null,
      });

      // DB has PM-prefixed codes with higher numbers
      prisma.employee.findMany.mockResolvedValue([
        { employeeCode: 'EMP-0001' },
        { employeeCode: 'EMP-0002' },
        { employeeCode: 'PM-0010' },
      ]);

      const code = await service.previewNextCode('tenant-1');
      // maxFoundNumber = 10 (from PM-0010), so next = 11
      expect(code).toBe('EMP-0011');
    });

    it('should use config.nextNumber when it is higher than DB max', async () => {
      prisma.employeeCodeConfig.findUnique.mockResolvedValue({
        pattern: '{PREFIX}-{NNNN}',
        prefix: 'EMP',
        separator: '-',
        digitLength: 4,
        yearFormat: 'YYYY',
        resetCycle: 'NEVER',
        nextNumber: 20,
        lastResetDate: null,
      });

      prisma.employee.findMany.mockResolvedValue([
        { employeeCode: 'EMP-0005' },
      ]);

      const code = await service.previewNextCode('tenant-1');
      // config.nextNumber=20 > maxInDB+1=6, so use 20
      expect(code).toBe('EMP-0020');
    });

    it('should scope query by propertyId when provided', async () => {
      prisma.employeeCodeConfig.findUnique.mockResolvedValue(null);
      prisma.employee.findMany.mockResolvedValue([]);

      await service.previewNextCode('tenant-1', undefined, 'property-abc');

      expect(prisma.employee.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: 'tenant-1',
            propertyId: 'property-abc',
          }),
        }),
      );
    });

    it('should throw BadRequestException when tenantId is missing', async () => {
      await expect(service.previewNextCode('')).rejects.toThrow(BadRequestException);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // generateNextCode
  // ──────────────────────────────────────────────────────────────────────────

  describe('generateNextCode', () => {
    it('should generate code and update counter atomically', async () => {
      const txMock = {
        employeeCodeConfig: {
          findUnique: jest.fn().mockResolvedValue({
            pattern: '{PREFIX}-{NNNN}',
            prefix: 'EMP',
            separator: '-',
            digitLength: 4,
            yearFormat: 'YYYY',
            resetCycle: 'NEVER',
            nextNumber: 1,
            lastResetDate: null,
          }),
          create: jest.fn(),
          update: jest.fn(),
        },
        employee: {
          findMany: jest.fn().mockResolvedValue([]),
          findFirst: jest.fn().mockResolvedValue(null),
        },
      };

      prisma.$transaction.mockImplementation((fn: any) => fn(txMock));

      const code = await service.generateNextCode('tenant-1');
      expect(code).toBe('EMP-0001');

      expect(txMock.employeeCodeConfig.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ nextNumber: 2 }),
        }),
      );
    });

    it('should skip already-used codes and retry', async () => {
      const txMock = {
        employeeCodeConfig: {
          findUnique: jest.fn().mockResolvedValue({
            pattern: '{PREFIX}-{NNNN}',
            prefix: 'EMP',
            separator: '-',
            digitLength: 4,
            yearFormat: 'YYYY',
            resetCycle: 'NEVER',
            nextNumber: 1,
            lastResetDate: null,
          }),
          create: jest.fn(),
          update: jest.fn(),
        },
        employee: {
          findMany: jest.fn().mockResolvedValue([
            { employeeCode: 'EMP-0001' },
            { employeeCode: 'EMP-0002' },
          ]),
          // First two attempts find collision, third succeeds
          findFirst: jest
            .fn()
            .mockResolvedValueOnce({ id: 'existing-1' }) // EMP-0003 collision (edge case)
            .mockResolvedValueOnce(null), // EMP-0004 free
        },
      };

      prisma.$transaction.mockImplementation((fn: any) => fn(txMock));

      const code = await service.generateNextCode('tenant-1');
      // maxInDB = 2 → start at 3, collision → 4
      expect(code).toBe('EMP-0004');
    });

    it('should throw when tenantId is missing', async () => {
      await expect(service.generateNextCode('')).rejects.toThrow(BadRequestException);
    });
  });
});
