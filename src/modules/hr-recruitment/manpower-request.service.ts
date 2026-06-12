import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { AddonService, ADDON_CODES } from '../addons/addon.service';
import {
  COST_EVENTS,
  RecruitmentBudgetReservedEvent,
} from '../cost-accounting/events/cost-accounting.events';
import { AuditAction, AuditResource, AuditCategory } from '../../audit-log/dto/audit-log.dto';
import {
  ApprovalChain,
  approveStep,
  rejectStep,
  buildApprovalChain,
  isChainApproved,
  approvedLevel,
} from '../../common/types/approval-chain';
import {
  CreateManpowerRequestDto,
  UpdateManpowerRequestDto,
  SubmitBudgetDto,
  ApprovalDecisionDto,
} from './dto/recruitment.dto';
import { ApprovalFlowService } from './approval-flow.service';

/**
 * Stage 1+2 of the recruitment pipeline: manpower request and budget approval.
 *
 * State machine:
 * draft → pending_approval → budget_pending → budget_approved → recruiting
 *       → interviewing → offer_made → hired → onboarding → probation → completed
 *       | rejected | cancelled
 */
@Injectable()
export class ManpowerRequestService {
  private readonly logger = new Logger(ManpowerRequestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    private readonly approvalFlow: ApprovalFlowService,
    private readonly addonService: AddonService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  private audit(action: AuditAction, resourceId: string, tenantId: string, userId: string, description: string, newValues?: Record<string, unknown>): void {
    this.auditLog
      .log({
        action,
        resource: AuditResource.MANPOWER_REQUEST,
        resourceId,
        category: AuditCategory.HR,
        tenantId,
        userId,
        newValues,
        description,
      })
      .catch((err: Error) => this.logger.error(`Audit log failed: ${err.message}`));
  }

  private async nextRequestNo(tenantId: string): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `MPR-${year}-`;
    const last = await (this.prisma as any).hrManpowerRequest.findFirst({
      where: { tenantId, requestNo: { startsWith: prefix } },
      orderBy: { requestNo: 'desc' },
      select: { requestNo: true },
    });
    const lastNo = last ? parseInt(last.requestNo.slice(prefix.length), 10) : 0;
    return `${prefix}${String(lastNo + 1).padStart(4, '0')}`;
  }

  // ─── CRUD ──────────────────────────────────────────────────────────────────

  async findAll(query: Record<string, string>, tenantId: string) {
    const page = parseInt(query.page ?? '1', 10);
    const limit = Math.min(parseInt(query.limit ?? '20', 10), 100);
    const where: Record<string, unknown> = { tenantId };
    if (query.status) where['status'] = query.status;
    if (query.departmentId) where['departmentId'] = query.departmentId;

    const [data, total] = await Promise.all([
      (this.prisma as any).hrManpowerRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { _count: { select: { candidates: true, equipmentRequests: true } } },
      }),
      (this.prisma as any).hrManpowerRequest.count({ where }),
    ]);
    return { data, meta: { page, limit, total } };
  }

  async findOne(id: string, tenantId: string) {
    const request = await (this.prisma as any).hrManpowerRequest.findFirst({
      where: { id, tenantId },
      include: {
        equipmentRequests: { include: { issuances: true } },
        candidates: {
          include: {
            interviews: { orderBy: [{ round: 'asc' }, { scheduledAt: 'asc' }] },
            hireRecord: true,
          },
        },
        jobPosting: true,
      },
    });
    if (!request) throw new NotFoundException(`Manpower request ${id} not found`);

    // แนบชื่อแผนก/ตำแหน่งจาก id (model ไม่มี relation ตรง — ดึงเพิ่มแล้ว attach)
    const [department, position] = await Promise.all([
      request.departmentId
        ? (this.prisma as any).hrDepartment.findUnique({
            where: { id: request.departmentId },
            select: { id: true, name: true, nameEn: true, code: true, color: true },
          })
        : null,
      request.positionId
        ? (this.prisma as any).hrPosition.findUnique({
            where: { id: request.positionId },
            select: { id: true, name: true, nameEn: true, code: true, level: true },
          })
        : null,
    ]);

    return { ...request, department, position };
  }

  async create(dto: CreateManpowerRequestDto, tenantId: string, userId: string) {
    const requestNo = await this.nextRequestNo(tenantId);
    const request = await (this.prisma as any).hrManpowerRequest.create({
      data: {
        tenantId,
        requestNo,
        propertyId: dto.propertyId ?? null,
        departmentId: dto.departmentId ?? null,
        positionId: dto.positionId ?? null,
        positionTitle: dto.positionTitle,
        headcount: dto.headcount ?? 1,
        employmentType: dto.employmentType ?? 'FULLTIME',
        reason: dto.reason,
        jobDescription: dto.jobDescription ?? null,
        expectedStartDate: dto.expectedStartDate ? new Date(dto.expectedStartDate) : null,
        status: 'draft',
        requestedBy: userId,
      },
    });
    this.audit(AuditAction.CREATE, request.id, tenantId, userId, `Manpower request ${requestNo} created`);
    return request;
  }

  async update(id: string, dto: UpdateManpowerRequestDto, tenantId: string, userId: string) {
    const existing = await this.findOne(id, tenantId);
    if (!['draft', 'rejected'].includes(existing.status)) {
      throw new BadRequestException(`Cannot edit a request in status "${existing.status}"`);
    }
    const updated = await (this.prisma as any).hrManpowerRequest.update({
      where: { id },
      data: {
        ...(dto.propertyId !== undefined && { propertyId: dto.propertyId }),
        ...(dto.departmentId !== undefined && { departmentId: dto.departmentId }),
        ...(dto.positionId !== undefined && { positionId: dto.positionId }),
        ...(dto.positionTitle !== undefined && { positionTitle: dto.positionTitle }),
        ...(dto.headcount !== undefined && { headcount: dto.headcount }),
        ...(dto.employmentType !== undefined && { employmentType: dto.employmentType }),
        ...(dto.reason !== undefined && { reason: dto.reason }),
        ...(dto.jobDescription !== undefined && { jobDescription: dto.jobDescription }),
        ...(dto.expectedStartDate !== undefined && { expectedStartDate: new Date(dto.expectedStartDate) }),
      },
    });
    this.audit(AuditAction.UPDATE, id, tenantId, userId, 'Manpower request updated');
    return updated;
  }

  async cancel(id: string, tenantId: string, userId: string) {
    const existing = await this.findOne(id, tenantId);
    if (['hired', 'onboarding', 'probation', 'completed'].includes(existing.status)) {
      throw new BadRequestException(`Cannot cancel a request in status "${existing.status}"`);
    }
    const updated = await (this.prisma as any).hrManpowerRequest.update({
      where: { id },
      data: { status: 'cancelled' },
    });
    this.audit(AuditAction.UPDATE, id, tenantId, userId, 'Manpower request cancelled');
    return updated;
  }

  // ─── Stage 1 approval ──────────────────────────────────────────────────────

  async submit(id: string, tenantId: string, userId: string) {
    const existing = await this.findOne(id, tenantId);
    if (!['draft', 'rejected'].includes(existing.status)) {
      throw new BadRequestException(`Only draft/rejected requests can be submitted (current: "${existing.status}")`);
    }
    const roles = await this.approvalFlow.resolveRoles(tenantId, 'manpower');
    const updated = await (this.prisma as any).hrManpowerRequest.update({
      where: { id },
      data: {
        status: 'pending_approval',
        approvalChain: buildApprovalChain(roles), // reset chain on resubmit (tenant config)
        currentApprovalLevel: 0,
      },
    });
    this.audit(AuditAction.MANPOWER_SUBMIT, id, tenantId, userId, `Manpower request ${existing.requestNo} submitted`);
    return updated;
  }

  async approve(id: string, dto: ApprovalDecisionDto, tenantId: string, userId: string) {
    const existing = await this.findOne(id, tenantId);
    if (existing.status !== 'pending_approval') {
      throw new BadRequestException(`Request is not pending approval (current: "${existing.status}")`);
    }
    const chain = approveStep((existing.approvalChain ?? []) as ApprovalChain, userId, dto.note);
    const fullyApproved = isChainApproved(chain);
    const updated = await (this.prisma as any).hrManpowerRequest.update({
      where: { id },
      data: {
        approvalChain: chain,
        currentApprovalLevel: approvedLevel(chain),
        ...(fullyApproved && { status: 'budget_pending' }),
      },
    });
    this.audit(
      AuditAction.MANPOWER_APPROVE_STEP,
      id,
      tenantId,
      userId,
      fullyApproved ? 'Manpower request fully approved → budget_pending' : `Manpower approval level ${approvedLevel(chain)}`,
      { level: approvedLevel(chain), fullyApproved },
    );
    return updated;
  }

  async reject(id: string, dto: ApprovalDecisionDto, tenantId: string, userId: string) {
    const existing = await this.findOne(id, tenantId);
    if (existing.status !== 'pending_approval') {
      throw new BadRequestException(`Request is not pending approval (current: "${existing.status}")`);
    }
    const chain = rejectStep((existing.approvalChain ?? []) as ApprovalChain, userId, dto.note);
    const updated = await (this.prisma as any).hrManpowerRequest.update({
      where: { id },
      data: { approvalChain: chain, status: 'rejected' },
    });
    this.audit(AuditAction.MANPOWER_REJECT, id, tenantId, userId, `Manpower request rejected: ${dto.note ?? '-'}`);
    return updated;
  }

  // ─── Stage 2: budget ───────────────────────────────────────────────────────

  async submitBudget(id: string, dto: SubmitBudgetDto, tenantId: string, userId: string) {
    const existing = await this.findOne(id, tenantId);
    if (existing.status !== 'budget_pending') {
      throw new BadRequestException(`Budget can be submitted only in "budget_pending" (current: "${existing.status}")`);
    }
    if (
      dto.salaryRangeMin !== undefined &&
      dto.salaryRangeMax !== undefined &&
      dto.salaryRangeMin > dto.salaryRangeMax
    ) {
      throw new BadRequestException('salaryRangeMin must not exceed salaryRangeMax');
    }
    const budgetRoles = await this.approvalFlow.resolveRoles(tenantId, 'budget');
    const updated = await (this.prisma as any).hrManpowerRequest.update({
      where: { id },
      data: {
        salaryRangeMin: dto.salaryRangeMin ?? null,
        salaryRangeMax: dto.salaryRangeMax ?? null,
        budgetTotal: dto.budgetTotal,
        budgetNote: dto.budgetNote ?? null,
        budgetChain: buildApprovalChain(budgetRoles),
      },
    });
    this.audit(AuditAction.BUDGET_SUBMIT, id, tenantId, userId, `Budget submitted (${dto.budgetTotal})`);
    return updated;
  }

  async approveBudget(id: string, dto: ApprovalDecisionDto, tenantId: string, userId: string) {
    const existing = await this.findOne(id, tenantId);
    if (existing.status !== 'budget_pending' || !existing.budgetChain) {
      throw new BadRequestException('No budget pending approval on this request');
    }
    const chain = approveStep(existing.budgetChain as ApprovalChain, userId, dto.note);
    const fullyApproved = isChainApproved(chain);
    const updated = await (this.prisma as any).hrManpowerRequest.update({
      where: { id },
      data: {
        budgetChain: chain,
        ...(fullyApproved && { status: 'recruiting', budgetApprovedAt: new Date() }),
      },
    });

    // อนุมัติงบครบ + มี COST_ACCOUNTING_MODULE → จองงบเงินเดือนให้แผนกที่ขอ (double-gate, ไม่ block)
    if (fullyApproved) await this.emitBudgetReserved(updated, tenantId, userId);

    this.audit(
      AuditAction.BUDGET_APPROVE_STEP,
      id,
      tenantId,
      userId,
      fullyApproved ? 'Budget fully approved → recruiting' : 'Budget approval step recorded',
      { fullyApproved },
    );
    return updated;
  }

  private async emitBudgetReserved(request: Record<string, any>, tenantId: string, userId: string): Promise<void> {
    try {
      const hasCostAddon = await this.addonService.hasActiveAddon(tenantId, ADDON_CODES.COST_ACCOUNTING_MODULE);
      if (!hasCostAddon) return;
      const payload: RecruitmentBudgetReservedEvent = {
        manpowerRequestId: request.id,
        requestNo: request.requestNo,
        tenantId,
        propertyId: request.propertyId ?? null,
        departmentId: request.departmentId ?? null,
        positionTitle: request.positionTitle,
        headcount: request.headcount ?? 1,
        budgetTotal: Number(request.budgetTotal ?? 0),
        createdBy: userId,
      };
      this.eventEmitter.emit(COST_EVENTS.RECRUITMENT_BUDGET_RESERVED, payload);
    } catch (error) {
      this.logger.warn(`Failed to emit budget_reserved for ${request.id}: ${(error as Error).message}`);
    }
  }

  async rejectBudget(id: string, dto: ApprovalDecisionDto, tenantId: string, userId: string) {
    const existing = await this.findOne(id, tenantId);
    if (existing.status !== 'budget_pending' || !existing.budgetChain) {
      throw new BadRequestException('No budget pending approval on this request');
    }
    const chain = rejectStep(existing.budgetChain as ApprovalChain, userId, dto.note);
    // Stay in budget_pending — requester revises figures and resubmits a fresh chain.
    const updated = await (this.prisma as any).hrManpowerRequest.update({
      where: { id },
      data: { budgetChain: chain },
    });
    this.audit(AuditAction.BUDGET_REJECT, id, tenantId, userId, `Budget rejected: ${dto.note ?? '-'}`);
    return updated;
  }
}
