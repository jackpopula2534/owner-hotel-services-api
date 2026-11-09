import { BadRequestException } from '@nestjs/common';
import { RecruitmentOverviewService, RECRUITING_STATUSES } from './recruitment-overview.service';

describe('RecruitmentOverviewService', () => {
  const NOW = new Date('2026-11-03T02:30:00.000Z');
  const prisma = {
    hrManpowerRequest: { findMany: jest.fn() },
    hrCandidate: { findMany: jest.fn() },
    hrDepartment: { findMany: jest.fn() },
  };
  const service = new RecruitmentOverviewService(prisma as never);

  beforeEach(() => jest.clearAllMocks());

  it('requires a tenant', async () => {
    await expect(service.getOverview(undefined)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns only recruiting requests with their candidates and department names', async () => {
    prisma.hrManpowerRequest.findMany.mockResolvedValue([
      {
        id: 'm1',
        requestNo: 'MPR-1',
        positionTitle: 'Room Attendant',
        headcount: 2,
        status: 'recruiting',
        departmentId: 'd1',
        createdAt: new Date('2026-10-30T08:00:00Z'),
        budgetApprovedAt: new Date('2026-10-30T08:51:00Z'),
        jobPosting: null,
      },
    ]);
    prisma.hrCandidate.findMany.mockResolvedValue([{ id: 'c1', manpowerRequestId: 'm1' }]);
    prisma.hrDepartment.findMany.mockResolvedValue([{ id: 'd1', name: 'ฝ่ายแม่บ้าน' }]);

    const o = await service.getOverview('t1', NOW);

    expect(prisma.hrManpowerRequest.findMany.mock.calls[0][0].where).toEqual({
      tenantId: 't1',
      status: { in: [...RECRUITING_STATUSES] },
    });
    expect(prisma.hrCandidate.findMany.mock.calls[0][0].where).toEqual({
      tenantId: 't1',
      manpowerRequestId: { in: ['m1'] },
    });
    expect(o.asOf).toBe(NOW.toISOString());
    expect(o.requests[0]).toMatchObject({
      id: 'm1',
      department: { id: 'd1', name: 'ฝ่ายแม่บ้าน' },
      openedAt: new Date('2026-10-30T08:51:00Z'),
    });
    expect(o.requests[0]).not.toHaveProperty('departmentId');
    expect(o.candidates).toHaveLength(1);
  });

  it('skips candidate queries when nothing is open', async () => {
    prisma.hrManpowerRequest.findMany.mockResolvedValue([]);
    const o = await service.getOverview('t1', NOW);
    expect(prisma.hrCandidate.findMany).not.toHaveBeenCalled();
    expect(o).toMatchObject({ requests: [], candidates: [] });
  });
});
