import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import {
  CreateQCTemplateDto,
  UpdateQCTemplateDto,
  CreateChecklistItemDto,
  CreateQCRecordDto,
  SubmitQCRecordDto,
  QueryQCRecordDto,
} from './dto/qc.dto';
import { QCRecordStatus } from '@prisma/client';

@Injectable()
export class QCService {
  private readonly logger = new Logger(QCService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // QC TEMPLATES
  // ═══════════════════════════════════════════════════════════════════════════

  async listTemplates(tenantId: string) {
    return this.prisma.qCTemplate.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      include: {
        checklistItems: { orderBy: { orderIndex: 'asc' } },
        _count: { select: { records: true } },
      },
    });
  }

  async createTemplate(tenantId: string, dto: CreateQCTemplateDto) {
    if (dto.appliesTo === 'CATEGORY' && !dto.categoryId) {
      throw new BadRequestException('ต้องระบุ categoryId เมื่อ appliesTo = CATEGORY');
    }
    if (dto.appliesTo === 'ITEM' && !dto.itemId) {
      throw new BadRequestException('ต้องระบุ itemId เมื่อ appliesTo = ITEM');
    }

    // Pre-flight existence + tenant-scope check so the user gets a friendly
    // 404 instead of a Prisma P2003 foreign-key explosion at write time.
    if (dto.appliesTo === 'CATEGORY' && dto.categoryId) {
      const cat = await this.prisma.itemCategory.findFirst({
        where: { id: dto.categoryId, tenantId },
        select: { id: true },
      });
      if (!cat) {
        throw new NotFoundException(`ไม่พบหมวดหมู่สินค้าในระบบ (categoryId=${dto.categoryId})`);
      }
    }
    if (dto.appliesTo === 'ITEM' && dto.itemId) {
      const item = await this.prisma.inventoryItem.findFirst({
        where: { id: dto.itemId, tenantId },
        select: { id: true },
      });
      if (!item) {
        throw new NotFoundException(`ไม่พบสินค้าในระบบ (itemId=${dto.itemId})`);
      }
    }

    // Normalize checklist items so each row gets a sequential orderIndex even
    // if the client forgot to send one (DTO defaults to 0 → all rows would
    // collide on the index).
    const checklistData = (dto.checklistItems ?? []).map((ci, idx) => ({
      label: ci.label,
      type: ci.type,
      required: ci.required ?? true,
      orderIndex: typeof ci.orderIndex === 'number' ? ci.orderIndex : idx,
      passCondition: ci.passCondition ? (ci.passCondition as unknown as object) : undefined,
    }));

    try {
      return await this.prisma.qCTemplate.create({
        data: {
          tenantId,
          name: dto.name,
          appliesTo: dto.appliesTo,
          categoryId: dto.appliesTo === 'CATEGORY' ? dto.categoryId : null,
          itemId: dto.appliesTo === 'ITEM' ? dto.itemId : null,
          checklistItems: checklistData.length ? { create: checklistData } : undefined,
        },
        include: { checklistItems: { orderBy: { orderIndex: 'asc' } } },
      });
    } catch (e: unknown) {
      this.logger.error('createTemplate failed', e instanceof Error ? e.stack : String(e));
      // Surface a meaningful error to the API consumer instead of a 500.
      throw new BadRequestException(
        e instanceof Error ? e.message : 'ไม่สามารถสร้าง QC Template ได้',
      );
    }
  }

  async updateTemplate(tenantId: string, id: string, dto: UpdateQCTemplateDto) {
    const existing = await this.findTemplateOrThrow(tenantId, id);

    // Resolve effective appliesTo — may come from dto or fall back to current value.
    const effectiveAppliesTo = dto.appliesTo ?? existing.appliesTo;

    // Validate scope fields when changing appliesTo or the associated ID.
    if (effectiveAppliesTo === 'CATEGORY') {
      const effectiveCategoryId = dto.categoryId ?? (existing.appliesTo === 'CATEGORY' ? existing.categoryId : undefined);
      if (!effectiveCategoryId) {
        throw new BadRequestException('ต้องระบุ categoryId เมื่อ appliesTo = CATEGORY');
      }
      if (dto.categoryId) {
        const cat = await this.prisma.itemCategory.findFirst({
          where: { id: dto.categoryId, tenantId },
          select: { id: true },
        });
        if (!cat) throw new NotFoundException(`ไม่พบหมวดหมู่สินค้า (categoryId=${dto.categoryId})`);
      }
    }

    if (effectiveAppliesTo === 'ITEM') {
      const effectiveItemId = dto.itemId ?? (existing.appliesTo === 'ITEM' ? existing.itemId : undefined);
      if (!effectiveItemId) {
        throw new BadRequestException('ต้องระบุ itemId เมื่อ appliesTo = ITEM');
      }
      if (dto.itemId) {
        const item = await this.prisma.inventoryItem.findFirst({
          where: { id: dto.itemId, tenantId },
          select: { id: true },
        });
        if (!item) throw new NotFoundException(`ไม่พบสินค้า (itemId=${dto.itemId})`);
      }
    }

    // Build scalar update payload — only include fields actually sent by client.
    const scalarUpdate: Record<string, unknown> = {};
    if (dto.name !== undefined)     scalarUpdate.name     = dto.name;
    if (dto.isActive !== undefined) scalarUpdate.isActive = dto.isActive;
    if (dto.appliesTo !== undefined) {
      scalarUpdate.appliesTo  = dto.appliesTo;
      // Nullify the opposite scope ID when switching scope type.
      scalarUpdate.categoryId = dto.appliesTo === 'CATEGORY' ? (dto.categoryId ?? existing.categoryId) : null;
      scalarUpdate.itemId     = dto.appliesTo === 'ITEM'     ? (dto.itemId     ?? existing.itemId)     : null;
    } else {
      // Scope type unchanged — allow updating individual IDs in place.
      if (dto.categoryId !== undefined) scalarUpdate.categoryId = dto.categoryId;
      if (dto.itemId     !== undefined) scalarUpdate.itemId     = dto.itemId;
    }

    // If checklistItems were sent, replace the entire set inside a transaction.
    if (dto.checklistItems !== undefined) {
      const checklistData = dto.checklistItems.map((ci, idx) => ({
        label:         ci.label,
        type:          ci.type,
        required:      ci.required ?? true,
        orderIndex:    typeof ci.orderIndex === 'number' ? ci.orderIndex : idx,
        passCondition: ci.passCondition ? (ci.passCondition as unknown as object) : undefined,
      }));

      return this.prisma.$transaction(async (tx) => {
        // Delete all existing checklist items then recreate — simpler than
        // diffing by label/type and avoids stale orderIndex collisions.
        await tx.qCChecklistItem.deleteMany({ where: { templateId: id } });

        return tx.qCTemplate.update({
          where: { id },
          data: {
            ...scalarUpdate,
            checklistItems: checklistData.length ? { create: checklistData } : undefined,
          },
          include: { checklistItems: { orderBy: { orderIndex: 'asc' } } },
        });
      });
    }

    // No checklist update — simple scalar patch.
    return this.prisma.qCTemplate.update({
      where: { id },
      data: scalarUpdate,
      include: { checklistItems: { orderBy: { orderIndex: 'asc' } } },
    });
  }

  async deleteTemplate(tenantId: string, id: string) {
    await this.findTemplateOrThrow(tenantId, id);
    const hasRecords = await this.prisma.qCRecord.count({ where: { templateId: id } });
    if (hasRecords > 0) {
      throw new ConflictException('ไม่สามารถลบ template ที่มีบันทึก QC อยู่แล้ว');
    }
    return this.prisma.qCTemplate.delete({ where: { id } });
  }

  async addChecklistItem(tenantId: string, templateId: string, dto: CreateChecklistItemDto) {
    await this.findTemplateOrThrow(tenantId, templateId);
    return this.prisma.qCChecklistItem.create({
      data: {
        templateId,
        label: dto.label,
        type: dto.type,
        required: dto.required ?? true,
        orderIndex: dto.orderIndex ?? 0,
        // PassConditionDto is a class instance — Prisma's JSON column accepts
        // a plain object, so cast through `unknown` to satisfy the typed
        // generated input.
        passCondition: dto.passCondition ? (dto.passCondition as unknown as object) : undefined,
      },
    });
  }

  async removeChecklistItem(tenantId: string, templateId: string, itemId: string) {
    await this.findTemplateOrThrow(tenantId, templateId);
    return this.prisma.qCChecklistItem.delete({ where: { id: itemId } });
  }

  private async findTemplateOrThrow(tenantId: string, id: string) {
    const template = await this.prisma.qCTemplate.findFirst({ where: { id, tenantId } });
    if (!template) throw new NotFoundException(`ไม่พบ QC Template ID: ${id}`);
    return template;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // QC RECORDS
  // ═══════════════════════════════════════════════════════════════════════════

  async listRecords(tenantId: string, query: QueryQCRecordDto) {
    const { page = 1, limit = 20, status, supplierId, goodsReceiveId, from, to } = query;
    const skip = (page - 1) * limit;

    const where: any = { tenantId };
    if (status) where.status = status;
    if (goodsReceiveId) where.goodsReceiveId = goodsReceiveId;

    // Date range filter on createdAt
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) {
        // Include the full end date (set to end-of-day)
        const toDate = new Date(to);
        toDate.setHours(23, 59, 59, 999);
        where.createdAt.lte = toDate;
      }
    }

    // Supplier filter via GR linkage
    // QCRecord has no direct Prisma relation to GoodsReceive — must resolve GR IDs first
    if (supplierId) {
      const linkedGRs = await this.prisma.goodsReceive.findMany({
        where: { tenantId, purchaseOrder: { supplierId } },
        select: { id: true },
      });
      where.goodsReceiveId = { in: linkedGRs.map((gr) => gr.id) };
    }

    const [rawData, total] = await Promise.all([
      this.prisma.qCRecord.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          template: {
            select: { id: true, name: true, _count: { select: { checklistItems: true } } },
          },
          lot: { select: { id: true, lotNumber: true } },
          results: { select: { passed: true } },
        },
      }),
      this.prisma.qCRecord.count({ where }),
    ]);

    // Resolve linked GR + supplier + inspector data in batch round-trips so the
    // list can show "GR-202604-0001 · Acme Supplier · ตรวจโดย คุณก้อง · 8 นาที"
    // without extra fetches per row.
    const grIds = Array.from(
      new Set(
        rawData.map((r: any) => r.goodsReceiveId).filter((id: string | null): id is string => !!id),
      ),
    );
    const inspectorIds = Array.from(
      new Set(rawData.map((r: any) => r.inspectedBy).filter(Boolean)),
    );

    const [grs, inspectors] = await Promise.all([
      grIds.length
        ? this.prisma.goodsReceive.findMany({
            where: { id: { in: grIds } },
            select: {
              id: true,
              grNumber: true,
              purchaseOrder: {
                select: {
                  id: true,
                  poNumber: true,
                  supplier: { select: { id: true, name: true } },
                },
              },
            },
          })
        : Promise.resolve([] as any[]),
      inspectorIds.length
        ? this.prisma.user.findMany({
            where: { id: { in: inspectorIds as string[] } },
            select: { id: true, firstName: true, lastName: true, email: true },
          })
        : Promise.resolve([] as any[]),
    ]);

    const grMap = new Map(grs.map((g: any) => [g.id, g]));
    const inspectorMap = new Map(
      inspectors.map((u: any) => [
        u.id,
        [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email,
      ]),
    );

    const data = rawData.map((rec: any) => {
      const checklistTotal = rec.template?._count?.checklistItems ?? 0;
      const completed = rec.results.length;
      const passed = rec.results.filter((r: any) => r.passed === true).length;
      const failed = rec.results.filter((r: any) => r.passed === false).length;

      const gr = rec.goodsReceiveId ? grMap.get(rec.goodsReceiveId) : null;

      // Submitted records carry inspectedAt; PENDING records have inspectedAt
      // = createdAt by Prisma default. Don't compute durationMs for PENDING.
      const durationMs =
        rec.status !== 'PENDING' && rec.inspectedAt && rec.createdAt
          ? new Date(rec.inspectedAt).getTime() - new Date(rec.createdAt).getTime()
          : null;

      return {
        id: rec.id,
        status: rec.status,
        notes: rec.notes,
        createdAt: rec.createdAt,
        inspectedAt: rec.inspectedAt,
        inspectedBy: rec.inspectedBy,
        inspectedByName: inspectorMap.get(rec.inspectedBy) ?? null,
        durationMs,
        template: rec.template ? { id: rec.template.id, name: rec.template.name } : null,
        lot: rec.lot,
        goodsReceiveId: rec.goodsReceiveId,
        goodsReceiveNumber: gr?.grNumber ?? null,
        purchaseOrderId: gr?.purchaseOrder?.id ?? null,
        purchaseOrderNumber: gr?.purchaseOrder?.poNumber ?? null,
        supplier: gr?.purchaseOrder?.supplier ?? null,
        progress: {
          checklistTotal,
          completed,
          passed,
          failed,
          passRate: completed > 0 ? Math.round((passed / completed) * 100) : 0,
          completionRate: checklistTotal > 0 ? Math.round((completed / checklistTotal) * 100) : 0,
        },
      };
    });

    return { data, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  async createRecord(tenantId: string, dto: CreateQCRecordDto, userId: string) {
    const template = await this.findTemplateOrThrow(tenantId, dto.templateId);

    return this.prisma.qCRecord.create({
      data: {
        tenantId,
        templateId: template.id,
        goodsReceiveId: dto.goodsReceiveId,
        lotId: dto.lotId,
        inspectedBy: userId,
        notes: dto.notes,
        status: QCRecordStatus.PENDING,
      },
      include: { template: { include: { checklistItems: { orderBy: { orderIndex: 'asc' } } } } },
    });
  }

  async getRecord(tenantId: string, id: string) {
    const record = await this.prisma.qCRecord.findFirst({
      where: { id, tenantId },
      include: {
        template: { include: { checklistItems: { orderBy: { orderIndex: 'asc' } } } },
        results: { include: { checklistItem: true } },
        lot: { select: { id: true, lotNumber: true, status: true } },
      },
    });
    if (!record) throw new NotFoundException(`ไม่พบ QC Record ID: ${id}`);
    return record;
  }

  async submitRecord(tenantId: string, id: string, dto: SubmitQCRecordDto) {
    const record = await this.getRecord(tenantId, id);
    if (record.status !== QCRecordStatus.PENDING) {
      throw new ConflictException('QC record นี้ถูก submit ไปแล้ว');
    }

    const template = record.template;
    const checklistItems = template.checklistItems;

    // Validate all required items have results
    const requiredItems = checklistItems.filter((ci) => ci.required);
    const submittedItemIds = new Set(dto.results.map((r) => r.checklistItemId));
    const missing = requiredItems.filter((ci) => !submittedItemIds.has(ci.id));
    if (missing.length > 0) {
      throw new BadRequestException(
        `ยังไม่ได้กรอก checklist items ที่จำเป็น: ${missing.map((m) => m.label).join(', ')}`,
      );
    }

    // Determine overall status
    const failedRequired = dto.results.filter((r) => {
      const item = checklistItems.find((ci) => ci.id === r.checklistItemId);
      return item?.required && !r.passed;
    });
    const failedOptional = dto.results.filter((r) => {
      const item = checklistItems.find((ci) => ci.id === r.checklistItemId);
      return !item?.required && !r.passed;
    });

    let status: QCRecordStatus;
    if (failedRequired.length > 0) {
      status = QCRecordStatus.FAILED;
    } else if (failedOptional.length > 0) {
      status = QCRecordStatus.PARTIAL_FAIL;
    } else {
      status = QCRecordStatus.PASSED;
    }

    return this.prisma.$transaction(async (tx) => {
      // Upsert results
      for (const result of dto.results) {
        await tx.qCResult.upsert({
          where: {
            // No composite unique yet — find existing
            id: await tx.qCResult
              .findFirst({ where: { recordId: id, checklistItemId: result.checklistItemId } })
              .then((r) => r?.id ?? ''),
          },
          update: {
            valueBool: result.valueBool,
            valueNumeric: result.valueNumeric !== undefined ? result.valueNumeric : null,
            valueText: result.valueText,
            photoUrls: result.photoUrls ? result.photoUrls : undefined,
            passed: result.passed,
          },
          create: {
            recordId: id,
            checklistItemId: result.checklistItemId,
            valueBool: result.valueBool,
            valueNumeric: result.valueNumeric !== undefined ? result.valueNumeric : null,
            valueText: result.valueText,
            photoUrls: result.photoUrls ? result.photoUrls : undefined,
            passed: result.passed,
          },
        });
      }

      // Update record status
      const updatedRecord = await tx.qCRecord.update({
        where: { id },
        data: { status, notes: dto.notes ?? record.notes },
        include: { results: true, lot: true },
      });

      // If lot linked and FAILED → quarantine lot
      if (record.lotId && status === QCRecordStatus.FAILED) {
        await tx.inventoryLot.update({
          where: { id: record.lotId },
          data: {
            status: 'QUARANTINED',
            notes: `[QC FAILED] Auto-quarantined after QC record ${id}`,
          },
        });
      }

      return updatedRecord;
    });
  }

  // ─── Upload photo (stores URL returned by Firebase) ─────────────────────────
  async savePhotoUrl(tenantId: string, recordId: string, checklistItemId: string, url: string) {
    await this.getRecord(tenantId, recordId); // Validate ownership

    const existing = await this.prisma.qCResult.findFirst({
      where: { recordId, checklistItemId },
    });

    const photoUrls = existing ? [...((existing.photoUrls as string[]) ?? []), url] : [url];

    return this.prisma.qCResult.upsert({
      where: { id: existing?.id ?? '' },
      update: { photoUrls },
      create: {
        recordId,
        checklistItemId,
        passed: false,
        photoUrls,
      },
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SUPPLIER QUALITY REPORT
  // ═══════════════════════════════════════════════════════════════════════════

  async getSupplierQualityReport(
    tenantId: string,
    supplierId: string,
    period: { from: string; to: string },
  ) {
    const grIds = await this.prisma.goodsReceive
      .findMany({
        where: {
          tenantId,
          purchaseOrder: { supplierId },
          receiveDate: { gte: new Date(period.from), lte: new Date(period.to) },
        },
        select: { id: true },
      })
      .then((rs) => rs.map((r) => r.id));

    const records = await this.prisma.qCRecord.findMany({
      where: { tenantId, goodsReceiveId: { in: grIds } },
      select: { id: true, status: true, inspectedAt: true, createdAt: true },
    });

    const total = records.length;
    const passed = records.filter((r) => r.status === 'PASSED').length;
    const partialFail = records.filter((r) => r.status === 'PARTIAL_FAIL').length;
    const failed = records.filter((r) => r.status === 'FAILED').length;

    return {
      supplierId,
      period,
      total,
      passed,
      partialFail,
      failed,
      passRate: total > 0 ? Math.round((passed / total) * 100) : null,
      rejectionRate: total > 0 ? Math.round((failed / total) * 100) : null,
    };
  }
}
