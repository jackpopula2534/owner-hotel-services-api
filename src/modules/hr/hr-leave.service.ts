import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { AuditAction, AuditResource, AuditCategory } from '../../audit-log/dto/audit-log.dto';
import { HrLeavePolicyService } from './hr-leave-policy.service';
import {
  CreateHrLeaveRequestDto,
  UpdateHrLeaveRequestDto,
  RejectLeaveRequestDto,
} from './dto/create-hr-leave-request.dto';

/** Approver role expected at each approval level (deepest chain = level 3). */
const LEVEL_ROLES: Record<number, string> = { 1: 'supervisor', 2: 'manager', 3: 'hr' };

@Injectable()
export class HrLeaveService {
  private readonly logger = new Logger(HrLeaveService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly leavePolicyService: HrLeavePolicyService,
    private readonly auditLog: AuditLogService,
  ) {}

  /** Build an approval chain for `levels` steps. Level N (hr) is always last. */
  private buildApprovalChain(levels: number) {
    const offset = 3 - levels; // so a 1-level chain is just 'hr', 2-level 'manager'+'hr', etc.
    return Array.from({ length: levels }, (_, i) => ({
      level: i + 1,
      role: LEVEL_ROLES[offset + i + 1] ?? 'hr',
      status: 'pending' as const,
      approverId: null as string | null,
      at: null as string | null,
    }));
  }

  private tenureMonths(startDate?: Date | string | null): number {
    if (!startDate) return 0;
    const start = new Date(startDate).getTime();
    return Math.max(0, Math.floor((Date.now() - start) / (1000 * 60 * 60 * 24 * 30)));
  }

  // ─── List & Detail ────────────────────────────────────────────────────────────

  async findAll(query: Record<string, string>, tenantId: string) {
    const page = parseInt(query.page ?? '1', 10);
    const limit = parseInt(query.limit ?? '20', 10);
    const skip = (page - 1) * limit;

    const { status, employeeId, leaveTypeId, search } = query;

    const where: Record<string, unknown> = { tenantId };
    if (status) where['status'] = status;
    if (employeeId) where['employeeId'] = employeeId;
    if (leaveTypeId) where['leaveTypeId'] = leaveTypeId;
    if (search) {
      where['employee'] = {
        OR: [
          { firstName: { contains: search } },
          { lastName: { contains: search } },
          { employeeCode: { contains: search } },
        ],
      };
    }

    const [data, total] = await Promise.all([
      (this.prisma as any).hrLeaveRequest.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
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
          leaveType: {
            select: { id: true, name: true, nameEn: true, code: true, color: true, isPaid: true },
          },
        },
      }),
      (this.prisma as any).hrLeaveRequest.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async findOne(id: string, tenantId: string) {
    const request = await (this.prisma as any).hrLeaveRequest.findFirst({
      where: { id, tenantId },
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
        leaveType: {
          select: {
            id: true,
            name: true,
            nameEn: true,
            code: true,
            color: true,
            isPaid: true,
            requiresDoc: true,
          },
        },
      },
    });
    if (!request) throw new NotFoundException(`Leave request ${id} not found`);
    return request;
  }

  // ─── Leave Balance ────────────────────────────────────────────────────────────

  async getLeaveBalance(employeeId: string, tenantId: string, year?: number) {
    const employee = await (this.prisma.employee as any).findFirst({
      where: { id: employeeId, tenantId },
    });
    if (!employee) throw new NotFoundException(`Employee ${employeeId} not found`);

    const targetYear = year ?? new Date().getFullYear();
    const yearStart = new Date(`${targetYear}-01-01`);
    const yearEnd = new Date(`${targetYear}-12-31`);

    // Fetch all leave types for this tenant
    const leaveTypes = await (this.prisma as any).hrLeaveType.findMany({
      where: { tenantId, isActive: true },
    });

    // Fetch all approved leave requests for this employee in the year
    const approvedLeaves = await (this.prisma as any).hrLeaveRequest.findMany({
      where: {
        tenantId,
        employeeId,
        status: 'approved',
        startDate: { gte: yearStart, lte: yearEnd },
      },
    });

    const balance = leaveTypes.map((lt: any) => {
      const used = approvedLeaves
        .filter((lr: any) => lr.leaveTypeId === lt.id)
        .reduce((sum: number, lr: any) => sum + lr.totalDays, 0);
      const total = lt.maxDaysPerYear ?? 0;
      const remaining = Math.max(0, total - used);
      return {
        leaveTypeId: lt.id,
        leaveTypeName: lt.name,
        code: lt.code,
        color: lt.color,
        total,
        used,
        remaining,
      };
    });

    return { employeeId, year: targetYear, balance };
  }

  // ─── CRUD ────────────────────────────────────────────────────────────────────

  async create(dto: CreateHrLeaveRequestDto, tenantId: string) {
    const employee = await (this.prisma.employee as any).findFirst({
      where: { id: dto.employeeId, tenantId },
    });
    if (!employee) throw new NotFoundException(`Employee ${dto.employeeId} not found`);

    const leaveType = await (this.prisma as any).hrLeaveType.findFirst({
      where: { id: dto.leaveTypeId, tenantId, isActive: true },
    });
    if (!leaveType) throw new NotFoundException(`Leave type ${dto.leaveTypeId} not found`);

    const start = new Date(dto.startDate);
    const end = new Date(dto.endDate);
    if (end < start) throw new BadRequestException('End date must be on or after start date');

    // Resolve tenure-aware leave policy → approval depth + attachment + blackout.
    const tenure = this.tenureMonths(employee.startDate);
    const policy = await this.leavePolicyService.resolveEffective(
      tenantId,
      dto.leaveTypeId,
      tenure,
    );

    if ((policy.requiresAttachment || leaveType.requiresDoc) && !dto.attachmentUrl) {
      throw new BadRequestException('This leave type requires a supporting document');
    }
    if (policy.blackoutDates.length) {
      const blackout = policy.blackoutDates.find((d) => {
        const day = new Date(d);
        return day >= start && day <= end;
      });
      if (blackout) {
        throw new BadRequestException(`Leave overlaps a blackout date (${blackout})`);
      }
    }

    const requiredLevels = policy.approvalLevels;
    const approvalChain = this.buildApprovalChain(requiredLevels);

    const request = await (this.prisma as any).hrLeaveRequest.create({
      data: {
        tenantId,
        employeeId: dto.employeeId,
        leaveTypeId: dto.leaveTypeId,
        startDate: start,
        endDate: end,
        totalDays: dto.totalDays,
        reason: dto.reason ?? null,
        substituteId: dto.substituteId ?? null,
        attachmentUrl: dto.attachmentUrl ?? null,
        approvalChain,
        currentLevel: 1,
        requiredLevels,
        status: 'pending',
      },
      include: {
        employee: { select: { id: true, firstName: true, lastName: true } },
        leaveType: { select: { id: true, name: true, code: true, color: true } },
      },
    });

    this.logger.log(`Leave request created: ${request.id} for employee ${dto.employeeId}`);
    return request;
  }

  async update(id: string, dto: UpdateHrLeaveRequestDto, tenantId: string) {
    const existing = await this.findOne(id, tenantId);
    if (existing.status !== 'pending') {
      throw new BadRequestException('Only pending leave requests can be updated');
    }

    return (this.prisma as any).hrLeaveRequest.update({
      where: { id },
      data: {
        ...(dto.startDate && { startDate: new Date(dto.startDate) }),
        ...(dto.endDate && { endDate: new Date(dto.endDate) }),
        ...(dto.totalDays !== undefined && { totalDays: dto.totalDays }),
        ...(dto.reason !== undefined && { reason: dto.reason }),
        ...(dto.substituteId !== undefined && { substituteId: dto.substituteId }),
        ...(dto.leaveTypeId && { leaveTypeId: dto.leaveTypeId }),
      },
    });
  }

  async remove(id: string, tenantId: string) {
    const existing = await this.findOne(id, tenantId);
    if (existing.status === 'approved') {
      throw new BadRequestException('Cannot delete an approved leave request');
    }
    return (this.prisma as any).hrLeaveRequest.delete({ where: { id } });
  }

  // ─── Workflow: Approve / Reject ───────────────────────────────────────────────

  async approve(id: string, approverId: string, tenantId: string) {
    const request = await this.findOne(id, tenantId);
    if (request.status !== 'pending') {
      throw new BadRequestException(`Leave request is already ${request.status}`);
    }

    const updated = await (this.prisma as any).hrLeaveRequest.update({
      where: { id },
      data: {
        status: 'approved',
        approvedBy: approverId,
        approvedAt: new Date(),
      },
      include: {
        employee: { select: { id: true, firstName: true, lastName: true } },
        leaveType: { select: { id: true, name: true } },
      },
    });

    this.logger.log(`Leave request ${id} approved by ${approverId}`);
    return updated;
  }

  /**
   * Multi-step approval (P2-05): approve the current level of the chain. When
   * the final level is approved the request becomes `approved`.
   */
  async approveStep(id: string, approverId: string, tenantId: string, note?: string) {
    const request = await this.findOne(id, tenantId);
    if (request.status !== 'pending') {
      throw new BadRequestException(`Leave request is already ${request.status}`);
    }

    const chain: any[] = Array.isArray(request.approvalChain)
      ? [...request.approvalChain]
      : this.buildApprovalChain(request.requiredLevels ?? 1);
    const idx = chain.findIndex((s) => s.status === 'pending');
    if (idx === -1) {
      throw new BadRequestException('Approval chain already complete');
    }

    chain[idx] = {
      ...chain[idx],
      status: 'approved',
      approverId,
      at: new Date().toISOString(),
      note: note ?? null,
    };
    const isFinal = idx === chain.length - 1;

    const updated = await (this.prisma as any).hrLeaveRequest.update({
      where: { id },
      data: {
        approvalChain: chain,
        currentLevel: Math.min(idx + 2, chain.length),
        ...(isFinal
          ? { status: 'approved', approvedBy: approverId, approvedAt: new Date() }
          : {}),
      },
      include: {
        employee: { select: { id: true, firstName: true, lastName: true } },
        leaveType: { select: { id: true, name: true } },
      },
    });

    await this.auditLog
      .log({
        action: AuditAction.LEAVE_APPROVE_STEP,
        resource: AuditResource.LEAVE_REQUEST,
        resourceId: id,
        category: AuditCategory.HR,
        tenantId,
        userId: approverId,
        newValues: { level: idx + 1, role: chain[idx].role, final: isFinal },
        description: `Leave approval step ${idx + 1}/${chain.length}`,
      })
      .catch((err) => this.logger.error(`Audit log failed: ${err.message}`));

    this.logger.log(`Leave ${id} step ${idx + 1}/${chain.length} approved by ${approverId}`);
    return updated;
  }

  async reject(id: string, dto: RejectLeaveRequestDto, rejectorId: string, tenantId: string) {
    const request = await this.findOne(id, tenantId);
    if (request.status !== 'pending') {
      throw new BadRequestException(`Leave request is already ${request.status}`);
    }

    const updated = await (this.prisma as any).hrLeaveRequest.update({
      where: { id },
      data: {
        status: 'rejected',
        rejectedBy: rejectorId,
        rejectedAt: new Date(),
        rejectReason: dto.reason,
      },
      include: {
        employee: { select: { id: true, firstName: true, lastName: true } },
        leaveType: { select: { id: true, name: true } },
      },
    });

    this.logger.log(`Leave request ${id} rejected by ${rejectorId}: ${dto.reason}`);
    return updated;
  }

  async cancel(id: string, tenantId: string) {
    const request = await this.findOne(id, tenantId);
    if (['rejected', 'cancelled'].includes(request.status)) {
      throw new BadRequestException(`Leave request is already ${request.status}`);
    }

    return (this.prisma as any).hrLeaveRequest.update({
      where: { id },
      data: { status: 'cancelled' },
    });
  }
}
