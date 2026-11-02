import { NotFoundException } from '@nestjs/common';
import { ManpowerInsightsService, bangkokMonthRange, dateColumnMonthRange } from './manpower-insights.service';
import { PrismaService } from '../../prisma/prisma.service';

function createMockPrisma() {
  return {
    hrManpowerRequest: {
      groupBy: jest.fn().mockResolvedValue([]),
      aggregate: jest.fn().mockResolvedValue({ _sum: { budgetTotal: null } }),
      findFirst: jest.fn(),
    },
    hrHireRecord: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]) },
    hrDepartment: { findFirst: jest.fn() },
    hrOvertimeRequest: { aggregate: jest.fn().mockResolvedValue({ _sum: { minutes: null } }) },
    hrCandidate: { findMany: jest.fn().mockResolvedValue([]) },
    hrProbationRound: { findMany: jest.fn().mockResolvedValue([]) },
    employee: {
      count: jest.fn().mockResolvedValue(0),
      aggregate: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
}

const NOW = new Date('2026-11-15T05:00:00.000Z');

describe('ManpowerInsightsService', () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let service: ManpowerInsightsService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new ManpowerInsightsService(prisma as unknown as PrismaService);
  });

  describe('month ranges', () => {
    it('Bangkok month boundaries for instants vs UTC midnight for @db.Date', () => {
      // 2026-10-31T18:00Z = 1 Nov 01:00 in Bangkok → November
      const instant = bangkokMonthRange(new Date('2026-10-31T18:00:00Z'));
      expect(instant.start.toISOString()).toBe('2026-10-31T17:00:00.000Z');
      expect(instant.end.toISOString()).toBe('2026-11-30T17:00:00.000Z');
      const dateCol = dateColumnMonthRange(new Date('2026-10-31T18:00:00Z'));
      expect(dateCol.start.toISOString()).toBe('2026-11-01T00:00:00.000Z');
      expect(dateCol.end.toISOString()).toBe('2026-12-01T00:00:00.000Z');
    });
  });

  describe('summary', () => {
    it('aggregates status buckets, starting-this-month and avg time-to-hire', async () => {
      prisma.hrManpowerRequest.groupBy.mockResolvedValue([
        { status: 'pending_approval', _count: { _all: 2 } },
        { status: 'budget_pending', _count: { _all: 1 } },
        { status: 'recruiting', _count: { _all: 3 } },
        { status: 'interviewing', _count: { _all: 1 } },
        { status: 'offer_made', _count: { _all: 1 } },
        { status: 'completed', _count: { _all: 4 } },
        { status: 'cancelled', _count: { _all: 1 } },
        { status: 'rejected', _count: { _all: 1 } },
      ]);
      prisma.hrHireRecord.count.mockResolvedValue(2);
      prisma.hrHireRecord.findMany.mockResolvedValue([
        // request A: created 1 Oct, first hire 11 Oct (10 days) — later hire ignored
        { createdAt: new Date('2026-10-11T00:00:00Z'), candidate: { manpowerRequestId: 'A', manpowerRequest: { createdAt: new Date('2026-10-01T00:00:00Z') } } },
        { createdAt: new Date('2026-10-20T00:00:00Z'), candidate: { manpowerRequestId: 'A', manpowerRequest: { createdAt: new Date('2026-10-01T00:00:00Z') } } },
        // request B: 21 days
        { createdAt: new Date('2026-10-22T00:00:00Z'), candidate: { manpowerRequestId: 'B', manpowerRequest: { createdAt: new Date('2026-10-01T00:00:00Z') } } },
      ]);

      const res = await service.summary('t1', NOW);

      expect(res).toEqual({
        pendingApproval: 2,
        budgetPending: 1,
        recruiting: 5,
        startingThisMonth: 2,
        avgTimeToHireDays: 15.5,
        active: 8,
        closed: 6,
      });
      const countWhere = prisma.hrHireRecord.count.mock.calls[0][0].where;
      expect(countWhere).toMatchObject({ tenantId: 't1', candidate: { status: 'hired' } });
      expect(countWhere.startDate.gte.toISOString()).toBe('2026-10-31T17:00:00.000Z');
      expect(prisma.hrManpowerRequest.groupBy.mock.calls[0][0].where).toEqual({ tenantId: 't1' });
    });

    it('avgTimeToHireDays is null with no hires', async () => {
      const res = await service.summary('t1', NOW);
      expect(res.avgTimeToHireDays).toBeNull();
      expect(res.active).toBe(0);
    });
  });

  describe('insights', () => {
    it('returns department numbers, salary band and recent leavers', async () => {
      prisma.hrDepartment.findFirst.mockResolvedValue({ id: 'd1', name: 'Kitchen', plannedHeadcount: 10, annualPersonnelBudget: '1200000.00' });
      prisma.employee.count.mockResolvedValue(8);
      prisma.hrOvertimeRequest.aggregate.mockResolvedValue({ _sum: { minutes: 125 } });
      prisma.hrManpowerRequest.aggregate.mockResolvedValue({ _sum: { budgetTotal: '300000.00' } });
      prisma.employee.aggregate.mockResolvedValue({ _min: { baseSalary: '15000' }, _max: { baseSalary: '22000' }, _count: { baseSalary: 3 } });
      prisma.employee.findMany.mockResolvedValue([
        { id: 'e9', firstName: 'Somchai', lastName: 'K', status: 'RESIGNED', updatedAt: new Date('2026-10-01T00:00:00Z'), position: null, hrPosition: { name: 'Cook' } },
      ]);

      const res = await service.insights('t1', { departmentId: 'd1', positionId: 'p1' }, NOW);

      expect(res.department).toEqual({
        id: 'd1',
        name: 'Kitchen',
        activeHeadcount: 8,
        plannedHeadcount: 10,
        overtimeHoursThisMonth: 2.1,
        annualPersonnelBudget: 1200000,
        committedBudgetThisYear: 300000,
        remainingBudget: 900000,
      });
      expect(res.positionSalary).toEqual({ min: 15000, max: 22000, count: 3 });
      expect(res.recentLeavers).toEqual([
        { id: 'e9', name: 'Somchai K', positionName: 'Cook', status: 'RESIGNED', leftAt: '2026-10-01T00:00:00.000Z' },
      ]);
      // time-to-hire filtered by position when given
      expect(prisma.hrHireRecord.findMany.mock.calls[0][0].where).toEqual({
        tenantId: 't1',
        candidate: { manpowerRequest: { positionId: 'p1' } },
      });
      // OT uses UTC-midnight bounds (@db.Date)
      const otWhere = prisma.hrOvertimeRequest.aggregate.mock.calls[0][0].where;
      expect(otWhere.date.gte.toISOString()).toBe('2026-11-01T00:00:00.000Z');
      expect(otWhere).toMatchObject({ tenantId: 't1', status: 'approved', employee: { departmentId: 'd1' } });
      expect(prisma.employee.count.mock.calls[0][0].where).toEqual({
        tenantId: 't1',
        departmentId: 'd1',
        status: { in: ['ACTIVE', 'PROBATION'] },
      });
    });

    it('nulls when no department/position given or found', async () => {
      prisma.employee.aggregate.mockResolvedValue({ _min: { baseSalary: null }, _max: { baseSalary: null }, _count: { baseSalary: 0 } });
      prisma.hrDepartment.findFirst.mockResolvedValue(null);
      const res = await service.insights('t1', { departmentId: 'dX', positionId: 'pX' }, NOW);
      expect(res.department).toBeNull();
      expect(res.positionSalary).toBeNull();
      expect(res.sampleSize).toBe(0);
    });
  });

  describe('probation', () => {
    it('returns the latest round per hired employee', async () => {
      prisma.hrManpowerRequest.findFirst.mockResolvedValue({ id: 'm1' });
      prisma.hrCandidate.findMany.mockResolvedValue([
        { hireRecord: { employee: { id: 'e1', firstName: 'A', lastName: 'B' } } },
        { hireRecord: { employee: { id: 'e2', firstName: 'C', lastName: 'D' } } },
        { hireRecord: null },
      ]);
      prisma.hrProbationRound.findMany.mockResolvedValue([
        { id: 'r2', employeeId: 'e1', status: 'active', startDate: 's', dueDate: 'd', checkpoints: [{ id: 'c1', label: '30 วัน', dueDate: 'x', status: 'done', score: '80.00', reviewedAt: null }] },
        { id: 'r1', employeeId: 'e1', status: 'extended', startDate: 's', dueDate: 'd', checkpoints: [] },
      ]);
      const res = await service.probation('m1', 't1');
      expect(res).toHaveLength(2);
      expect(res[0].round?.id).toBe('r2');
      expect(res[0].round?.checkpoints[0].score).toBe(80);
      expect(res[1]).toEqual({ employeeId: 'e2', name: 'C D', round: null });
      expect(prisma.hrProbationRound.findMany.mock.calls[0][0].where).toEqual({ tenantId: 't1', employeeId: { in: ['e1', 'e2'] } });
    });

    it('404s for a request of another tenant', async () => {
      prisma.hrManpowerRequest.findFirst.mockResolvedValue(null);
      await expect(service.probation('m1', 't1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
