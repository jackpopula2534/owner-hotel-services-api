import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { AuditAction, AuditResource, AuditCategory } from '../../audit-log/dto/audit-log.dto';
import { UpsertJobPostingDto, PublicApplicationDto } from './dto/recruitment.dto';

/** สถานะ manpower request ที่อนุญาตให้เปิด/แก้ประกาศ public ได้ (หลังอนุมัติงบ). */
const POSTABLE_STATUSES = ['recruiting', 'interviewing'];

interface JobPostingRecord {
  status: string;
  openAt: Date | null;
  closeAt: Date | null;
}

/**
 * Public job posting (ประกาศรับสมัครสาธารณะ) — ผูก 1:1 กับ manpower request.
 * ฝั่ง dashboard: สร้าง/เผยแพร่/ปิด. ฝั่ง public: ดูประกาศ + ยื่นใบสมัคร (ไม่ต้อง login).
 * ใบสมัครกลายเป็น HrCandidate (source = public_form) เข้า pipeline เดิม.
 */
@Injectable()
export class JobPostingService {
  private readonly logger = new Logger(JobPostingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  private audit(
    action: AuditAction,
    resource: AuditResource,
    resourceId: string,
    tenantId: string,
    userId: string,
    description: string,
  ): void {
    this.auditLog
      .log({ action, resource, resourceId, category: AuditCategory.HR, tenantId, userId, description })
      .catch((err: Error) => this.logger.error(`Audit log failed: ${err.message}`));
  }

  /** ประกาศเปิดรับอยู่จริงหรือไม่ ณ เวลานี้ (เผยแพร่แล้ว + อยู่ในช่วง open/close). */
  isWindowOpen(posting: JobPostingRecord, now: Date = new Date()): boolean {
    if (posting.status !== 'published') return false;
    if (posting.openAt && now < posting.openAt) return false;
    if (posting.closeAt && now > posting.closeAt) return false;
    return true;
  }

  // ── Dashboard side (authenticated) ─────────────────────────────────────────

  async getForRequest(manpowerRequestId: string, tenantId: string) {
    const posting = await (this.prisma as any).hrJobPosting.findFirst({
      where: { manpowerRequestId, tenantId },
    });
    if (!posting) return null;
    const applicantCount = await (this.prisma as any).hrCandidate.count({
      where: { tenantId, manpowerRequestId, source: 'public_form' },
    });
    return { ...posting, applicantCount, isOpen: this.isWindowOpen(posting) };
  }

  async upsert(manpowerRequestId: string, dto: UpsertJobPostingDto, tenantId: string, userId: string) {
    const manpower = await (this.prisma as any).hrManpowerRequest.findFirst({
      where: { id: manpowerRequestId, tenantId },
    });
    if (!manpower) throw new NotFoundException(`Manpower request ${manpowerRequestId} not found`);
    if (!POSTABLE_STATUSES.includes(manpower.status)) {
      throw new BadRequestException(`เปิดประกาศได้หลังอนุมัติงบเท่านั้น (สถานะปัจจุบัน: "${manpower.status}")`);
    }
    if (dto.openAt && dto.closeAt && new Date(dto.openAt) >= new Date(dto.closeAt)) {
      throw new BadRequestException('เวลาเปิดรับต้องอยู่ก่อนเวลาปิดรับ');
    }

    const existing = await (this.prisma as any).hrJobPosting.findUnique({ where: { manpowerRequestId } });
    const data = {
      title: dto.title,
      description: dto.description ?? null,
      location: dto.location ?? null,
      employmentType: dto.employmentType ?? manpower.employmentType ?? null,
      salaryRangeText: dto.salaryRangeText ?? null,
      openAt: dto.openAt ? new Date(dto.openAt) : null,
      closeAt: dto.closeAt ? new Date(dto.closeAt) : null,
    };

    if (existing) {
      const updated = await (this.prisma as any).hrJobPosting.update({ where: { id: existing.id }, data });
      this.audit(AuditAction.UPDATE, AuditResource.MANPOWER_REQUEST, updated.id, tenantId, userId, `Job posting updated for ${manpower.requestNo}`);
      return updated;
    }

    const created = await (this.prisma as any).hrJobPosting.create({
      data: {
        ...data,
        tenantId,
        propertyId: manpower.propertyId ?? null,
        manpowerRequestId,
        publicToken: randomBytes(16).toString('hex'),
        status: 'draft',
        createdBy: userId,
      },
    });
    this.audit(AuditAction.CREATE, AuditResource.MANPOWER_REQUEST, created.id, tenantId, userId, `Job posting created for ${manpower.requestNo}`);
    return created;
  }

  async publish(manpowerRequestId: string, tenantId: string, userId: string) {
    const posting = await this.requirePosting(manpowerRequestId, tenantId);
    if (posting.status === 'published') return posting;
    const updated = await (this.prisma as any).hrJobPosting.update({
      where: { id: posting.id },
      data: { status: 'published', publishedAt: new Date(), closedAt: null },
    });
    this.audit(AuditAction.UPDATE, AuditResource.MANPOWER_REQUEST, posting.id, tenantId, userId, 'Job posting published');
    return updated;
  }

  async close(manpowerRequestId: string, tenantId: string, userId: string) {
    const posting = await this.requirePosting(manpowerRequestId, tenantId);
    const updated = await (this.prisma as any).hrJobPosting.update({
      where: { id: posting.id },
      data: { status: 'closed', closedAt: new Date() },
    });
    this.audit(AuditAction.UPDATE, AuditResource.MANPOWER_REQUEST, posting.id, tenantId, userId, 'Job posting closed');
    return updated;
  }

  private async requirePosting(manpowerRequestId: string, tenantId: string) {
    const posting = await (this.prisma as any).hrJobPosting.findFirst({ where: { manpowerRequestId, tenantId } });
    if (!posting) throw new NotFoundException('ยังไม่มีประกาศรับสมัครสำหรับคำขอนี้');
    return posting;
  }

  // ── Public side (no auth) ──────────────────────────────────────────────────

  /** หาประกาศจาก token พร้อมข้อมูลที่ปลอดภัยสำหรับแสดงผลสาธารณะ. */
  async getPublicByToken(token: string) {
    const posting = await (this.prisma as any).hrJobPosting.findUnique({
      where: { publicToken: token },
      include: { manpowerRequest: { select: { positionTitle: true } } },
    });
    if (!posting || posting.status === 'draft') {
      throw new NotFoundException('ไม่พบประกาศรับสมัคร');
    }
    return {
      token: posting.publicToken,
      title: posting.title,
      positionTitle: posting.manpowerRequest?.positionTitle ?? posting.title,
      description: posting.description,
      location: posting.location,
      employmentType: posting.employmentType,
      salaryRangeText: posting.salaryRangeText,
      openAt: posting.openAt,
      closeAt: posting.closeAt,
      isOpen: this.isWindowOpen(posting),
    };
  }

  /** โหลดประกาศจาก token แล้วการันตีว่ายังเปิดรับอยู่ (ใช้ก่อน apply/upload). */
  async requireOpenPosting(token: string) {
    const posting = await (this.prisma as any).hrJobPosting.findUnique({ where: { publicToken: token } });
    if (!posting || posting.status === 'draft') throw new NotFoundException('ไม่พบประกาศรับสมัคร');
    if (!this.isWindowOpen(posting)) throw new BadRequestException('ปิดรับสมัครแล้ว');
    return posting;
  }

  async submitApplication(token: string, dto: PublicApplicationDto) {
    if (dto.consentGiven !== true) {
      throw new BadRequestException('ต้องยินยอมเงื่อนไขการเก็บข้อมูล (PDPA) ก่อนส่งใบสมัคร');
    }
    const posting = await this.requireOpenPosting(token);

    const applicationData = {
      nickname: dto.nickname ?? null,
      nationalId: dto.nationalId ?? null,
      dateOfBirth: dto.dateOfBirth ?? null,
      gender: dto.gender ?? null,
      address: dto.address ?? null,
      bankName: dto.bankName ?? null,
      bankAccount: dto.bankAccount ?? null,
      taxId: dto.taxId ?? null,
      socialSecurity: dto.socialSecurity ?? null,
      educations: dto.educations ?? [],
      workExperiences: dto.workExperiences ?? [],
      emergencyContacts: dto.emergencyContacts ?? [],
    };

    const resume = (dto.attachments ?? []).find((a) => a.kind === 'resume');

    const candidate = await (this.prisma as any).hrCandidate.create({
      data: {
        tenantId: posting.tenantId,
        manpowerRequestId: posting.manpowerRequestId,
        jobPostingId: posting.id,
        firstName: dto.firstName,
        lastName: dto.lastName,
        email: dto.email ?? null,
        phone: dto.phone ?? null,
        resumeUrl: resume?.url ?? null,
        source: 'public_form',
        expectedSalary: dto.expectedSalary ?? null,
        note: dto.note ?? null,
        status: 'applied',
        applicationData,
        attachments: dto.attachments ?? [],
        consentGiven: true,
        consentAt: new Date(),
      },
    });

    this.audit(
      AuditAction.CREATE,
      AuditResource.CANDIDATE,
      candidate.id,
      posting.tenantId,
      'public',
      `Public application from ${dto.firstName} ${dto.lastName} via job posting`,
    );
    return { id: candidate.id, status: 'applied' };
  }
}
