import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { AuditAction, AuditResource, AuditCategory } from '../../audit-log/dto/audit-log.dto';
import { CreateProbationReviewDto, DecideProbationDto } from './dto/hr-lifecycle.dto';

/**
 * Probation review & decision (P2-04). A decision drives the employee
 * lifecycle status: passed → ACTIVE, extended → PROBATION, failed → TERMINATED.
 */
@Injectable()
export class HrProbationService {
  private readonly logger = new Logger(HrProbationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  async findAll(query: Record<string, string>, tenantId: string) {
    const where: Record<string, unknown> = { tenantId };
    if (query.employeeId) where['employeeId'] = query.employeeId;
    if (query.decision) where['decision'] = query.decision;
    const data = await (this.prisma as any).hrProbationReview.findMany({
      where,
      orderBy: [{ decision: 'asc' }, { dueDate: 'asc' }],
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true, status: true } },
      },
    });
    return { data, total: data.length };
  }

  async findOne(id: string, tenantId: string) {
    const review = await (this.prisma as any).hrProbationReview.findFirst({
      where: { id, tenantId },
      include: { employee: { select: { id: true, firstName: true, lastName: true } } },
    });
    if (!review) throw new NotFoundException(`Probation review ${id} not found`);
    return review;
  }

  async create(dto: CreateProbationReviewDto, tenantId: string) {
    const employee = await (this.prisma.employee as any).findFirst({
      where: { id: dto.employeeId, tenantId },
    });
    if (!employee) throw new NotFoundException(`Employee ${dto.employeeId} not found`);

    const review = await (this.prisma as any).hrProbationReview.create({
      data: {
        tenantId,
        employeeId: dto.employeeId,
        startDate: new Date(dto.startDate),
        dueDate: new Date(dto.dueDate),
        decision: 'pending',
      },
    });
    await (this.prisma.employee as any).update({
      where: { id: dto.employeeId },
      data: { status: 'PROBATION' },
    });
    return review;
  }

  async decide(id: string, dto: DecideProbationDto, reviewerId: string, tenantId: string) {
    const review = await this.findOne(id, tenantId);
    if (review.decision !== 'pending') {
      throw new BadRequestException(`Probation already decided (${review.decision})`);
    }

    const updated = await (this.prisma as any).hrProbationReview.update({
      where: { id },
      data: {
        decision: dto.decision,
        score: dto.score !== undefined ? dto.score.toFixed(2) : null,
        strengths: dto.strengths ?? null,
        improvements: dto.improvements ?? null,
        note: dto.note ?? null,
        reviewerId,
        reviewDate: new Date(),
        ...(dto.decision === 'extended' && dto.newDueDate && { dueDate: new Date(dto.newDueDate) }),
      },
    });

    const statusMap: Record<string, string> = {
      passed: 'ACTIVE',
      extended: 'PROBATION',
      failed: 'TERMINATED',
    };
    await (this.prisma.employee as any).update({
      where: { id: review.employeeId },
      data: { status: statusMap[dto.decision] },
    });

    // Re-open a fresh pending cycle when extended.
    if (dto.decision === 'extended' && dto.newDueDate) {
      await (this.prisma as any).hrProbationReview.create({
        data: {
          tenantId,
          employeeId: review.employeeId,
          startDate: new Date(),
          dueDate: new Date(dto.newDueDate),
          decision: 'pending',
        },
      });
    }

    await this.auditLog
      .log({
        action: AuditAction.PROBATION_DECISION,
        resource: AuditResource.PROBATION,
        resourceId: id,
        category: AuditCategory.HR,
        tenantId,
        userId: reviewerId,
        newValues: { decision: dto.decision, employeeStatus: statusMap[dto.decision] },
        description: `Probation ${dto.decision}`,
      })
      .catch((err) => this.logger.error(`Audit log failed: ${err.message}`));

    return updated;
  }
}
