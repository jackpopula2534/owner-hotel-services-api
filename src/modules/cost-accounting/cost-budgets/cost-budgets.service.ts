import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateCostBudgetDto } from './dto/create-cost-budget.dto';
import { UpdateCostBudgetDto } from './dto/update-cost-budget.dto';
import { v4 as uuidv4 } from 'uuid';

interface BudgetVsActual {
  costCenterId: string;
  centerName: string;
  costTypeId: string;
  typeName: string;
  budget: number;
  actual: number;
  variance: number;
  variancePercent: number;
}

@Injectable()
export class CostBudgetsService {
  private readonly logger = new Logger(CostBudgetsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAll(tenantId: string, propertyId: string, period?: string): Promise<any[]> {
    const where: any = { tenantId, propertyId };
    if (period) where.period = period;

    const budgets = await this.prisma.costBudget.findMany({
      where,
      include: {
        costCenter: {
          select: { id: true, name: true },
        },
        costType: {
          select: { id: true, name: true, category: true },
        },
      },
      orderBy: { period: 'desc' },
    });

    return budgets.map((budget) => ({
      id: budget.id,
      propertyId: budget.propertyId,
      costCenterId: budget.costCenterId,
      costCenter: budget.costCenter,
      costTypeId: budget.costTypeId,
      costType: budget.costType,
      period: budget.period,
      budgetAmount: budget.budgetAmount,
      notes: budget.notes,
      createdAt: budget.createdAt,
      updatedAt: budget.updatedAt,
    }));
  }

  async findOne(id: string, tenantId: string): Promise<any> {
    const budget = await this.prisma.costBudget.findFirst({
      where: { id, tenantId },
      include: {
        costCenter: {
          select: { id: true, name: true },
        },
        costType: {
          select: { id: true, name: true, category: true },
        },
      },
    });

    if (!budget) {
      throw new NotFoundException(`Cost budget with ID ${id} not found`);
    }

    return {
      id: budget.id,
      propertyId: budget.propertyId,
      costCenterId: budget.costCenterId,
      costCenter: budget.costCenter,
      costTypeId: budget.costTypeId,
      costType: budget.costType,
      period: budget.period,
      budgetAmount: budget.budgetAmount,
      notes: budget.notes,
      createdAt: budget.createdAt,
      updatedAt: budget.updatedAt,
    };
  }

  async create(dto: CreateCostBudgetDto, userId: string, tenantId: string): Promise<any> {
    // Validate cost center belongs to tenant
    const costCenter = await this.prisma.costCenter.findFirst({
      where: { id: dto.costCenterId, tenantId },
    });
    if (!costCenter) {
      throw new BadRequestException(`Cost center ${dto.costCenterId} not found for this tenant`);
    }

    // Validate cost type belongs to tenant
    const costType = await this.prisma.costType.findFirst({
      where: { id: dto.costTypeId, tenantId },
    });
    if (!costType) {
      throw new BadRequestException(`Cost type ${dto.costTypeId} not found for this tenant`);
    }

    // Check unique combo: tenant+property+center+type+period
    const existing = await this.prisma.costBudget.findFirst({
      where: {
        tenantId,
        propertyId: dto.propertyId,
        costCenterId: dto.costCenterId,
        costTypeId: dto.costTypeId,
        period: dto.period,
      },
    });

    if (existing) {
      throw new BadRequestException(
        `Budget already exists for this combination of property, cost center, cost type, and period`,
      );
    }

    const budget = await this.prisma.costBudget.create({
      data: {
        id: uuidv4(),
        tenantId,
        propertyId: dto.propertyId,
        costCenterId: dto.costCenterId,
        costTypeId: dto.costTypeId,
        period: dto.period,
        budgetAmount: dto.budgetAmount,
        notes: dto.notes,
        createdBy: userId,
      },
      include: {
        costCenter: {
          select: { id: true, name: true },
        },
        costType: {
          select: { id: true, name: true, category: true },
        },
      },
    });

    this.logger.log(`Cost budget ${budget.id} created by user ${userId}`);

    return {
      id: budget.id,
      propertyId: budget.propertyId,
      costCenterId: budget.costCenterId,
      costCenter: budget.costCenter,
      costTypeId: budget.costTypeId,
      costType: budget.costType,
      period: budget.period,
      budgetAmount: budget.budgetAmount,
      notes: budget.notes,
      createdAt: budget.createdAt,
      updatedAt: budget.updatedAt,
    };
  }

  async update(id: string, dto: UpdateCostBudgetDto, tenantId: string): Promise<any> {
    // Verify budget exists
    await this.findOne(id, tenantId);

    const budget = await this.prisma.costBudget.update({
      where: { id },
      data: {
        ...(dto.budgetAmount !== undefined && { budgetAmount: dto.budgetAmount }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
      },
      include: {
        costCenter: {
          select: { id: true, name: true },
        },
        costType: {
          select: { id: true, name: true, category: true },
        },
      },
    });

    this.logger.log(`Cost budget ${id} updated`);

    return {
      id: budget.id,
      propertyId: budget.propertyId,
      costCenterId: budget.costCenterId,
      costCenter: budget.costCenter,
      costTypeId: budget.costTypeId,
      costType: budget.costType,
      period: budget.period,
      budgetAmount: budget.budgetAmount,
      notes: budget.notes,
      createdAt: budget.createdAt,
      updatedAt: budget.updatedAt,
    };
  }

  async remove(id: string, tenantId: string): Promise<void> {
    // Verify budget exists
    await this.findOne(id, tenantId);

    await this.prisma.costBudget.delete({
      where: { id },
    });

    this.logger.log(`Cost budget ${id} deleted`);
  }

  async bulkCreate(
    budgets: CreateCostBudgetDto[],
    userId: string,
    tenantId: string,
  ): Promise<any[]> {
    const createdBudgets: any[] = [];

    await this.prisma.$transaction(async (tx) => {
      for (const dto of budgets) {
        // Validate cost center and type belong to tenant
        const [costCenter, costType] = await Promise.all([
          tx.costCenter.findFirst({
            where: { id: dto.costCenterId, tenantId },
          }),
          tx.costType.findFirst({
            where: { id: dto.costTypeId, tenantId },
          }),
        ]);

        if (!costCenter) {
          throw new BadRequestException(
            `Cost center ${dto.costCenterId} not found for this tenant`,
          );
        }
        if (!costType) {
          throw new BadRequestException(`Cost type ${dto.costTypeId} not found for this tenant`);
        }

        // Check unique combo
        const existing = await tx.costBudget.findFirst({
          where: {
            tenantId,
            propertyId: dto.propertyId,
            costCenterId: dto.costCenterId,
            costTypeId: dto.costTypeId,
            period: dto.period,
          },
        });

        if (existing) {
          throw new BadRequestException(
            `Budget already exists for this combination (property: ${dto.propertyId}, center: ${dto.costCenterId}, type: ${dto.costTypeId}, period: ${dto.period})`,
          );
        }

        const budget = await tx.costBudget.create({
          data: {
            id: uuidv4(),
            tenantId,
            propertyId: dto.propertyId,
            costCenterId: dto.costCenterId,
            costTypeId: dto.costTypeId,
            period: dto.period,
            budgetAmount: dto.budgetAmount,
            notes: dto.notes,
            createdBy: userId,
          },
          include: {
            costCenter: {
              select: { id: true, name: true },
            },
            costType: {
              select: { id: true, name: true, category: true },
            },
          },
        });

        createdBudgets.push({
          id: budget.id,
          propertyId: budget.propertyId,
          costCenterId: budget.costCenterId,
          costCenter: budget.costCenter,
          costTypeId: budget.costTypeId,
          costType: budget.costType,
          period: budget.period,
          budgetAmount: budget.budgetAmount,
          notes: budget.notes,
          createdAt: budget.createdAt,
          updatedAt: budget.updatedAt,
        });
      }
    });

    this.logger.log(`Bulk created ${createdBudgets.length} cost budgets by user ${userId}`);
    return createdBudgets;
  }

  async getBudgetVsActual(
    tenantId: string,
    propertyId: string,
    period: string,
  ): Promise<BudgetVsActual[]> {
    // Get all budgets for the period
    const budgets = await this.prisma.costBudget.findMany({
      where: {
        tenantId,
        propertyId,
        period,
      },
      include: {
        costCenter: {
          select: { id: true, name: true },
        },
        costType: {
          select: { id: true, name: true },
        },
      },
    });

    // Get all cost entries for the period
    const entries = await this.prisma.costEntry.findMany({
      where: {
        tenantId,
        propertyId,
        period,
        status: { in: ['posted', 'pending'] },
      },
    });

    // Build result with actual amounts
    const result: BudgetVsActual[] = budgets.map((budget) => {
      const actual = entries
        .filter(
          (entry) =>
            entry.costCenterId === budget.costCenterId && entry.costTypeId === budget.costTypeId,
        )
        .reduce((sum, entry) => sum + Number(entry.amount), 0);

      const budgetAmount = Number(budget.budgetAmount);
      const variance = budgetAmount - actual;
      const variancePercent = budgetAmount > 0 ? (variance / budgetAmount) * 100 : 0;

      return {
        costCenterId: budget.costCenterId,
        centerName: budget.costCenter.name,
        costTypeId: budget.costTypeId,
        typeName: budget.costType.name,
        budget: budgetAmount,
        actual,
        variance,
        variancePercent,
      };
    });

    return result;
  }

  async copyBudget(
    tenantId: string,
    propertyId: string,
    fromPeriod: string,
    toPeriod: string,
  ): Promise<any[]> {
    // Get all budgets from the source period
    const sourceBudgets = await this.prisma.costBudget.findMany({
      where: {
        tenantId,
        propertyId,
        period: fromPeriod,
      },
      include: {
        costCenter: {
          select: { id: true, name: true },
        },
        costType: {
          select: { id: true, name: true, category: true },
        },
      },
    });

    if (sourceBudgets.length === 0) {
      throw new BadRequestException(`No budgets found for period ${fromPeriod}`);
    }

    const createdBudgets: any[] = [];

    await this.prisma.$transaction(async (tx) => {
      for (const sourceBudget of sourceBudgets) {
        // Check if budget already exists in target period
        const existing = await tx.costBudget.findFirst({
          where: {
            tenantId,
            propertyId,
            costCenterId: sourceBudget.costCenterId,
            costTypeId: sourceBudget.costTypeId,
            period: toPeriod,
          },
        });

        if (existing) {
          this.logger.warn(
            `Budget already exists for center ${sourceBudget.costCenterId}, type ${sourceBudget.costTypeId} in period ${toPeriod}. Skipping.`,
          );
          continue;
        }

        const newBudget = await tx.costBudget.create({
          data: {
            id: uuidv4(),
            tenantId,
            propertyId,
            costCenterId: sourceBudget.costCenterId,
            costTypeId: sourceBudget.costTypeId,
            period: toPeriod,
            budgetAmount: sourceBudget.budgetAmount,
            notes: sourceBudget.notes
              ? `Copied from ${fromPeriod}: ${sourceBudget.notes}`
              : `Copied from ${fromPeriod}`,
            createdBy: sourceBudget.createdBy,
          },
          include: {
            costCenter: {
              select: { id: true, name: true },
            },
            costType: {
              select: { id: true, name: true, category: true },
            },
          },
        });

        createdBudgets.push({
          id: newBudget.id,
          propertyId: newBudget.propertyId,
          costCenterId: newBudget.costCenterId,
          costCenter: newBudget.costCenter,
          costTypeId: newBudget.costTypeId,
          costType: newBudget.costType,
          period: newBudget.period,
          budgetAmount: newBudget.budgetAmount,
          notes: newBudget.notes,
          createdAt: newBudget.createdAt,
          updatedAt: newBudget.updatedAt,
        });
      }
    });

    this.logger.log(`Copied ${createdBudgets.length} budgets from ${fromPeriod} to ${toPeriod}`);
    return createdBudgets;
  }
}
