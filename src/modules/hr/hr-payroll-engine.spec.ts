import { Test, TestingModule } from '@nestjs/testing';
import { HrPayrollService } from './hr-payroll.service';
import { HrPayrollPolicyService } from './hr-payroll-policy.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../audit-log/audit-log.service';

function createMockPrisma() {
  return {
    employee: { findMany: jest.fn() },
    hrPayroll: { findFirst: jest.fn(), create: jest.fn() },
    hrOvertimeRequest: { findMany: jest.fn().mockResolvedValue([]) },
    hrAttendance: { findMany: jest.fn().mockResolvedValue([]) },
    hrLeaveRequest: { findMany: jest.fn().mockResolvedValue([]) },
    hrShiftAssignment: { findMany: jest.fn().mockResolvedValue([]) },
  };
}

const BASE_POLICY = {
  id: 'pol1',
  workingDaysPerMonth: 30,
  workingHoursPerDay: 8,
  otRequiresApproval: true,
  otMultiplier: 1.5,
  unpaidLeaveRate: 1.0,
  paidLeaveDeducted: false,
  socialSecurityEnabled: true,
  socialSecurityRate: 0.05,
  socialSecurityCap: 750,
  lateDeductionPerMin: 0,
};

describe('HrPayrollService.computeForEmployee (engine)', () => {
  let service: HrPayrollService;
  let prisma: ReturnType<typeof createMockPrisma>;

  const period = {
    monthStart: new Date(Date.UTC(2026, 5, 1)),
    monthEnd: new Date(Date.UTC(2026, 5, 30, 23, 59, 59)),
  };

  beforeEach(async () => {
    prisma = createMockPrisma();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HrPayrollService,
        { provide: HrPayrollPolicyService, useValue: { resolveEffective: jest.fn() } },
        { provide: AuditLogService, useValue: { log: jest.fn() } },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(HrPayrollService);
  });

  it('computes OT from approved requests, unpaid leave, and social security', async () => {
    prisma.hrOvertimeRequest.findMany.mockResolvedValue([{ minutes: 120, multiplier: 1.5 }]);
    prisma.hrLeaveRequest.findMany.mockResolvedValue([
      { totalDays: 2, leaveType: { isPaid: false, name: 'ลากิจ' } },
    ]);

    const r = await service.computeForEmployee(
      { id: 'e1', baseSalary: 30000, propertyId: null },
      BASE_POLICY,
      period,
      't1',
      [],
    );

    // dailyRate 1000, hourlyRate 125 → OT = 125 * 1.5 * 2 = 375
    expect(r.overtimePay).toBeCloseTo(375);
    expect(r.unpaidLeaveDays).toBe(2);
    // SSO capped at 750 (min of 1500, 750)
    expect(r.socialSecurity).toBe(750);
    // deductions = unpaid leave 2000 + SSO 750
    expect(r.totalDeduction).toBeCloseTo(2750);
    // net = 30000 + 375 - 2750
    expect(r.netSalary).toBeCloseTo(27625);
  });

  it('uses raw attendance OT when policy does not require approval', async () => {
    prisma.hrAttendance.findMany.mockResolvedValue([
      { overtimeMinutes: 60 },
      { overtimeMinutes: 60 },
    ]);
    const policy = { ...BASE_POLICY, otRequiresApproval: false, socialSecurityEnabled: false };
    const r = await service.computeForEmployee(
      { id: 'e1', baseSalary: 24000, propertyId: null },
      policy,
      period,
      't1',
      [],
    );
    // dailyRate 800, hourlyRate 100 → OT = 100 * 1.5 * 2h = 300
    expect(r.overtimePay).toBeCloseTo(300);
    expect(prisma.hrOvertimeRequest.findMany).not.toHaveBeenCalled();
    expect(r.netSalary).toBeCloseTo(24300);
  });

  it('adds caller-supplied allowances and bonuses', async () => {
    const policy = { ...BASE_POLICY, socialSecurityEnabled: false };
    const r = await service.computeForEmployee(
      { id: 'e1', baseSalary: 20000, propertyId: null },
      policy,
      period,
      't1',
      [
        { type: 'allowance', name: 'ค่าตำแหน่ง', amount: 2000 },
        { type: 'bonus', name: 'โบนัส', amount: 1000 },
      ],
    );
    expect(r.totalAllowance).toBe(2000);
    expect(r.bonusPay).toBe(1000);
    expect(r.netSalary).toBeCloseTo(23000);
  });
});
