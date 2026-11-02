import { ConflictException } from '@nestjs/common';
import { InterviewService } from './interview.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { RecruitmentNotifierService } from './recruitment-notifier.service';

function createMockPrisma() {
  const prisma: any = {
    hrInterview: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      create: jest.fn(({ data }: any) => ({ id: 'iv-new', ...data })),
      update: jest.fn(({ data }: any) => Promise.resolve({ id: 'iv1', ...data })),
    },
    hrCandidate: {
      findFirst: jest.fn(),
      update: jest.fn(({ data }: any) => ({ id: 'c1', ...data })),
      count: jest.fn().mockResolvedValue(1),
    },
    hrManpowerRequest: { updateMany: jest.fn(() => ({ count: 1 })) },
  };
  prisma.$transaction = jest.fn((ops: unknown[]) => Promise.all(ops));
  return prisma;
}

const FUTURE = new Date(Date.now() + 3 * 86_400_000);
FUTURE.setUTCHours(3, 0, 0, 0); // 10:00 Bangkok

describe('InterviewService', () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let notifier: { notifyCandidateInterview: jest.Mock };
  let service: InterviewService;

  beforeEach(() => {
    prisma = createMockPrisma();
    notifier = { notifyCandidateInterview: jest.fn().mockResolvedValue(true) };
    service = new InterviewService(
      prisma as unknown as PrismaService,
      { log: jest.fn().mockResolvedValue(undefined) } as unknown as AuditLogService,
      notifier as unknown as RecruitmentNotifierService,
    );
  });

  const existing = (over: Record<string, unknown>) => ({
    id: 'iv-old',
    scheduledAt: FUTURE,
    durationMinutes: 45,
    interviewerIds: ['u1'],
    candidate: { firstName: 'Old', lastName: 'Cand' },
    ...over,
  });

  describe('findConflicts', () => {
    it('reports overlaps and same-day interviews for the given interviewers only', async () => {
      prisma.hrInterview.findMany.mockResolvedValue([
        existing({ id: 'a', scheduledAt: new Date(FUTURE.getTime() + 30 * 60_000) }), // overlaps 10:30
        existing({ id: 'b', scheduledAt: new Date(FUTURE.getTime() + 3 * 3_600_000) }), // 13:00 same day
        existing({ id: 'c', interviewerIds: ['u9'] }), // other interviewer
      ]);
      const res = await service.findConflicts({ interviewerIds: ['u1', 'u2'], scheduledAt: FUTURE, durationMinutes: 45 }, 't1');
      expect(res.conflicts.map((c) => c.interviewId)).toEqual(['a']);
      expect(res.conflicts[0]).toMatchObject({ interviewerId: 'u1', candidateName: 'Old Cand', durationMinutes: 45 });
      expect(res.sameDay.map((s) => s.scheduledAt)).toHaveLength(2);
      const where = prisma.hrInterview.findMany.mock.calls[0][0].where;
      expect(where.tenantId).toBe('t1');
      expect(where.status).toEqual({ in: ['scheduled', 'rescheduled'] });
    });

    it('back-to-back interviews do not conflict; excludeId is passed through', async () => {
      prisma.hrInterview.findMany.mockResolvedValue([existing({ scheduledAt: new Date(FUTURE.getTime() + 45 * 60_000) })]);
      const res = await service.findConflicts(
        { interviewerIds: ['u1'], scheduledAt: FUTURE, durationMinutes: 45, excludeId: 'iv-x' },
        't1',
      );
      expect(res.conflicts).toHaveLength(0);
      expect(prisma.hrInterview.findMany.mock.calls[0][0].where.id).toEqual({ not: 'iv-x' });
    });
  });

  describe('schedule', () => {
    beforeEach(() => {
      prisma.hrCandidate.findFirst.mockResolvedValue({
        id: 'c1',
        status: 'screening',
        manpowerRequestId: 'm1',
        firstName: 'N',
        lastName: 'C',
        email: 'n@c.com',
        phone: '0812345678',
        manpowerRequest: { status: 'recruiting', positionTitle: 'Chef' },
      });
    });

    it('409 when an interviewer is double-booked', async () => {
      prisma.hrInterview.findMany.mockResolvedValue([existing({})]);
      await expect(
        service.schedule('c1', { scheduledAt: FUTURE.toISOString(), interviewerIds: ['u1'] }, 't1', 'u-hr'),
      ).rejects.toBeInstanceOf(ConflictException);
      const err = await service
        .schedule('c1', { scheduledAt: FUTURE.toISOString(), interviewerIds: ['u1'] }, 't1', 'u-hr')
        .catch((e: ConflictException) => e.getResponse() as { details: { conflicts: unknown[] } });
      expect(err.details.conflicts).toHaveLength(1);
      expect(prisma.hrInterview.create).not.toHaveBeenCalled();
    });

    it('allowConflict overrides; persists duration/format and notifies candidate', async () => {
      prisma.hrInterview.findMany.mockResolvedValue([existing({})]);
      const res = await service.schedule(
        'c1',
        {
          scheduledAt: FUTURE.toISOString(),
          interviewerIds: ['u1'],
          allowConflict: true,
          durationMinutes: 60,
          format: 'video',
          notifyCandidate: true,
        },
        't1',
        'u-hr',
      );
      expect(prisma.hrInterview.create.mock.calls[0][0].data).toMatchObject({ durationMinutes: 60, format: 'video' });
      expect(notifier.notifyCandidateInterview).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 't1', positionTitle: 'Chef', durationMinutes: 60, format: 'video' }),
      );
      expect(res.candidateNotifiedAt).toBeInstanceOf(Date);
    });

    it('notification failure never fails scheduling', async () => {
      notifier.notifyCandidateInterview.mockRejectedValue(new Error('smtp down'));
      const res = await service.schedule(
        'c1',
        { scheduledAt: FUTURE.toISOString(), interviewerIds: ['u1'], notifyCandidate: true },
        't1',
        'u-hr',
      );
      expect(res.id).toBe('iv-new');
      expect(res.candidateNotifiedAt).toBeUndefined();
    });
  });

  describe('recordResult', () => {
    beforeEach(() => {
      prisma.hrInterview.findFirst.mockResolvedValue({
        id: 'iv1',
        status: 'scheduled',
        candidateId: 'c1',
        candidate: { manpowerRequestId: 'm1' },
      });
    });

    it('derives score from ratings average × 20 when score is omitted', async () => {
      const res = await service.recordResult(
        'iv1',
        { result: 'pass', ratings: [{ criterion: 'สื่อสาร', score: 4 }, { criterion: 'ทักษะ', score: 5 }] },
        't1',
        'u1',
      );
      expect(res.score).toBe('90.00');
      expect(res.ratings).toEqual([{ criterion: 'สื่อสาร', score: 4 }, { criterion: 'ทักษะ', score: 5 }]);
    });

    it('explicit score wins over ratings', async () => {
      const res = await service.recordResult(
        'iv1',
        { result: 'pass', score: 70, ratings: [{ criterion: 'a', score: 5 }] },
        't1',
        'u1',
      );
      expect(res.score).toBe('70.00');
    });
  });
});
