import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { HrTrainingService } from './hr-training.service';
import { HrSelfServiceService } from './hr-self-service.service';
import { HrAnalyticsService } from './hr-analytics.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../audit-log/audit-log.service';

describe('HrTrainingService', () => {
  let service: HrTrainingService;
  let prisma: any;
  beforeEach(async () => {
    prisma = {
      employee: { findFirst: jest.fn() },
      hrTrainingRecord: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HrTrainingService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogService, useValue: { log: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    service = module.get(HrTrainingService);
  });

  it('creates a training record with formatted score + parsed dates', async () => {
    prisma.employee.findFirst.mockResolvedValue({ id: 'e1' });
    prisma.hrTrainingRecord.create.mockImplementation(({ data }: any) => ({ id: 'tr1', ...data }));
    const res = await service.create(
      { employeeId: 'e1', title: 'Safety', type: 'certification', score: 90, expiresAt: '2027-01-01' },
      't1', 'u1',
    );
    expect(res.score).toBe('90.00');
    expect(res.expiresAt).toBeInstanceOf(Date);
    expect(res.type).toBe('certification');
  });

  it('throws when employee not found', async () => {
    prisma.employee.findFirst.mockResolvedValue(null);
    await expect(service.create({ employeeId: 'x', title: 'T' }, 't1')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('HrSelfServiceService', () => {
  let service: HrSelfServiceService;
  let prisma: any;
  beforeEach(async () => {
    prisma = {
      employee: { findFirst: jest.fn() },
      hrPayroll: { findMany: jest.fn().mockResolvedValue([]) },
      hrLeaveRequest: { findMany: jest.fn().mockResolvedValue([]) },
      hrAttendance: { findMany: jest.fn().mockResolvedValue([]) },
      hrShiftAssignment: { findMany: jest.fn().mockResolvedValue([]) },
      hrTrainingRecord: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [HrSelfServiceService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(HrSelfServiceService);
  });

  it('throws when employee not found', async () => {
    prisma.employee.findFirst.mockResolvedValue(null);
    await expect(service.getOverview('x', 't1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('summarises paid vs unpaid approved leave days', async () => {
    prisma.employee.findFirst.mockResolvedValue({ id: 'e1', firstName: 'A', lastName: 'B' });
    prisma.hrLeaveRequest.findMany.mockResolvedValue([
      { status: 'approved', totalDays: 3, leaveType: { isPaid: true } },
      { status: 'approved', totalDays: 2, leaveType: { isPaid: false } },
      { status: 'pending', totalDays: 1, leaveType: { isPaid: true } },
    ]);
    const res = await service.getOverview('e1', 't1', 2026);
    expect(res.leave.summary.paidDaysTaken).toBe(3);
    expect(res.leave.summary.unpaidDaysTaken).toBe(2);
    expect(res.leave.summary.pending).toBe(1);
  });
});

describe('HrAnalyticsService', () => {
  let service: HrAnalyticsService;
  let prisma: any;
  beforeEach(async () => {
    prisma = {
      employee: {
        groupBy: jest.fn().mockResolvedValue([
          { status: 'ACTIVE', _count: { _all: 8 } },
          { status: 'PROBATION', _count: { _all: 2 } },
          { status: 'RESIGNED', _count: { _all: 3 } },
        ]),
        findMany: jest.fn().mockResolvedValue([
          { department: 'Front', status: 'ACTIVE' },
          { department: 'Front', status: 'ACTIVE' },
          { department: 'HK', status: 'PROBATION' },
          { department: 'HK', status: 'RESIGNED' },
        ]),
      },
      hrAttendance: {
        groupBy: jest.fn().mockResolvedValue([
          { status: 'present', _count: { _all: 80 } },
          { status: 'late', _count: { _all: 15 } },
          { status: 'absent', _count: { _all: 5 } },
        ]),
      },
      hrPayroll: { findMany: jest.fn().mockResolvedValue([{ overtimePay: 1000, netSalary: 30000 }, { overtimePay: 500, netSalary: 25000 }]) },
      hrOffboarding: { count: jest.fn().mockResolvedValue(2) },
      hrEmployeeDocument: { count: jest.fn().mockResolvedValue(4) },
      hrTrainingRecord: { count: jest.fn().mockResolvedValue(1) },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [HrAnalyticsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(HrAnalyticsService);
  });

  it('computes headcount, absenteeism, OT cost and turnover', async () => {
    const r = await service.getOverview('t1', 6, 2026);
    expect(r.headcount.total).toBe(10); // ACTIVE 8 + PROBATION 2
    expect(r.headcount.byDepartment.Front).toBe(2);
    // absenteeism = (late 15 + absent 5) / 100
    expect(r.attendance.absenteeismRate).toBeCloseTo(0.2);
    expect(r.payroll.otCost).toBe(1500);
    // turnover = 2 / 10
    expect(r.turnover.turnoverRate).toBeCloseTo(0.2);
    expect(r.compliance.documentsExpiring).toBe(4);
    expect(r.compliance.certificationsExpiring).toBe(1);
  });
});
