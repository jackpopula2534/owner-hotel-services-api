import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { AuditAction, AuditResource, AuditCategory } from '../../audit-log/dto/audit-log.dto';
import {
  CreateProbationRoundDto,
  ReviewProbationCheckpointDto,
  DecideProbationRoundDto,
} from './dto/hr-lifecycle.dto';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Probation rounds + checkpoints (2026-06-10 redesign — replaces HrProbationReview).
 *
 * Rounds open automatically from the recruitment pipeline (HireService.confirmStart)
 * or manually here for existing employees. A decision drives the employee
 * lifecycle status: passed → ACTIVE, extended → new round, failed → TERMINATED.
 */
@Injectable()
export class HrProbationService {
  private readonly logger = new Logger(HrProbationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  private audit(action: AuditAction, resourceId: string, tenantId: string, userId: string | undefined, description: string, newValues?: Record<string, unknown>): void {
    this.auditLog
      .log({ action, resource: AuditResource.PROBATION, resourceId, category: AuditCategory.HR, tenantId, userId, description, newValues })
      .catch((err: Error) => this.logger.error(`Audit log failed: ${err.message}`));
  }

  async findAll(query: Record<string, string>, tenantId: string) {
    const where: Record<string, unknown> = { tenantId };
    if (query.employeeId) where['employeeId'] = query.employeeId;
    if (query.status) where['status'] = query.status;
    const data = await (this.prisma as any).hrProbationRound.findMany({
      where,
      orderBy: [{ status: 'asc' }, { dueDate: 'asc' }],
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true, status: true } },
        checkpoints: { orderBy: { dueDate: 'asc' }, include: { ratings: true } },
      },
    });
    return { data, total: data.length };
  }

  async findOne(id: string, tenantId: string) {
    const round = await (this.prisma as any).hrProbationRound.findFirst({
      where: { id, tenantId },
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true, status: true } },
        checkpoints: { orderBy: { dueDate: 'asc' }, include: { ratings: true } },
      },
    });
    if (!round) throw new NotFoundException(`Probation round ${id} not found`);
    return round;
  }

  /** Open a round manually (for employees hired outside the recruitment pipeline). */
  async create(dto: CreateProbationRoundDto, tenantId: string, userId?: string) {
    const employee = await (this.prisma.employee as any).findFirst({
      where: { id: dto.employeeId, tenantId },
    });
    if (!employee) throw new NotFoundException(`Employee ${dto.employeeId} not found`);

    const active = await (this.prisma as any).hrProbationRound.findFirst({
      where: { tenantId, employeeId: dto.employeeId, status: 'active' },
    });
    if (active) throw new BadRequestException('Employee already has an active probation round');

    const startDate = new Date(dto.startDate);
    const dueDate = new Date(dto.dueDate);
    if (dueDate.getTime() <= startDate.getTime()) {
      throw new BadRequestException('dueDate must be after startDate');
    }
    const totalDays = Math.round((dueDate.getTime() - startDate.getTime()) / DAY_MS);
    const checkpointDays = (dto.checkpointDays ?? [30, 60, 90]).filter((d) => d < totalDays);

    const round = await this.prisma.$transaction(async (tx: any) => {
      const created = await tx.hrProbationRound.create({
        data: { tenantId, employeeId: dto.employeeId, startDate, dueDate, status: 'active' },
      });
      for (const days of [...checkpointDays, totalDays]) {
        await tx.hrProbationCheckpoint.create({
          data: {
            tenantId,
            roundId: created.id,
            label: `${days} วัน`,
            dueDate: new Date(startDate.getTime() + days * DAY_MS),
            status: 'pending',
          },
        });
      }
      await tx.employee.update({ where: { id: dto.employeeId }, data: { status: 'PROBATION' } });
      return created;
    });

    this.audit(AuditAction.PROBATION_OPEN, round.id, tenantId, userId, `Probation round opened (due ${dto.dueDate})`);
    return this.findOne(round.id, tenantId);
  }

  /** Record a checkpoint review (30/60/90-day evaluation). */
  async reviewCheckpoint(roundId: string, checkpointId: string, dto: ReviewProbationCheckpointDto, reviewerId: string, tenantId: string) {
    const round = await this.findOne(roundId, tenantId);
    if (round.status !== 'active') {
      throw new BadRequestException(`Round is not active (current: "${round.status}")`);
    }
    const checkpoint = round.checkpoints.find((c: { id: string }) => c.id === checkpointId);
    if (!checkpoint) throw new NotFoundException(`Checkpoint ${checkpointId} not found in round ${roundId}`);
    if (checkpoint.status === 'done') throw new BadRequestException('Checkpoint already reviewed');

    // คะแนนรวม: ถ้าส่ง ratings รายมิติมา ใช้ค่าเฉลี่ยเป็น overall, ไม่งั้นใช้ score ที่ส่งมาตรง ๆ
    const ratings = dto.ratings ?? [];
    const overall =
      ratings.length > 0
        ? ratings.reduce((sum, r) => sum + r.score, 0) / ratings.length
        : dto.score;

    const updated = await this.prisma.$transaction(async (tx: any) => {
      if (ratings.length > 0) {
        await tx.hrProbationCheckpointRating.deleteMany({ where: { checkpointId } });
        for (const r of ratings) {
          await tx.hrProbationCheckpointRating.create({
            data: { tenantId, checkpointId, competency: r.competency, score: r.score.toFixed(2) },
          });
        }
      }
      return tx.hrProbationCheckpoint.update({
        where: { id: checkpointId },
        data: {
          score: overall !== undefined && overall !== null ? Number(overall).toFixed(2) : null,
          strengths: dto.strengths ?? null,
          improvements: dto.improvements ?? null,
          reviewerId,
          reviewedAt: new Date(),
          status: dto.skip ? 'skipped' : 'done',
        },
        include: { ratings: true },
      });
    });

    this.audit(
      AuditAction.PROBATION_CHECKPOINT_REVIEW,
      checkpointId,
      tenantId,
      reviewerId,
      `Checkpoint "${checkpoint.label}" reviewed (score: ${overall != null ? Number(overall).toFixed(0) : '-'}${ratings.length ? `, ${ratings.length} มิติ` : ''})`,
    );
    return updated;
  }

  /**
   * Final decision. passed → ACTIVE, failed → TERMINATED,
   * extended → close this round and open a follow-up round linked via extendedFrom.
   */
  async decide(id: string, dto: DecideProbationRoundDto, deciderId: string, tenantId: string) {
    const round = await this.findOne(id, tenantId);
    if (round.status !== 'active') {
      throw new BadRequestException(`Round already decided (${round.status})`);
    }
    if (dto.decision === 'extended' && !dto.newDueDate) {
      throw new BadRequestException('newDueDate is required when extending probation');
    }

    const employeeStatusMap: Record<string, string> = {
      passed: 'ACTIVE',
      extended: 'PROBATION',
      failed: 'TERMINATED',
    };

    const result = await this.prisma.$transaction(async (tx: any) => {
      const updated = await tx.hrProbationRound.update({
        where: { id },
        data: {
          status: dto.decision,
          decidedBy: deciderId,
          decidedAt: new Date(),
          decisionNote: dto.note ?? null,
        },
      });
      await tx.hrProbationCheckpoint.updateMany({
        where: { roundId: id, status: 'pending' },
        data: { status: 'skipped' },
      });
      await tx.employee.update({
        where: { id: round.employeeId },
        data: { status: employeeStatusMap[dto.decision] },
      });

      let nextRound = null;
      if (dto.decision === 'extended') {
        const startDate = new Date();
        const dueDate = new Date(dto.newDueDate!);
        nextRound = await tx.hrProbationRound.create({
          data: {
            tenantId,
            employeeId: round.employeeId,
            hireRecordId: round.hireRecordId,
            extendedFrom: id,
            startDate,
            dueDate,
            status: 'active',
          },
        });
        await tx.hrProbationCheckpoint.create({
          data: {
            tenantId,
            roundId: nextRound.id,
            label: 'สรุปผลรอบต่อเวลา',
            dueDate,
            status: 'pending',
          },
        });
      }

      // Close out the source manpower request only when EVERY hired employee's probation
      // has been resolved (passed/failed) — รับหลายอัตราต้องจบทดลองงานครบทุกคนก่อนถือว่าเสร็จ
      if (round.hireRecordId && (dto.decision === 'passed' || dto.decision === 'failed')) {
        const hire = await tx.hrHireRecord.findUnique({
          where: { id: round.hireRecordId },
          include: { candidate: { select: { manpowerRequestId: true } } },
        });
        if (hire?.candidate?.manpowerRequestId) {
          await this.completeRequestIfAllProbationResolved(tx, hire.candidate.manpowerRequestId, tenantId);
        }
      }
      return { round: updated, nextRound };
    });

    this.audit(
      AuditAction.PROBATION_DECISION,
      id,
      tenantId,
      deciderId,
      `Probation ${dto.decision}`,
      { decision: dto.decision, employeeStatus: employeeStatusMap[dto.decision] },
    );
    return result;
  }

  /**
   * ปิดคำขอสรรหา (probation → completed) เฉพาะเมื่อ "ทุกอัตราที่จ้าง" จบช่วงทดลองงานครบแล้ว
   * (รับหลายคน: ตราบใดยังมีพนักงานที่ยังไม่รายงานตัว (PENDING_START) หรือยังทดลองงานอยู่ (PROBATION)
   * คำขอจะยังไม่ถือว่าเสร็จ) เรียกภายใน transaction ของ decide หลังอัปเดตสถานะพนักงานคนปัจจุบันแล้ว
   */
  private async completeRequestIfAllProbationResolved(tx: any, manpowerRequestId: string, tenantId: string): Promise<void> {
    const hiredCandidates = await tx.hrCandidate.findMany({
      where: { tenantId, manpowerRequestId, status: 'hired' },
      select: { hireRecord: { select: { employee: { select: { status: true } } } } },
    });
    if (hiredCandidates.length === 0) return;
    const anyUnresolved = hiredCandidates.some((c: any) => {
      const status = c.hireRecord?.employee?.status;
      return status === 'PENDING_START' || status === 'PROBATION';
    });
    if (anyUnresolved) return;
    await tx.hrManpowerRequest.updateMany({
      where: { id: manpowerRequestId, status: 'probation' },
      data: { status: 'completed' },
    });
  }
}
