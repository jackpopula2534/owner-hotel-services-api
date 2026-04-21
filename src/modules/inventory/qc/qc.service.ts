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

    return this.prisma.qCTemplate.create({
      data: {
        tenantId,
        name: dto.name,
        appliesTo: dto.appliesTo,
        categoryId: dto.categoryId,
        itemId: dto.itemId,
        checklistItems: dto.checklistItems?.length
          ? { create: dto.checklistItems }
          : undefined,
      },
      include: { checklistItems: { orderBy: { orderIndex: 'asc' } } },
    });
  }

  async updateTemplate(tenantId: string, id: string, dto: UpdateQCTemplateDto) {
    await this.findTemplateOrThrow(tenantId, id);
    return this.prisma.qCTemplate.update({
      where: { id },
      data: { ...dto },
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
      data: { templateId, ...dto },
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
    const { page = 1, limit = 20, status, supplierId, goodsReceiveId } = query;
    const skip = (page - 1) * limit;

    const where: any = { tenantId };
    if (status) where.status = status;
    if (goodsReceiveId) where.goodsReceiveId = goodsReceiveId;

    // Supplier filter via GR linkage
    if (supplierId) {
      where.goodsReceive = { purchaseOrder: { supplierId } };
    }

    const [data, total] = await Promise.all([
      this.prisma.qCRecord.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          template: { select: { id: true, name: true } },
          lot: { select: { id: true, lotNumber: true } },
          _count: { select: { results: true } },
        },
      }),
      this.prisma.qCRecord.count({ where }),
    ]);

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

    const photoUrls = existing
      ? [...((existing.photoUrls as string[]) ?? []), url]
      : [url];

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
