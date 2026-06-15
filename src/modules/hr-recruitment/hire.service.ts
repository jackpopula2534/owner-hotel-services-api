import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { AuditAction, AuditResource, AuditCategory } from '../../audit-log/dto/audit-log.dto';
import { AddonService, ADDON_CODES } from '../addons/addon.service';
import {
  COST_EVENTS,
  RecruitmentSalaryCommittedEvent,
} from '../cost-accounting/events/cost-accounting.events';
import { EmployeeCodeConfigService } from '../hr/employee-code-config.service';
import { RecruitmentInventoryService } from '../hr/recruitment-inventory.service';
import { HireCandidateDto, CancelHireDto } from './dto/recruitment.dto';

const DAY_MS = 24 * 60 * 60 * 1000;

/** สถานะพนักงานที่ถือว่า "รายงานตัวเริ่มงานแล้ว" (ผ่านขั้นยืนยันเริ่มงาน) */
const STARTED_EMPLOYEE_STATUSES = ['PROBATION', 'ACTIVE'];

/**
 * Stage 5→7 bridge: accept offer → create Employee (PENDING_START) + issuances,
 * then on the actual first day confirm start → PROBATION + auto-open a
 * probation round with 30/60/90-day checkpoints.
 */
@Injectable()
export class HireService {
  private readonly logger = new Logger(HireService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    private readonly employeeCode: EmployeeCodeConfigService,
    private readonly recruitmentInventory: RecruitmentInventoryService,
    private readonly addonService: AddonService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  private audit(action: AuditAction, resourceId: string, tenantId: string, userId: string, description: string, newValues?: Record<string, unknown>): void {
    this.auditLog
      .log({ action, resource: AuditResource.HIRE_RECORD, resourceId, category: AuditCategory.HR, tenantId, userId, description, newValues })
      .catch((err: Error) => this.logger.error(`Audit log failed: ${err.message}`));
  }

  /** Offer accepted → create Employee + first-day equipment issuances (single transaction). */
  async hire(candidateId: string, dto: HireCandidateDto, tenantId: string, userId: string) {
    const candidate = await (this.prisma as any).hrCandidate.findFirst({
      where: { id: candidateId, tenantId },
      include: {
        hireRecord: true,
        manpowerRequest: { include: { equipmentRequests: { where: { status: 'approved' } } } },
      },
    });
    if (!candidate) throw new NotFoundException(`Candidate ${candidateId} not found`);
    if (!candidate.hireRecord || candidate.hireRecord.offerStatus !== 'offered') {
      throw new BadRequestException('Candidate has no pending offer to accept');
    }

    const email = dto.email ?? candidate.email;
    if (!email) throw new BadRequestException('An email is required to create the employee record');

    const employeeCode = await this.employeeCode.generateNextCode(
      tenantId,
      undefined,
      candidate.manpowerRequest.propertyId ?? undefined,
    );

    // จองของแบบ B: reserve ตอนจ้างสำเร็จเท่านั้น (เฉพาะเมื่อมี INVENTORY_MODULE)
    const hasInventory = await this.recruitmentInventory.isEnabled(tenantId);

    // ข้อมูลใบสมัคร public (ชุดเดียว) → map เข้า Employee เมื่อมีค่า
    const applicationFields = this.mapApplicationToEmployee(candidate);

    const result = await this.prisma.$transaction(async (tx: any) => {
      const employee = await tx.employee.create({
        data: {
          tenantId,
          propertyId: candidate.manpowerRequest.propertyId ?? null,
          departmentId: candidate.manpowerRequest.departmentId ?? null,
          positionId: candidate.manpowerRequest.positionId ?? null,
          position: candidate.manpowerRequest.positionTitle,
          firstName: candidate.firstName,
          lastName: candidate.lastName,
          email,
          phone: candidate.phone ?? null,
          employeeCode,
          employmentType: candidate.manpowerRequest.employmentType,
          baseSalary: candidate.hireRecord.offeredSalary,
          initialSalary: candidate.hireRecord.offeredSalary,
          startDate: candidate.hireRecord.startDate,
          status: 'PENDING_START',
          ...applicationFields,
        },
      });

      const hireRecord = await tx.hrHireRecord.update({
        where: { id: candidate.hireRecord.id },
        data: { offerStatus: 'accepted', acceptedAt: new Date(), employeeId: employee.id },
      });

      // First-day issuance checklist from every approved equipment request.
      for (const eq of candidate.manpowerRequest.equipmentRequests) {
        const items = Array.isArray(eq.items) ? eq.items : [];
        let issuanceItems = items.map((i: Record<string, unknown>) => ({ ...i, issued: false }));
        let issuanceStatus = 'pending';
        if (hasInventory) {
          const reservation = await this.recruitmentInventory.reserveItems(
            tx,
            issuanceItems as any[],
            tenantId,
            candidate.manpowerRequest.propertyId ?? null,
          );
          issuanceItems = reservation.items as any[];
          if (reservation.reservedAny) issuanceStatus = 'reserved';
        }
        await tx.hrEquipmentIssuance.create({
          data: {
            tenantId,
            equipmentRequestId: eq.id,
            employeeId: employee.id,
            items: issuanceItems,
            status: issuanceStatus,
          },
        });
      }

      await tx.hrCandidate.update({ where: { id: candidateId }, data: { status: 'hired' } });

      // headcount > 1: ปิดคำขอ ("hired") เมื่อจ้างครบโควต้าเท่านั้น ถ้ายังไม่ครบวนกลับไปหาคนต่อ
      const hiredCount = await tx.hrCandidate.count({
        where: { tenantId, manpowerRequestId: candidate.manpowerRequestId, status: 'hired' },
      });
      const quotaFilled = hiredCount >= (candidate.manpowerRequest.headcount ?? 1);
      // อุปกรณ์เป็นขั้นบังคับก่อนเริ่มงาน: ถ้ามีคำขอเบิกที่ "อนุมัติแล้ว" ตอนจ้างครบ → ข้ามไปขั้นรับของ
      // (onboarding) ได้เลย; ถ้ายังไม่มี ค้างที่ "hired" (ขั้นขออุปกรณ์) จนกว่าจะสร้าง+อนุมัติคำขอเบิก
      const hasApprovedEquipment = (candidate.manpowerRequest.equipmentRequests?.length ?? 0) > 0;
      const nextStatus = quotaFilled ? (hasApprovedEquipment ? 'onboarding' : 'hired') : 'recruiting';
      await tx.hrManpowerRequest.update({
        where: { id: candidate.manpowerRequestId },
        data: { status: nextStatus },
      });
      return { employee, hireRecord };
    });

    this.audit(AuditAction.CANDIDATE_HIRE, result.hireRecord.id, tenantId, userId, `Candidate hired → employee ${employeeCode} (start ${candidate.hireRecord.startDate.toISOString().slice(0, 10)})`, { employeeId: result.employee.id });

    // จ้างสำเร็จ + มี COST_ACCOUNTING_MODULE → ส่งเงินเดือนที่ commit ให้บัญชีต้นทุน (double-gate, ไม่ block)
    await this.emitSalaryCommitted(candidate, result, tenantId, userId);

    return result;
  }

  /**
   * แปลง applicationData (ใบสมัคร public ชุดเดียว) → field ของ Employee.
   * ใส่เฉพาะค่าที่มี เพื่อไม่ทับ default — รองรับ candidate ที่ HR เพิ่มเอง (ไม่มี applicationData).
   */
  private mapApplicationToEmployee(candidate: Record<string, any>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    const app = (candidate.applicationData ?? {}) as Record<string, any>;

    if (app.nickname) out.nickname = app.nickname;
    if (app.nationalId) out.nationalId = app.nationalId;
    if (app.dateOfBirth) out.dateOfBirth = new Date(app.dateOfBirth);
    if (app.gender) out.gender = app.gender;
    if (app.bankName) out.bankName = app.bankName;
    if (app.bankAccount) out.bankAccount = app.bankAccount;
    if (app.taxId) out.taxId = app.taxId;
    if (app.socialSecurity) out.socialSecurity = app.socialSecurity;
    if (Array.isArray(app.educations) && app.educations.length) out.educations = app.educations;
    if (Array.isArray(app.workExperiences) && app.workExperiences.length) out.workExperiences = app.workExperiences;
    if (Array.isArray(app.emergencyContacts) && app.emergencyContacts.length) out.emergencyContacts = app.emergencyContacts;
    if (app.address) out.notes = app.address;

    // PDPA consent จากใบสมัคร → employee record
    if (candidate.consentGiven) {
      out.consentGiven = true;
      out.consentAt = candidate.consentAt ?? new Date();
    }
    return out;
  }

  private async emitSalaryCommitted(
    candidate: Record<string, any>,
    result: { employee: Record<string, any>; hireRecord: Record<string, any> },
    tenantId: string,
    userId: string,
  ): Promise<void> {
    try {
      const hasCostAddon = await this.addonService.hasActiveAddon(tenantId, ADDON_CODES.COST_ACCOUNTING_MODULE);
      if (!hasCostAddon) return;
      const payload: RecruitmentSalaryCommittedEvent = {
        hireRecordId: result.hireRecord.id,
        manpowerRequestId: candidate.manpowerRequestId,
        tenantId,
        propertyId: candidate.manpowerRequest.propertyId ?? null,
        departmentId: candidate.manpowerRequest.departmentId ?? null,
        positionTitle: candidate.manpowerRequest.positionTitle,
        employeeId: result.employee.id,
        monthlySalary: Number(result.hireRecord.offeredSalary ?? 0),
        startDate: result.hireRecord.startDate.toISOString(),
        createdBy: userId,
      };
      this.eventEmitter.emit(COST_EVENTS.RECRUITMENT_SALARY_COMMITTED, payload);
    } catch (error) {
      this.logger.warn(`Failed to emit salary_committed for hire ${result.hireRecord.id}: ${(error as Error).message}`);
    }
  }

  /**
   * First day: employee reported to work. Sets PROBATION and auto-opens a
   * probation round with 30/60/90-day checkpoints (capped at probationDays).
   */
  async confirmStart(hireRecordId: string, tenantId: string, userId: string) {
    const hireRecord = await (this.prisma as any).hrHireRecord.findFirst({
      where: { id: hireRecordId, tenantId },
      include: { candidate: true },
    });
    if (!hireRecord) throw new NotFoundException(`Hire record ${hireRecordId} not found`);
    if (hireRecord.offerStatus !== 'accepted' || !hireRecord.employeeId) {
      throw new BadRequestException('Offer must be accepted (employee created) before confirming start');
    }

    // หมายเหตุ: การเบิกอุปกรณ์เป็นขั้นคู่ขนาน (เตรียมของก่อน/หลังวันเริ่มก็ได้) — ไม่บังคับว่าต้อง
    // มีใบเบิกก่อนจึงจะยืนยันวันเริ่มงานได้ เพื่อให้พนักงานรายงานตัว/เปิดทดลองงานได้ทันแม้ของยังไม่ครบ

    const existingRound = await (this.prisma as any).hrProbationRound.findFirst({
      where: { tenantId, employeeId: hireRecord.employeeId, status: 'active' },
    });
    if (existingRound) throw new BadRequestException('Employee already has an active probation round');

    const startDate = new Date();
    const dueDate = new Date(startDate.getTime() + hireRecord.probationDays * DAY_MS);
    const checkpointDays = [30, 60, 90].filter((d) => d < hireRecord.probationDays);

    const round = await this.prisma.$transaction(async (tx: any) => {
      await tx.employee.update({
        where: { id: hireRecord.employeeId },
        data: { status: 'PROBATION', startDate },
      });
      const created = await tx.hrProbationRound.create({
        data: {
          tenantId,
          employeeId: hireRecord.employeeId,
          hireRecordId,
          startDate,
          dueDate,
          status: 'active',
        },
      });
      for (const days of [...checkpointDays, hireRecord.probationDays]) {
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
      // ขยับคำขอไป "probation" เมื่อผ่านขั้นอุปกรณ์แล้ว (onboarding) หรือกรณีจ้างครบ+อนุมัติอุปกรณ์
      // พร้อมกัน (hired) — แต่ต้อง "ยืนยันเริ่มงานครบทุกอัตรา" ก่อน (รับหลายคนต้องรายงานตัวครบ)
      await this.advanceToProbationIfAllStarted(tx, hireRecord.candidate.manpowerRequestId, tenantId);
      return created;
    });

    this.audit(AuditAction.PROBATION_OPEN, round.id, tenantId, userId, `Employee started — probation round opened (due ${dueDate.toISOString().slice(0, 10)})`, { employeeId: hireRecord.employeeId });
    return round;
  }

  /**
   * เลื่อนคำขอสรรหา onboarding/hired → probation เฉพาะเมื่อ "ทุกอัตราที่จ้าง" รายงานตัวเริ่มงานครบแล้ว
   * (รับหลายคน: ตราบใดยังมีพนักงานที่ยังไม่ยืนยันเริ่มงาน — status = PENDING_START — คำขอจะค้างขั้นเดิม)
   * เรียกภายใน transaction ของ confirmStart หลังตั้งพนักงานคนปัจจุบันเป็น PROBATION แล้ว
   */
  private async advanceToProbationIfAllStarted(tx: any, manpowerRequestId: string, tenantId: string): Promise<void> {
    const hiredCandidates = await tx.hrCandidate.findMany({
      where: { tenantId, manpowerRequestId, status: 'hired' },
      select: { hireRecord: { select: { employee: { select: { status: true } } } } },
    });
    if (hiredCandidates.length === 0) return;
    const allStarted = hiredCandidates.every((c: any) =>
      STARTED_EMPLOYEE_STATUSES.includes(c.hireRecord?.employee?.status ?? ''),
    );
    if (!allStarted) return;
    await tx.hrManpowerRequest.updateMany({
      where: { id: manpowerRequestId, status: { in: ['onboarding', 'hired'] } },
      data: { status: 'probation' },
    });
  }

  /**
   * ผู้ถูกจ้างไม่มารายงานตัววันแรก → ยกเลิกการจ้าง: ปลดจองของ (ถ้ามี),
   * Employee → CANCELLED, ใบเบิกที่ค้าง → cancelled แล้ววนคำขอกลับไป "recruiting"
   */
  async cancelNoShow(hireRecordId: string, dto: CancelHireDto, tenantId: string, userId: string) {
    const hireRecord = await (this.prisma as any).hrHireRecord.findFirst({
      where: { id: hireRecordId, tenantId },
      include: { candidate: { include: { manpowerRequest: { select: { id: true, headcount: true } } } }, employee: true },
    });
    if (!hireRecord) throw new NotFoundException(`Hire record ${hireRecordId} not found`);
    if (hireRecord.offerStatus !== 'accepted' || !hireRecord.employeeId) {
      throw new BadRequestException('Only an accepted hire (employee created) can be cancelled');
    }
    if (hireRecord.employee?.status !== 'PENDING_START') {
      throw new BadRequestException(
        `Employee already started (status: "${hireRecord.employee?.status}") — use the probation/offboarding flow instead`,
      );
    }

    const manpowerRequestId = hireRecord.candidate.manpowerRequestId;
    await this.prisma.$transaction(async (tx: any) => {
      await tx.hrHireRecord.update({
        where: { id: hireRecordId },
        data: { offerStatus: 'cancelled' },
      });
      await tx.employee.update({
        where: { id: hireRecord.employeeId },
        data: { status: 'CANCELLED', ...(dto.reason && { note: dto.reason }) },
      });
      await tx.hrCandidate.update({
        where: { id: hireRecord.candidateId },
        data: { status: 'withdrawn' },
      });

      // ใบเบิกวันแรกที่ยังไม่จ่ายของ → ปลดจองสต๊อก (graceful ถ้าไม่มี INVENTORY_MODULE) แล้วยกเลิก
      const issuances = await tx.hrEquipmentIssuance.findMany({
        where: { tenantId, employeeId: hireRecord.employeeId, status: { in: ['pending', 'reserved'] } },
      });
      for (const issuance of issuances) {
        await this.recruitmentInventory.releaseReservation(tx, issuance);
        await tx.hrEquipmentIssuance.update({ where: { id: issuance.id }, data: { status: 'cancelled' } });
      }

      // จ้างยังไม่ครบโควต้า → วนคำขอกลับไปหาคนใหม่
      const hiredCount = await tx.hrCandidate.count({
        where: { tenantId, manpowerRequestId, status: 'hired' },
      });
      if (hiredCount < (hireRecord.candidate.manpowerRequest?.headcount ?? 1)) {
        await tx.hrManpowerRequest.update({
          where: { id: manpowerRequestId },
          data: { status: 'recruiting' },
        });
      }
    });

    this.audit(AuditAction.UPDATE, hireRecordId, tenantId, userId, `Hire cancelled (no-show)${dto.reason ? `: ${dto.reason}` : ''} — request reopened for recruiting`, { employeeId: hireRecord.employeeId });
    return (this.prisma as any).hrHireRecord.findFirst({
      where: { id: hireRecordId, tenantId },
      include: { candidate: true, employee: true },
    });
  }
}
