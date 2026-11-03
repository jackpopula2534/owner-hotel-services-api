import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { AuditAction, AuditResource, AuditCategory } from '../../audit-log/dto/audit-log.dto';
import { CreateCandidateDto, UpdateCandidateDto, MakeOfferDto } from './dto/recruitment.dto';

/** Stage 4 (candidates) + stage 5 entry (offer). Hiring itself lives in HireService. */
/**
 * รวมข้อมูลใบสมัครที่ HR แก้กับของเดิม: key ที่ไม่ส่งมาคงค่าเดิม, null = ล้างค่า,
 * array ที่ส่งมาแทนที่ทั้งชุด (ตัดแถวว่างทิ้ง)
 */
export function mergeApplicationData(existing: unknown, patch: object): Record<string, unknown> {
  const base =
    existing && typeof existing === 'object' && !Array.isArray(existing)
      ? (existing as Record<string, unknown>)
      : {};
  const updates = Object.fromEntries(
    Object.entries(patch)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => {
        if (Array.isArray(v)) {
          const rows = v.filter(
            (row) =>
              row &&
              typeof row === 'object' &&
              Object.values(row as Record<string, unknown>).some(
                (x) => x != null && String(x).trim() !== '',
              ),
          );
          return [k, rows];
        }
        if (typeof v === 'string') return [k, v.trim() === '' ? null : v.trim()];
        return [k, v];
      }),
  );
  return { ...base, ...updates };
}

/** ค่าเทียบเท่ากันไหม — ตัวเลข/Decimal เทียบเป็นตัวเลข, ''/undefined = null, object เทียบแบบ JSON */
function normalize(v: unknown): unknown {
  if (v === undefined || v === '') return null;
  if (v !== null && typeof v === 'object' && 'toNumber' in (v as object)) {
    return Number((v as { toString(): string }).toString());
  }
  return v;
}

const sameValue = (a: unknown, b: unknown): boolean => {
  const x = normalize(a);
  const y = normalize(b);
  if (typeof x === 'number' || typeof y === 'number') return Number(x) === Number(y);
  return JSON.stringify(x) === JSON.stringify(y);
};

/**
 * เทียบข้อมูลเดิมกับข้อมูลที่จะบันทึก — คืนเฉพาะ field ที่เปลี่ยนจริง
 * applicationData ถูกแตกเป็น `applicationData.<key>` เพื่อให้ log อ่านง่ายว่าแก้ช่องไหน
 */
export function candidateDiff(
  existing: Record<string, any>,
  data: Record<string, unknown>,
): { fields: string[]; oldValues: Record<string, unknown>; newValues: Record<string, unknown> } {
  const oldValues: Record<string, unknown> = {};
  const newValues: Record<string, unknown> = {};
  for (const [key, next] of Object.entries(data)) {
    if (key === 'applicationData') {
      const before = (existing.applicationData ?? {}) as Record<string, unknown>;
      const after = (next ?? {}) as Record<string, unknown>;
      for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
        if (!sameValue(before[k], after[k])) {
          oldValues[`applicationData.${k}`] = normalize(before[k]);
          newValues[`applicationData.${k}`] = normalize(after[k]);
        }
      }
      continue;
    }
    if (!sameValue(existing[key], next)) {
      oldValues[key] = normalize(existing[key]);
      newValues[key] = normalize(next);
    }
  }
  return { fields: Object.keys(newValues), oldValues, newValues };
}

@Injectable()
export class CandidateService {
  private readonly logger = new Logger(CandidateService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  private audit(
    action: AuditAction,
    resourceId: string,
    tenantId: string,
    userId: string,
    description: string,
    values?: { oldValues: Record<string, unknown>; newValues: Record<string, unknown> },
  ): void {
    this.auditLog
      .log({
        action,
        resource: AuditResource.CANDIDATE,
        resourceId,
        category: AuditCategory.HR,
        tenantId,
        userId,
        description,
        ...(values ?? {}),
      })
      .catch((err: Error) => this.logger.error(`Audit log failed: ${err.message}`));
  }

  async findAll(query: Record<string, string>, tenantId: string) {
    const where: Record<string, unknown> = { tenantId };
    if (query.manpowerRequestId) where['manpowerRequestId'] = query.manpowerRequestId;
    if (query.status) where['status'] = query.status;
    const data = await (this.prisma as any).hrCandidate.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        interviews: { orderBy: [{ round: 'asc' }, { scheduledAt: 'asc' }] },
        hireRecord: true,
        manpowerRequest: {
          select: { id: true, requestNo: true, positionTitle: true, status: true },
        },
      },
    });
    return { data, total: data.length };
  }

  async findOne(id: string, tenantId: string) {
    const candidate = await (this.prisma as any).hrCandidate.findFirst({
      where: { id, tenantId },
      include: {
        interviews: { orderBy: [{ round: 'asc' }, { scheduledAt: 'asc' }] },
        // แนบสถานะพนักงานที่ถูกสร้าง (PENDING_START → PROBATION) เพื่อให้ frontend รู้ว่าเริ่มงาน/เปิดทดลองงานแล้ว
        hireRecord: {
          include: { employee: { select: { id: true, status: true, startDate: true } } },
        },
        manpowerRequest: {
          select: { id: true, requestNo: true, positionTitle: true, status: true },
        },
      },
    });
    if (!candidate) throw new NotFoundException(`Candidate ${id} not found`);
    return candidate;
  }

  async create(
    manpowerRequestId: string,
    dto: CreateCandidateDto,
    tenantId: string,
    userId: string,
  ) {
    const manpower = await (this.prisma as any).hrManpowerRequest.findFirst({
      where: { id: manpowerRequestId, tenantId },
    });
    if (!manpower) throw new NotFoundException(`Manpower request ${manpowerRequestId} not found`);
    if (!['recruiting', 'interviewing'].includes(manpower.status)) {
      throw new BadRequestException(
        `Cannot add candidates while the request is "${manpower.status}"`,
      );
    }
    const candidate = await (this.prisma as any).hrCandidate.create({
      data: {
        tenantId,
        manpowerRequestId,
        firstName: dto.firstName,
        lastName: dto.lastName,
        email: dto.email ?? null,
        phone: dto.phone ?? null,
        resumeUrl: dto.resumeUrl ?? null,
        source: dto.source ?? null,
        expectedSalary: dto.expectedSalary ?? null,
        note: dto.note ?? null,
        status: 'applied',
      },
    });
    this.audit(
      AuditAction.CREATE,
      candidate.id,
      tenantId,
      userId,
      `Candidate ${dto.firstName} ${dto.lastName} added to ${manpower.requestNo}`,
    );
    return candidate;
  }

  async update(id: string, dto: UpdateCandidateDto, tenantId: string, userId: string) {
    const existing = await this.findOne(id, tenantId);
    if (existing.status === 'hired') throw new BadRequestException('Cannot edit a hired candidate');
    const statusReason = dto.statusReason?.trim() || null;
    const closing = dto.status === 'rejected' || dto.status === 'withdrawn';
    if (closing && dto.status !== existing.status && !statusReason) {
      throw new BadRequestException(
        dto.status === 'withdrawn' ? 'ต้องระบุเหตุผลที่ผู้สมัครถอนตัว' : 'ต้องระบุเหตุผลที่ไม่ผ่าน',
      );
    }

    // เรซูเม่หลัก = ไฟล์ kind 'resume' ไฟล์แรกในชุดไฟล์แนบที่ส่งมา (ถ้าไม่ได้ระบุ resumeUrl ตรง ๆ)
    const resumeFromAttachments =
      dto.attachments !== undefined && dto.resumeUrl === undefined
        ? (dto.attachments.find((a) => a.kind === 'resume')?.url ?? null)
        : undefined;

    const data: Record<string, unknown> = {
      ...(dto.firstName !== undefined && { firstName: dto.firstName }),
      ...(dto.lastName !== undefined && { lastName: dto.lastName }),
      ...(dto.email !== undefined && { email: dto.email }),
      ...(dto.phone !== undefined && { phone: dto.phone }),
      ...(dto.resumeUrl !== undefined && { resumeUrl: dto.resumeUrl }),
      ...(resumeFromAttachments !== undefined && { resumeUrl: resumeFromAttachments }),
      ...(dto.source !== undefined && { source: dto.source }),
      ...(dto.expectedSalary !== undefined && { expectedSalary: dto.expectedSalary }),
      ...(dto.note !== undefined && { note: dto.note }),
      ...(dto.status !== undefined && { status: dto.status }),
      ...(closing && statusReason && { statusReason }),
      ...(dto.attachments !== undefined && { attachments: dto.attachments }),
      ...(dto.applicationData !== undefined && {
        applicationData: mergeApplicationData(existing.applicationData, dto.applicationData),
      }),
    };

    const diff = candidateDiff(existing, data);
    if (diff.fields.length === 0) return existing; // ไม่มีอะไรเปลี่ยน — ไม่เขียน ไม่บันทึก log

    const updated = await (this.prisma as any).hrCandidate.update({ where: { id }, data });
    this.audit(
      AuditAction.UPDATE,
      id,
      tenantId,
      userId,
      closing && dto.status !== existing.status
        ? `${dto.status === 'withdrawn' ? 'ผู้สมัครถอนตัว' : 'ไม่ผ่าน'}: ${statusReason}`
        : `แก้ไขข้อมูลผู้สมัคร: ${diff.fields.join(', ')}`,
      { oldValues: diff.oldValues, newValues: diff.newValues },
    );
    return updated;
  }

  /**
   * ประวัติการเปลี่ยนแปลงของผู้สมัคร (จาก audit log) — ใหม่สุดก่อน
   * แต่ละรายการมีรายการ field ที่เปลี่ยน (ค่าเดิม → ค่าใหม่) และชื่อผู้แก้
   */
  async getHistory(id: string, tenantId: string) {
    const candidate = await this.findOne(id, tenantId);
    // รวมประวัติของสัมภาษณ์ทุกรอบ (นัด / เลื่อน / ยกเลิก / ไม่มา / ผล) เข้ากับประวัติผู้สมัคร
    const interviewIds: string[] = (candidate.interviews ?? []).map((iv: { id: string }) => iv.id);
    const logs: Array<Record<string, any>> = await (this.prisma as any).auditLog.findMany({
      where: {
        tenantId,
        OR: [
          { resource: AuditResource.CANDIDATE, resourceId: id },
          ...(interviewIds.length
            ? [{ resource: AuditResource.INTERVIEW, resourceId: { in: interviewIds } }]
            : []),
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const userIds = [...new Set(logs.map((l) => l.userId).filter(Boolean))] as string[];
    const users: Array<{
      id: string;
      firstName: string | null;
      lastName: string | null;
      email: string;
    }> = userIds.length
      ? await (this.prisma as any).user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, firstName: true, lastName: true, email: true },
        })
      : [];
    const nameOf = new Map(
      users.map((u) => [u.id, [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email]),
    );

    return logs.map((l) => {
      const oldValues = (l.oldValues ?? {}) as Record<string, unknown>;
      const newValues = (l.newValues ?? {}) as Record<string, unknown>;
      const reason = typeof newValues.reason === 'string' ? newValues.reason : null;
      const fields = [...new Set([...Object.keys(oldValues), ...Object.keys(newValues)])].filter(
        (f) => f !== 'reason' && f !== 'statusReason',
      );
      return {
        id: l.id,
        kind: l.resource === AuditResource.INTERVIEW ? 'interview' : 'candidate',
        reason:
          reason ?? (typeof newValues.statusReason === 'string' ? newValues.statusReason : null),
        action: l.action,
        description: l.description ?? null,
        createdAt: l.createdAt,
        user: l.userId ? { id: l.userId, name: nameOf.get(l.userId) ?? null } : null,
        changes: fields.map((field) => ({
          field,
          from: oldValues[field] ?? null,
          to: newValues[field] ?? null,
        })),
      };
    });
  }

  /** Stage 5: make an offer (sets start date/time + probation length). */
  async makeOffer(id: string, dto: MakeOfferDto, tenantId: string, userId: string) {
    const candidate = await this.findOne(id, tenantId);
    if (candidate.status !== 'interviewed') {
      throw new BadRequestException(
        `Offer requires an "interviewed" candidate (current: "${candidate.status}")`,
      );
    }
    if (candidate.hireRecord) throw new BadRequestException('Candidate already has an offer');

    const hireRecord = await this.prisma.$transaction(async (tx: any) => {
      const created = await tx.hrHireRecord.create({
        data: {
          tenantId,
          candidateId: id,
          offeredSalary: dto.offeredSalary,
          probationPositionBonus: dto.probationPositionBonus ?? null,
          probationAllowance: dto.probationAllowance ?? null,
          postProbationSalary: dto.postProbationSalary ?? null,
          postProbationPositionBonus: dto.postProbationPositionBonus ?? null,
          postProbationAllowance: dto.postProbationAllowance ?? null,
          startDate: new Date(dto.startDate),
          startTime: dto.startTime ?? null,
          probationDays: dto.probationDays ?? 90,
          offerStatus: 'offered',
          offerSentAt: new Date(),
        },
      });
      await tx.hrCandidate.update({ where: { id }, data: { status: 'offer_made' } });
      // คำขอหลายอัตรา: เลื่อนใบ → "offer_made" เฉพาะเมื่อเสนอจ้างครบทุกอัตราแล้ว ไม่ใช่คนแรกที่ได้
      // offer แล้วใบเดินขั้นทันที — ถ้ายังไม่ครบ คงค้างขั้นสรรหา/สัมภาษณ์ให้ไปหาคนที่เหลือก่อน
      await this.advanceToOfferMadeIfAllOffered(tx, candidate.manpowerRequestId, tenantId);
      return created;
    });
    this.audit(
      AuditAction.OFFER_MADE,
      id,
      tenantId,
      userId,
      `Offer made: ${dto.offeredSalary}, start ${dto.startDate} ${dto.startTime ?? ''}`,
    );
    return hireRecord;
  }

  /**
   * เลื่อนคำขอ (recruiting/interviewing → offer_made) เฉพาะเมื่อ "ทุกอัตรา" ได้รับ offer แล้ว
   * (รับหลายคน: ตราบใดยังมีอัตราที่ยังไม่ได้เสนอจ้าง ใบจะยังไม่เดินไปขั้นเสนอจ้าง/จ้าง — กันใบ
   * กระโดดขั้นเพราะผู้สมัครคนเดียวได้ offer) เรียกภายใน transaction ของ makeOffer หลังอัปเดต candidate
   */
  private async advanceToOfferMadeIfAllOffered(
    tx: any,
    manpowerRequestId: string,
    tenantId: string,
  ): Promise<void> {
    const request = await tx.hrManpowerRequest.findFirst({
      where: { id: manpowerRequestId, tenantId },
      select: { headcount: true },
    });
    if (!request) return;
    const headcount = request.headcount ?? 1;
    const offeredCount = await tx.hrCandidate.count({
      where: {
        tenantId,
        manpowerRequestId,
        status: { in: ['offer_made', 'offer_accepted', 'hired'] },
      },
    });
    if (offeredCount < headcount) return;
    await tx.hrManpowerRequest.updateMany({
      where: { id: manpowerRequestId, status: { in: ['recruiting', 'interviewing'] } },
      data: { status: 'offer_made' },
    });
  }

  async declineOffer(id: string, tenantId: string, userId: string) {
    const candidate = await this.findOne(id, tenantId);
    if (!candidate.hireRecord || candidate.hireRecord.offerStatus !== 'offered') {
      throw new BadRequestException('No pending offer to decline');
    }
    await this.prisma.$transaction([
      (this.prisma as any).hrHireRecord.update({
        where: { id: candidate.hireRecord.id },
        data: { offerStatus: 'declined' },
      }),
      (this.prisma as any).hrCandidate.update({ where: { id }, data: { status: 'withdrawn' } }),
      (this.prisma as any).hrManpowerRequest.update({
        where: { id: candidate.manpowerRequestId },
        data: { status: 'recruiting' },
      }),
    ]);
    this.audit(AuditAction.UPDATE, id, tenantId, userId, 'Offer declined by candidate');
    return this.findOne(id, tenantId);
  }
}
