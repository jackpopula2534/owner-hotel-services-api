import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateKpiTemplateDto,
  UpdateKpiTemplateDto,
  CreateKpiTemplateItemDto,
  UpdateKpiTemplateItemDto,
} from './dto/create-kpi-template.dto';

/** ตรวจสอบว่าน้ำหนักรวม items = 100% */
function validateWeightSum(weights: number[]): void {
  const total = weights.reduce((s, w) => s + w, 0);
  if (Math.abs(total - 100) > 0.01) {
    throw new BadRequestException(
      `น้ำหนัก KPI รวมต้องเท่ากับ 100% (ปัจจุบัน: ${total.toFixed(2)}%)`,
    );
  }
}

@Injectable()
export class HrKpiTemplateService {
  private readonly logger = new Logger(HrKpiTemplateService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── Templates ───────────────────────────────────────────────────────────────

  async findAll(tenantId: string, query: Record<string, string>) {
    const { isActive, departmentCode, search } = query;
    const where: Record<string, unknown> = {
      OR: [{ tenantId }, { tenantId: null }], // รวม system defaults
    };
    if (isActive !== undefined) where['isActive'] = isActive === 'true';
    if (departmentCode) where['departmentCode'] = departmentCode;
    if (search) {
      where['OR'] = [
        { name: { contains: search } },
        { nameEn: { contains: search } },
      ];
    }

    return (this.prisma as any).hrKpiTemplate.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      include: {
        items: { orderBy: { sortOrder: 'asc' } },
        _count: { select: { cycles: true } },
      },
    });
  }

  async findOne(id: string, tenantId: string) {
    const template = await (this.prisma as any).hrKpiTemplate.findFirst({
      where: { id, OR: [{ tenantId }, { tenantId: null }] },
      include: {
        items: { orderBy: { sortOrder: 'asc' } },
        _count: { select: { cycles: true } },
      },
    });
    if (!template) throw new NotFoundException(`KPI Template ${id} not found`);
    return template;
  }

  async create(dto: CreateKpiTemplateDto, tenantId: string) {
    validateWeightSum(dto.items.map((i) => i.weight));

    const template = await (this.prisma as any).hrKpiTemplate.create({
      data: {
        tenantId,
        name: dto.name,
        nameEn: dto.nameEn,
        departmentCode: dto.departmentCode,
        positionCode: dto.positionCode,
        periodType: dto.periodType,
        description: dto.description,
        isActive: dto.isActive ?? true,
        items: {
          create: dto.items.map((item, index) => ({
            name: item.name,
            nameEn: item.nameEn,
            description: item.description,
            weight: item.weight,
            minScore: item.minScore ?? 1,
            maxScore: item.maxScore ?? 5,
            sortOrder: item.sortOrder ?? index,
          })),
        },
      },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    });

    this.logger.log(`KPI Template created: ${template.id} — ${template.name}`);
    return template;
  }

  async update(id: string, dto: UpdateKpiTemplateDto, tenantId: string) {
    const template = await this.findOne(id, tenantId);

    if (template.isDefault) {
      throw new ConflictException('ไม่สามารถแก้ไข System Default Template ได้');
    }

    const updated = await (this.prisma as any).hrKpiTemplate.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.nameEn !== undefined && { nameEn: dto.nameEn }),
        ...(dto.departmentCode !== undefined && { departmentCode: dto.departmentCode }),
        ...(dto.positionCode !== undefined && { positionCode: dto.positionCode }),
        ...(dto.periodType !== undefined && { periodType: dto.periodType }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    });

    this.logger.log(`KPI Template updated: ${id}`);
    return updated;
  }

  async remove(id: string, tenantId: string) {
    const template = await this.findOne(id, tenantId);

    if (template.isDefault) {
      throw new ConflictException('ไม่สามารถลบ System Default Template ได้');
    }
    if (template._count.cycles > 0) {
      throw new ConflictException(
        `ไม่สามารถลบ Template ที่มี Evaluation Cycle ใช้งานอยู่ (${template._count.cycles} รอบ)`,
      );
    }

    await (this.prisma as any).hrKpiTemplate.delete({ where: { id } });
    this.logger.log(`KPI Template deleted: ${id}`);
    return { message: 'KPI Template deleted successfully' };
  }

  // ─── Template Items (Criteria) ────────────────────────────────────────────────

  async addItem(templateId: string, dto: CreateKpiTemplateItemDto, tenantId: string) {
    await this.findOne(templateId, tenantId);

    // ตรวจสอบ weight รวมหลังเพิ่ม
    const existing = await (this.prisma as any).hrKpiTemplateItem.findMany({
      where: { templateId },
      select: { weight: true },
    });
    const existingTotal = existing.reduce((s: number, i: { weight: { toNumber?: () => number } | number }) => {
      const w = typeof i.weight === 'object' && 'toNumber' in i.weight ? (i.weight as any).toNumber() : Number(i.weight);
      return s + w;
    }, 0);

    if (existingTotal + dto.weight > 100.01) {
      throw new BadRequestException(
        `น้ำหนักรวมจะเกิน 100% (ปัจจุบัน: ${existingTotal.toFixed(2)}% + ใหม่: ${dto.weight}%)`,
      );
    }

    const item = await (this.prisma as any).hrKpiTemplateItem.create({
      data: {
        templateId,
        name: dto.name,
        nameEn: dto.nameEn,
        description: dto.description,
        weight: dto.weight,
        minScore: dto.minScore ?? 1,
        maxScore: dto.maxScore ?? 5,
        sortOrder: dto.sortOrder ?? 99,
      },
    });

    this.logger.log(`KPI item added: ${item.id} → template ${templateId}`);
    return item;
  }

  async updateItem(
    templateId: string,
    itemId: string,
    dto: UpdateKpiTemplateItemDto,
    tenantId: string,
  ) {
    await this.findOne(templateId, tenantId);

    const item = await (this.prisma as any).hrKpiTemplateItem.findFirst({
      where: { id: itemId, templateId },
    });
    if (!item) throw new NotFoundException(`KPI criteria ${itemId} not found in template ${templateId}`);

    // ถ้า update weight ให้ตรวจสอบรวม
    if (dto.weight !== undefined) {
      const others = await (this.prisma as any).hrKpiTemplateItem.findMany({
        where: { templateId, id: { not: itemId } },
        select: { weight: true },
      });
      const othersTotal = others.reduce((s: number, i: any) => s + Number(i.weight), 0);
      if (othersTotal + dto.weight > 100.01) {
        throw new BadRequestException(
          `น้ำหนักรวมจะเกิน 100% (คนอื่น: ${othersTotal.toFixed(2)}% + ใหม่: ${dto.weight}%)`,
        );
      }
    }

    const updated = await (this.prisma as any).hrKpiTemplateItem.update({
      where: { id: itemId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.nameEn !== undefined && { nameEn: dto.nameEn }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.weight !== undefined && { weight: dto.weight }),
        ...(dto.minScore !== undefined && { minScore: dto.minScore }),
        ...(dto.maxScore !== undefined && { maxScore: dto.maxScore }),
        ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
      },
    });

    return updated;
  }

  async removeItem(templateId: string, itemId: string, tenantId: string) {
    await this.findOne(templateId, tenantId);

    const item = await (this.prisma as any).hrKpiTemplateItem.findFirst({
      where: { id: itemId, templateId },
    });
    if (!item) throw new NotFoundException(`KPI criteria ${itemId} not found`);

    // ตรวจสอบ item ถูกใช้ใน KpiScore
    const usedCount = await (this.prisma as any).hrKpiScore.count({
      where: { criteriaId: itemId },
    });
    if (usedCount > 0) {
      throw new ConflictException(
        `ไม่สามารถลบ KPI criteria ที่มีข้อมูลคะแนนอยู่แล้ว (${usedCount} รายการ)`,
      );
    }

    await (this.prisma as any).hrKpiTemplateItem.delete({ where: { id: itemId } });
    this.logger.log(`KPI item deleted: ${itemId}`);
    return { message: 'KPI criteria deleted successfully' };
  }
}
