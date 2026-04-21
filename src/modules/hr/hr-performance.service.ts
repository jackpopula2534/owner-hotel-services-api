import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateHrPerformanceDto, UpdateHrPerformanceDto } from './dto/create-hr-performance.dto';
import {
  SavePerformanceDraftDto,
  RejectPerformanceDto,
  BulkApproveDto,
} from './dto/update-hr-performance.dto';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Derive letter grade from overall score (0-100) */
function deriveGrade(score: number): string {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B+';
  if (score >= 70) return 'B';
  if (score >= 60) return 'C+';
  if (score >= 50) return 'C';
  return 'D';
}

/** Legacy fixed-weight calculation (backward compat) */
function calcOverallLegacy(
  work: number,
  attendance: number,
  teamwork: number,
  service: number,
): number {
  return Math.round((work * 0.3 + attendance * 0.2 + teamwork * 0.2 + service * 0.3) * 100) / 100;
}

/** Dynamic weighted calculation from KPI scores array */
function calcOverallDynamic(scores: { score: number; weight: number }[]): number {
  const totalWeight = scores.reduce((s, k) => s + k.weight, 0);
  if (totalWeight === 0) return 0;
  const weighted = scores.reduce((s, k) => s + (k.score / 5) * 100 * k.weight, 0);
  return Math.round((weighted / totalWeight) * 100) / 100;
}

/** Normalize score to 0-100 range based on maxScore */
function normalizeScore(score: number, maxScore: number): number {
  return maxScore > 0 ? (score / maxScore) * 100 : 0;
}

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class HrPerformanceService {
  private readonly logger = new Logger(HrPerformanceService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── Query ───────────────────────────────────────────────────────────────────

  async findAll(query: Record<string, string>, tenantId: string) {
    const page = parseInt(query.page ?? '1', 10);
    const limit = parseInt(query.limit ?? '20', 10);
    const skip = (page - 1) * limit;

    const { employeeId, period, periodType, status, search, cycleId } = query;

    const where: Record<string, unknown> = { tenantId };
    if (employeeId) where['employeeId'] = employeeId;
    if (cycleId) where['cycleId'] = cycleId;
    if (period) where['period'] = period;
    if (periodType) where['periodType'] = periodType;
    if (status) where['status'] = status;
    if (search) {
      where['employee'] = {
        OR: [
          { firstName: { contains: search } },
          { lastName: { contains: search } },
          { employeeCode: { contains: search } },
          { department: { contains: search } },
        ],
      };
    }

    const [data, total] = await Promise.all([
      (this.prisma as any).hrPerformance.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ period: 'desc' }, { createdAt: 'desc' }],
        include: {
          employee: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              employeeCode: true,
              department: true,
              position: true,
            },
          },
          cycle: {
            select: { id: true, name: true, period: true, status: true },
          },
          kpiScores: {
            select: { id: true, criteriaName: true, weight: true, score: true },
          },
        },
      }),
      (this.prisma as any).hrPerformance.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async getSummary(query: Record<string, string>, tenantId: string) {
    const { period, periodType, cycleId } = query;

    const where: Record<string, unknown> = { tenantId };
    if (period) where['period'] = period;
    if (periodType) where['periodType'] = periodType;
    if (cycleId) where['cycleId'] = cycleId;

    const records = await (this.prisma as any).hrPerformance.findMany({
      where,
      select: { scoreOverall: true, grade: true, status: true },
    });

    const total = records.length;
    const avgOverall =
      total > 0
        ? Math.round(
            (records.reduce((s: number, r: any) => s + Number(r.scoreOverall), 0) / total) * 100,
          ) / 100
        : 0;

    const byGrade: Record<string, number> = { A: 0, 'B+': 0, B: 0, 'C+': 0, C: 0, D: 0 };
    const byStatus: Record<string, number> = {
      pending: 0,
      draft: 0,
      submitted: 0,
      approved: 0,
      rejected: 0,
    };

    for (const r of records) {
      if (r.grade && byGrade[r.grade] !== undefined) byGrade[r.grade]++;
      if (r.status && byStatus[r.status] !== undefined) byStatus[r.status]++;
    }

    return { total, avgOverall, byGrade, byStatus };
  }

  async findOne(id: string, tenantId: string) {
    const record = await (this.prisma as any).hrPerformance.findFirst({
      where: { id, tenantId },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeCode: true,
            department: true,
            position: true,
          },
        },
        cycle: {
          select: { id: true, name: true, period: true, status: true },
        },
        kpiScores: {
          include: {
            criteria: {
              select: {
                id: true,
                name: true,
                weight: true,
                minScore: true,
                maxScore: true,
                sortOrder: true,
              },
            },
          },
          orderBy: { criteria: { sortOrder: 'asc' } },
        },
      },
    });
    if (!record) throw new NotFoundException(`Performance record ${id} not found`);
    return record;
  }

  // ─── Save Draft (new dynamic score method) ───────────────────────────────────

  async saveDraft(id: string, dto: SavePerformanceDraftDto, tenantId: string) {
    const record = await (this.prisma as any).hrPerformance.findFirst({
      where: { id, tenantId },
    });
    if (!record) throw new NotFoundException(`Performance record ${id} not found`);

    if (record.status === 'approved') {
      throw new ForbiddenException('ไม่สามารถแก้ไขรายการที่อนุมัติแล้ว');
    }
    if (record.status === 'submitted') {
      throw new ForbiddenException('ส่งไปแล้ว ต้องรอ Manager reject ก่อนจึงจะแก้ไขได้');
    }

    // Load template items for validation + weight snapshot
    let templateItems: any[] = [];
    if (record.templateId) {
      templateItems = await (this.prisma as any).hrKpiTemplateItem.findMany({
        where: { templateId: record.templateId },
      });
    }

    // Upsert KPI scores
    await (this.prisma as any).$transaction(async (tx: any) => {
      for (const scoreInput of dto.scores) {
        const item = templateItems.find((i: any) => i.id === scoreInput.criteriaId);
        if (!item && templateItems.length > 0) {
          throw new BadRequestException(
            `KPI criteria ${scoreInput.criteriaId} ไม่ได้อยู่ใน Template`,
          );
        }

        await tx.hrKpiScore.upsert({
          where: {
            performanceId_criteriaId: {
              performanceId: id,
              criteriaId: scoreInput.criteriaId,
            },
          },
          update: {
            score: scoreInput.score,
            comment: scoreInput.comment,
          },
          create: {
            performanceId: id,
            criteriaId: scoreInput.criteriaId,
            criteriaName: item?.name ?? 'KPI',
            weight: item?.weight ?? 20,
            score: scoreInput.score,
            comment: scoreInput.comment,
          },
        });
      }
    });

    // Recalculate overall score
    const allScores = await (this.prisma as any).hrKpiScore.findMany({
      where: { performanceId: id },
    });

    const scoreOverall = calcOverallDynamic(
      allScores.map((s: any) => ({ score: Number(s.score), weight: Number(s.weight) })),
    );
    const grade = deriveGrade(scoreOverall);

    const updated = await (this.prisma as any).hrPerformance.update({
      where: { id },
      data: {
        status: record.status === 'pending' ? 'draft' : record.status,
        scoreOverall,
        grade,
        ...(dto.strengths !== undefined && { strengths: dto.strengths }),
        ...(dto.improvements !== undefined && { improvements: dto.improvements }),
        ...(dto.goals !== undefined && { goals: dto.goals }),
        ...(dto.note !== undefined && { note: dto.note }),
        ...(dto.reviewerName !== undefined && { reviewerName: dto.reviewerName }),
      },
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
        kpiScores: true,
      },
    });

    this.logger.log(`Performance draft saved: ${id} — overall: ${scoreOverall} grade: ${grade}`);
    return updated;
  }

  // ─── Submit for Approval ─────────────────────────────────────────────────────

  async submit(id: string, tenantId: string) {
    const record = await (this.prisma as any).hrPerformance.findFirst({
      where: { id, tenantId },
      include: { kpiScores: true },
    });
    if (!record) throw new NotFoundException(`Performance record ${id} not found`);

    if (!['draft', 'rejected'].includes(record.status)) {
      throw new ConflictException(`ไม่สามารถ submit ได้เมื่อ status เป็น ${record.status}`);
    }
    if (record.kpiScores.length === 0) {
      throw new BadRequestException('ต้องกรอกคะแนนก่อน submit');
    }

    // ตรวจสอบ criteria ครบ
    if (record.templateId) {
      const templateItemCount = await (this.prisma as any).hrKpiTemplateItem.count({
        where: { templateId: record.templateId },
      });
      if (record.kpiScores.length < templateItemCount) {
        throw new BadRequestException(
          `กรอกคะแนนไม่ครบ: กรอกแล้ว ${record.kpiScores.length}/${templateItemCount} รายการ`,
        );
      }
    }

    const updated = await (this.prisma as any).hrPerformance.update({
      where: { id },
      data: { status: 'submitted', rejectionReason: null },
    });

    this.logger.log(`Performance submitted: ${id}`);
    return updated;
  }

  // ─── Approve ─────────────────────────────────────────────────────────────────

  async approve(id: string, tenantId: string, approvedBy: string) {
    const record = await (this.prisma as any).hrPerformance.findFirst({
      where: { id, tenantId },
    });
    if (!record) throw new NotFoundException(`Performance record ${id} not found`);
    if (record.status !== 'submitted') {
      throw new ConflictException(
        `อนุมัติได้เฉพาะ status = submitted เท่านั้น (ปัจจุบัน: ${record.status})`,
      );
    }

    const updated = await (this.prisma as any).hrPerformance.update({
      where: { id },
      data: { status: 'approved', approvedBy, approvedAt: new Date() },
    });

    this.logger.log(`Performance approved: ${id} by ${approvedBy}`);
    return updated;
  }

  // ─── Reject ──────────────────────────────────────────────────────────────────

  async reject(id: string, dto: RejectPerformanceDto, tenantId: string, rejectedBy: string) {
    const record = await (this.prisma as any).hrPerformance.findFirst({
      where: { id, tenantId },
    });
    if (!record) throw new NotFoundException(`Performance record ${id} not found`);
    if (record.status !== 'submitted') {
      throw new ConflictException(
        `reject ได้เฉพาะ status = submitted เท่านั้น (ปัจจุบัน: ${record.status})`,
      );
    }

    const updated = await (this.prisma as any).hrPerformance.update({
      where: { id },
      data: {
        status: 'rejected',
        rejectionReason: dto.reason,
        approvedBy: rejectedBy,
        approvedAt: new Date(),
      },
    });

    this.logger.log(`Performance rejected: ${id} by ${rejectedBy} — reason: ${dto.reason}`);
    return updated;
  }

  // ─── Bulk Approve ─────────────────────────────────────────────────────────────

  async bulkApprove(dto: BulkApproveDto, tenantId: string, approvedBy: string) {
    const records = await (this.prisma as any).hrPerformance.findMany({
      where: { id: { in: dto.ids }, tenantId, status: 'submitted' },
      select: { id: true },
    });

    if (records.length === 0) {
      throw new BadRequestException('ไม่พบรายการที่รออนุมัติ');
    }

    const ids = records.map((r: any) => r.id);

    await (this.prisma as any).hrPerformance.updateMany({
      where: { id: { in: ids } },
      data: { status: 'approved', approvedBy, approvedAt: new Date() },
    });

    this.logger.log(`Bulk approved ${ids.length} performances by ${approvedBy}`);
    return { approved: ids.length, skipped: dto.ids.length - ids.length };
  }

  // ─── Legacy CRUD (backward compat) ───────────────────────────────────────────

  async create(dto: CreateHrPerformanceDto, tenantId: string) {
    const employee = await (this.prisma as any).employee.findFirst({
      where: { id: dto.employeeId, tenantId },
    });
    if (!employee) throw new NotFoundException(`Employee ${dto.employeeId} not found`);

    const existing = await (this.prisma as any).hrPerformance.findFirst({
      where: { tenantId, employeeId: dto.employeeId, period: dto.period, cycleId: null },
    });
    if (existing) {
      throw new ConflictException(
        `Performance review for employee ${dto.employeeId} in period ${dto.period} already exists`,
      );
    }

    const scoreOverall = calcOverallLegacy(
      dto.scoreWork,
      dto.scoreAttendance,
      dto.scoreTeamwork,
      dto.scoreService,
    );
    const grade = deriveGrade(scoreOverall);

    const record = await (this.prisma as any).hrPerformance.create({
      data: {
        tenantId,
        employeeId: dto.employeeId,
        period: dto.period,
        periodType: dto.periodType,
        reviewDate: dto.reviewDate ? new Date(dto.reviewDate) : new Date(),
        reviewerId: dto.reviewerId,
        reviewerName: dto.reviewerName,
        scoreWork: dto.scoreWork,
        scoreAttendance: dto.scoreAttendance,
        scoreTeamwork: dto.scoreTeamwork,
        scoreService: dto.scoreService,
        scoreOverall,
        grade,
        status: dto.status ?? 'draft',
        strengths: dto.strengths,
        improvements: dto.improvements,
        goals: dto.goals,
        note: dto.note,
      },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeCode: true,
            department: true,
          },
        },
      },
    });

    this.logger.log(`Performance record created (legacy): ${record.id}`);
    return record;
  }

  async update(id: string, dto: UpdateHrPerformanceDto, tenantId: string) {
    const existing = await (this.prisma as any).hrPerformance.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException(`Performance record ${id} not found`);

    const scoreWork = dto.scoreWork ?? Number(existing.scoreWork);
    const scoreAttendance = dto.scoreAttendance ?? Number(existing.scoreAttendance);
    const scoreTeamwork = dto.scoreTeamwork ?? Number(existing.scoreTeamwork);
    const scoreService = dto.scoreService ?? Number(existing.scoreService);

    const scoreOverall = calcOverallLegacy(scoreWork, scoreAttendance, scoreTeamwork, scoreService);
    const grade = deriveGrade(scoreOverall);

    const updateData: Record<string, unknown> = {
      scoreWork,
      scoreAttendance,
      scoreTeamwork,
      scoreService,
      scoreOverall,
      grade,
    };

    if (dto.reviewDate) updateData['reviewDate'] = new Date(dto.reviewDate);
    if (dto.reviewerName !== undefined) updateData['reviewerName'] = dto.reviewerName;
    if (dto.strengths !== undefined) updateData['strengths'] = dto.strengths;
    if (dto.improvements !== undefined) updateData['improvements'] = dto.improvements;
    if (dto.goals !== undefined) updateData['goals'] = dto.goals;
    if (dto.note !== undefined) updateData['note'] = dto.note;
    if (dto.status) {
      updateData['status'] = dto.status;
      if (dto.status === 'approved') {
        updateData['approvedAt'] = new Date();
      }
    }

    const record = await (this.prisma as any).hrPerformance.update({
      where: { id },
      data: updateData,
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeCode: true,
            department: true,
          },
        },
      },
    });

    this.logger.log(`Performance record updated (legacy): ${id}`);
    return record;
  }

  async remove(id: string, tenantId: string) {
    const existing = await (this.prisma as any).hrPerformance.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException(`Performance record ${id} not found`);
    await (this.prisma as any).hrPerformance.delete({ where: { id } });
    this.logger.log(`Performance record deleted: ${id}`);
    return { message: 'Performance record deleted successfully' };
  }
}
