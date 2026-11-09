import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Employee data completeness aggregator.
 *
 * รวมความครบถ้วนของข้อมูลพนักงานจาก 2 แหล่ง:
 *  1. Profile sections — ข้อมูลใน Employee record (6 tab ของฟอร์มพนักงาน)
 *  2. HR subsystems — ระบบย่อยที่ผูกกับพนักงานผ่าน employeeId
 *     (เอกสาร/onboarding, ทดลองงาน, นโยบายลา, payroll, กะ/roster, อบรม, เข้างาน)
 *
 * คะแนนรวมคิดจาก required items เท่านั้น (optional แสดงเป็นข้อมูลเฉยๆ)
 * complete = 1 คะแนน, partial = 0.5 คะแนน
 */

export type CompletenessStatus = 'complete' | 'partial' | 'missing';

export interface ProfileSectionStatus {
  key: string;
  label: string;
  complete: boolean;
  missingFields: string[];
}

export interface SystemStatus {
  key: string;
  label: string;
  status: CompletenessStatus;
  required: boolean;
  detail: string;
  done: number;
  total: number;
}

export interface EmployeeCompleteness {
  employeeId: string;
  overallPct: number;
  profile: { pct: number; sections: ProfileSectionStatus[] };
  systems: SystemStatus[];
}

const has = (v: unknown): boolean => {
  if (v === null || v === undefined) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  return true;
};

const hasItems = (v: unknown): boolean => Array.isArray(v) && v.length > 0;

@Injectable()
export class HrCompletenessService {
  constructor(private readonly prisma: PrismaService) {}

  async getEmployeeCompleteness(id: string, tenantId?: string): Promise<EmployeeCompleteness> {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    const employee = await (this.prisma.employee as any).findFirst({
      where: { id, tenantId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        nationalId: true,
        dateOfBirth: true,
        gender: true,
        departmentId: true,
        positionId: true,
        startDate: true,
        employmentType: true,
        educations: true,
        workExperiences: true,
        emergencyContacts: true,
        bankName: true,
        bankAccount: true,
        baseSalary: true,
        socialSecurity: true,
        taxId: true,
        consentGiven: true,
      },
    });
    if (!employee) {
      throw new NotFoundException(`Employee with ID ${id} not found`);
    }

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [
      docRequirements,
      onboardingTasks,
      probationReview,
      leavePolicyCount,
      payrollPolicyCount,
      shiftCount,
      attendanceCount,
      trainingCount,
    ] = await Promise.all([
      (this.prisma as any).hrEmployeeDocumentRequirement.findMany({
        where: { tenantId, employeeId: id },
        select: { status: true },
      }),
      (this.prisma as any).hrOnboardingTask.findMany({
        where: { tenantId, employeeId: id },
        select: { isComplete: true },
      }),
      (this.prisma as any).hrProbationRound
        .findFirst({
          where: { tenantId, employeeId: id },
          orderBy: { createdAt: 'desc' },
          select: { status: true },
        })
        .then((r: { status: string } | null) =>
          r ? { decision: r.status === 'active' ? 'pending' : r.status } : null,
        ),
      (this.prisma as any).hrLeavePolicy.count({
        where: { tenantId, isActive: true },
      }),
      (this.prisma as any).hrPayrollPolicy.count({
        where: { tenantId, isActive: true },
      }),
      (this.prisma as any).hrShiftAssignment.count({
        where: { tenantId, employeeId: id },
      }),
      (this.prisma as any).hrAttendance.count({
        where: { tenantId, employeeId: id, date: { gte: thirtyDaysAgo } },
      }),
      (this.prisma as any).hrTrainingRecord.count({
        where: { tenantId, employeeId: id },
      }),
    ]);

    const sections = this.buildProfileSections(employee);
    const systems = this.buildSystems({
      docRequirements,
      onboardingTasks,
      probationReview,
      leavePolicyCount,
      payrollPolicyCount,
      shiftCount,
      attendanceCount,
      trainingCount,
      employee,
    });

    const profileScore = sections.filter((s) => s.complete).length;
    const profilePct = Math.round((profileScore / sections.length) * 100);

    const requiredSystems = systems.filter((s) => s.required);
    const systemScore = requiredSystems.reduce((sum, s) => {
      if (s.status === 'complete') return sum + 1;
      if (s.status === 'partial') return sum + 0.5;
      return sum;
    }, 0);

    const overallPct = Math.round(
      ((profileScore + systemScore) / (sections.length + requiredSystems.length)) * 100,
    );

    return {
      employeeId: id,
      overallPct,
      profile: { pct: profilePct, sections },
      systems,
    };
  }

  /**
   * Bulk summary สำหรับหน้า list — คืนเฉพาะ overallPct ต่อพนักงาน
   * ใช้ bulk query (ไม่ N+1) — attendance/training เป็น optional ไม่กระทบคะแนน
   * จึงไม่ดึงใน summary
   */
  async getCompletenessSummary(
    tenantId?: string,
    ids?: string[],
  ): Promise<{ employeeId: string; overallPct: number }[]> {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    const employees = await (this.prisma.employee as any).findMany({
      where: { tenantId, ...(ids?.length ? { id: { in: ids } } : {}) },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        nationalId: true,
        dateOfBirth: true,
        departmentId: true,
        positionId: true,
        startDate: true,
        employmentType: true,
        educations: true,
        workExperiences: true,
        emergencyContacts: true,
        bankName: true,
        bankAccount: true,
        baseSalary: true,
        socialSecurity: true,
        consentGiven: true,
      },
    });
    if (employees.length === 0) return [];

    const empIds = employees.map((e: any) => e.id);

    const [docReqs, onboardingTasks, probations, leavePolicyCount, payrollPolicyCount, shifts] =
      await Promise.all([
        (this.prisma as any).hrEmployeeDocumentRequirement.findMany({
          where: { tenantId, employeeId: { in: empIds } },
          select: { employeeId: true, status: true },
        }),
        (this.prisma as any).hrOnboardingTask.findMany({
          where: { tenantId, employeeId: { in: empIds } },
          select: { employeeId: true, isComplete: true },
        }),
        (this.prisma as any).hrProbationRound.findMany({
          where: { tenantId, employeeId: { in: empIds } },
          orderBy: { createdAt: 'desc' },
          select: { employeeId: true, status: true },
        }),
        (this.prisma as any).hrLeavePolicy.count({ where: { tenantId, isActive: true } }),
        (this.prisma as any).hrPayrollPolicy.count({ where: { tenantId, isActive: true } }),
        (this.prisma as any).hrShiftAssignment.groupBy({
          by: ['employeeId'],
          where: { tenantId, employeeId: { in: empIds } },
          _count: { _all: true },
        }),
      ]);

    const groupBy = <T extends { employeeId: string }>(rows: T[]): Map<string, T[]> => {
      const map = new Map<string, T[]>();
      for (const row of rows) {
        const list = map.get(row.employeeId) ?? [];
        map.set(row.employeeId, [...list, row]);
      }
      return map;
    };

    const docsByEmp = groupBy<{ employeeId: string; status: string }>(docReqs);
    const tasksByEmp = groupBy<{ employeeId: string; isComplete: boolean }>(onboardingTasks);
    const shiftCountByEmp = new Map<string, number>(
      shifts.map((s: any) => [s.employeeId, s._count._all]),
    );
    // probations เรียง desc แล้ว — ตัวแรกของแต่ละคนคือรอบล่าสุด
    const latestProbationByEmp = new Map<string, { decision: string }>();
    for (const p of probations) {
      if (!latestProbationByEmp.has(p.employeeId)) {
        // map round status → legacy decision semantics (active = pending)
        latestProbationByEmp.set(p.employeeId, { decision: p.status === 'active' ? 'pending' : p.status });
      }
    }

    return employees.map((employee: any) => {
      const sections = this.buildProfileSections(employee);
      const systems = this.buildSystems({
        docRequirements: docsByEmp.get(employee.id) ?? [],
        onboardingTasks: tasksByEmp.get(employee.id) ?? [],
        probationReview: latestProbationByEmp.get(employee.id) ?? null,
        leavePolicyCount,
        payrollPolicyCount,
        shiftCount: shiftCountByEmp.get(employee.id) ?? 0,
        attendanceCount: 0,
        trainingCount: 0,
        employee,
      });

      const profileScore = sections.filter((s) => s.complete).length;
      const requiredSystems = systems.filter((s) => s.required);
      const systemScore = requiredSystems.reduce((sum, s) => {
        if (s.status === 'complete') return sum + 1;
        if (s.status === 'partial') return sum + 0.5;
        return sum;
      }, 0);

      return {
        employeeId: employee.id,
        overallPct: Math.round(
          ((profileScore + systemScore) / (sections.length + requiredSystems.length)) * 100,
        ),
      };
    });
  }

  private buildProfileSections(employee: any): ProfileSectionStatus[] {
    const personalMissing: string[] = [];
    if (!has(employee.firstName)) personalMissing.push('ชื่อ');
    if (!has(employee.lastName)) personalMissing.push('นามสกุล');
    if (!has(employee.email)) personalMissing.push('อีเมล');
    if (!has(employee.phone)) personalMissing.push('เบอร์โทรศัพท์');
    if (!has(employee.nationalId)) personalMissing.push('เลขบัตรประชาชน');
    if (!has(employee.dateOfBirth)) personalMissing.push('วันเกิด');

    const employmentMissing: string[] = [];
    if (!has(employee.departmentId)) employmentMissing.push('แผนก');
    if (!has(employee.positionId)) employmentMissing.push('ตำแหน่ง');
    if (!has(employee.startDate)) employmentMissing.push('วันเริ่มงาน');
    if (!has(employee.employmentType)) employmentMissing.push('ประเภทการจ้าง');

    const financialMissing: string[] = [];
    if (!has(employee.bankName)) financialMissing.push('ธนาคาร');
    if (!has(employee.bankAccount)) financialMissing.push('เลขบัญชี');
    if (!has(employee.baseSalary)) financialMissing.push('เงินเดือนพื้นฐาน');
    if (!has(employee.socialSecurity)) financialMissing.push('ประกันสังคม');
    if (!employee.consentGiven) financialMissing.push('ยินยอม PDPA');

    return [
      {
        key: 'personal',
        label: 'ข้อมูลส่วนตัว',
        complete: personalMissing.length === 0,
        missingFields: personalMissing,
      },
      {
        key: 'employment',
        label: 'การจ้างงาน',
        complete: employmentMissing.length === 0,
        missingFields: employmentMissing,
      },
      {
        key: 'education',
        label: 'การศึกษา',
        complete: hasItems(employee.educations),
        missingFields: hasItems(employee.educations) ? [] : ['ยังไม่มีประวัติการศึกษา'],
      },
      {
        key: 'workExperience',
        label: 'ประวัติการทำงาน',
        complete: hasItems(employee.workExperiences),
        missingFields: hasItems(employee.workExperiences) ? [] : ['ยังไม่มีประวัติการทำงาน'],
      },
      {
        key: 'emergencyContact',
        label: 'ผู้ติดต่อฉุกเฉิน',
        complete: hasItems(employee.emergencyContacts),
        missingFields: hasItems(employee.emergencyContacts) ? [] : ['ยังไม่มีผู้ติดต่อฉุกเฉิน'],
      },
      {
        key: 'financial',
        label: 'ข้อมูลการเงิน',
        complete: financialMissing.length === 0,
        missingFields: financialMissing,
      },
    ];
  }

  private buildSystems(ctx: {
    docRequirements: { status: string }[];
    onboardingTasks: { isComplete: boolean }[];
    probationReview: { decision: string } | null;
    leavePolicyCount: number;
    payrollPolicyCount: number;
    shiftCount: number;
    attendanceCount: number;
    trainingCount: number;
    employee: any;
  }): SystemStatus[] {
    const systems: SystemStatus[] = [];

    // ── เอกสารพนักงาน (document requirements) ──
    const docTotal = ctx.docRequirements.length;
    const docDone = ctx.docRequirements.filter((r) => r.status !== 'missing').length;
    systems.push({
      key: 'documents',
      label: 'เอกสารพนักงาน',
      required: true,
      done: docDone,
      total: docTotal,
      status: docTotal === 0 ? 'missing' : docDone === docTotal ? 'complete' : 'partial',
      detail:
        docTotal === 0
          ? 'ยังไม่ได้มอบหมายเอกสารที่ต้องส่ง'
          : `ส่งแล้ว ${docDone}/${docTotal} รายการ`,
    });

    // ── Onboarding checklist ──
    const obTotal = ctx.onboardingTasks.length;
    const obDone = ctx.onboardingTasks.filter((t) => t.isComplete).length;
    systems.push({
      key: 'onboarding',
      label: 'Onboarding checklist',
      required: true,
      done: obDone,
      total: obTotal,
      status: obTotal === 0 ? 'missing' : obDone === obTotal ? 'complete' : 'partial',
      detail:
        obTotal === 0 ? 'ยังไม่ได้สร้าง onboarding checklist' : `เสร็จ ${obDone}/${obTotal} งาน`,
    });

    // ── ทดลองงาน (probation) ──
    const decision = ctx.probationReview?.decision;
    systems.push({
      key: 'probation',
      label: 'ทดลองงาน',
      required: true,
      done: decision && decision !== 'pending' ? 1 : 0,
      total: 1,
      status: !ctx.probationReview ? 'missing' : decision === 'pending' ? 'partial' : 'complete',
      detail: !ctx.probationReview
        ? 'ยังไม่ได้เปิดรอบทดลองงาน'
        : decision === 'pending'
          ? 'อยู่ระหว่างทดลองงาน — ยังไม่บันทึกผล'
          : `บันทึกผลแล้ว (${decision})`,
    });

    // ── นโยบายการลา (tenant-level setup) ──
    systems.push({
      key: 'leavePolicy',
      label: 'นโยบายการลา',
      required: true,
      done: ctx.leavePolicyCount > 0 ? 1 : 0,
      total: 1,
      status: ctx.leavePolicyCount > 0 ? 'complete' : 'missing',
      detail:
        ctx.leavePolicyCount > 0
          ? `มีนโยบายลาที่ใช้งาน ${ctx.leavePolicyCount} นโยบาย`
          : 'ยังไม่มีนโยบายการลาในระบบ',
    });

    // ── Payroll readiness ──
    const payrollChecks = [
      has(ctx.employee.baseSalary),
      has(ctx.employee.bankAccount),
      ctx.payrollPolicyCount > 0,
    ];
    const payrollDone = payrollChecks.filter(Boolean).length;
    const payrollMissing: string[] = [];
    if (!has(ctx.employee.baseSalary)) payrollMissing.push('เงินเดือนพื้นฐาน');
    if (!has(ctx.employee.bankAccount)) payrollMissing.push('เลขบัญชีธนาคาร');
    if (ctx.payrollPolicyCount === 0) payrollMissing.push('นโยบายเงินเดือน');
    systems.push({
      key: 'payroll',
      label: 'ความพร้อมจ่ายเงินเดือน',
      required: true,
      done: payrollDone,
      total: payrollChecks.length,
      status:
        payrollDone === payrollChecks.length ? 'complete' : payrollDone > 0 ? 'partial' : 'missing',
      detail:
        payrollDone === payrollChecks.length
          ? 'พร้อมคำนวณเงินเดือน'
          : `ขาด: ${payrollMissing.join(', ')}`,
    });

    // ── กะ / Roster ──
    systems.push({
      key: 'roster',
      label: 'ตารางเวร (Roster)',
      required: true,
      done: ctx.shiftCount > 0 ? 1 : 0,
      total: 1,
      status: ctx.shiftCount > 0 ? 'complete' : 'missing',
      detail:
        ctx.shiftCount > 0 ? `มีกะที่มอบหมายแล้ว ${ctx.shiftCount} กะ` : 'ยังไม่ได้จัดกะให้พนักงาน',
    });

    // ── การเข้างาน (informational) ──
    systems.push({
      key: 'attendance',
      label: 'การเข้างาน (30 วัน)',
      required: false,
      done: ctx.attendanceCount,
      total: ctx.attendanceCount,
      status: ctx.attendanceCount > 0 ? 'complete' : 'missing',
      detail:
        ctx.attendanceCount > 0
          ? `มีบันทึกเข้างาน ${ctx.attendanceCount} วัน`
          : 'ไม่มีบันทึกเข้างานใน 30 วัน',
    });

    // ── การอบรม (informational) ──
    systems.push({
      key: 'training',
      label: 'การอบรม / ใบรับรอง',
      required: false,
      done: ctx.trainingCount,
      total: ctx.trainingCount,
      status: ctx.trainingCount > 0 ? 'complete' : 'missing',
      detail:
        ctx.trainingCount > 0
          ? `มีประวัติอบรม ${ctx.trainingCount} รายการ`
          : 'ยังไม่มีประวัติการอบรม',
    });

    return systems;
  }
}
