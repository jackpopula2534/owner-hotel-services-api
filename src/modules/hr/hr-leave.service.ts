import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateHrLeaveRequestDto,
  UpdateHrLeaveRequestDto,
  RejectLeaveRequestDto,
} from './dto/create-hr-leave-request.dto';

@Injectable()
export class HrLeaveService {
  private readonly logger = new Logger(HrLeaveService.name);

  constructor(private readonly prisma: PrismaService) {}

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
