import {
  BadRequestException,
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, RfqStatus } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { EmailService } from '@/email/email.service';
import { SupplierPortalService } from '../supplier-portal/supplier-portal.service';
import {
  CancelRfqDto,
  CreateRfqDto,
  ExtendDeadlineDto,
  QueryRfqDto,
  QuickRfqFromPrDto,
  UpdateRfqDto,
} from './dto';

interface RfqListItem {
  id: string;
  rfqNumber: string;
  status: RfqStatus;
  round: number;
  subject: string | null;
  issuedAt: Date | null;
  deadline: Date | null;
  createdAt: Date;
  prCount: number;
  recipientCount: number;
  responseCount: number;
}

@Injectable()
export class RfqsService {
  private readonly logger = new Logger(RfqsService.name);

  constructor(
    private readonly prisma: PrismaService,
    // forwardRef breaks the SupplierPortal ↔ Rfqs cycle (SupplierQuotesModule
    // sits between the two). See rfqs.module.ts for the matching import.
    @Inject(forwardRef(() => SupplierPortalService))
    private readonly supplierPortalService: SupplierPortalService,
    private readonly emailService: EmailService,
  ) {}

  async create(
    tenantId: string,
    userId: string,
    dto: CreateRfqDto,
  ): Promise<{ id: string; rfqNumber: string; status: RfqStatus }> {
    const sendImmediately = dto.sendImmediately ?? false;

    const result = await this.prisma.$transaction(async (tx) => {
      // Validate PRs exist and belong to tenant
      const prs = await tx.purchaseRequisition.findMany({
        where: {
          id: { in: dto.purchaseRequisitionIds },
          tenantId,
        },
        select: { id: true, status: true },
      });
      if (prs.length !== dto.purchaseRequisitionIds.length) {
        throw new NotFoundException('พบ PR บางรายการไม่ถูกต้อง');
      }
      const invalidPr = prs.find(
        (pr) =>
          pr.status !== 'APPROVED' &&
          pr.status !== 'PENDING_QUOTES' &&
          pr.status !== 'QUOTES_RECEIVED',
      );
      if (invalidPr) {
        throw new BadRequestException(
          `PR ${invalidPr.id} มีสถานะ ${invalidPr.status} ไม่สามารถขอใบเสนอราคาได้`,
        );
      }

      // Validate suppliers
      const suppliers = await tx.supplier.findMany({
        where: { id: { in: dto.supplierIds }, tenantId, deletedAt: null },
        select: { id: true },
      });
      if (suppliers.length !== dto.supplierIds.length) {
        throw new NotFoundException('พบซัพพลายเออร์บางรายไม่ถูกต้อง');
      }

      const rfqNumber = await this.generateRfqNumber(tenantId, tx);

      const rfq = await tx.requestForQuotation.create({
        data: {
          tenantId,
          propertyId: dto.propertyId,
          rfqNumber,
          status: sendImmediately ? RfqStatus.SENT : RfqStatus.DRAFT,
          round: 1,
          subject: dto.subject ?? null,
          coverLetter: dto.coverLetter ?? null,
          customTerms: dto.customTerms ?? null,
          templateId: dto.templateId ?? null,
          deadline: dto.deadline ? new Date(dto.deadline) : null,
          issuedAt: sendImmediately ? new Date() : null,
          createdBy: userId,
          prLinks: {
            create: dto.purchaseRequisitionIds.map((prId) => ({
              purchaseRequisitionId: prId,
            })),
          },
          recipients: {
            create: dto.supplierIds.map((supplierId) => ({
              supplierId,
              sentAt: sendImmediately ? new Date() : null,
            })),
          },
        },
        select: { id: true, rfqNumber: true, status: true },
      });

      // Update PR status when sending
      if (sendImmediately) {
        await tx.purchaseRequisition.updateMany({
          where: {
            id: { in: dto.purchaseRequisitionIds },
            tenantId,
            status: { in: ['APPROVED'] },
          },
          data: { status: 'PENDING_QUOTES' },
        });

        // Create empty SupplierQuote skeletons (one per supplier × PR)
        await this.sproutSupplierQuotes(tx, {
          tenantId,
          rfqId: rfq.id,
          round: 1,
          purchaseRequisitionIds: dto.purchaseRequisitionIds,
          supplierIds: dto.supplierIds,
        });
      }

      return rfq;
    });

    // Email dispatch happens AFTER the transaction commits so a slow SMTP
    // round-trip can't hold the DB connection / lock the transaction.
    if (sendImmediately) {
      await this.dispatchInvitations(tenantId, result.id).catch((err) => {
        this.logger.error(
          `Failed to dispatch RFQ invitations for ${result.id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });
    }

    return result;
  }

  async quickFromPr(
    tenantId: string,
    userId: string,
    dto: QuickRfqFromPrDto,
  ): Promise<{ id: string; rfqNumber: string; status: RfqStatus }> {
    const pr = await this.prisma.purchaseRequisition.findFirst({
      where: { id: dto.purchaseRequisitionId, tenantId },
      select: { id: true, propertyId: true, status: true },
    });
    if (!pr) throw new NotFoundException('ไม่พบ PR');

    return this.create(tenantId, userId, {
      propertyId: pr.propertyId,
      purchaseRequisitionIds: [pr.id],
      supplierIds: dto.supplierIds,
      deadline: dto.deadline,
      subject: dto.notes,
      sendImmediately: true,
    });
  }

  async findAll(
    tenantId: string,
    query: QueryRfqDto,
  ): Promise<{
    data: RfqListItem[];
    meta: { page: number; limit: number; total: number };
  }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Prisma.RequestForQuotationWhereInput = {
      tenantId,
      ...(query.propertyId && { propertyId: query.propertyId }),
      ...(query.status && { status: query.status }),
      ...(query.search && {
        OR: [{ rfqNumber: { contains: query.search } }, { subject: { contains: query.search } }],
      }),
      ...(query.supplierId && {
        recipients: { some: { supplierId: query.supplierId } },
      }),
      ...(query.purchaseRequisitionId && {
        prLinks: {
          some: { purchaseRequisitionId: query.purchaseRequisitionId },
        },
      }),
    };

    const [rows, total] = await Promise.all([
      this.prisma.requestForQuotation.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          rfqNumber: true,
          status: true,
          round: true,
          subject: true,
          issuedAt: true,
          deadline: true,
          createdAt: true,
          _count: {
            select: {
              prLinks: true,
              recipients: true,
              supplierQuotes: true,
            },
          },
        },
      }),
      this.prisma.requestForQuotation.count({ where }),
    ]);

    const data: RfqListItem[] = rows.map((row) => ({
      id: row.id,
      rfqNumber: row.rfqNumber,
      status: row.status,
      round: row.round,
      subject: row.subject,
      issuedAt: row.issuedAt,
      deadline: row.deadline,
      createdAt: row.createdAt,
      prCount: row._count.prLinks,
      recipientCount: row._count.recipients,
      responseCount: row._count.supplierQuotes,
    }));

    return { data, meta: { page, limit, total } };
  }

  async findOne(id: string, tenantId: string): Promise<unknown> {
    const rfq = await this.prisma.requestForQuotation.findFirst({
      where: { id, tenantId },
      include: {
        prLinks: {
          include: {
            purchaseRequisition: {
              select: {
                id: true,
                prNumber: true,
                status: true,
                requiredDate: true,
                department: true,
                _count: { select: { items: true } },
              },
            },
          },
        },
        recipients: {
          include: {
            supplier: {
              select: {
                id: true,
                name: true,
                contactPerson: true,
                email: true,
                phone: true,
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
        supplierQuotes: {
          select: {
            id: true,
            supplierId: true,
            status: true,
            totalAmount: true,
            receivedAt: true,
          },
        },
        parentRfq: { select: { id: true, rfqNumber: true, round: true } },
        childRfqs: {
          select: { id: true, rfqNumber: true, round: true, status: true },
        },
      },
    });
    if (!rfq) throw new NotFoundException('ไม่พบ RFQ');
    return rfq;
  }

  async update(id: string, tenantId: string, dto: UpdateRfqDto): Promise<unknown> {
    const rfq = await this.ensureExists(id, tenantId);
    if (rfq.status !== RfqStatus.DRAFT) {
      throw new BadRequestException('แก้ไขได้เฉพาะ RFQ ที่อยู่ในสถานะ DRAFT');
    }
    return this.prisma.requestForQuotation.update({
      where: { id },
      data: {
        subject: dto.subject ?? undefined,
        coverLetter: dto.coverLetter ?? undefined,
        customTerms: dto.customTerms ?? undefined,
        deadline: dto.deadline ? new Date(dto.deadline) : undefined,
      },
    });
  }

  async send(id: string, tenantId: string): Promise<unknown> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const rfq = await tx.requestForQuotation.findFirst({
        where: { id, tenantId },
        include: { prLinks: true, recipients: true },
      });
      if (!rfq) throw new NotFoundException('ไม่พบ RFQ');
      if (rfq.status !== RfqStatus.DRAFT) {
        throw new BadRequestException('ส่งได้เฉพาะ RFQ สถานะ DRAFT');
      }
      if (rfq.recipients.length === 0) {
        throw new BadRequestException('ต้องมีซัพพลายเออร์อย่างน้อย 1 ราย');
      }

      const now = new Date();
      await tx.rfqSupplierRecipient.updateMany({
        where: { requestForQuotationId: id, sentAt: null },
        data: { sentAt: now },
      });

      const updated = await tx.requestForQuotation.update({
        where: { id },
        data: { status: RfqStatus.SENT, issuedAt: now },
      });

      const prIds = rfq.prLinks.map((link) => link.purchaseRequisitionId);
      if (prIds.length > 0) {
        await tx.purchaseRequisition.updateMany({
          where: { id: { in: prIds }, tenantId, status: 'APPROVED' },
          data: { status: 'PENDING_QUOTES' },
        });
      }

      await this.sproutSupplierQuotes(tx, {
        tenantId,
        rfqId: id,
        round: rfq.round,
        purchaseRequisitionIds: prIds,
        supplierIds: rfq.recipients.map((r) => r.supplierId),
      });

      return updated;
    });

    await this.dispatchInvitations(tenantId, id).catch((err) => {
      this.logger.error(
        `Failed to dispatch RFQ invitations for ${id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    });

    return updated;
  }

  /**
   * Generate magic-link tokens for every recipient that has an email and
   * kick off the invitation emails (queued via EmailService / Bull).
   * Called after send() / create(sendImmediately) + by admin resend.
   */
  async dispatchInvitations(tenantId: string, rfqId: string): Promise<void> {
    const rfq = await this.prisma.requestForQuotation.findFirst({
      where: { id: rfqId, tenantId },
      select: {
        rfqNumber: true,
        subject: true,
        coverLetter: true,
        customTerms: true,
        deadline: true,
      },
    });
    if (!rfq) return;

    const results = await this.supplierPortalService.generateTokensForRfq(tenantId, rfqId);

    const deadlineStr = rfq.deadline
      ? rfq.deadline.toLocaleDateString('th-TH', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })
      : null;

    for (const res of results) {
      if (!res.supplierEmail) {
        this.logger.warn(
          `Supplier ${res.supplierId} (${res.supplierName}) has no email — skipping invitation`,
        );
        continue;
      }
      try {
        await this.emailService.sendRfqInvitation({
          to: res.supplierEmail,
          supplierName: res.supplierName,
          rfqNumber: rfq.rfqNumber,
          portalUrl: res.portalUrl,
          subject: rfq.subject,
          coverLetter: rfq.coverLetter,
          customTerms: rfq.customTerms,
          deadline: deadlineStr,
          expiresAt: res.expiresAt.toLocaleString('th-TH'),
          tenantId,
        });
      } catch (err) {
        this.logger.error(
          `Failed to queue invitation email for supplier ${res.supplierId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }

  /**
   * Admin-triggered resend of the magic-link invitation. If supplierId is
   * provided, regenerate and email only that supplier (e.g. supplier lost
   * the link). Otherwise dispatch fresh tokens to all recipients.
   *
   * Old tokens for the affected supplier(s) are revoked so the previously
   * emailed link stops working — the supplier must use the latest one.
   */
  async resendInvitation(
    id: string,
    tenantId: string,
    supplierId?: string,
  ): Promise<{ resent: number; skipped: number }> {
    const rfq = await this.ensureExists(id, tenantId);
    if (rfq.status !== RfqStatus.SENT && rfq.status !== RfqStatus.PARTIAL_RESPONSE) {
      throw new BadRequestException('สามารถส่งลิงก์ซ้ำได้เฉพาะ RFQ ที่ส่งแล้วและยังไม่ปิด');
    }

    // "All suppliers" path reuses dispatchInvitations — it already revokes
    // stale tokens via generateTokensForRfq().
    if (!supplierId) {
      const recipientCount = await this.prisma.rfqSupplierRecipient.count({
        where: { requestForQuotationId: id },
      });
      await this.dispatchInvitations(tenantId, id);
      this.logger.log(`Admin resent RFQ invitation for ${id} to ${recipientCount} recipients`);
      // dispatchInvitations swallows per-supplier errors, so we report the
      // target count. The caller can still inspect logs for skipped ones.
      return { resent: recipientCount, skipped: 0 };
    }

    // Single-supplier path: use regenerateTokenForSupplier + send one email.
    const res = await this.supplierPortalService.regenerateTokenForSupplier(
      tenantId,
      id,
      supplierId,
    );

    if (!res.supplierEmail) {
      this.logger.warn(`Admin tried to resend to supplier ${supplierId} but it has no email`);
      return { resent: 0, skipped: 1 };
    }

    const deadlineStr = rfq.deadline
      ? rfq.deadline.toLocaleDateString('th-TH', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })
      : null;

    try {
      await this.emailService.sendRfqInvitation({
        to: res.supplierEmail,
        supplierName: res.supplierName,
        rfqNumber: rfq.rfqNumber,
        portalUrl: res.portalUrl,
        subject: rfq.subject,
        coverLetter: rfq.coverLetter,
        customTerms: rfq.customTerms,
        deadline: deadlineStr,
        expiresAt: res.expiresAt.toLocaleString('th-TH'),
        tenantId,
      });
      this.logger.log(`Admin resent RFQ ${id} invitation to supplier ${supplierId}`);
      return { resent: 1, skipped: 0 };
    } catch (err) {
      this.logger.error(
        `Failed to resend invitation for supplier ${supplierId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      throw new BadRequestException('ส่งอีเมลไม่สำเร็จ กรุณาลองใหม่');
    }
  }

  async remind(id: string, tenantId: string, supplierId?: string): Promise<{ reminded: number }> {
    const rfq = await this.ensureExists(id, tenantId);
    if (rfq.status !== RfqStatus.SENT && rfq.status !== RfqStatus.PARTIAL_RESPONSE) {
      throw new BadRequestException('เตือนได้เฉพาะ RFQ ที่ส่งแล้วและยังไม่ปิด');
    }

    const now = new Date();
    const result = await this.prisma.rfqSupplierRecipient.updateMany({
      where: {
        requestForQuotationId: id,
        respondedAt: null,
        declinedAt: null,
        ...(supplierId && { supplierId }),
      },
      data: {
        remindedAt: now,
        remindCount: { increment: 1 },
      },
    });
    return { reminded: result.count };
  }

  async extendDeadline(id: string, tenantId: string, dto: ExtendDeadlineDto): Promise<unknown> {
    const rfq = await this.ensureExists(id, tenantId);
    const newDeadline = new Date(dto.deadline);
    if (rfq.deadline && newDeadline <= rfq.deadline) {
      throw new BadRequestException('Deadline ใหม่ต้องหลังจาก deadline เดิม');
    }
    return this.prisma.requestForQuotation.update({
      where: { id },
      data: {
        deadline: newDeadline,
        status: rfq.status === RfqStatus.EXPIRED ? RfqStatus.SENT : rfq.status,
      },
    });
  }

  async cancel(id: string, tenantId: string, userId: string, dto: CancelRfqDto): Promise<unknown> {
    const rfq = await this.ensureExists(id, tenantId);
    if (rfq.status === RfqStatus.CANCELLED || rfq.status === RfqStatus.FULLY_RESPONDED) {
      throw new ConflictException('RFQ ถูกปิดไปแล้ว');
    }
    return this.prisma.requestForQuotation.update({
      where: { id },
      data: {
        status: RfqStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelledBy: userId,
        cancelReason: dto.reason ?? null,
      },
    });
  }

  /**
   * สร้าง RFQ รอบใหม่ (re-solicit) โดย link กลับไปยัง parentRfqId
   * ใช้เมื่อรอบก่อนไม่มีใครตอบหรือราคาไม่เข้าเกณฑ์
   */
  async resolicit(
    parentId: string,
    tenantId: string,
    userId: string,
    overrides: Partial<CreateRfqDto>,
  ): Promise<{ id: string; rfqNumber: string; status: RfqStatus }> {
    const parent = await this.prisma.requestForQuotation.findFirst({
      where: { id: parentId, tenantId },
      include: {
        prLinks: true,
        recipients: true,
      },
    });
    if (!parent) throw new NotFoundException('ไม่พบ RFQ ต้นทาง');

    const prIds =
      overrides.purchaseRequisitionIds ?? parent.prLinks.map((p) => p.purchaseRequisitionId);
    const supplierIds = overrides.supplierIds ?? parent.recipients.map((r) => r.supplierId);

    return this.prisma.$transaction(async (tx) => {
      const rfqNumber = await this.generateRfqNumber(tenantId, tx);
      const rfq = await tx.requestForQuotation.create({
        data: {
          tenantId,
          propertyId: parent.propertyId,
          rfqNumber,
          status: RfqStatus.DRAFT,
          round: parent.round + 1,
          parentRfqId: parent.id,
          subject: overrides.subject ?? parent.subject,
          coverLetter: overrides.coverLetter ?? parent.coverLetter,
          customTerms: overrides.customTerms ?? parent.customTerms,
          deadline: overrides.deadline ? new Date(overrides.deadline) : parent.deadline,
          createdBy: userId,
          prLinks: {
            create: prIds.map((prId) => ({ purchaseRequisitionId: prId })),
          },
          recipients: {
            create: supplierIds.map((supplierId) => ({ supplierId })),
          },
        },
        select: { id: true, rfqNumber: true, status: true },
      });
      return rfq;
    });
  }

  /**
   * Called when a SupplierQuote is submitted/received.
   * Marks the recipient row as responded and rolls up the RFQ status.
   */
  async markResponseReceived(tenantId: string, rfqId: string, supplierId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const rfq = await tx.requestForQuotation.findFirst({
        where: { id: rfqId, tenantId },
        include: { recipients: true },
      });
      if (!rfq) return;

      const now = new Date();
      await tx.rfqSupplierRecipient.updateMany({
        where: {
          requestForQuotationId: rfqId,
          supplierId,
          respondedAt: null,
        },
        data: { respondedAt: now },
      });

      const total = rfq.recipients.length;
      const responded = rfq.recipients.filter(
        (r) => r.respondedAt !== null || r.supplierId === supplierId,
      ).length;

      let next: RfqStatus = rfq.status;
      if (responded >= total && total > 0) next = RfqStatus.FULLY_RESPONDED;
      else if (responded > 0) next = RfqStatus.PARTIAL_RESPONSE;

      if (next !== rfq.status) {
        await tx.requestForQuotation.update({
          where: { id: rfqId },
          data: { status: next },
        });
      }
    });
  }

  /**
   * Create empty SupplierQuote skeletons (status=REQUESTED) for every
   * (supplier × PR) so staff can fill in prices as quotes come in.
   * Uses skipDuplicates to be idempotent against the
   * [tenantId, prId, supplierId, round] unique constraint.
   */
  private async sproutSupplierQuotes(
    tx: Prisma.TransactionClient,
    input: {
      tenantId: string;
      rfqId: string;
      round: number;
      purchaseRequisitionIds: string[];
      supplierIds: string[];
    },
  ): Promise<void> {
    const { tenantId, rfqId, round, purchaseRequisitionIds, supplierIds } = input;
    if (purchaseRequisitionIds.length === 0 || supplierIds.length === 0) return;

    const rows: Prisma.SupplierQuoteCreateManyInput[] = [];
    for (const supplierId of supplierIds) {
      for (const prId of purchaseRequisitionIds) {
        rows.push({
          tenantId,
          purchaseRequisitionId: prId,
          requestForQuotationId: rfqId,
          supplierId,
          round,
          status: 'REQUESTED',
        });
      }
    }

    await tx.supplierQuote.createMany({
      data: rows,
      skipDuplicates: true,
    });
  }

  private async ensureExists(id: string, tenantId: string) {
    const rfq = await this.prisma.requestForQuotation.findFirst({
      where: { id, tenantId },
    });
    if (!rfq) throw new NotFoundException('ไม่พบ RFQ');
    return rfq;
  }

  private async generateRfqNumber(tenantId: string, tx: Prisma.TransactionClient): Promise<string> {
    const now = new Date();
    const yearMonth = `${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(
      2,
      '0',
    )}`;
    const seq = await tx.documentSequence.upsert({
      where: {
        tenantId_docType_yearMonth: {
          tenantId,
          docType: 'RFQ',
          yearMonth,
        },
      },
      create: {
        tenantId,
        docType: 'RFQ',
        prefix: 'RFQ',
        yearMonth,
        lastNumber: 1,
      },
      update: { lastNumber: { increment: 1 } },
    });
    return `RFQ-${yearMonth}-${String(seq.lastNumber).padStart(4, '0')}`;
  }
}
