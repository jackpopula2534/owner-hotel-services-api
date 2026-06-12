import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { AuditAction, AuditResource, AuditCategory } from '../../audit-log/dto/audit-log.dto';
import { ScheduleInterviewDto, RescheduleInterviewDto, InterviewResultDto } from './dto/recruitment.dto';

/** Stage 4: interview scheduling and results. */
@Injectable()
export class InterviewService {
  private readonly logger = new Logger(InterviewService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  private audit(action: AuditAction, resourceId: string, tenantId: string, userId: string, description: string): void {
    this.auditLog
      .log({ action, resource: AuditResource.INTERVIEW, resourceId, category: AuditCategory.HR, tenantId, userId, description })
      .catch((err: Error) => this.logger.error(`Audit log failed: ${err.message}`));
  }

  /**
   * เมื่อผู้สมัครหลุดจาก pipeline (fail/no-show) — ถ้าคำขอไม่เหลือผู้สมัคร active
   * ให้วนกลับไป "recruiting" เพื่อหาคนใหม่ แทนที่จะค้างอยู่ที่ interviewing/offer_made
   */
  private async reopenRequestIfNoActiveCandidates(manpowerRequestId: string, tenantId: string): Promise<void> {
    const activeCount = await (this.prisma as any).hrCandidate.count({
      where: {
        tenantId,
        manpowerRequestId,
        status: { in: ['applied', 'screening', 'interview_scheduled', 'interviewed', 'offer_made', 'offer_accepted'] },
      },
    });
    if (activeCount > 0) return;
    const result = await (this.prisma as any).hrManpowerRequest.updateMany({
      where: { id: manpowerRequestId, tenantId, status: { in: ['interviewing', 'offer_made'] } },
      data: { status: 'recruiting' },
    });
    if (result.count > 0) {
      this.logger.log(`Manpower request ${manpowerRequestId} reopened to "recruiting" (no active candidates left)`);
    }
  }

  async findAll(query: Record<string, string>, tenantId: string) {
    const where: Record<string, unknown> = { tenantId };
    if (query.candidateId) where['candidateId'] = query.candidateId;
    if (query.status) where['status'] = query.status;
    if (query.from || query.to) {
      where['scheduledAt'] = {
        ...(query.from && { gte: new Date(query.from) }),
        ...(query.to && { lte: new Date(query.to) }),
      };
    }
    const data = await (this.prisma as any).hrInterview.findMany({
      where,
      orderBy: { scheduledAt: 'asc' },
      include: { candidate: { select: { id: true, firstName: true, lastName: true, status: true, manpowerRequestId: true } } },
    });
    return { data, total: data.length };
  }

  async findOne(id: string, tenantId: string) {
    const interview = await (this.prisma as any).hrInterview.findFirst({
      where: { id, tenantId },
      include: { candidate: true },
    });
    if (!interview) throw new NotFoundException(`Interview ${id} not found`);
    return interview;
  }

  async schedule(candidateId: string, dto: ScheduleInterviewDto, tenantId: string, userId: string) {
    const candidate = await (this.prisma as any).hrCandidate.findFirst({
      where: { id: candidateId, tenantId },
      include: { manpowerRequest: { select: { status: true } } },
    });
    if (!candidate) throw new NotFoundException(`Candidate ${candidateId} not found`);
    if (['hired', 'rejected', 'withdrawn'].includes(candidate.status)) {
      throw new BadRequestException(`Cannot schedule an interview for a "${candidate.status}" candidate`);
    }
    if (!dto.interviewerIds.length) throw new BadRequestException('At least one interviewer is required');
    if (new Date(dto.scheduledAt).getTime() < Date.now()) {
      throw new BadRequestException('scheduledAt must be in the future');
    }

    const [interview] = await this.prisma.$transaction([
      (this.prisma as any).hrInterview.create({
        data: {
          tenantId,
          candidateId,
          round: dto.round ?? 1,
          scheduledAt: new Date(dto.scheduledAt),
          location: dto.location ?? null,
          interviewerIds: dto.interviewerIds,
          status: 'scheduled',
        },
      }),
      (this.prisma as any).hrCandidate.update({
        where: { id: candidateId },
        data: { status: 'interview_scheduled' },
      }),
      (this.prisma as any).hrManpowerRequest.updateMany({
        where: { id: candidate.manpowerRequestId, tenantId, status: 'recruiting' },
        data: { status: 'interviewing' },
      }),
    ]);
    this.audit(AuditAction.INTERVIEW_SCHEDULE, interview.id, tenantId, userId, `Interview round ${dto.round ?? 1} scheduled at ${dto.scheduledAt}`);
    return interview;
  }

  async reschedule(id: string, dto: RescheduleInterviewDto, tenantId: string, userId: string) {
    const existing = await this.findOne(id, tenantId);
    if (existing.status !== 'scheduled') {
      throw new BadRequestException(`Only scheduled interviews can be updated (current: "${existing.status}")`);
    }
    const updated = await (this.prisma as any).hrInterview.update({
      where: { id },
      data: {
        ...(dto.scheduledAt && { scheduledAt: new Date(dto.scheduledAt), status: 'rescheduled' }),
        ...(dto.location !== undefined && { location: dto.location }),
        ...(dto.interviewerIds && { interviewerIds: dto.interviewerIds }),
        ...(dto.status && { status: dto.status }), // cancelled | no_show
      },
    });
    // a rescheduled interview is still actionable
    if (dto.scheduledAt && updated.status === 'rescheduled') {
      await (this.prisma as any).hrInterview.update({ where: { id }, data: { status: 'scheduled' } });
    }
    // no-show = ผู้สมัครหลุดจาก pipeline → ปิดผู้สมัคร แล้ววนคำขอกลับไปหาคนใหม่ถ้าไม่เหลือใคร
    if (dto.status === 'no_show') {
      await (this.prisma as any).hrCandidate.update({
        where: { id: existing.candidateId },
        data: { status: 'rejected' },
      });
      await this.reopenRequestIfNoActiveCandidates(existing.candidate.manpowerRequestId, tenantId);
    }
    this.audit(AuditAction.UPDATE, id, tenantId, userId, `Interview updated (${dto.status ?? 'rescheduled'})`);
    return this.findOne(id, tenantId);
  }

  async recordResult(id: string, dto: InterviewResultDto, tenantId: string, userId: string) {
    const existing = await this.findOne(id, tenantId);
    if (!['scheduled', 'rescheduled'].includes(existing.status)) {
      throw new BadRequestException(`Interview is not awaiting a result (current: "${existing.status}")`);
    }
    const candidateStatus = dto.result === 'fail' ? 'rejected' : 'interviewed';
    const [updated] = await this.prisma.$transaction([
      (this.prisma as any).hrInterview.update({
        where: { id },
        data: {
          status: 'completed',
          result: dto.result,
          score: dto.score !== undefined ? dto.score.toFixed(2) : null,
          feedback: dto.feedback ?? null,
        },
      }),
      (this.prisma as any).hrCandidate.update({
        where: { id: existing.candidateId },
        data: { status: dto.result === 'next_round' ? 'screening' : candidateStatus },
      }),
    ]);
    // ผู้สมัครไม่ผ่าน → ถ้าคำขอไม่เหลือผู้สมัคร active ให้วนกลับไปหาคนใหม่
    if (dto.result === 'fail') {
      await this.reopenRequestIfNoActiveCandidates(existing.candidate.manpowerRequestId, tenantId);
    }
    this.audit(AuditAction.INTERVIEW_RESULT, id, tenantId, userId, `Interview result: ${dto.result} (score: ${dto.score ?? '-'})`);
    return updated;
  }
}
