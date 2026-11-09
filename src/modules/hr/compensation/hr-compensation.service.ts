import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogService } from '../../../audit-log/audit-log.service';
import { AuditAction, AuditCategory, AuditResource } from '../../../audit-log/dto/audit-log.dto';
import { businessDateOf } from '../../../common/utils/bangkok-day.util';
import {
  Db,
  recordCompensationChange,
  resolveCompensationAsOf,
  syncEmployeeCurrent,
  todayBusinessDate,
  toCompensation,
  totalOf,
} from './compensation.core';
import { AdjustCompensationDto, CancelCompensationChangeDto } from './compensation.dto';

const ROLE_SEE_PAY = new Set(['platform_admin', 'tenant_admin', 'admin', 'hr']);

/**
 * ประวัติค่าตอบแทน — ดู / ปรับเอง / ยกเลิกรายการที่ยังไม่มีผล / งานรายวัน apply ตามวันที่มีผล
 * (การบันทึกจากการจ้าง/ผ่านทดลองงานเรียก compensation.core โดยตรงใน transaction ของ flow นั้น)
 */
@Injectable()
export class HrCompensationService {
  private readonly logger = new Logger(HrCompensationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  private get db(): Db {
    return this.prisma;
  }

  private audit(
    employeeId: string,
    tenantId: string,
    userId: string,
    description: string,
    oldValues?: object,
    newValues?: object,
  ) {
    this.auditLog
      .log({
        action: AuditAction.UPDATE,
        resource: AuditResource.EMPLOYEE,
        resourceId: employeeId,
        category: AuditCategory.HR,
        tenantId,
        userId,
        description,
        oldValues: oldValues as Record<string, unknown>,
        newValues: newValues as Record<string, unknown>,
      })
      .catch((err: Error) => this.logger.error(`Audit log failed: ${err.message}`));
  }

  private async requireEmployee(tenantId: string, employeeId: string) {
    const emp = await this.db.employee.findFirst({
      where: { id: employeeId, tenantId },
      select: { id: true, baseSalary: true, positionBonus: true, allowance: true, status: true },
    });
    if (!emp) throw new NotFoundException(`Employee ${employeeId} not found`);
    return emp;
  }

  /** ประวัติของพนักงาน (วันที่มีผลใหม่สุดก่อน) + ค่าที่มีผลวันนี้ — ตัวเลขถูกซ่อนสำหรับ role ที่ไม่มีสิทธิ์ */
  async listForEmployee(tenantId: string, employeeId: string, role?: string) {
    const emp = await this.requireEmployee(tenantId, employeeId);
    const rows: Array<Record<string, any>> = await this.db.hrCompensationChange.findMany({
      where: { tenantId, employeeId },
      orderBy: [{ effectiveDate: 'desc' }, { createdAt: 'desc' }],
    });
    const userIds = [
      ...new Set(rows.flatMap((r) => [r.actorUserId, r.cancelledBy]).filter(Boolean)),
    ] as string[];
    const users: Array<{
      id: string;
      firstName: string | null;
      lastName: string | null;
      email: string;
    }> = userIds.length
      ? await this.db.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, firstName: true, lastName: true, email: true },
        })
      : [];
    const nameOf = new Map(
      users.map((u) => [u.id, [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email]),
    );
    const canSeePay = role ? ROLE_SEE_PAY.has(role) : false;
    const today = todayBusinessDate();
    const current = await resolveCompensationAsOf(this.db, tenantId, employeeId, today, emp);

    const money = (c: Record<string, unknown> | null) =>
      c && canSeePay ? { ...toCompensation(c), total: totalOf(toCompensation(c)) } : null;

    return {
      canSeePay,
      current: canSeePay ? { ...current, total: totalOf(current) } : null,
      changes: rows.map((r) => ({
        id: r.id,
        effectiveDate: r.effectiveDate
          ? (r.effectiveDate as Date).toISOString().slice(0, 10)
          : null,
        changeType: r.changeType,
        source: r.source,
        status: r.status,
        reason: r.reason,
        refType: r.refType,
        refId: r.refId,
        createdAt: r.createdAt,
        appliedAt: r.appliedAt,
        cancelledAt: r.cancelledAt,
        actor: r.actorUserId
          ? { id: r.actorUserId, name: nameOf.get(r.actorUserId) ?? null }
          : null,
        cancelledBy: r.cancelledBy
          ? { id: r.cancelledBy, name: nameOf.get(r.cancelledBy) ?? null }
          : null,
        compensation: money(r),
        previous: money(r.previous as Record<string, unknown> | null),
      })),
    };
  }

  /** HR ปรับค่าตอบแทนเอง — ต้องมีวันที่มีผลและเหตุผลเสมอ */
  async adjust(dto: AdjustCompensationDto, tenantId: string, userId: string) {
    await this.requireEmployee(tenantId, dto.employeeId);
    const effectiveDate = businessDateOf(dto.effectiveDate.slice(0, 10));
    const row = await this.prisma.$transaction((tx) =>
      recordCompensationChange(tx, {
        tenantId,
        employeeId: dto.employeeId,
        effectiveDate,
        compensation: {
          baseSalary: dto.baseSalary,
          positionBonus: dto.positionBonus ?? 0,
          allowance: dto.allowance ?? 0,
        },
        changeType: dto.changeType ?? 'MANUAL_ADJUST',
        source: 'user',
        actorUserId: userId,
        reason: dto.reason.trim(),
      }),
    );
    this.audit(
      dto.employeeId,
      tenantId,
      userId,
      `ปรับค่าตอบแทน (${row.changeType}) มีผล ${dto.effectiveDate.slice(0, 10)}: ${dto.reason}`,
      row.previous ?? undefined,
      toCompensation(row),
    );
    return row;
  }

  /** ยกเลิกรายการที่ยังไม่มีผล (pending/scheduled) — รายการที่ applied แล้วต้องแก้ด้วย CORRECTION */
  async cancel(id: string, dto: CancelCompensationChangeDto, tenantId: string, userId: string) {
    const row = await this.db.hrCompensationChange.findFirst({ where: { id, tenantId } });
    if (!row) throw new NotFoundException(`Compensation change ${id} not found`);
    if (!['pending', 'scheduled'].includes(row.status)) {
      throw new BadRequestException(
        'ยกเลิกได้เฉพาะรายการที่ยังไม่มีผล — รายการที่มีผลแล้วให้บันทึกการแก้ไข (CORRECTION) แทน',
      );
    }
    const updated = await this.db.hrCompensationChange.update({
      where: { id },
      data: { status: 'cancelled', cancelledAt: new Date(), cancelledBy: userId },
    });
    this.audit(
      row.employeeId,
      tenantId,
      userId,
      `ยกเลิกการปรับค่าตอบแทน ${row.changeType}: ${dto.reason}`,
    );
    return updated;
  }

  /**
   * ทุกวัน 00:05 เวลาไทย — รายการที่ถึงวันที่มีผลแล้ว → applied + อัปเดตค่าปัจจุบันบน Employee
   * (ระบบเงินเดือนอ่านจากประวัติโดยตรง ถ้างานนี้พลาด ตัวเลขเงินเดือนก็ยังถูก)
   */
  @Cron('5 0 * * *', { name: 'hr-compensation-apply', timeZone: 'Asia/Bangkok' })
  async applyDue(now: Date = new Date()): Promise<number> {
    const today = todayBusinessDate(now);
    const due: Array<{ id: string; tenantId: string; employeeId: string }> =
      await this.db.hrCompensationChange.findMany({
        where: { status: 'scheduled', effectiveDate: { lte: today } },
        select: { id: true, tenantId: true, employeeId: true },
      });
    for (const row of due) {
      try {
        await this.prisma.$transaction(async (tx) => {
          await (tx as Db).hrCompensationChange.update({
            where: { id: row.id },
            data: { status: 'applied', appliedAt: now },
          });
          await syncEmployeeCurrent(tx, row.tenantId, row.employeeId, today);
        });
      } catch (err) {
        this.logger.error(
          `apply compensation ${row.id} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    if (due.length) this.logger.log(`Applied ${due.length} compensation change(s)`);
    return due.length;
  }
}
