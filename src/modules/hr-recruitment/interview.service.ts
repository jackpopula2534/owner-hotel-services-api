import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { AuditAction, AuditResource, AuditCategory } from '../../audit-log/dto/audit-log.dto';
import {
  ScheduleInterviewDto,
  RescheduleInterviewDto,
  InterviewResultDto,
} from './dto/recruitment.dto';
import { RecruitmentNotifierService } from './recruitment-notifier.service';

const BKK_OFFSET_MS = 7 * 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
const DEFAULT_DURATION = 45;
/** นัดที่ยังต้องไปสัมภาษณ์จริง (rescheduled ถูกคืนเป็น scheduled ทันที แต่กันไว้เผื่อค้าง) */
const OPEN_INTERVIEW_STATUSES = ['scheduled', 'rescheduled'];

export interface InterviewConflict {
  interviewId: string;
  interviewerId: string;
  candidateName: string;
  scheduledAt: Date;
  durationMinutes: number;
}

export interface InterviewSameDay {
  interviewerId: string;
  scheduledAt: Date;
  durationMinutes: number;
  candidateName: string;
}

export interface ConflictQuery {
  interviewerIds: string[];
  scheduledAt: Date;
  durationMinutes: number;
  excludeId?: string;
}

/** Stage 4: interview scheduling and results. */
@Injectable()
export class InterviewService {
  private readonly logger = new Logger(InterviewService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    private readonly notifier: RecruitmentNotifierService,
  ) {}

  /**
   * นัดของกรรมการที่ชนเวลา + นัดอื่นในวันเดียวกัน (วันตามเวลาไทย)
   * interviewerIds เก็บเป็น JSON → ดึงนัดทั้งวันของ tenant แล้วกรองกรรมการใน memory
   */
  async findConflicts(
    q: ConflictQuery,
    tenantId: string,
  ): Promise<{ conflicts: InterviewConflict[]; sameDay: InterviewSameDay[] }> {
    const wanted = new Set(q.interviewerIds.filter(Boolean));
    if (!wanted.size || Number.isNaN(q.scheduledAt.getTime()))
      return { conflicts: [], sameDay: [] };

    const start = q.scheduledAt.getTime();
    const end = start + q.durationMinutes * 60_000;
    // วันไทยของนัดนี้ + เผื่อนัดที่เริ่มก่อนเที่ยงคืนแต่ยาวข้ามมา (สูงสุด 240 นาที)
    const dayStart = Math.floor((start + BKK_OFFSET_MS) / DAY_MS) * DAY_MS - BKK_OFFSET_MS;
    const dayEnd = dayStart + DAY_MS;
    const rows: Array<Record<string, any>> = await (this.prisma as any).hrInterview.findMany({
      where: {
        tenantId,
        status: { in: OPEN_INTERVIEW_STATUSES },
        scheduledAt: {
          gte: new Date(Math.min(dayStart, start - 240 * 60_000)),
          lt: new Date(Math.max(dayEnd, end)),
        },
        ...(q.excludeId && { id: { not: q.excludeId } }),
      },
      orderBy: { scheduledAt: 'asc' },
      select: {
        id: true,
        scheduledAt: true,
        durationMinutes: true,
        interviewerIds: true,
        candidate: { select: { firstName: true, lastName: true } },
      },
    });

    const conflicts: InterviewConflict[] = [];
    const sameDay: InterviewSameDay[] = [];
    for (const iv of rows ?? []) {
      const ivStart = new Date(iv.scheduledAt).getTime();
      const duration = Number(iv.durationMinutes ?? DEFAULT_DURATION);
      const ivEnd = ivStart + duration * 60_000;
      const candidateName = iv.candidate
        ? `${iv.candidate.firstName} ${iv.candidate.lastName}`.trim()
        : '';
      const ids = Array.isArray(iv.interviewerIds) ? (iv.interviewerIds as string[]) : [];
      const overlaps = ivStart < end && start < ivEnd;
      const onSameDay = ivStart >= dayStart && ivStart < dayEnd;
      for (const interviewerId of ids) {
        if (!wanted.has(interviewerId)) continue;
        if (overlaps) {
          conflicts.push({
            interviewId: iv.id,
            interviewerId,
            candidateName,
            scheduledAt: iv.scheduledAt,
            durationMinutes: duration,
          });
        }
        if (onSameDay) {
          sameDay.push({
            interviewerId,
            scheduledAt: iv.scheduledAt,
            durationMinutes: duration,
            candidateName,
          });
        }
      }
    }
    return { conflicts, sameDay };
  }

  /** แจ้งผู้สมัคร (อีเมล/SMS) — ไม่ทำให้การนัดล้ม; สำเร็จ → stamp candidateNotifiedAt */
  private async notifyCandidate(
    interview: Record<string, any>,
    tenantId: string,
  ): Promise<Record<string, any>> {
    try {
      const candidate = await (this.prisma as any).hrCandidate.findFirst({
        where: { id: interview.candidateId, tenantId },
        select: {
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          manpowerRequest: { select: { positionTitle: true } },
        },
      });
      if (!candidate) return interview;
      const ok = await this.notifier.notifyCandidateInterview({
        tenantId,
        candidate,
        positionTitle: candidate.manpowerRequest?.positionTitle ?? '',
        round: interview.round,
        scheduledAt: new Date(interview.scheduledAt),
        durationMinutes: interview.durationMinutes ?? DEFAULT_DURATION,
        format: interview.format,
        location: interview.location,
      });
      if (!ok) return interview;
      return await (this.prisma as any).hrInterview.update({
        where: { id: interview.id },
        data: { candidateNotifiedAt: new Date() },
      });
    } catch (e) {
      this.logger.warn(
        `notify candidate for interview ${interview.id} failed: ${e instanceof Error ? e.message : String(e)}`,
      );
      return interview;
    }
  }

  /** บันทึกประวัติการสัมภาษณ์ — ประวัติผู้สมัคร (getHistory) ดึง log ของสัมภาษณ์ทุกรอบมารวมด้วย */
  private audit(
    action: AuditAction,
    resourceId: string,
    tenantId: string,
    userId: string,
    description: string,
    values?: { oldValues?: Record<string, unknown>; newValues?: Record<string, unknown> },
  ): void {
    this.auditLog
      .log({
        action,
        resource: AuditResource.INTERVIEW,
        resourceId,
        category: AuditCategory.HR,
        tenantId,
        userId,
        description,
        ...(values ?? {}),
      })
      .catch((err: Error) => this.logger.error(`Audit log failed: ${err.message}`));
  }

  /**
   * เมื่อผู้สมัครหลุดจาก pipeline (fail/no-show) — ถ้าคำขอไม่เหลือผู้สมัคร active
   * ให้วนกลับไป "recruiting" เพื่อหาคนใหม่ แทนที่จะค้างอยู่ที่ interviewing/offer_made
   */
  private async reopenRequestIfNoActiveCandidates(
    manpowerRequestId: string,
    tenantId: string,
  ): Promise<void> {
    const activeCount = await (this.prisma as any).hrCandidate.count({
      where: {
        tenantId,
        manpowerRequestId,
        status: {
          in: [
            'applied',
            'screening',
            'interview_scheduled',
            'interviewed',
            'offer_made',
            'offer_accepted',
          ],
        },
      },
    });
    if (activeCount > 0) return;
    const result = await (this.prisma as any).hrManpowerRequest.updateMany({
      where: { id: manpowerRequestId, tenantId, status: { in: ['interviewing', 'offer_made'] } },
      data: { status: 'recruiting' },
    });
    if (result.count > 0) {
      this.logger.log(
        `Manpower request ${manpowerRequestId} reopened to "recruiting" (no active candidates left)`,
      );
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
      include: {
        candidate: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            status: true,
            manpowerRequestId: true,
          },
        },
      },
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
      throw new BadRequestException(
        `Cannot schedule an interview for a "${candidate.status}" candidate`,
      );
    }
    if (!dto.interviewerIds.length)
      throw new BadRequestException('At least one interviewer is required');
    if (new Date(dto.scheduledAt).getTime() < Date.now()) {
      throw new BadRequestException('scheduledAt must be in the future');
    }
    const durationMinutes = dto.durationMinutes ?? DEFAULT_DURATION;
    if (!dto.allowConflict) {
      const { conflicts } = await this.findConflicts(
        {
          interviewerIds: dto.interviewerIds,
          scheduledAt: new Date(dto.scheduledAt),
          durationMinutes,
        },
        tenantId,
      );
      if (conflicts.length) {
        throw new ConflictException({
          message:
            'Interviewer already has an interview at this time (send allowConflict: true to override)',
          // AllExceptionsFilter ส่งต่อให้ client เฉพาะ `details` → error.details.conflicts
          details: { conflicts },
        });
      }
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
          durationMinutes,
          format: dto.format ?? null,
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
    this.audit(
      AuditAction.INTERVIEW_SCHEDULE,
      interview.id,
      tenantId,
      userId,
      `นัดสัมภาษณ์รอบ ${dto.round ?? 1}`,
      {
        newValues: {
          scheduledAt: interview.scheduledAt,
          location: interview.location,
          format: interview.format,
          durationMinutes,
        },
      },
    );
    if (dto.notifyCandidate) return this.notifyCandidate(interview, tenantId);
    return interview;
  }

  async reschedule(id: string, dto: RescheduleInterviewDto, tenantId: string, userId: string) {
    const existing = await this.findOne(id, tenantId);
    if (existing.status !== 'scheduled') {
      throw new BadRequestException(
        `Only scheduled interviews can be updated (current: "${existing.status}")`,
      );
    }
    const moved =
      !!dto.scheduledAt &&
      new Date(dto.scheduledAt).getTime() !== new Date(existing.scheduledAt).getTime();
    const reason = dto.reason?.trim() || null;
    // เลื่อนวันเวลา / ยกเลิก / ไม่มา ต้องบอกเหตุผลเสมอ
    if ((moved || dto.status) && !reason) {
      throw new BadRequestException(
        dto.status === 'no_show'
          ? 'ต้องระบุรายละเอียดกรณีผู้สมัครไม่มาสัมภาษณ์'
          : dto.status === 'cancelled'
            ? 'ต้องระบุเหตุผลที่ยกเลิกนัดสัมภาษณ์'
            : 'ต้องระบุเหตุผลที่เลื่อนนัดสัมภาษณ์',
      );
    }
    const updated = await (this.prisma as any).hrInterview.update({
      where: { id },
      data: {
        ...((moved || dto.status) && { statusReason: reason }),
        ...(dto.scheduledAt && { scheduledAt: new Date(dto.scheduledAt), status: 'rescheduled' }),
        ...(dto.location !== undefined && { location: dto.location }),
        ...(dto.interviewerIds && { interviewerIds: dto.interviewerIds }),
        ...(dto.durationMinutes !== undefined && { durationMinutes: dto.durationMinutes }),
        ...(dto.format !== undefined && { format: dto.format }),
        ...(dto.status && { status: dto.status }), // cancelled | no_show
      },
    });
    // a rescheduled interview is still actionable
    if (dto.scheduledAt && updated.status === 'rescheduled') {
      await (this.prisma as any).hrInterview.update({
        where: { id },
        data: { status: 'scheduled' },
      });
    }
    // no-show = ผู้สมัครหลุดจาก pipeline → ปิดผู้สมัคร แล้ววนคำขอกลับไปหาคนใหม่ถ้าไม่เหลือใคร
    if (dto.status === 'no_show') {
      await (this.prisma as any).hrCandidate.update({
        where: { id: existing.candidateId },
        data: { status: 'rejected', statusReason: `ไม่มาสัมภาษณ์: ${reason}` },
      });
      await this.reopenRequestIfNoActiveCandidates(existing.candidate.manpowerRequestId, tenantId);
    }
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    const track = (field: string, from: unknown, to: unknown) => {
      if (to === undefined || JSON.stringify(from ?? null) === JSON.stringify(to ?? null)) return;
      before[field] = from ?? null;
      after[field] = to ?? null;
    };
    if (moved) track('scheduledAt', existing.scheduledAt, new Date(dto.scheduledAt as string));
    track('location', existing.location, dto.location);
    track('interviewerIds', existing.interviewerIds, dto.interviewerIds);
    track('durationMinutes', existing.durationMinutes, dto.durationMinutes);
    track('format', existing.format, dto.format);
    track('status', existing.status, dto.status);
    if (reason) after.reason = reason;
    const label =
      dto.status === 'no_show'
        ? 'ผู้สมัครไม่มาสัมภาษณ์'
        : dto.status === 'cancelled'
          ? 'ยกเลิกนัดสัมภาษณ์'
          : moved
            ? 'เลื่อนนัดสัมภาษณ์'
            : 'แก้ไขนัดสัมภาษณ์';
    this.audit(
      AuditAction.UPDATE,
      id,
      tenantId,
      userId,
      `${label} รอบ ${existing.round}${reason ? `: ${reason}` : ''}`,
      { oldValues: before, newValues: after },
    );
    const result = await this.findOne(id, tenantId);
    if (dto.notifyCandidate && !dto.status && result.status === 'scheduled') {
      const notified = await this.notifyCandidate(result, tenantId);
      return {
        ...result,
        candidateNotifiedAt: notified.candidateNotifiedAt ?? result.candidateNotifiedAt,
      };
    }
    return result;
  }

  async recordResult(id: string, dto: InterviewResultDto, tenantId: string, userId: string) {
    const existing = await this.findOne(id, tenantId);
    if (!['scheduled', 'rescheduled'].includes(existing.status)) {
      throw new BadRequestException(
        `Interview is not awaiting a result (current: "${existing.status}")`,
      );
    }
    const candidateStatus = dto.result === 'fail' ? 'rejected' : 'interviewed';
    const reason = dto.reason?.trim() || null;
    if (dto.result === 'fail' && !reason) throw new BadRequestException('ต้องระบุเหตุผลที่ไม่ผ่าน');
    // คะแนนรายหัวข้อ 1-5 → ไม่ส่ง score มา ให้คิดเป็นเต็ม 100 จากค่าเฉลี่ย
    const ratings = dto.ratings?.length
      ? dto.ratings.map((r) => ({ criterion: r.criterion.trim(), score: r.score }))
      : null;
    const score =
      dto.score !== undefined
        ? dto.score
        : ratings
          ? Math.round((ratings.reduce((a, r) => a + r.score, 0) / ratings.length) * 20)
          : undefined;
    const [updated] = await this.prisma.$transaction([
      (this.prisma as any).hrInterview.update({
        where: { id },
        data: {
          status: 'completed',
          result: dto.result,
          score: score !== undefined ? score.toFixed(2) : null,
          feedback: dto.feedback ?? null,
          resultReason: dto.result === 'fail' ? reason : null,
          ...(ratings && { ratings }),
        },
      }),
      (this.prisma as any).hrCandidate.update({
        where: { id: existing.candidateId },
        data: {
          status: dto.result === 'next_round' ? 'screening' : candidateStatus,
          ...(dto.result === 'fail' && {
            statusReason: `ไม่ผ่านสัมภาษณ์รอบ ${existing.round}: ${reason}`,
          }),
        },
      }),
    ]);
    // ผู้สมัครไม่ผ่าน → ถ้าคำขอไม่เหลือผู้สมัคร active ให้วนกลับไปหาคนใหม่
    if (dto.result === 'fail') {
      await this.reopenRequestIfNoActiveCandidates(existing.candidate.manpowerRequestId, tenantId);
    }
    const resultLabel =
      dto.result === 'pass' ? 'ผ่าน' : dto.result === 'fail' ? 'ไม่ผ่าน' : 'ไปรอบต่อไป';
    this.audit(
      AuditAction.INTERVIEW_RESULT,
      id,
      tenantId,
      userId,
      `ผลสัมภาษณ์รอบ ${existing.round}: ${resultLabel}${reason && dto.result === 'fail' ? ` — ${reason}` : ''}`,
      {
        oldValues: { status: existing.status },
        newValues: {
          result: dto.result,
          score: score ?? null,
          ...(dto.feedback ? { feedback: dto.feedback } : {}),
          ...(dto.result === 'fail' ? { reason } : {}),
        },
      },
    );
    return updated;
  }
}
