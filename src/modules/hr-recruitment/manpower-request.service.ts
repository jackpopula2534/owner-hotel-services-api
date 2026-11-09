import { Injectable, NotFoundException, BadRequestException, HttpException, HttpStatus, Logger } from '@nestjs/common';
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
  currentStep,
  ApproverRole,
} from '../../common/types/approval-chain';
import {
  CreateManpowerRequestDto,
  UpdateManpowerRequestDto,
  SubmitBudgetDto,
  ApprovalDecisionDto,
  RequiredNoteDto,
  SubmitManpowerRequestDto,
} from './dto/recruitment.dto';
import { appendHistory, assertOwnAttachments, readHistory } from './manpower-approval-history';
import { ApprovalFlowService } from './approval-flow.service';
import { RecruitmentNotifierService } from './recruitment-notifier.service';

/** สถานะที่ถือว่า "ปิดแล้ว" สำหรับ bucket=closed ในลิสต์ */
const CLOSED_BUCKET_STATUSES = ['completed', 'cancelled', 'rejected'];
/** กดเตือนผู้อนุมัติซ้ำได้ทุก ๆ 10 นาที */
export const REMIND_THROTTLE_MS = 10 * 60_000;

export interface ManpowerProgress {
  applicants: number;
  newApplicants: number;
  scheduled: number;
  passed: number;
  offered: number;
  hired: number;
  started: number;
  passedProbation: number;
  nextInterviewAt: string | null;
}

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
    private readonly notifier: RecruitmentNotifierService,
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
    const and: Record<string, unknown>[] = [];
    if (query.status) where['status'] = query.status;
    if (query.departmentId) where['departmentId'] = query.departmentId;
    if (query.bucket === 'active') and.push({ status: { notIn: CLOSED_BUCKET_STATUSES } });
    if (query.bucket === 'closed') and.push({ status: { in: CLOSED_BUCKET_STATUSES } });
    const search = query.search?.trim();
    if (search) {
      and.push({ OR: [{ positionTitle: { contains: search } }, { requestNo: { contains: search } }] });
    }
    if (and.length) where['AND'] = and;

    const [rows, total] = await Promise.all([
      (this.prisma as any).hrManpowerRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { _count: { select: { candidates: true, equipmentRequests: true } } },
      }),
      (this.prisma as any).hrManpowerRequest.count({ where }),
    ]);
    const data = await this.attachListExtras(rows ?? [], tenantId);
    return { data, meta: { page, limit, total } };
  }

  /** แนบ department {id,name} + progress funnel ต่อแถว (query รวมทีเดียวต่อหน้า ไม่ใช่ต่อแถว) */
  private async attachListExtras(rows: Array<Record<string, any>>, tenantId: string) {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id as string);
    const deptIds = [...new Set(rows.map((r) => r.departmentId).filter(Boolean))] as string[];
    const now = new Date();

    const [departments, candidates, upcoming] = await Promise.all([
      deptIds.length
        ? (this.prisma as any).hrDepartment.findMany({
            where: { tenantId, id: { in: deptIds } },
            select: { id: true, name: true },
          })
        : [],
      (this.prisma as any).hrCandidate.findMany({
        where: { tenantId, manpowerRequestId: { in: ids } },
        select: {
          manpowerRequestId: true,
          status: true,
          hireRecord: { select: { employee: { select: { status: true } } } },
        },
      }),
      (this.prisma as any).hrInterview.findMany({
        where: {
          tenantId,
          status: 'scheduled',
          scheduledAt: { gt: now },
          candidate: { manpowerRequestId: { in: ids } },
        },
        orderBy: { scheduledAt: 'asc' },
        select: { scheduledAt: true, candidate: { select: { manpowerRequestId: true } } },
      }),
    ]);

    const deptById = new Map<string, { id: string; name: string }>(
      (departments ?? []).map((d: { id: string; name: string }) => [d.id, { id: d.id, name: d.name }]),
    );
    const progressById = new Map<string, ManpowerProgress>(ids.map((id) => [id, ManpowerRequestService.emptyProgress()]));

    for (const c of candidates ?? []) {
      const p = progressById.get(c.manpowerRequestId);
      if (!p) continue;
      const empStatus: string | undefined = c.hireRecord?.employee?.status;
      p.applicants += 1;
      if (['applied', 'screening'].includes(c.status)) p.newApplicants += 1;
      if (c.status === 'interview_scheduled') p.scheduled += 1;
      if (['interviewed', 'offer_made', 'offer_accepted', 'hired'].includes(c.status)) p.passed += 1;
      if (['offer_made', 'offer_accepted', 'hired'].includes(c.status)) p.offered += 1;
      if (c.status === 'hired') {
        p.hired += 1;
        if (empStatus === 'PROBATION' || empStatus === 'ACTIVE') p.started += 1;
        if (empStatus === 'ACTIVE') p.passedProbation += 1;
      }
    }
    for (const iv of upcoming ?? []) {
      const p = progressById.get(iv.candidate?.manpowerRequestId);
      if (p && !p.nextInterviewAt) p.nextInterviewAt = new Date(iv.scheduledAt).toISOString();
    }

    return rows.map((r) => ({
      ...r,
      department: r.departmentId ? (deptById.get(r.departmentId) ?? null) : null,
      progress: progressById.get(r.id) ?? ManpowerRequestService.emptyProgress(),
    }));
  }

  private static emptyProgress(): ManpowerProgress {
    return {
      applicants: 0,
      newApplicants: 0,
      scheduled: 0,
      passed: 0,
      offered: 0,
      hired: 0,
      started: 0,
      passedProbation: 0,
      nextInterviewAt: null,
    };
  }

  /** replacementEmployeeIds ต้องเป็นพนักงานของ tenant นี้ทั้งหมด (Employee ไม่อยู่ใน tenant middleware) */
  private async assertReplacementEmployees(ids: string[] | undefined, tenantId: string): Promise<string[] | undefined> {
    if (ids === undefined) return undefined;
    const unique = [...new Set(ids)];
    if (!unique.length) return [];
    const count = await (this.prisma as any).employee.count({ where: { tenantId, id: { in: unique } } });
    if (count !== unique.length) {
      throw new BadRequestException('replacementEmployeeIds contains employees outside this organization');
    }
    return unique;
  }

  async findOne(id: string, tenantId: string) {
    const request = await (this.prisma as any).hrManpowerRequest.findFirst({
      where: { id, tenantId },
      include: {
        equipmentRequests: { include: { issuances: true } },
        candidates: {
          include: {
            interviews: { orderBy: [{ round: 'asc' }, { scheduledAt: 'asc' }] },
            // แนบสถานะพนักงาน (PENDING_START → PROBATION) เพื่อให้ลิสต์ผู้สมัครรู้ว่า "ยืนยันวันเริ่มงาน" ได้รายคน
            hireRecord: { include: { employee: { select: { id: true, status: true, startDate: true } } } },
          },
        },
        jobPosting: true,
      },
    });
    if (!request) throw new NotFoundException(`Manpower request ${id} not found`);

    // แนบชื่อแผนก/ตำแหน่งจาก id (model ไม่มี relation ตรง — ดึงเพิ่มแล้ว attach)
    // ใช้ findFirst + tenantId เสมอ (model เป็น tenant-scoped, findUnique ถูกบล็อกโดย TenantScope)
    const [department, position] = await Promise.all([
      request.departmentId
        ? (this.prisma as any).hrDepartment.findFirst({
            where: { id: request.departmentId, tenantId },
            select: { id: true, name: true, nameEn: true, code: true, color: true },
          })
        : null,
      request.positionId
        ? (this.prisma as any).hrPosition.findFirst({
            where: { id: request.positionId, tenantId },
            select: { id: true, name: true, nameEn: true, code: true, level: true },
          })
        : null,
    ]);

    return { ...request, department, position, actors: await this.actorNames(request, tenantId) };
  }

  /** ชื่อคนที่อยู่ในประวัติ/ลำดับอนุมัติ — หน้าจอจะได้แสดง "คุณสมชาย (หัวหน้าแผนก)" แทน id */
  private async actorNames(request: Record<string, any>, tenantId: string): Promise<Record<string, string>> {
    const chains = [request.approvalChain, request.budgetChain].flatMap((c) => (Array.isArray(c) ? c : []));
    const ids = new Set<string>([
      ...readHistory(request.approvalHistory).map((h) => h.userId),
      ...chains.map((s: { approverId?: string | null }) => s.approverId).filter((x): x is string => !!x),
      ...(request.requestedBy ? [request.requestedBy] : []),
    ]);
    if (ids.size === 0) return {};
    const users: Array<{ id: string; firstName: string | null; lastName: string | null; email: string }> =
      await (this.prisma as any).user.findMany({
        where: { id: { in: [...ids] }, tenantId },
        select: { id: true, firstName: true, lastName: true, email: true },
      });
    return Object.fromEntries(users.map((u) => [u.id, `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.email]));
  }

  async create(dto: CreateManpowerRequestDto, tenantId: string, userId: string) {
    const replacementEmployeeIds = await this.assertReplacementEmployees(dto.replacementEmployeeIds, tenantId);
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
        reasonType: dto.reasonType ?? null,
        ...(replacementEmployeeIds !== undefined && { replacementEmployeeIds }),
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
    const replacementEmployeeIds = await this.assertReplacementEmployees(dto.replacementEmployeeIds, tenantId);
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
        ...(dto.reasonType !== undefined && { reasonType: dto.reasonType }),
        ...(replacementEmployeeIds !== undefined && { replacementEmployeeIds }),
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
      data: {
        status: 'cancelled',
        approvalHistory: appendHistory(existing.approvalHistory, { stage: 'request', action: 'cancelled', userId }),
      },
    });
    this.audit(AuditAction.UPDATE, id, tenantId, userId, 'Manpower request cancelled');
    return updated;
  }

  // ─── Stage 1 approval ──────────────────────────────────────────────────────

  async submit(id: string, dto: SubmitManpowerRequestDto, tenantId: string, userId: string) {
    const existing = await this.findOne(id, tenantId);
    if (!['draft', 'rejected'].includes(existing.status)) {
      throw new BadRequestException(`Only draft/rejected requests can be submitted (current: "${existing.status}")`);
    }
    // ยื่นใหม่หลังถูกส่งกลับ/ไม่อนุมัติ → ต้องชี้แจงว่าแก้อะไร ผู้อนุมัติจะได้ไม่ต้องเดา
    const isResubmit = readHistory(existing.approvalHistory).some((h) => h.stage === 'request' && (h.action === 'submitted' || h.action === 'resubmitted'))
      || ((existing.approvalChain ?? []) as ApprovalChain).some((s) => s.status === 'rejected');
    if (isResubmit && !dto.note?.trim()) {
      throw new BadRequestException('ยื่นใหม่ต้องระบุสิ่งที่แก้ไข/คำชี้แจง');
    }
    const attachments = assertOwnAttachments(dto.attachments, tenantId, id);
    const roles = await this.approvalFlow.resolveRoles(tenantId, 'manpower');
    const updated = await (this.prisma as any).hrManpowerRequest.update({
      where: { id },
      data: {
        status: 'pending_approval',
        approvalChain: buildApprovalChain(roles), // reset chain on resubmit (tenant config)
        currentApprovalLevel: 0,
        approvalHistory: appendHistory(existing.approvalHistory, {
          stage: 'request',
          action: isResubmit ? 'resubmitted' : 'submitted',
          userId,
          note: dto.note,
          attachments,
        }),
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
    const before = (existing.approvalChain ?? []) as ApprovalChain;
    const attachments = assertOwnAttachments(dto.attachments, tenantId, id);
    const chain = approveStep(before, userId, dto.note, attachments);
    const fullyApproved = isChainApproved(chain);
    const updated = await (this.prisma as any).hrManpowerRequest.update({
      where: { id },
      data: {
        approvalChain: chain,
        approvalHistory: appendHistory(existing.approvalHistory, { stage: 'request', action: 'approved', userId, note: dto.note, attachments, chainBefore: before }),
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
    const before = (existing.approvalChain ?? []) as ApprovalChain;
    const attachments = assertOwnAttachments(dto.attachments, tenantId, id);
    const chain = rejectStep(before, userId, dto.note, attachments);
    const updated = await (this.prisma as any).hrManpowerRequest.update({
      where: { id },
      data: {
        approvalChain: chain,
        status: 'rejected',
        approvalHistory: appendHistory(existing.approvalHistory, { stage: 'request', action: 'rejected', userId, note: dto.note, attachments, chainBefore: before }),
      },
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
    const attachments = assertOwnAttachments(dto.attachments, tenantId, id);
    const budgetResubmit = readHistory(existing.approvalHistory).some((h) => h.stage === 'budget' && (h.action === 'submitted' || h.action === 'resubmitted'));
    const budgetRoles = await this.approvalFlow.resolveRoles(tenantId, 'budget');
    const updated = await (this.prisma as any).hrManpowerRequest.update({
      where: { id },
      data: {
        salaryRangeMin: dto.salaryRangeMin ?? null,
        salaryRangeMax: dto.salaryRangeMax ?? null,
        budgetTotal: dto.budgetTotal,
        budgetNote: dto.budgetNote ?? null,
        budgetChain: buildApprovalChain(budgetRoles),
        approvalHistory: appendHistory(existing.approvalHistory, {
          stage: 'budget',
          action: budgetResubmit ? 'resubmitted' : 'submitted',
          userId,
          note: dto.budgetNote,
          attachments,
        }),
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
    const before = existing.budgetChain as ApprovalChain;
    const attachments = assertOwnAttachments(dto.attachments, tenantId, id);
    const chain = approveStep(before, userId, dto.note, attachments);
    const fullyApproved = isChainApproved(chain);
    const updated = await (this.prisma as any).hrManpowerRequest.update({
      where: { id },
      data: {
        budgetChain: chain,
        approvalHistory: appendHistory(existing.approvalHistory, { stage: 'budget', action: 'approved', userId, note: dto.note, attachments, chainBefore: before }),
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
    const before = existing.budgetChain as ApprovalChain;
    const attachments = assertOwnAttachments(dto.attachments, tenantId, id);
    const chain = rejectStep(before, userId, dto.note, attachments);
    // Stay in budget_pending — requester revises figures and resubmits a fresh chain.
    const updated = await (this.prisma as any).hrManpowerRequest.update({
      where: { id },
      data: {
        budgetChain: chain,
        approvalHistory: appendHistory(existing.approvalHistory, { stage: 'budget', action: 'returned', userId, note: dto.note, attachments, chainBefore: before }),
      },
    });
    this.audit(AuditAction.BUDGET_REJECT, id, tenantId, userId, `Budget rejected: ${dto.note ?? '-'}`);
    return updated;
  }

  /** ไม่อนุมัติงบ (ปิดคำขอ) — ต่างจาก rejectBudget ที่ส่งกลับให้แก้ตัวเลขแล้วยื่นใหม่ */
  async declineBudget(id: string, dto: RequiredNoteDto, tenantId: string, userId: string) {
    const existing = await this.findOne(id, tenantId);
    if (existing.status !== 'budget_pending' || !existing.budgetChain) {
      throw new BadRequestException('No budget pending approval on this request');
    }
    const before = existing.budgetChain as ApprovalChain;
    const attachments = assertOwnAttachments(dto.attachments, tenantId, id);
    const chain = rejectStep(before, userId, dto.note, attachments);
    const updated = await (this.prisma as any).hrManpowerRequest.update({
      where: { id },
      data: {
        budgetChain: chain,
        status: 'rejected',
        approvalHistory: appendHistory(existing.approvalHistory, { stage: 'budget', action: 'rejected', userId, note: dto.note, attachments, chainBefore: before }),
      },
    });
    this.audit(AuditAction.BUDGET_DECLINE, id, tenantId, userId, `Budget declined: ${dto.note}`);
    return updated;
  }

  // ─── Return for revision / remind approvers ───────────────────────────────

  /** ส่งกลับให้แก้: ปิดขั้นปัจจุบันเป็น rejected พร้อมเหตุผล แล้วคืนเป็น draft ให้ผู้ขอแก้ + ยื่นใหม่ */
  async returnForRevision(id: string, dto: RequiredNoteDto, tenantId: string, userId: string) {
    const existing = await this.findOne(id, tenantId);
    if (existing.status !== 'pending_approval') {
      throw new BadRequestException(`Request is not pending approval (current: "${existing.status}")`);
    }
    const before = (existing.approvalChain ?? []) as ApprovalChain;
    const attachments = assertOwnAttachments(dto.attachments, tenantId, id);
    const chain = rejectStep(before, userId, dto.note, attachments);
    const updated = await (this.prisma as any).hrManpowerRequest.update({
      where: { id },
      data: {
        approvalChain: chain,
        status: 'draft',
        approvalHistory: appendHistory(existing.approvalHistory, { stage: 'request', action: 'returned', userId, note: dto.note, attachments, chainBefore: before }),
      },
    });
    this.audit(AuditAction.MANPOWER_RETURN, id, tenantId, userId, `Manpower request returned for revision: ${dto.note}`);
    return updated;
  }

  /**
   * เตือนผู้อนุมัติของขั้นที่ค้างอยู่ (กระดิ่ง HR + ลิงก์ไปคำขอ)
   * กดซ้ำได้ทุก 10 นาที — claim สิทธิ์แบบ atomic ด้วย updateMany บน lastRemindedAt กันกดรัว
   */
  async remind(id: string, tenantId: string, userId: string): Promise<{ remindedAt: string; role: ApproverRole; recipients: number }> {
    const existing = await this.findOne(id, tenantId);
    let chain: ApprovalChain | null = null;
    let stage: 'manpower' | 'budget' = 'manpower';
    if (existing.status === 'pending_approval') {
      chain = (existing.approvalChain ?? []) as ApprovalChain;
    } else if (existing.status === 'budget_pending' && existing.budgetChain) {
      chain = existing.budgetChain as ApprovalChain;
      stage = 'budget';
    }
    const step = chain ? currentStep(chain) : null;
    if (!step) throw new BadRequestException('No approval step is waiting on this request');

    const now = new Date();
    const threshold = new Date(now.getTime() - REMIND_THROTTLE_MS);
    const claim = await (this.prisma as any).hrManpowerRequest.updateMany({
      where: { id, tenantId, OR: [{ lastRemindedAt: null }, { lastRemindedAt: { lt: threshold } }] },
      data: { lastRemindedAt: now },
    });
    if (!claim?.count) {
      throw new HttpException('Approvers were reminded less than 10 minutes ago', HttpStatus.TOO_MANY_REQUESTS);
    }

    const recipientIds = await this.notifier.resolveApproverUserIds(tenantId, step.role);
    const recipients = await this.notifier.notifyUsers(tenantId, recipientIds, {
      title: stage === 'budget' ? 'เตือน: งบขอกำลังพลรออนุมัติ' : 'เตือน: คำขอกำลังพลรออนุมัติ',
      message: `${existing.requestNo} (${existing.positionTitle}) รอการอนุมัติขั้นที่ ${step.level}`,
      link: `/hr/recruitment/${id}`,
      type: 'warning',
    });
    this.audit(AuditAction.MANPOWER_REMIND, id, tenantId, userId, `Reminded ${stage} approvers (${step.role}) — ${recipients} recipient(s)`);
    return { remindedAt: now.toISOString(), role: step.role, recipients };
  }
}
