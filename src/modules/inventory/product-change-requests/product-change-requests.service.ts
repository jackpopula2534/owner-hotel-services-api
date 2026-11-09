import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ProductChangeRequest, ProductChangeRequestStatus } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import {
  ChangeRequestActor,
  REQUESTER_ROLES,
  REVIEWER_ROLES,
  VIEWER_ROLES,
  assertRole,
} from './product-change-access';
import { buildChanges, requestLevel } from './product-change-fields';
import { ProductChangeApplyService } from './product-change-apply.service';
import { ProductChangeNotifierService } from './product-change-notifier.service';
import { ProductChangeQueriesService } from './product-change-queries.service';
import {
  ProductRequestDetail,
  asJson,
  decideFields,
  definedEntries,
  isOpen,
  permissionsFor,
  readChanges,
} from './product-change-shared';
import {
  CreateItemUpdateRequestDto,
  CreateNewItemRequestDto,
  NewItemProposalDto,
  ProcurementChangesDto,
  ResubmitRequestDto,
  SuggestedWarehouseDto,
} from './dto/create-product-request.dto';
import {
  ApproveRequestDto,
  CancelRequestDto,
  RejectRequestDto,
  ReviewNoteDto,
  WarehouseDataDto,
} from './dto/review-product-request.dto';

type Db = Prisma.TransactionClient | PrismaService;

/**
 * คำขอสร้าง/แก้ไขสินค้า (ฝั่งเขียน)
 *
 * จัดซื้อ: ส่งคำขอ → ส่งใหม่หลังคลังขอข้อมูล → ยกเลิก
 * คลัง:   อนุมัติ/รับทราบ (ทั้งใบหรือบางฟิลด์) → ขอข้อมูลเพิ่ม → ปฏิเสธ
 *
 * ทุกการเปลี่ยนสถานะบันทึกเป็น event (ไทม์ไลน์) ในทรานแซกชันเดียวกับการเปลี่ยนสถานะ
 */
@Injectable()
export class ProductChangeRequestsService {
  private readonly logger = new Logger(ProductChangeRequestsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly applier: ProductChangeApplyService,
    private readonly queries: ProductChangeQueriesService,
    private readonly notifier: ProductChangeNotifierService,
  ) {}

  // ─── Submit (ฝั่งจัดซื้อ) ──────────────────────────────────────────────────

  async submitNewItem(
    actor: ChangeRequestActor,
    dto: CreateNewItemRequestDto,
  ): Promise<ProductRequestDetail> {
    assertRole(actor, REQUESTER_ROLES, 'ส่งคำขอสร้างสินค้า');
    await this.validateNewItemProposal(actor.tenantId, dto.proposal, dto.suggestedWarehouse);
    const actorName = await this.notifier.nameOf(actor);

    const created = await this.prisma.$transaction(async (tx) => {
      const request = await tx.productChangeRequest.create({
        data: {
          tenantId: actor.tenantId,
          requestNumber: await this.nextNumber(tx, actor.tenantId),
          type: 'CREATE',
          level: 'APPROVAL',
          status: 'PENDING',
          proposed: asJson(dto.proposal),
          suggestedWarehouse: dto.suggestedWarehouse
            ? asJson(dto.suggestedWarehouse)
            : Prisma.JsonNull,
          reason: dto.reason?.trim() || null,
          prReference: dto.prReference?.trim() || null,
          neededBy: dto.neededBy ? new Date(dto.neededBy) : null,
          requestedById: actor.userId,
          requestedByName: actorName,
        },
      });
      await this.addEvent(tx, request, 'SUBMITTED', actor.userId, actorName, dto.reason);
      return request;
    });

    this.logger.log(`Product request ${created.requestNumber} (CREATE) by ${actor.userId}`);
    await this.notifier.notifyReviewers(created, `ขอสร้างสินค้าใหม่: ${dto.proposal.name}`);
    return this.queries.findOne(actor, created.id);
  }

  async submitItemUpdate(
    actor: ChangeRequestActor,
    dto: CreateItemUpdateRequestDto,
  ): Promise<ProductRequestDetail> {
    assertRole(actor, REQUESTER_ROLES, 'ส่งคำขอแก้ไขสินค้า');
    const { baseline, changes } = await this.diffForItem(actor.tenantId, dto.itemId, dto.changes);
    await this.assertNoOpenUpdate(actor.tenantId, dto.itemId);
    const actorName = await this.notifier.nameOf(actor);

    const created = await this.prisma.$transaction(async (tx) => {
      const request = await tx.productChangeRequest.create({
        data: {
          tenantId: actor.tenantId,
          requestNumber: await this.nextNumber(tx, actor.tenantId),
          type: 'UPDATE',
          level: requestLevel(changes),
          status: 'PENDING',
          itemId: dto.itemId,
          proposed: asJson(definedEntries(dto.changes)),
          baseline: asJson(baseline),
          changes: asJson(changes),
          reason: dto.reason.trim(),
          effectiveDate: dto.effectiveDate ? new Date(dto.effectiveDate) : null,
          requestedById: actor.userId,
          requestedByName: actorName,
        },
      });
      await this.addEvent(tx, request, 'SUBMITTED', actor.userId, actorName, dto.reason);
      return request;
    });

    this.logger.log(
      `Product request ${created.requestNumber} (UPDATE ${changes.length} fields) by ${actor.userId}`,
    );
    await this.notifier.notifyReviewers(
      created,
      `ขอแก้ไขสินค้า: ${changes.map((c) => c.label).join(', ')}`,
    );
    return this.queries.findOne(actor, created.id);
  }

  async resubmit(
    actor: ChangeRequestActor,
    id: string,
    dto: ResubmitRequestDto,
  ): Promise<ProductRequestDetail> {
    const request = await this.getRequest(actor, id, REQUESTER_ROLES, 'แก้ไขคำขอสินค้า');
    if (!permissionsFor(actor, request).canResubmit) {
      throw new ForbiddenException('ส่งใหม่ได้เฉพาะคำขอที่คลังขอข้อมูลเพิ่ม และเป็นผู้ส่งคำขอ');
    }

    let data: Prisma.ProductChangeRequestUpdateInput;
    if (request.type === 'CREATE') {
      const proposal = dto.proposal ?? (request.proposed as unknown as NewItemProposalDto);
      const suggested =
        dto.suggestedWarehouse ??
        (request.suggestedWarehouse as unknown as SuggestedWarehouseDto | null) ??
        undefined;
      await this.validateNewItemProposal(actor.tenantId, proposal, suggested);
      data = {
        proposed: asJson(proposal),
        suggestedWarehouse: suggested ? asJson(suggested) : Prisma.JsonNull,
      };
    } else {
      if (!request.itemId) throw new BadRequestException('คำขอแก้ไขนี้ไม่มีสินค้าอ้างอิงแล้ว');
      const source = dto.changes ?? (request.proposed as unknown as ProcurementChangesDto);
      const { baseline, changes } = await this.diffForItem(actor.tenantId, request.itemId, source);
      data = {
        proposed: asJson(definedEntries(source)),
        baseline: asJson(baseline),
        changes: asJson(changes),
        level: requestLevel(changes),
        ...(dto.effectiveDate !== undefined
          ? { effectiveDate: dto.effectiveDate ? new Date(dto.effectiveDate) : null }
          : {}),
      };
    }

    const actorName = await this.notifier.nameOf(actor);
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.productChangeRequest.update({
        where: { id: request.id },
        data: {
          ...data,
          status: 'PENDING',
          ...(dto.reason !== undefined ? { reason: dto.reason.trim() || null } : {}),
        },
      });
      await this.addEvent(tx, row, 'RESUBMITTED', actor.userId, actorName, dto.note);
      return row;
    });
    await this.notifier.notifyReviewers(
      updated,
      `จัดซื้อส่งข้อมูลเพิ่มแล้ว: ${updated.requestNumber}`,
    );
    return this.queries.findOne(actor, id);
  }

  async cancel(
    actor: ChangeRequestActor,
    id: string,
    dto: CancelRequestDto,
  ): Promise<ProductRequestDetail> {
    const request = await this.getRequest(actor, id, REQUESTER_ROLES, 'ยกเลิกคำขอสินค้า');
    if (!permissionsFor(actor, request).canCancel) {
      throw new ForbiddenException('ยกเลิกได้เฉพาะคำขอที่ยังไม่ถูกตัดสิน โดยผู้ส่งคำขอ');
    }
    const actorName = await this.notifier.nameOf(actor);
    await this.prisma.$transaction(async (tx) => {
      const row = await tx.productChangeRequest.update({
        where: { id },
        data: { status: 'CANCELLED' },
      });
      await this.addEvent(tx, row, 'CANCELLED', actor.userId, actorName, dto.note);
    });
    await this.notifier.notifyReviewers(
      request,
      `จัดซื้อยกเลิกคำขอแล้ว${dto.note ? `: ${dto.note}` : ''}`,
    );
    return this.queries.findOne(actor, id);
  }

  // ─── Review (ฝั่งคลัง) ─────────────────────────────────────────────────────

  async approve(
    actor: ChangeRequestActor,
    id: string,
    dto: ApproveRequestDto,
  ): Promise<ProductRequestDetail> {
    const request = await this.getForReview(actor, id);
    if (request.status !== 'PENDING') {
      throw new ConflictException('คำขอนี้ไม่ได้อยู่ในสถานะรอพิจารณา');
    }
    const actorName = await this.notifier.nameOf(actor);
    const now = new Date();
    const review = {
      reviewedById: actor.userId,
      reviewedByName: actorName,
      reviewedAt: now,
      reviewNote: dto.note?.trim() || null,
    };

    if (request.type === 'CREATE') {
      if (!dto.warehouseData) {
        throw new BadRequestException(
          'ต้องกรอกข้อมูลฝั่งคลัง (SKU, หน่วยนับ ...) ก่อนอนุมัติสร้างสินค้า',
        );
      }
      const proposal = request.proposed as unknown as NewItemProposalDto;
      const warehouse: WarehouseDataDto = dto.warehouseData;
      await this.prisma.$transaction(async (tx) => {
        const itemId = await this.applier.applyCreate(tx, request.tenantId, proposal, warehouse);
        const row = await tx.productChangeRequest.update({
          where: { id },
          data: {
            ...review,
            status: 'APPROVED',
            itemId,
            warehouseData: asJson(warehouse),
            appliedAt: now,
          },
        });
        await this.addEvent(tx, row, 'APPROVED', actor.userId, actorName, dto.note);
        await this.addEvent(
          tx,
          row,
          'APPLIED',
          actor.userId,
          actorName,
          `สร้างสินค้า SKU ${warehouse.sku}`,
        );
      });
    } else {
      const decided = decideFields(readChanges(request.changes), dto.approvedFields);
      const applyNow = !request.effectiveDate || request.effectiveDate.getTime() <= now.getTime();
      const status: ProductChangeRequestStatus =
        request.level === 'APPROVAL' ? 'APPROVED' : 'ACKNOWLEDGED';
      const rejectedCount = decided.filter((c) => c.decision === 'REJECTED').length;
      const note =
        rejectedCount > 0 ? `${dto.note ?? ''} (ไม่ผ่าน ${rejectedCount} ฟิลด์)`.trim() : dto.note;

      await this.prisma.$transaction(async (tx) => {
        if (applyNow && request.itemId) {
          await this.applier.applyUpdate(tx, request.tenantId, request.itemId, decided);
        }
        const row = await tx.productChangeRequest.update({
          where: { id },
          data: { ...review, status, changes: asJson(decided), appliedAt: applyNow ? now : null },
        });
        await this.addEvent(tx, row, status, actor.userId, actorName, note);
        if (applyNow) await this.addEvent(tx, row, 'APPLIED', actor.userId, actorName, null);
      });
    }

    await this.notifier.audit(actor, request, 'approved');
    await this.notifier.notifyRequester(
      request,
      request.type === 'CREATE'
        ? `คลังอนุมัติสร้างสินค้าแล้ว (SKU ${dto.warehouseData?.sku})`
        : 'คลังรับทราบ/อนุมัติการแก้ไขแล้ว',
      'success',
    );
    return this.queries.findOne(actor, id);
  }

  async requestInfo(
    actor: ChangeRequestActor,
    id: string,
    dto: ReviewNoteDto,
  ): Promise<ProductRequestDetail> {
    const request = await this.getForReview(actor, id);
    if (request.status !== 'PENDING') {
      throw new ConflictException('คำขอนี้ไม่ได้อยู่ในสถานะรอพิจารณา');
    }
    const actorName = await this.notifier.nameOf(actor);
    await this.prisma.$transaction(async (tx) => {
      const row = await tx.productChangeRequest.update({
        where: { id },
        data: { status: 'NEEDS_INFO', reviewNote: dto.note.trim() },
      });
      await this.addEvent(tx, row, 'NEEDS_INFO', actor.userId, actorName, dto.note);
    });
    await this.notifier.notifyRequester(request, `คลังขอข้อมูลเพิ่ม: ${dto.note}`, 'warning');
    return this.queries.findOne(actor, id);
  }

  async reject(
    actor: ChangeRequestActor,
    id: string,
    dto: RejectRequestDto,
  ): Promise<ProductRequestDetail> {
    const request = await this.getForReview(actor, id);
    if (dto.duplicateOfItemId) {
      const dup = await this.prisma.inventoryItem.findFirst({
        where: { id: dto.duplicateOfItemId, tenantId: actor.tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!dup) throw new BadRequestException('ไม่พบสินค้าที่อ้างว่าซ้ำ');
    }
    const actorName = await this.notifier.nameOf(actor);
    await this.prisma.$transaction(async (tx) => {
      const row = await tx.productChangeRequest.update({
        where: { id },
        data: {
          status: 'REJECTED',
          reviewedById: actor.userId,
          reviewedByName: actorName,
          reviewedAt: new Date(),
          reviewNote: dto.note.trim(),
          duplicateOfItemId: dto.duplicateOfItemId ?? null,
        },
      });
      await this.addEvent(tx, row, 'REJECTED', actor.userId, actorName, dto.note);
    });
    await this.notifier.audit(actor, request, 'rejected');
    await this.notifier.notifyRequester(request, `คลังปฏิเสธคำขอ: ${dto.note}`, 'error');
    return this.queries.findOne(actor, id);
  }

  /** บันทึกว่าคลังเปิดอ่านแล้ว (ครั้งแรกเท่านั้น) — โชว์ในไทม์ไลน์ของจัดซื้อ */
  async markViewed(actor: ChangeRequestActor, id: string): Promise<void> {
    assertRole(actor, VIEWER_ROLES, 'ดูคำขอสินค้า');
    if (!REVIEWER_ROLES.has(actor.role)) return;
    const request = await this.prisma.productChangeRequest.findFirst({
      where: { id, tenantId: actor.tenantId },
      include: { events: { where: { action: 'VIEWED' }, take: 1, select: { id: true } } },
    });
    if (!request || request.status !== 'PENDING' || request.events.length > 0) return;
    if (request.requestedById === actor.userId) return;
    const actorName = await this.notifier.nameOf(actor);
    await this.addEvent(this.prisma, request, 'VIEWED', actor.userId, actorName, null);
  }

  // ─── Scheduled apply (ถึงวันมีผล) ─────────────────────────────────────────

  /** ใช้ค่าใหม่ของคำขอแก้ไขที่อนุมัติแล้ว แต่ตั้งวันมีผลไว้ล่วงหน้า */
  async applyDueUpdates(now: Date = new Date()): Promise<number> {
    const due = await this.prisma.productChangeRequest.findMany({
      where: {
        type: 'UPDATE',
        status: { in: ['APPROVED', 'ACKNOWLEDGED'] },
        appliedAt: null,
        effectiveDate: { lte: now },
        itemId: { not: null },
      },
      take: 100,
    });
    let applied = 0;
    for (const request of due) {
      try {
        await this.prisma.$transaction(async (tx) => {
          await this.applier.applyUpdate(
            tx,
            request.tenantId,
            request.itemId as string,
            readChanges(request.changes),
          );
          const row = await tx.productChangeRequest.update({
            where: { id: request.id },
            data: { appliedAt: now },
          });
          await this.addEvent(tx, row, 'APPLIED', null, 'ระบบ', 'ถึงวันมีผล');
        });
        applied += 1;
      } catch (error) {
        this.logger.error(
          `Failed to apply ${request.requestNumber}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return applied;
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private async diffForItem(tenantId: string, itemId: string, source: ProcurementChangesDto) {
    const proposed = definedEntries(source);
    if ('name' in proposed && (proposed.name === null || String(proposed.name).trim() === '')) {
      throw new BadRequestException('ชื่อสินค้าห้ามว่าง');
    }
    if ('preferredSupplierId' in proposed && proposed.preferredSupplierId === null) {
      throw new BadRequestException(
        'ต้องมี Supplier หลัก — เปลี่ยนเป็น Supplier อื่นได้ แต่ล้างค่าไม่ได้',
      );
    }
    if (typeof proposed.preferredSupplierId === 'string') {
      await this.applier.assertSupplier(tenantId, proposed.preferredSupplierId);
    }
    const baseline = await this.applier.readSnapshot(tenantId, itemId);
    const changes = buildChanges(baseline, proposed);
    if (changes.length === 0) throw new BadRequestException('ไม่มีข้อมูลที่เปลี่ยนจากค่าปัจจุบัน');

    const touchesTerms = changes.some((c) =>
      ['unitPrice', 'minOrderQty', 'leadDays'].includes(c.field),
    );
    if (touchesTerms && !(proposed.preferredSupplierId ?? baseline.preferredSupplierId)) {
      throw new BadRequestException(
        'สินค้านี้ยังไม่มี Supplier หลัก — เลือก Supplier ก่อนแก้ราคา/MOQ/Lead time',
      );
    }
    return { baseline, changes };
  }

  private async validateNewItemProposal(
    tenantId: string,
    proposal: NewItemProposalDto,
    suggested?: SuggestedWarehouseDto,
  ): Promise<void> {
    if (!proposal?.name?.trim()) throw new BadRequestException('ต้องระบุชื่อสินค้า');
    if (proposal.supplierId) {
      await this.applier.assertSupplier(tenantId, proposal.supplierId);
    } else if (proposal.unitPrice !== undefined || proposal.minOrderQty !== undefined) {
      throw new BadRequestException('ระบุราคา/MOQ ต้องเลือก Supplier ด้วย');
    }
    if (suggested?.categoryId) await this.applier.assertCategory(tenantId, suggested.categoryId);
    if (
      suggested?.minStock !== undefined &&
      suggested?.maxStock !== undefined &&
      suggested.maxStock < suggested.minStock
    ) {
      throw new BadRequestException('Max stock ที่เสนอต้องไม่น้อยกว่า Min stock');
    }
  }

  private async assertNoOpenUpdate(tenantId: string, itemId: string): Promise<void> {
    const open = await this.prisma.productChangeRequest.findFirst({
      where: { tenantId, itemId, type: 'UPDATE', status: { in: ['PENDING', 'NEEDS_INFO'] } },
      select: { requestNumber: true },
    });
    if (open) {
      throw new ConflictException(
        `สินค้านี้มีคำขอแก้ไขค้างอยู่แล้ว (${open.requestNumber}) — แก้ในคำขอเดิมหรือยกเลิกก่อน`,
      );
    }
  }

  private async getRequest(
    actor: ChangeRequestActor,
    id: string,
    roles: ReadonlySet<string>,
    action: string,
  ): Promise<ProductChangeRequest> {
    assertRole(actor, roles, action);
    const request = await this.prisma.productChangeRequest.findFirst({
      where: { id, tenantId: actor.tenantId },
    });
    if (!request) throw new NotFoundException(`ไม่พบคำขอ ${id}`);
    return request;
  }

  private async getForReview(actor: ChangeRequestActor, id: string): Promise<ProductChangeRequest> {
    const request = await this.getRequest(actor, id, REVIEWER_ROLES, 'พิจารณาคำขอสินค้า');
    if (!permissionsFor(actor, request).canReview) {
      throw isOpen(request.status)
        ? new ForbiddenException('อนุมัติคำขอของตัวเองไม่ได้ — ต้องให้หัวหน้าคลังเป็นผู้พิจารณา')
        : new ConflictException('คำขอนี้ถูกตัดสินไปแล้ว');
    }
    return request;
  }

  private async nextNumber(tx: Prisma.TransactionClient, tenantId: string): Promise<string> {
    const now = new Date();
    const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const docType = 'PRODUCT_CHANGE_REQUEST';
    const seq = await tx.documentSequence.upsert({
      where: { tenantId_docType_yearMonth: { tenantId, docType, yearMonth } },
      create: { tenantId, docType, prefix: 'PCR', yearMonth, lastNumber: 1 },
      update: { lastNumber: { increment: 1 } },
    });
    return `PCR-${yearMonth}-${String(seq.lastNumber).padStart(4, '0')}`;
  }

  private async addEvent(
    db: Db,
    request: Pick<ProductChangeRequest, 'id' | 'tenantId'>,
    action: string,
    actorId: string | null,
    actorName: string | null,
    note: string | null | undefined,
  ): Promise<void> {
    await db.productChangeRequestEvent.create({
      data: {
        requestId: request.id,
        tenantId: request.tenantId,
        action,
        actorId,
        actorName,
        note: note?.trim() || null,
      },
    });
  }
}
