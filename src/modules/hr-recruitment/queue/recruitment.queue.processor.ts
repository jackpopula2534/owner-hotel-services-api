import { Processor, Process, OnQueueError } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { PrismaService } from '../../../prisma/prisma.service';

export const RECRUITMENT_QUEUE = 'recruitment';

export const RECRUITMENT_JOBS = {
  INTERVIEW_REMINDER: 'interview-reminder',
  START_DATE_REMINDER: 'start-date-reminder',
  PROBATION_CHECKPOINT_DUE: 'probation-checkpoint-due',
  PROBATION_DUE: 'probation-due',
  APPROVAL_PENDING_NUDGE: 'approval-pending-nudge',
};

interface ApprovalStep {
  level: number;
  role: string;
  approverId: string | null;
  status: 'pending' | 'approved' | 'rejected';
  decidedAt: string | null;
  note: string | null;
}

/**
 * Background notifications for the recruitment → probation pipeline (design §4.2).
 *
 * Jobs create in-app Notification rows directly via Prisma (the same table the
 * NotificationsService writes to) so the queue stays decoupled from the WS
 * gateway and is safe to run when Redis/sockets are unavailable.
 */
@Processor(RECRUITMENT_QUEUE)
export class RecruitmentQueueProcessor {
  private readonly logger = new Logger(RecruitmentQueueProcessor.name);
  private lastQueueErrorLog = 0;

  constructor(private readonly prisma: PrismaService) {}

  /** Prisma client typed loosely — generated model types are unavailable in CI sandbox. */
  private get db(): any {
    return this.prisma as any;
  }

  @OnQueueError()
  onError(error: Error) {
    const now = Date.now();
    const isConnectionError =
      error.name === 'AggregateError' || (error as NodeJS.ErrnoException).code === 'ECONNREFUSED';
    if (isConnectionError) {
      if (now - this.lastQueueErrorLog < 30_000) return;
      this.lastQueueErrorLog = now;
      this.logger.warn('Recruitment queue: Redis unavailable — jobs will run once Redis reconnects.');
      return;
    }
    this.logger.error(`Queue error: ${error.message}`, error.stack);
  }

  private async notify(params: {
    userId?: string | null;
    tenantId?: string | null;
    title: string;
    message: string;
    category: string;
    type?: string;
  }): Promise<void> {
    try {
      await this.db.notification.create({
        data: {
          userId: params.userId ?? null,
          tenantId: params.tenantId ?? null,
          title: params.title,
          message: params.message,
          type: params.type ?? 'info',
          category: params.category,
        },
      });
    } catch (e) {
      this.logger.warn(`notify failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  private dayWindow(daysFromNow: number): { start: Date; end: Date } {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() + daysFromNow);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { start, end };
  }

  // ── interview-reminder: 24h + 1h before scheduledAt ──────────────────────────
  @Process(RECRUITMENT_JOBS.INTERVIEW_REMINDER)
  async handleInterviewReminder(job: Job): Promise<{ reminded: number }> {
    const { windowMinutes } = (job.data ?? {}) as { windowMinutes?: number };
    const lead = windowMinutes ?? 60; // scheduler enqueues for 24h & 1h leads
    const now = new Date();
    const from = new Date(now.getTime() + lead * 60_000);
    const to = new Date(from.getTime() + 15 * 60_000); // 15-min scan bucket

    const interviews = await this.db.hrInterview.findMany({
      where: { status: 'scheduled', scheduledAt: { gte: from, lt: to } },
      include: { candidate: { select: { firstName: true, lastName: true, tenantId: true } } },
    });

    for (const iv of interviews) {
      const candidateName = iv.candidate ? `${iv.candidate.firstName} ${iv.candidate.lastName}` : 'ผู้สมัคร';
      const when = iv.scheduledAt.toLocaleString('th-TH');
      const interviewerIds = Array.isArray(iv.interviewerIds) ? (iv.interviewerIds as string[]) : [];
      for (const uid of interviewerIds) {
        await this.notify({
          userId: uid,
          tenantId: iv.tenantId,
          title: 'เตือนนัดสัมภาษณ์',
          message: `สัมภาษณ์ ${candidateName} (รอบ ${iv.round}) ${when}${iv.location ? ` ที่ ${iv.location}` : ''}`,
          category: 'recruitment.interview',
        });
      }
    }
    this.logger.log(`interview-reminder: ${interviews.length} interview(s), lead ${lead}m`);
    return { reminded: interviews.length };
  }

  // ── start-date-reminder: 3 days before start date ────────────────────────────
  @Process(RECRUITMENT_JOBS.START_DATE_REMINDER)
  async handleStartDateReminder(job: Job): Promise<{ reminded: number }> {
    const { daysBefore } = (job.data ?? {}) as { daysBefore?: number };
    const { start, end } = this.dayWindow(daysBefore ?? 3);

    const hires = await this.db.hrHireRecord.findMany({
      where: { offerStatus: 'accepted', startDate: { gte: start, lt: end } },
      include: { candidate: { select: { firstName: true, lastName: true } } },
    });

    for (const h of hires) {
      const name = h.candidate ? `${h.candidate.firstName} ${h.candidate.lastName}` : 'พนักงานใหม่';
      await this.notify({
        tenantId: h.tenantId,
        title: 'เตรียมรับพนักงานใหม่',
        message: `${name} เริ่มงาน ${h.startDate.toISOString().split('T')[0]}${h.startTime ? ` ${h.startTime}` : ''} — เตรียมของเบิกให้พร้อม`,
        category: 'recruitment.start_date',
      });
    }
    this.logger.log(`start-date-reminder: ${hires.length} hire(s)`);
    return { reminded: hires.length };
  }

  // ── probation-checkpoint-due: checkpoints due within 7 days ───────────────────
  @Process(RECRUITMENT_JOBS.PROBATION_CHECKPOINT_DUE)
  async handleProbationCheckpointDue(job: Job): Promise<{ reminded: number }> {
    const { daysAhead } = (job.data ?? {}) as { daysAhead?: number };
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const horizon = new Date(now);
    horizon.setDate(horizon.getDate() + (daysAhead ?? 7) + 1);

    const checkpoints = await this.db.hrProbationCheckpoint.findMany({
      where: { status: 'pending', dueDate: { gte: now, lt: horizon } },
      include: { round: { select: { employeeId: true, status: true } } },
    });

    let count = 0;
    for (const cp of checkpoints) {
      if (cp.round?.status !== 'active') continue;
      await this.notify({
        userId: cp.reviewerId ?? null,
        tenantId: cp.tenantId,
        title: 'Checkpoint ทดลองงานใกล้ครบกำหนด',
        message: `${cp.label} ครบกำหนด ${cp.dueDate.toISOString().split('T')[0]} — กรุณาประเมิน`,
        category: 'probation.checkpoint',
      });
      count++;
    }
    this.logger.log(`probation-checkpoint-due: ${count} checkpoint(s)`);
    return { reminded: count };
  }

  // ── probation-due: rounds past due but not decided ───────────────────────────
  @Process(RECRUITMENT_JOBS.PROBATION_DUE)
  async handleProbationDue(_job: Job): Promise<{ reminded: number }> {
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    const rounds = await this.db.hrProbationRound.findMany({
      where: { status: 'active', dueDate: { lt: now } },
      include: { employee: { select: { firstName: true, lastName: true } } },
    });

    for (const r of rounds) {
      const name = r.employee ? `${r.employee.firstName} ${r.employee.lastName}` : 'พนักงาน';
      await this.notify({
        tenantId: r.tenantId,
        title: 'รอบทดลองงานครบกำหนด — รอตัดสินผล',
        message: `${name} ครบกำหนดทดลองงาน ${r.dueDate.toISOString().split('T')[0]} แต่ยังไม่ตัดสินผล`,
        category: 'probation.due',
        type: 'warning',
      });
    }
    this.logger.log(`probation-due: ${rounds.length} round(s)`);
    return { reminded: rounds.length };
  }

  // ── approval-pending-nudge: approvers idle > 2 days ──────────────────────────
  @Process(RECRUITMENT_JOBS.APPROVAL_PENDING_NUDGE)
  async handleApprovalPendingNudge(job: Job): Promise<{ reminded: number }> {
    const { staleDays } = (job.data ?? {}) as { staleDays?: number };
    const threshold = new Date();
    threshold.setDate(threshold.getDate() - (staleDays ?? 2));

    const requests = await this.db.hrManpowerRequest.findMany({
      where: { status: { in: ['pending_approval', 'budget_pending'] }, updatedAt: { lt: threshold } },
      select: {
        id: true,
        tenantId: true,
        requestNo: true,
        positionTitle: true,
        status: true,
        approvalChain: true,
        budgetChain: true,
      },
    });

    let count = 0;
    for (const req of requests) {
      const chain = (req.status === 'budget_pending' ? req.budgetChain : req.approvalChain) as
        | ApprovalStep[]
        | null;
      const currentStep = Array.isArray(chain) ? chain.find((s) => s.status === 'pending') : null;
      await this.notify({
        userId: currentStep?.approverId ?? null,
        tenantId: req.tenantId,
        title: 'มีคำขอรออนุมัติค้างนาน',
        message: `${req.requestNo} (${req.positionTitle}) รออนุมัติเกิน ${staleDays ?? 2} วัน`,
        category: 'recruitment.approval_nudge',
        type: 'warning',
      });
      count++;
    }
    this.logger.log(`approval-pending-nudge: ${count} request(s)`);
    return { reminded: count };
  }
}
