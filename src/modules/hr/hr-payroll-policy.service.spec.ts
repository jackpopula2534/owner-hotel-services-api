import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { HrPayrollPolicyService } from './hr-payroll-policy.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../audit-log/audit-log.service';

function createMockPrisma() {
  return {
    hrPayrollPolicy: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
  };
}

describe('HrPayrollPolicyService', () => {
  let service: HrPayrollPolicyService;
  let prisma: ReturnType<typeof createMockPrisma>;
  let audit: { log: jest.Mock };

  beforeEach(async () => {
    prisma = createMockPrisma();
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HrPayrollPolicyService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogService, useValue: audit },
      ],
    }).compile();
    service = module.get(HrPayrollPolicyService);
  });

  describe('resolveEffective', () => {
    it('returns static defaults when no policy exists', async () => {
      prisma.hrPayrollPolicy.findMany.mockResolvedValue([]);
      const p = await service.resolveEffective('t1');
      expect(p.id).toBeNull();
      expect(p.otMultiplier).toBe(1.5);
      expect(p.workingDaysPerMonth).toBe(30);
    });

    it('prefers a property-specific policy over the default', async () => {
      prisma.hrPayrollPolicy.findMany.mockResolvedValue([
        { id: 'def', isDefault: true, propertyId: null, otMultiplier: '1.50', holidayOtMultiplier: '2.00', unpaidLeaveRate: '1.00', socialSecurityRate: '0.0500', socialSecurityCap: '750.00', lateDeductionPerMin: '0.00' },
        { id: 'prop', isDefault: false, propertyId: 'p1', otMultiplier: '2.00', holidayOtMultiplier: '3.00', unpaidLeaveRate: '1.00', socialSecurityRate: '0.0500', socialSecurityCap: '750.00', lateDeductionPerMin: '0.00' },
      ]);
      const p = await service.resolveEffective('t1', 'p1');
      expect(p.id).toBe('prop');
      expect(p.otMultiplier).toBe(2); // coerced to number
    });
  });

  describe('create', () => {
    it('clears existing default when creating a new default policy', async () => {
      prisma.hrPayrollPolicy.create.mockResolvedValue({ id: 'new' });
      await service.create({ name: 'P', isDefault: true } as any, 't1', 'u1');
      expect(prisma.hrPayrollPolicy.updateMany).toHaveBeenCalled();
      expect(audit.log).toHaveBeenCalled();
    });
  });

  it('throws on missing policy', async () => {
    prisma.hrPayrollPolicy.findFirst.mockResolvedValue(null);
    await expect(service.findOne('x', 't1')).rejects.toBeInstanceOf(NotFoundException);
  });
});
