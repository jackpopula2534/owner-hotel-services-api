import { Test, TestingModule } from '@nestjs/testing';
import { Job } from 'bull';
import { RecruitmentQueueProcessor } from './recruitment.queue.processor';
import { PrismaService } from '../../../prisma/prisma.service';

function createMockPrisma() {
  return {
    notification: { create: jest.fn().mockResolvedValue({ id: 'n1' }) },
    hrInterview: { findMany: jest.fn().mockResolvedValue([]) },
    hrHireRecord: { findMany: jest.fn().mockResolvedValue([]) },
    hrProbationCheckpoint: { findMany: jest.fn().mockResolvedValue([]) },
    hrProbationRound: { findMany: jest.fn().mockResolvedValue([]) },
    hrManpowerRequest: { findMany: jest.fn().mockResolvedValue([]) },
  };
}

const job = (data: unknown) => ({ data }) as Job;

describe('RecruitmentQueueProcessor', () => {
  let processor: RecruitmentQueueProcessor;
  let prisma: ReturnType<typeof createMockPrisma>;

  beforeEach(async () => {
    prisma = createMockPrisma();
    const module: TestingModule = await Test.createTestingModule({
      providers: [RecruitmentQueueProcessor, { provide: PrismaService, useValue: prisma }],
    }).compile();
    processor = module.get(RecruitmentQueueProcessor);
  });

  it('interview-reminder notifies every interviewer', async () => {
    prisma.hrInterview.findMany.mockResolvedValue([
      {
        id: 'iv1',
        tenantId: 't1',
        round: 1,
        scheduledAt: new Date(),
        location: 'Room A',
        interviewerIds: ['u1', 'u2'],
        candidate: { firstName: 'A', lastName: 'B', tenantId: 't1' },
      },
    ]);
    const res = await processor.handleInterviewReminder(job({ windowMinutes: 60 }));
    expect(res.reminded).toBe(1);
    expect(prisma.notification.create).toHaveBeenCalledTimes(2);
  });

  it('start-date-reminder notifies once per accepted hire', async () => {
    prisma.hrHireRecord.findMany.mockResolvedValue([
      { id: 'h1', tenantId: 't1', startDate: new Date(), startTime: '08:30', candidate: { firstName: 'C', lastName: 'D' } },
    ]);
    const res = await processor.handleStartDateReminder(job({ daysBefore: 3 }));
    expect(res.reminded).toBe(1);
    expect(prisma.notification.create).toHaveBeenCalledTimes(1);
  });

  it('probation-checkpoint-due skips checkpoints whose round is not active', async () => {
    prisma.hrProbationCheckpoint.findMany.mockResolvedValue([
      { id: 'c1', tenantId: 't1', label: '30 วัน', dueDate: new Date(), reviewerId: 'u1', round: { employeeId: 'e1', status: 'active' } },
      { id: 'c2', tenantId: 't1', label: '60 วัน', dueDate: new Date(), reviewerId: 'u1', round: { employeeId: 'e1', status: 'passed' } },
    ]);
    const res = await processor.handleProbationCheckpointDue(job({ daysAhead: 7 }));
    expect(res.reminded).toBe(1);
  });

  it('probation-due notifies for each overdue active round', async () => {
    prisma.hrProbationRound.findMany.mockResolvedValue([
      { id: 'r1', tenantId: 't1', dueDate: new Date(), employee: { firstName: 'E', lastName: 'F' } },
    ]);
    const res = await processor.handleProbationDue(job({}));
    expect(res.reminded).toBe(1);
    expect(prisma.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ category: 'probation.due', type: 'warning' }) }),
    );
  });

  it('approval-pending-nudge targets the current pending approver', async () => {
    prisma.hrManpowerRequest.findMany.mockResolvedValue([
      {
        id: 'm1',
        tenantId: 't1',
        requestNo: 'MPR-2026-0001',
        positionTitle: 'FD',
        status: 'pending_approval',
        approvalChain: [
          { level: 1, role: 'dept_head', approverId: 'u9', status: 'pending', decidedAt: null, note: null },
        ],
        budgetChain: null,
      },
    ]);
    const res = await processor.handleApprovalPendingNudge(job({ staleDays: 2 }));
    expect(res.reminded).toBe(1);
    expect(prisma.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: 'u9' }) }),
    );
  });
});
