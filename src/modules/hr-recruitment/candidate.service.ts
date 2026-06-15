import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { AuditAction, AuditResource, AuditCategory } from '../../audit-log/dto/audit-log.dto';
import { CreateCandidateDto, UpdateCandidateDto, MakeOfferDto } from './dto/recruitment.dto';

/** Stage 4 (candidates) + stage 5 entry (offer). Hiring itself lives in HireService. */
@Injectable()
export class CandidateService {
  private readonly logger = new Logger(CandidateService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  private audit(action: AuditAction, resourceId: string, tenantId: string, userId: string, description: string): void {
    this.auditLog
      .log({ action, resource: AuditResource.CANDIDATE, resourceId, category: AuditCategory.HR, tenantId, userId, description })
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
        manpowerRequest: { select: { id: true, requestNo: true, positionTitle: true, status: true } },
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
        hireRecord: { include: { employee: { select: { id: true, status: true, startDate: true } } } },
        manpowerRequest: { select: { id: true, requestNo: true, positionTitle: true, status: true } },
      },
    });
    if (!candidate) throw new NotFoundException(`Candidate ${id} not found`);
    return candidate;
  }

  async create(manpowerRequestId: string, dto: CreateCandidateDto, tenantId: string, userId: string) {
    const manpower = await (this.prisma as any).hrManpowerRequest.findFirst({
      where: { id: manpowerRequestId, tenantId },
    });
    if (!manpower) throw new NotFoundException(`Manpower request ${manpowerRequestId} not found`);
    if (!['recruiting', 'interviewing'].includes(manpower.status)) {
      throw new BadRequestException(`Cannot add candidates while the request is "${manpower.status}"`);
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
    this.audit(AuditAction.CREATE, candidate.id, tenantId, userId, `Candidate ${dto.firstName} ${dto.lastName} added to ${manpower.requestNo}`);
    return candidate;
  }

  async update(id: string, dto: UpdateCandidateDto, tenantId: string, userId: string) {
    const existing = await this.findOne(id, tenantId);
    if (existing.status === 'hired') throw new BadRequestException('Cannot edit a hired candidate');
    const updated = await (this.prisma as any).hrCandidate.update({
      where: { id },
      data: {
        ...(dto.firstName !== undefined && { firstName: dto.firstName }),
        ...(dto.lastName !== undefined && { lastName: dto.lastName }),
        ...(dto.email !== undefined && { email: dto.email }),
        ...(dto.phone !== undefined && { phone: dto.phone }),
        ...(dto.resumeUrl !== undefined && { resumeUrl: dto.resumeUrl }),
        ...(dto.source !== undefined && { source: dto.source }),
        ...(dto.expectedSalary !== undefined && { expectedSalary: dto.expectedSalary }),
        ...(dto.note !== undefined && { note: dto.note }),
        ...(dto.status !== undefined && { status: dto.status }),
      },
    });
    this.audit(AuditAction.UPDATE, id, tenantId, userId, 'Candidate updated');
    return updated;
  }

  /** Stage 5: make an offer (sets start date/time + probation length). */
  async makeOffer(id: string, dto: MakeOfferDto, tenantId: string, userId: string) {
    const candidate = await this.findOne(id, tenantId);
    if (candidate.status !== 'interviewed') {
      throw new BadRequestException(`Offer requires an "interviewed" candidate (current: "${candidate.status}")`);
    }
    if (candidate.hireRecord) throw new BadRequestException('Candidate already has an offer');

    const hireRecord = await this.prisma.$transaction(async (tx: any) => {
      const created = await tx.hrHireRecord.create({
        data: {
          tenantId,
          candidateId: id,
          offeredSalary: dto.offeredSalary,
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
    this.audit(AuditAction.OFFER_MADE, id, tenantId, userId, `Offer made: ${dto.offeredSalary}, start ${dto.startDate} ${dto.startTime ?? ''}`);
    return hireRecord;
  }

  /**
   * เลื่อนคำขอ (recruiting/interviewing → offer_made) เฉพาะเมื่อ "ทุกอัตรา" ได้รับ offer แล้ว
   * (รับหลายคน: ตราบใดยังมีอัตราที่ยังไม่ได้เสนอจ้าง ใบจะยังไม่เดินไปขั้นเสนอจ้าง/จ้าง — กันใบ
   * กระโดดขั้นเพราะผู้สมัครคนเดียวได้ offer) เรียกภายใน transaction ของ makeOffer หลังอัปเดต candidate
   */
  private async advanceToOfferMadeIfAllOffered(tx: any, manpowerRequestId: string, tenantId: string): Promise<void> {
    const request = await tx.hrManpowerRequest.findFirst({
      where: { id: manpowerRequestId, tenantId },
      select: { headcount: true },
    });
    if (!request) return;
    const headcount = request.headcount ?? 1;
    const offeredCount = await tx.hrCandidate.count({
      where: { tenantId, manpowerRequestId, status: { in: ['offer_made', 'offer_accepted', 'hired'] } },
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
