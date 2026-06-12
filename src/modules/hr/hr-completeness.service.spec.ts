import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { HrCompletenessService } from './hr-completeness.service';
import { PrismaService } from '../../prisma/prisma.service';

const TENANT = 'tenant-1';
const EMP_ID = 'emp-1';

const fullEmployee = {
  id: EMP_ID,
  firstName: 'ธนกร',
  lastName: 'ช่างดี',
  email: 'thanakorn.eng@mountain.hotel',
  phone: '081-234-5010',
  nationalId: '1100501012345',
  dateOfBirth: new Date('1987-02-14'),
  gender: 'male',
  departmentId: 'dept-1',
  positionId: 'pos-1',
  startDate: new Date('2024-01-01'),
  employmentType: 'FULLTIME',
  educations: [{ degree: 'B.Eng' }],
  workExperiences: [{ company: 'A Hotel' }],
  emergencyContacts: [{ name: 'สมศรี' }],
  bankName: 'KBANK',
  bankAccount: '123-4-56789-0',
  baseSalary: 30000,
  socialSecurity: 'SSO-001',
  taxId: 'TAX-001',
  consentGiven: true,
};

describe('HrCompletenessService', () => {
  let service: HrCompletenessService;
  let prisma: any;

  const setupPrisma = (overrides: Partial<Record<string, any>> = {}) => {
    prisma.employee.findFirst.mockResolvedValue(
      'employee' in overrides ? overrides.employee : fullEmployee,
    );
    prisma.hrEmployeeDocumentRequirement.findMany.mockResolvedValue(
      overrides.docRequirements ?? [{ status: 'verified' }],
    );
    prisma.hrOnboardingTask.findMany.mockResolvedValue(
      overrides.onboardingTasks ?? [{ isComplete: true }],
    );
    const probation =
      'probationReview' in overrides ? overrides.probationReview : { decision: 'passed' };
    prisma.hrProbationRound.findFirst.mockResolvedValue(
      probation ? { status: probation.decision === 'pending' ? 'active' : probation.decision } : null,
    );
    prisma.hrLeavePolicy.count.mockResolvedValue(overrides.leavePolicyCount ?? 1);
    prisma.hrPayrollPolicy.count.mockResolvedValue(overrides.payrollPolicyCount ?? 1);
    prisma.hrShiftAssignment.count.mockResolvedValue(overrides.shiftCount ?? 5);
    prisma.hrAttendance.count.mockResolvedValue(overrides.attendanceCount ?? 20);
    prisma.hrTrainingRecord.count.mockResolvedValue(overrides.trainingCount ?? 2);
  };

  beforeEach(async () => {
    prisma = {
      employee: { findFirst: jest.fn(), findMany: jest.fn() },
      hrEmployeeDocumentRequirement: { findMany: jest.fn() },
      hrOnboardingTask: { findMany: jest.fn() },
      hrProbationRound: { findFirst: jest.fn(), findMany: jest.fn() },
      hrLeavePolicy: { count: jest.fn() },
      hrPayrollPolicy: { count: jest.fn() },
      hrShiftAssignment: { count: jest.fn(), groupBy: jest.fn() },
      hrAttendance: { count: jest.fn() },
      hrTrainingRecord: { count: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [HrCompletenessService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<HrCompletenessService>(HrCompletenessService);
  });

  it('throws BadRequestException when tenantId is missing', async () => {
    await expect(service.getEmployeeCompleteness(EMP_ID)).rejects.toThrow(BadRequestException);
  });

  it('throws NotFoundException when employee does not exist', async () => {
    setupPrisma({ employee: null });
    await expect(service.getEmployeeCompleteness(EMP_ID, TENANT)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('returns 100% when profile and all required systems are complete', async () => {
    setupPrisma();
    const result = await service.getEmployeeCompleteness(EMP_ID, TENANT);

    expect(result.overallPct).toBe(100);
    expect(result.profile.pct).toBe(100);
    expect(result.profile.sections).toHaveLength(6);
    expect(result.profile.sections.every((s) => s.complete)).toBe(true);
    expect(result.systems.filter((s) => s.required).every((s) => s.status === 'complete')).toBe(
      true,
    );
  });

  it('reports missing profile fields per section', async () => {
    setupPrisma({
      employee: {
        ...fullEmployee,
        phone: null,
        nationalId: '',
        educations: [],
        bankAccount: null,
      },
    });
    const result = await service.getEmployeeCompleteness(EMP_ID, TENANT);

    const personal = result.profile.sections.find((s) => s.key === 'personal');
    expect(personal?.complete).toBe(false);
    expect(personal?.missingFields).toEqual(
      expect.arrayContaining(['เบอร์โทรศัพท์', 'เลขบัตรประชาชน']),
    );

    const education = result.profile.sections.find((s) => s.key === 'education');
    expect(education?.complete).toBe(false);

    const financial = result.profile.sections.find((s) => s.key === 'financial');
    expect(financial?.complete).toBe(false);
    expect(financial?.missingFields).toContain('เลขบัญชี');
  });

  it('marks documents as partial when some requirements are missing', async () => {
    setupPrisma({
      docRequirements: [{ status: 'verified' }, { status: 'missing' }],
    });
    const result = await service.getEmployeeCompleteness(EMP_ID, TENANT);

    const docs = result.systems.find((s) => s.key === 'documents');
    expect(docs?.status).toBe('partial');
    expect(docs?.done).toBe(1);
    expect(docs?.total).toBe(2);
  });

  it('marks subsystems as missing when no records exist', async () => {
    setupPrisma({
      docRequirements: [],
      onboardingTasks: [],
      probationReview: null,
      leavePolicyCount: 0,
      shiftCount: 0,
      attendanceCount: 0,
      trainingCount: 0,
    });
    const result = await service.getEmployeeCompleteness(EMP_ID, TENANT);

    for (const key of ['documents', 'onboarding', 'probation', 'leavePolicy', 'roster']) {
      expect(result.systems.find((s) => s.key === key)?.status).toBe('missing');
    }
    expect(result.overallPct).toBeLessThan(100);
  });

  it('marks probation as partial while decision is pending', async () => {
    setupPrisma({ probationReview: { decision: 'pending' } });
    const result = await service.getEmployeeCompleteness(EMP_ID, TENANT);

    const probation = result.systems.find((s) => s.key === 'probation');
    expect(probation?.status).toBe('partial');
  });

  it('reports payroll readiness with missing items in detail', async () => {
    setupPrisma({
      employee: { ...fullEmployee, baseSalary: null },
      payrollPolicyCount: 0,
    });
    const result = await service.getEmployeeCompleteness(EMP_ID, TENANT);

    const payroll = result.systems.find((s) => s.key === 'payroll');
    expect(payroll?.status).toBe('partial');
    expect(payroll?.detail).toContain('เงินเดือนพื้นฐาน');
    expect(payroll?.detail).toContain('นโยบายเงินเดือน');
  });

  describe('getCompletenessSummary (bulk)', () => {
    it('throws BadRequestException when tenantId is missing', async () => {
      await expect(service.getCompletenessSummary()).rejects.toThrow(BadRequestException);
    });

    it('returns empty array when no employees match', async () => {
      prisma.employee.findMany.mockResolvedValue([]);
      const result = await service.getCompletenessSummary(TENANT, ['none']);
      expect(result).toEqual([]);
    });

    it('returns overallPct per employee using bulk queries', async () => {
      const emp2 = { ...fullEmployee, id: 'emp-2', educations: [], bankAccount: null };
      prisma.employee.findMany.mockResolvedValue([fullEmployee, emp2]);
      prisma.hrEmployeeDocumentRequirement.findMany.mockResolvedValue([
        { employeeId: EMP_ID, status: 'verified' },
      ]);
      prisma.hrOnboardingTask.findMany.mockResolvedValue([
        { employeeId: EMP_ID, isComplete: true },
      ]);
      prisma.hrProbationRound.findMany.mockResolvedValue([
        { employeeId: EMP_ID, status: 'passed' },
      ]);
      prisma.hrLeavePolicy.count.mockResolvedValue(1);
      prisma.hrPayrollPolicy.count.mockResolvedValue(1);
      prisma.hrShiftAssignment.groupBy.mockResolvedValue([
        { employeeId: EMP_ID, _count: { _all: 5 } },
      ]);

      const result = await service.getCompletenessSummary(TENANT, [EMP_ID, 'emp-2']);

      expect(result).toHaveLength(2);
      const first = result.find((r) => r.employeeId === EMP_ID);
      const second = result.find((r) => r.employeeId === 'emp-2');
      expect(first?.overallPct).toBe(100);
      // emp-2 ไม่มีข้อมูลระบบย่อยเลย + profile ขาด → ต่ำกว่าชัดเจน
      expect(second?.overallPct).toBeLessThan(first!.overallPct);
      // ต้อง bulk query ครั้งเดียว ไม่ N+1
      expect(prisma.employee.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.hrShiftAssignment.groupBy).toHaveBeenCalledTimes(1);
    });
  });

  it('does not count optional systems (attendance, training) in the score', async () => {
    setupPrisma({ attendanceCount: 0, trainingCount: 0 });
    const result = await service.getEmployeeCompleteness(EMP_ID, TENANT);

    expect(result.overallPct).toBe(100);
    expect(result.systems.find((s) => s.key === 'attendance')?.required).toBe(false);
    expect(result.systems.find((s) => s.key === 'training')?.required).toBe(false);
  });
});
