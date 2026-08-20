import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { AuditAction, AuditResource, AuditCategory } from '../../audit-log/dto/audit-log.dto';
import { CreateHrOffboardingDto, UpdateClearanceDto } from './dto/hr-offboarding.dto';

/**
 * Offboarding & clearance (P2-06/07). Completing an offboarding revokes the
 * employee's user account, unlinks them from operational staff records, and
 * sets the lifecycle status to resigned/terminated.
 */
@Injectable()
export class HrOffboardingService {
  private readonly logger = new Logger(HrOffboardingService.name);

  static readonly DEFAULT_CLEARANCE = [
    'คืนอุปกรณ์/ยูนิฟอร์ม',
    'คืนกุญแจ/คีย์การ์ด',
    'ส่งมอบงาน',
    'เคลียร์เงินยืม/ค่าใช้จ่ายค้าง',
    'ปิดบัญชีผู้ใช้ระบบ',
    'คำนวณเงินเดือนงวดสุดท้าย',
  ];

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  async findAll(query: Record<string, string>, tenantId: string) {
    const where: Record<string, unknown> = { tenantId };
    if (query.employeeId) where['employeeId'] = query.employeeId;
    if (query.status) where['status'] = query.status;
    const data = await (this.prisma as any).hrOffboarding.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true, status: true } },
      },
    });
    return { data, total: data.length };
  }

  async findOne(id: string, tenantId: string) {
    const record = await (this.prisma as any).hrOffboarding.findFirst({
      where: { id, tenantId },
      include: { employee: { select: { id: true, firstName: true, lastName: true, status: true } } },
    });
    if (!record) throw new NotFoundException(`Offboarding ${id} not found`);
    return record;
  }

  async create(dto: CreateHrOffboardingDto, tenantId: string, userId?: string) {
    const employee = await (this.prisma.employee as any).findFirst({
      where: { id: dto.employeeId, tenantId },
    });
    if (!employee) throw new NotFoundException(`Employee ${dto.employeeId} not found`);

    const existing = await (this.prisma as any).hrOffboarding.findFirst({
      where: { tenantId, employeeId: dto.employeeId, status: { in: ['initiated', 'clearing'] } },
    });
    if (existing) {
      throw new BadRequestException('An active offboarding already exists for this employee');
    }

    const items = (dto.clearanceItems?.length
      ? dto.clearanceItems
      : HrOffboardingService.DEFAULT_CLEARANCE.map((label) => ({ label, done: false }))
    ).map((i: any) => ({ label: i.label, done: i.done ?? false, by: null, at: null }));

    const record = await (this.prisma as any).hrOffboarding.create({
      data: {
        tenantId,
        employeeId: dto.employeeId,
        type: dto.type,
        reason: dto.reason ?? null,
        noticeDate: dto.noticeDate ? new Date(dto.noticeDate) : null,
        lastWorkingDate: dto.lastWorkingDate ? new Date(dto.lastWorkingDate) : null,
        status: 'clearing',
        clearanceItems: items,
        initiatedBy: userId ?? null,
      },
    });

    await this.audit(AuditAction.OFFBOARDING_INITIATE, record.id, tenantId, userId, {
      employeeId: dto.employeeId,
      type: dto.type,
    });
    return record;
  }

  async updateClearance(id: string, dto: UpdateClearanceDto, tenantId: string, userId?: string) {
    const record = await this.findOne(id, tenantId);
    if (record.status === 'completed' || record.status === 'cancelled') {
      throw new BadRequestException(`Offboarding is already ${record.status}`);
    }
    const items = dto.clearanceItems.map((i) => ({
      label: i.label,
      done: i.done ?? false,
      by: i.done ? userId ?? null : null,
      at: i.done ? new Date().toISOString() : null,
    }));
    return (this.prisma as any).hrOffboarding.update({
      where: { id },
      data: { clearanceItems: items },
    });
  }

  /**
   * Complete offboarding: requires all clearance items done. Revokes user
   * access, unlinks operational staff, and finalises lifecycle status.
   */
  async complete(id: string, tenantId: string, userId?: string) {
    const record = await this.findOne(id, tenantId);
    if (record.status === 'completed') {
      throw new BadRequestException('Offboarding already completed');
    }
    const items: any[] = Array.isArray(record.clearanceItems) ? record.clearanceItems : [];
    const pending = items.filter((i) => !i.done);
    if (pending.length) {
      throw new BadRequestException(
        `Clearance incomplete: ${pending.map((i) => i.label).join(', ')}`,
      );
    }

    // Revoke user account access (P2-07)
    //
    // users.employeeId เก็บ "รหัสพนักงาน" แบบข้อความอิสระ (เช่น EMP3704) ไม่ใช่ id ของ
    // ตาราง employees — ตัวเชื่อมจริงคือ metadata.hrEmployeeId ที่ hotel-terminal-users เขียนไว้
    // จับคู่ด้วย record.employeeId ตรง ๆ จึงไม่เคยเจอแถวไหนเลย บัญชีของคนที่ลาออกยัง login ได้
    // ต้องไล่จากตัวพนักงานจริงทั้งสามทางที่ระบบใช้ผูกบัญชี
    const employee = await this.prisma.employee.findFirst({
      where: { id: record.employeeId, tenantId },
      select: { email: true, employeeCode: true },
    });
    const accountMatches: Prisma.UserWhereInput[] = [
      { metadata: { contains: `"hrEmployeeId":"${record.employeeId}"` } },
    ];
    if (employee?.employeeCode) accountMatches.push({ employeeId: employee.employeeCode });
    if (employee?.email) accountMatches.push({ email: employee.email });
    const userResult = await this.prisma.user.updateMany({
      where: { tenantId, OR: accountMatches },
      data: { status: 'inactive' },
    });

    // Unlink operational staff record (P2-07)
    const staffResult = await (this.prisma as any).staff.updateMany({
      where: { tenantId, employeeId: record.employeeId },
      data: { status: 'inactive' },
    });

    // Finalise employee lifecycle status
    const newStatus = record.type === 'termination' ? 'TERMINATED' : 'RESIGNED';
    await (this.prisma.employee as any).update({
      where: { id: record.employeeId },
      data: { status: newStatus },
    });

    const updated = await (this.prisma as any).hrOffboarding.update({
      where: { id },
      data: {
        status: 'completed',
        accountRevoked: userResult.count > 0,
        staffUnlinked: staffResult.count > 0,
        completedAt: new Date(),
      },
    });

    await this.audit(AuditAction.OFFBOARDING_COMPLETE, id, tenantId, userId, {
      employeeStatus: newStatus,
      accountsRevoked: userResult.count,
      staffUnlinked: staffResult.count,
    });
    if (userResult.count > 0) {
      await this.audit(AuditAction.EMPLOYEE_ACCOUNT_REVOKE, record.employeeId, tenantId, userId, {
        count: userResult.count,
      });
    }

    this.logger.log(
      `Offboarding ${id} completed: employee ${record.employeeId} → ${newStatus}`,
    );
    return updated;
  }

  async cancel(id: string, tenantId: string) {
    const record = await this.findOne(id, tenantId);
    if (record.status === 'completed') {
      throw new BadRequestException('Cannot cancel a completed offboarding');
    }
    return (this.prisma as any).hrOffboarding.update({
      where: { id },
      data: { status: 'cancelled' },
    });
  }

  private async audit(
    action: AuditAction,
    resourceId: string,
    tenantId: string,
    userId: string | undefined,
    newValues: Record<string, unknown>,
  ) {
    await this.auditLog
      .log({
        action,
        resource: AuditResource.OFFBOARDING,
        resourceId,
        category: AuditCategory.HR,
        tenantId,
        userId,
        newValues,
        description: 'Offboarding lifecycle change',
      })
      .catch((err) => this.logger.error(`Audit log failed: ${err.message}`));
  }
}
