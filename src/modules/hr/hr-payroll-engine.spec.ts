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
    hrWorkCalendar: { findMany: jest.fn().mockResolvedValue([]) },
  };
}

const BASE_POLICY = {
  id: 'pol1',
  workingDaysPerMonth: 30,
  workingHoursPerDay: 8,
  otRequiresApproval: true,
  otMultiplier: 1.5,
  holidayOtMultiplier: 2.0,
  unpaidLeaveRate: 1.0,
  paidLeaveDeducted: false,
  socialSecurityEnabled: true,
  socialSecurityRate: 0.05,
  socialSecurityCap: 750,
  taxEnabled: false,
  taxPersonalAllowance: 60000,
  taxExpenseRate: 0.5,
  taxExpenseCap: 100000,
  taxExtraAllowance: 0,
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

  it('pays approved OT only up to the minutes actually clocked in', async () => {
    const otDate = new Date(Date.UTC(2026, 5, 10));
    // อนุมัติ 120 นาที และตอกบัตรจริง 120 นาที → จ่ายเต็ม
    prisma.hrOvertimeRequest.findMany.mockResolvedValue([
      { minutes: 120, multiplier: 1.5, date: otDate },
    ]);
    prisma.hrAttendance.findMany.mockResolvedValue([
      { date: otDate, overtimeMinutes: 120 },
    ]);
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

  it('caps approved OT at the actual clocked-in overtime', async () => {
    const otDate = new Date(Date.UTC(2026, 5, 12));
    // อนุมัติ 120 นาที แต่ตอกบัตรจริงแค่ 90 นาที → จ่ายตาม 90 นาที
    prisma.hrOvertimeRequest.findMany.mockResolvedValue([
      { minutes: 120, multiplier: 1.5, date: otDate },
    ]);
    prisma.hrAttendance.findMany.mockResolvedValue([
      { date: otDate, overtimeMinutes: 90 },
    ]);
    const policy = { ...BASE_POLICY, socialSecurityEnabled: false };

    const r = await service.computeForEmployee(
      { id: 'e1', baseSalary: 30000, propertyId: null },
      policy,
      period,
      't1',
      [],
    );

    // hourlyRate 125 → OT = 125 * 1.5 * (90/60) = 281.25
    expect(r.overtimePay).toBeCloseTo(281.25);
  });

  it('pays no OT when approved but never clocked in', async () => {
    prisma.hrOvertimeRequest.findMany.mockResolvedValue([
      { minutes: 120, multiplier: 1.5, date: new Date(Date.UTC(2026, 5, 14)) },
    ]);
    prisma.hrAttendance.findMany.mockResolvedValue([]); // ไม่มีการตอกบัตร
    const policy = { ...BASE_POLICY, socialSecurityEnabled: false };

    const r = await service.computeForEmployee(
      { id: 'e1', baseSalary: 30000, propertyId: null },
      policy,
      period,
      't1',
      [],
    );

    expect(r.overtimePay).toBe(0);
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

  it('applies holidayOtMultiplier to OT clocked on a day-off', async () => {
    const holiday = new Date(Date.UTC(2026, 5, 7));
    prisma.hrAttendance.findMany.mockResolvedValue([
      { date: holiday, overtimeMinutes: 120 },
    ]);
    prisma.hrShiftAssignment.findMany.mockResolvedValue([
      { date: holiday, isDayOff: true },
    ]);
    const policy = { ...BASE_POLICY, otRequiresApproval: false, socialSecurityEnabled: false };
    const r = await service.computeForEmployee(
      { id: 'e1', baseSalary: 24000, propertyId: null },
      policy,
      period,
      't1',
      [],
    );
    // hourlyRate 100, holiday x2 → 100 * 2 * 2h = 400 (ไม่ใช่ 300 จาก otMultiplier 1.5)
    expect(r.overtimePay).toBeCloseTo(400);
  });

  it('deducts rostered working days with no clock-in and no approved leave', async () => {
    const dayA = new Date(Date.UTC(2026, 5, 2));
    const dayB = new Date(Date.UTC(2026, 5, 3));
    prisma.hrShiftAssignment.findMany.mockResolvedValue([
      { date: dayA, isDayOff: false },
      { date: dayB, isDayOff: false },
    ]);
    // ตอกบัตรแค่วัน A → วัน B = ขาดงาน
    prisma.hrAttendance.findMany.mockResolvedValue([
      { date: dayA, checkIn: new Date(Date.UTC(2026, 5, 2, 9)), overtimeMinutes: 0 },
    ]);
    const policy = { ...BASE_POLICY, socialSecurityEnabled: false };
    const r = await service.computeForEmployee(
      { id: 'e1', baseSalary: 30000, propertyId: null },
      policy,
      period,
      't1',
      [],
    );
    // dailyRate 1000 * ขาด 1 วัน = 1000
    expect(r.absentDays).toBe(1);
    expect(r.totalDeduction).toBeCloseTo(1000);
    expect(r.netSalary).toBeCloseTo(29000);
  });

  it('does not deduct absence when no roster exists', async () => {
    prisma.hrShiftAssignment.findMany.mockResolvedValue([]);
    prisma.hrAttendance.findMany.mockResolvedValue([]);
    const policy = { ...BASE_POLICY, socialSecurityEnabled: false };
    const r = await service.computeForEmployee(
      { id: 'e1', baseSalary: 30000, propertyId: null },
      policy,
      period,
      't1',
      [],
    );
    expect(r.absentDays).toBe(0);
    expect(r.totalDeduction).toBeCloseTo(0);
  });

  it('computes progressive withholding tax when taxEnabled', async () => {
    const policy = {
      ...BASE_POLICY,
      taxEnabled: true,
      socialSecurityEnabled: false,
    };
    const r = await service.computeForEmployee(
      { id: 'e1', baseSalary: 30000, propertyId: null },
      policy,
      period,
      't1',
      [],
    );
    // annual 360k − expense 100k(cap) − personal 60k = 200k taxable
    // tax: 150k@0% + 50k@5% = 2500/ปี → 208.33/เดือน
    expect(r.tax).toBeCloseTo(208.33, 1);
    expect(r.items.some((i) => i.type === 'deduction' && i.name === 'ภาษีหัก ณ ที่จ่าย')).toBe(true);
  });

  it('charges no tax when annual net income is below the 150k threshold', async () => {
    const policy = {
      ...BASE_POLICY,
      taxEnabled: true,
      socialSecurityEnabled: false,
    };
    const r = await service.computeForEmployee(
      { id: 'e1', baseSalary: 12000, propertyId: null },
      policy,
      period,
      't1',
      [],
    );
    // annual 144k − expense 72k − personal 60k = 12k (< 150k) → ภาษี 0
    expect(r.tax).toBe(0);
  });

  it('does not compute tax when taxEnabled is false', async () => {
    const policy = { ...BASE_POLICY, socialSecurityEnabled: false };
    const r = await service.computeForEmployee(
      { id: 'e1', baseSalary: 80000, propertyId: null },
      policy,
      period,
      't1',
      [],
    );
    expect(r.tax).toBe(0);
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
