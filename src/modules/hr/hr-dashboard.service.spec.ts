import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import {
  HrDashboardService,
  bangkokInstant,
  classifyEmployeeDay,
  summarize,
} from './hr-dashboard.service';
import { PrismaService } from '../../prisma/prisma.service';

// 2026-11-02 15:01 เวลาไทย
const NOW = new Date('2026-11-02T08:01:00.000Z');
const D = (s: string) => new Date(`${s}T00:00:00.000Z`);

function createMockPrisma() {
  const findMany = () => jest.fn().mockResolvedValue([]);
  const count = () => jest.fn().mockResolvedValue(0);
  return {
    employee: { findMany: findMany(), count: count() } as { findMany: jest.Mock; count: jest.Mock },
    hrAttendance: { findMany: findMany() },
    hrShiftAssignment: { findMany: findMany() },
    hrLeaveRequest: { findMany: findMany(), count: count() },
    hrOvertimeRequest: { findMany: findMany(), count: count() },
    hrAttendanceException: { findMany: findMany(), count: count() },
    hrProbationRound: { findMany: findMany() },
    hrEmployeeDocumentRequirement: { count: count() },
    hrInterview: { findMany: findMany() },
  };
}

const emp = (id: string, status = 'ACTIVE', dept: { id: string; name: string } | null = null) => ({
  id,
  firstName: `F${id}`,
  lastName: `L${id}`,
  status,
  department: null,
  hrDepartment: dept,
});

describe('HrDashboard pure helpers', () => {
  it('bangkokInstant converts Bangkok clock to UTC instant', () => {
    expect(bangkokInstant('2026-11-02', '09:00').toISOString()).toBe('2026-11-02T02:00:00.000Z');
  });

  it('classifies attendance before leave / roster', () => {
    const base = { onLeave: true, shift: null, rosterMode: true, date: '2026-11-02', now: NOW };
    expect(classifyEmployeeDay({ ...base, attendance: { status: 'late', checkIn: NOW } })).toBe(
      'late',
    );
    expect(classifyEmployeeDay({ ...base, attendance: { status: 'present', checkIn: NOW } })).toBe(
      'on_time',
    );
    expect(classifyEmployeeDay({ ...base, attendance: null })).toBe('on_leave');
  });

  it('roster mode: no shift or day-off → day_off', () => {
    const base = {
      attendance: null,
      onLeave: false,
      rosterMode: true,
      date: '2026-11-02',
      now: NOW,
    };
    expect(classifyEmployeeDay({ ...base, shift: null })).toBe('day_off');
    expect(classifyEmployeeDay({ ...base, shift: { isDayOff: true, startTime: '08:00' } })).toBe(
      'day_off',
    );
  });

  it('distinguishes no-show from a shift that has not started yet', () => {
    const base = {
      attendance: null,
      onLeave: false,
      rosterMode: true,
      date: '2026-11-02',
      now: NOW,
    };
    expect(classifyEmployeeDay({ ...base, shift: { isDayOff: false, startTime: '08:00' } })).toBe(
      'not_checked_in',
    );
    // กะ 14:45 + 30 นาที = 15:15 > 15:01
    expect(classifyEmployeeDay({ ...base, shift: { isDayOff: false, startTime: '14:45' } })).toBe(
      'awaiting_shift',
    );
  });

  it('summarize uses only due employees as the rate denominator', () => {
    const c = summarize([
      'on_time',
      'on_time',
      'late',
      'not_checked_in',
      'awaiting_shift',
      'on_leave',
      'day_off',
    ]);
    expect(c).toMatchObject({ present: 3, expected: 5, onLeave: 1, dayOff: 1, attendanceRate: 75 });
    expect(summarize(['awaiting_shift']).attendanceRate).toBeNull();
  });
});

describe('HrDashboardService.getOverview', () => {
  let service: HrDashboardService;
  let prisma: ReturnType<typeof createMockPrisma>;

  beforeEach(async () => {
    prisma = createMockPrisma();
    const module: TestingModule = await Test.createTestingModule({
      providers: [HrDashboardService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(HrDashboardService);
  });

  it('requires tenant', async () => {
    await expect(service.getOverview(undefined)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('excludes separated employees and queries the Bangkok business day', async () => {
    const hk = { id: 'hk', name: 'ฝ่ายแม่บ้าน' };
    prisma.employee.findMany.mockResolvedValue([
      emp('1', 'ACTIVE', hk),
      emp('2', 'PROBATION', hk),
      emp('3', 'ACTIVE'),
      emp('4', 'RESIGNED'),
      emp('5', 'terminated'),
    ]);
    prisma.hrAttendance.findMany.mockResolvedValue([
      {
        employeeId: '1',
        date: D('2026-11-02'),
        status: 'present',
        checkIn: new Date('2026-11-02T01:50:00Z'),
      },
      {
        employeeId: '2',
        date: D('2026-11-02'),
        status: 'late',
        checkIn: new Date('2026-11-02T02:20:00Z'),
      },
    ]);
    prisma.hrLeaveRequest.findMany
      .mockResolvedValueOnce([
        {
          employeeId: '3',
          startDate: D('2026-11-01'),
          endDate: D('2026-11-03'),
          leaveType: { name: 'ลาป่วย' },
        },
      ])
      .mockResolvedValue([]);

    const o = await service.getOverview('t1', undefined, NOW);

    expect(o.date).toBe('2026-11-02');
    expect(o.headcount).toMatchObject({
      total: 5,
      current: 3,
      active: 2,
      probation: 1,
      separated: 2,
    });
    expect(o.rosterMode).toBe(false);
    expect(o.today).toMatchObject({
      present: 2,
      onTime: 1,
      late: 1,
      onLeave: 1,
      attendanceRate: 100,
    });
    // สาย 20 นาทีจาก 09:00 (02:00Z)
    expect(o.today.lateAvgMinutes).toBe(20);
    expect(o.away).toEqual([
      expect.objectContaining({ employeeId: '3', status: 'on_leave', leaveType: 'ลาป่วย' }),
    ]);
    expect(o.departments[0]).toMatchObject({ name: 'ฝ่ายแม่บ้าน', headcount: 2, present: 2 });
    expect(o.trend).toHaveLength(14);
    expect(o.trend[13].date).toBe('2026-11-02');

    const attWhere = prisma.hrAttendance.findMany.mock.calls[0][0].where;
    expect(attWhere.employeeId.in).toEqual(['1', '2', '3']);
    expect(attWhere.date.lte.toISOString()).toBe('2026-11-02T00:00:00.000Z');
    expect(attWhere.date.gte.toISOString()).toBe('2026-10-20T00:00:00.000Z');
  });

  it('uses the roster when one exists for the day', async () => {
    prisma.employee.findMany.mockResolvedValue([emp('1'), emp('2'), emp('3')]);
    prisma.hrShiftAssignment.findMany.mockResolvedValue([
      {
        employeeId: '1',
        date: D('2026-11-02'),
        isDayOff: false,
        startTime: null,
        shiftType: { startTime: '07:00' },
      },
      { employeeId: '2', date: D('2026-11-02'), isDayOff: true, startTime: null, shiftType: null },
    ]);
    const o = await service.getOverview('t1', undefined, NOW);
    expect(o.rosterMode).toBe(true);
    expect(o.today).toMatchObject({ expected: 1, notCheckedIn: 1, dayOff: 2, attendanceRate: 0 });
    expect(o.away[0]).toMatchObject({
      employeeId: '1',
      status: 'not_checked_in',
      shiftStart: '07:00',
    });
  });

  it('counts only employees of the property and reports unassigned ones', async () => {
    prisma.employee.count = jest.fn().mockResolvedValue(4);
    const o = await service.getOverview('t1', 'p1', NOW);
    expect(prisma.employee.findMany.mock.calls[0][0].where).toEqual({
      tenantId: 't1',
      anonymizedAt: null,
      propertyId: 'p1',
    });
    expect(prisma.employee.count.mock.calls[0][0].where).toMatchObject({ propertyId: null });
    expect(o.unassignedEmployees).toBe(4);
  });

  it('does not report unassigned employees for a tenant-wide view', async () => {
    const o = await service.getOverview('t1', undefined, NOW);
    expect(o.unassignedEmployees).toBeNull();
  });

  it('merges pending approvals newest first and counts todos', async () => {
    prisma.employee.findMany.mockResolvedValue([emp('1')]);
    prisma.hrLeaveRequest.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: 'l1',
        employeeId: '1',
        employee: emp('1'),
        leaveType: { name: 'ลาพักร้อน' },
        startDate: D('2026-11-05'),
        endDate: D('2026-11-07'),
        totalDays: 3,
        createdAt: new Date('2026-11-01T00:00:00Z'),
      },
    ]);
    prisma.hrLeaveRequest.count.mockResolvedValue(1);
    prisma.hrOvertimeRequest.findMany.mockResolvedValue([
      {
        id: 'o1',
        employeeId: '1',
        employee: emp('1'),
        date: D('2026-11-02'),
        minutes: 180,
        createdAt: new Date('2026-11-02T03:00:00Z'),
      },
    ]);
    prisma.hrOvertimeRequest.count.mockResolvedValue(2);
    prisma.hrProbationRound.findMany.mockResolvedValue([
      { dueDate: D('2026-11-05'), status: 'active', employee: emp('1') },
      { dueDate: D('2026-11-25'), status: 'active', employee: emp('1') },
    ]);

    const o = await service.getOverview('t1', undefined, NOW);
    expect(o.pending).toMatchObject({ total: 3, leave: 1, overtime: 2, exceptions: 0 });
    expect(o.pending.items.map((i) => i.id)).toEqual(['o1', 'l1']);
    expect(o.todos.probationDue).toBe(1);
    expect(o.upcoming[0]).toMatchObject({ date: '2026-11-05', kind: 'probation' });
  });
});
