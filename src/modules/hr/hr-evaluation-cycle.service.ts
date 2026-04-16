import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateEvaluationCycleDto,
  UpdateEvaluationCycleDto,
} from './dto/create-evaluation-cycle.dto';

@Injectable()
export class HrEvaluationCycleService {
  private readonly logger = new Logger(HrEvaluationCycleService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── Query ───────────────────────────────────────────────────────────────────

  async findAll(tenantId: string, query: Record<string, string>) {
    const { status, period } = query;
    const page = parseInt(query.page ?? '1', 10);
    const limit = parseInt(query.limit ?? '20', 10);
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { tenantId };
    if (status) where['status'] = status;
    if (period) where['period'] = period;

    const [data, total] = await Promise.all([
      (this.prisma as any).hrEvaluationCycle.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          template: {
            select: { id: true, name: true, periodType: true },
          },
          _count: {
            select: { performances: true },
          },
        },
      }),
      (this.prisma as any).hrEvaluationCycle.count({ where }),
    ]);

    // Enrich with progress stats
    const enriched = await Promise.all(
      data.map(async (cycle: any) => {
        const [done, total_perf] = await Promise.all([
          (this.prisma as any).hrPerformance.count({
            where: { cycleId: cycle.id, status: { in: ['submitted', 'approved'] } },
          }),
          (this.prisma as any).hrPerformance.count({ where: { cycleId: cycle.id } }),
        ]);
        return { ...cycle, progress: { done, total: total_perf } };
      }),
    );

    return { data: enriched, total, page, limit };
  }

  async findOne(id: string, tenantId: string) {
    const cycle = await (this.prisma as any).hrEvaluationCycle.findFirst({
      where: { id, tenantId },
      include: {
        template: { include: { items: { orderBy: { sortOrder: 'asc' } } } },
        performances: {
          include: {
            employee: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                employeeCode: true,
                department: true,
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!cycle) throw new NotFoundException(`Evaluation Cycle ${id} not found`);
    return cycle;
  }

  // ─── Mutations ───────────────────────────────────────────────────────────────

  /**
   * สร้าง Evaluation Cycle + auto-generate HrPerformance records สำหรับทุก employee
   */
  async create(dto: CreateEvaluationCycleDto, tenantId: string, createdBy?: string) {
    // Validate template
    const template = await (this.prisma as any).hrKpiTemplate.findFirst({
      where: { id: dto.templateId, OR: [{ tenantId }, { tenantId: null }] },
      include: { items: true },
    });
    if (!template) throw new NotFoundException(`KPI Template ${dto.templateId} not found`);
    if (template.items.length === 0) {
      throw new BadRequestException('Template ต้องมี KPI criteria อย่างน้อย 1 รายการก่อนเปิดรอบ');
    }

    // Validate employees
    if (!dto.employeeIds || dto.employeeIds.length === 0) {
      throw new BadRequestException('ต้องเลือกพนักงานอย่างน้อย 1 คน');
    }

    const employees = await (this.prisma as any).employee.findMany({
      where: { id: { in: dto.employeeIds }, tenantId },
      select: { id: true },
    });
    if (employees.length !== dto.employeeIds.length) {
      throw new BadRequestException('บางรหัสพนักงานไม่ถูกต้องหรือไม่อยู่ใน tenant นี้');
    }

    // Check duplicate cycle for same period + template
    const existing = await (this.prisma as any).hrEvaluationCycle.findFirst({
      where: { tenantId, templateId: dto.templateId, period: dto.period },
    });
    if (existing) {
      throw new ConflictException(
        `มีรอบประเมิน ${dto.period} ด้วย Template นี้อยู่แล้ว (ID: ${existing.id})`,
      );
    }

    // Create cycle + performance records in a single transaction
    const result = await (this.prisma as any).$transaction(async (tx: any) => {
      const cycle = await tx.hrEvaluationCycle.create({
        data: {
          tenantId,
          templateId: dto.templateId,
          name: dto.name,
          period: dto.period,
          periodType: dto.periodType,
          startDate: new Date(dto.startDate),
          endDate: new Date(dto.endDate),
          dueDate: new Date(dto.dueDate),
          description: dto.description,
          status: 'open',
          createdBy,
        },
      });

      // Auto-generate HrPerformance records (status: pending)
      await tx.hrPerformance.createMany({
        data: employees.map((emp: { id: string }) => ({
          tenantId,
          employeeId: emp.id,
          cycleId: cycle.id,
          templateId: dto.templateId,
          period: dto.period,
          periodType: dto.periodType,
          status: 'pending',
        })),
        skipDuplicates: true,
      });

      return cycle;
    });

    this.logger.log(
      `Evaluation Cycle created: ${result.id} — ${dto.name} — ${employees.length} performances generated`,
    );

    return {
      ...result,
      generatedCount: employees.length,
    };
  }

  async update(id: string, dto: UpdateEvaluationCycleDto, tenantId: string) {
    const cycle = await (this.prisma as any).hrEvaluationCycle.findFirst({
      where: { id, tenantId },
    });
    if (!cycle) throw new NotFoundException(`Evaluation Cycle ${id} not found`);

    const updated = await (this.prisma as any).hrEvaluationCycle.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.dueDate !== undefined && { dueDate: new Date(dto.dueDate) }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.status !== undefined && { status: dto.status }),
      },
      include: { template: { select: { id: true, name: true } } },
    });

    this.logger.log(`Evaluation Cycle updated: ${id}`);
    return updated;
  }

  async close(id: string, tenantId: string) {
    const cycle = await (this.prisma as any).hrEvaluationCycle.findFirst({
      where: { id, tenantId },
    });
    if (!cycle) throw new NotFoundException(`Evaluation Cycle ${id} not found`);
    if (cycle.status !== 'open') {
      throw new ConflictException(`Cycle is already ${cycle.status}`);
    }

    const updated = await (this.prisma as any).hrEvaluationCycle.update({
      where: { id },
      data: { status: 'closed' },
    });

    this.logger.log(`Evaluation Cycle closed: ${id}`);
    return updated;
  }

  async getProgress(id: string, tenantId: string) {
    const cycle = await (this.prisma as any).hrEvaluationCycle.findFirst({
      where: { id, tenantId },
    });
    if (!cycle) throw new NotFoundException(`Evaluation Cycle ${id} not found`);

    const [total, pending, draft, submitted, approved, rejected] = await Promise.all([
      (this.prisma as any).hrPerformance.count({ where: { cycleId: id } }),
      (this.prisma as any).hrPerformance.count({ where: { cycleId: id, status: 'pending' } }),
      (this.prisma as any).hrPerformance.count({ where: { cycleId: id, status: 'draft' } }),
      (this.prisma as any).hrPerformance.count({ where: { cycleId: id, status: 'submitted' } }),
      (this.prisma as any).hrPerformance.count({ where: { cycleId: id, status: 'approved' } }),
      (this.prisma as any).hrPerformance.count({ where: { cycleId: id, status: 'rejected' } }),
    ]);

    return {
      cycleId: id,
      cycleName: cycle.name,
      total,
      byStatus: { pending, draft, submitted, approved, rejected },
      completionRate: total > 0 ? Math.round(((submitted + approved) / total) * 100) : 0,
    };
  }
}
