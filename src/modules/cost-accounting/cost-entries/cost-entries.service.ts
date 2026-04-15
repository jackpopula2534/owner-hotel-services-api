import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateCostEntryDto, CostSourceType } from './dto/create-cost-entry.dto';
import { QueryCostEntryDto, CostEntryStatus } from './dto/query-cost-entry.dto';
import { v4 as uuidv4 } from 'uuid';

interface CostEntrySummaryByCenter {
  centerId: string;
  centerName: string;
  material: number;
  labor: number;
  overhead: number;
  revenue: number;
  total: number;
}

interface CostEntrySummaryCostType {
  typeId: string;
  typeName: string;
  category: string;
  total: number;
}

interface CostEntrySummaryGrandTotal {
  material: number;
  labor: number;
  overhead: number;
  revenue: number;
  net: number;
}

interface CostEntrySummary {
  byCenter: CostEntrySummaryByCenter[];
  byCostType: CostEntrySummaryCostType[];
  grandTotal: CostEntrySummaryGrandTotal;
}

interface MonthlyTrend {
  period: string;
  material: number;
  labor: number;
  overhead: number;
  revenue: number;
  netProfit: number;
}

@Injectable()
export class CostEntriesService {
  private readonly logger = new Logger(CostEntriesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    tenantId: string,
    query: QueryCostEntryDto,
  ): Promise<{ data: any[]; total: number; page: number; limit: number }> {
    const {
      page = 1,
      limit = 20,
      propertyId,
      costCenterId,
      costTypeId,
      period,
      startDate,
      endDate,
      sourceType,
      status,
    } = query;
    const skip = (page - 1) * limit;

    const where: any = { tenantId };

    if (propertyId) where.propertyId = propertyId;
    if (costCenterId) where.costCenterId = costCenterId;
    if (costTypeId) where.costTypeId = costTypeId;
    if (period) where.period = period;
    if (sourceType) where.sourceType = sourceType;
    if (status) where.status = status;

    if (startDate || endDate) {
      where.entryDate = {};
      if (startDate) where.entryDate.gte = new Date(startDate);
      if (endDate) where.entryDate.lte = new Date(endDate);
    }

    const [data, total] = await Promise.all([
      this.prisma.costEntry.findMany({
        where,
        skip,
        take: limit,
        include: {
          costCenter: {
            select: { id: true, name: true },
          },
          costType: {
            select: { id: true, name: true, category: true },
          },
        },
        orderBy: { entryDate: 'desc' },
      }),
      this.prisma.costEntry.count({ where }),
    ]);

    return {
      data: data.map((entry) => ({
        id: entry.id,
        propertyId: entry.propertyId,
        costCenterId: entry.costCenterId,
        costCenter: entry.costCenter,
        costTypeId: entry.costTypeId,
        costType: entry.costType,
        amount: entry.amount,
        period: entry.period,
        entryDate: entry.entryDate,
        description: entry.description,
        sourceType: entry.sourceType,
        sourceId: entry.sourceId,
        status: entry.status,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      })),
      total,
      page,
      limit,
    };
  }

  async findOne(id: string, tenantId: string): Promise<any> {
    const entry = await this.prisma.costEntry.findFirst({
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

    if (!entry) {
      throw new NotFoundException(`Cost entry with ID ${id} not found`);
    }

    return {
      id: entry.id,
      propertyId: entry.propertyId,
      costCenterId: entry.costCenterId,
      costCenter: entry.costCenter,
      costTypeId: entry.costTypeId,
      costType: entry.costType,
      amount: entry.amount,
      period: entry.period,
      entryDate: entry.entryDate,
      description: entry.description,
      sourceType: entry.sourceType,
      sourceId: entry.sourceId,
      status: entry.status,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    };
  }

  async create(dto: CreateCostEntryDto, userId: string, tenantId: string): Promise<any> {
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

    // Check if period is closed
    const periodClose = await this.prisma.periodClose.findFirst({
      where: { tenantId, period: dto.period },
    });
    if (periodClose && periodClose.status === 'CLOSED') {
      throw new BadRequestException(`Period ${dto.period} is closed and cannot accept new entries`);
    }

    const entryDate = dto.entryDate ? new Date(dto.entryDate) : new Date();

    const entry = await this.prisma.costEntry.create({
      data: {
        id: uuidv4(),
        tenantId,
        propertyId: dto.propertyId,
        costCenterId: dto.costCenterId,
        costTypeId: dto.costTypeId,
        amount: dto.amount,
        period: dto.period,
        entryDate,
        description: dto.description,
        sourceType: dto.sourceType || CostSourceType.MANUAL,
        sourceId: dto.sourceId,
        status: CostEntryStatus.PENDING,
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

    this.logger.log(`Cost entry ${entry.id} created by user ${userId}`);

    return {
      id: entry.id,
      propertyId: entry.propertyId,
      costCenterId: entry.costCenterId,
      costCenter: entry.costCenter,
      costTypeId: entry.costTypeId,
      costType: entry.costType,
      amount: entry.amount,
      period: entry.period,
      entryDate: entry.entryDate,
      description: entry.description,
      sourceType: entry.sourceType,
      sourceId: entry.sourceId,
      status: entry.status,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    };
  }

  async createBatch(
    entries: CreateCostEntryDto[],
    userId: string,
    tenantId: string,
  ): Promise<any[]> {
    const createdEntries: any[] = [];

    await this.prisma.$transaction(async (tx) => {
      for (const dto of entries) {
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

        // Check period is not closed
        const periodClose = await tx.periodClose.findFirst({
          where: { tenantId, period: dto.period },
        });
        if (periodClose && periodClose.status === 'CLOSED') {
          throw new BadRequestException(
            `Period ${dto.period} is closed and cannot accept new entries`,
          );
        }

        const entryDate = dto.entryDate ? new Date(dto.entryDate) : new Date();

        const entry = await tx.costEntry.create({
          data: {
            id: uuidv4(),
            tenantId,
            propertyId: dto.propertyId,
            costCenterId: dto.costCenterId,
            costTypeId: dto.costTypeId,
            amount: dto.amount,
            period: dto.period,
            entryDate,
            description: dto.description,
            sourceType: dto.sourceType || CostSourceType.MANUAL,
            sourceId: dto.sourceId,
            status: CostEntryStatus.PENDING,
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

        createdEntries.push({
          id: entry.id,
          propertyId: entry.propertyId,
          costCenterId: entry.costCenterId,
          costCenter: entry.costCenter,
          costTypeId: entry.costTypeId,
          costType: entry.costType,
          amount: entry.amount,
          period: entry.period,
          entryDate: entry.entryDate,
          description: entry.description,
          sourceType: entry.sourceType,
          sourceId: entry.sourceId,
          status: entry.status,
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt,
        });
      }
    });

    this.logger.log(`Batch created ${createdEntries.length} cost entries by user ${userId}`);
    return createdEntries;
  }

  async reverse(id: string, userId: string, tenantId: string): Promise<any> {
    const original = await this.findOne(id, tenantId);

    // Check if period is closed
    const periodClose = await this.prisma.periodClose.findFirst({
      where: { tenantId, period: original.period },
    });
    if (periodClose && periodClose.status === 'CLOSED') {
      throw new BadRequestException(
        `Period ${original.period} is closed and cannot accept reversing entries`,
      );
    }

    const reversing = await this.prisma.costEntry.create({
      data: {
        id: uuidv4(),
        tenantId,
        propertyId: original.propertyId,
        costCenterId: original.costCenterId,
        costTypeId: original.costTypeId,
        amount: -original.amount,
        period: original.period,
        entryDate: new Date(),
        description: `Reversal of entry ${id}: ${original.description || ''}`,
        sourceType: original.sourceType,
        sourceId: id,
        status: CostEntryStatus.POSTED,
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

    // Mark original as reversed
    await this.prisma.costEntry.update({
      where: { id },
      data: { status: CostEntryStatus.REVERSED },
    });

    this.logger.log(`Cost entry ${id} reversed with new entry ${reversing.id} by user ${userId}`);

    return {
      id: reversing.id,
      propertyId: reversing.propertyId,
      costCenterId: reversing.costCenterId,
      costCenter: reversing.costCenter,
      costTypeId: reversing.costTypeId,
      costType: reversing.costType,
      amount: reversing.amount,
      period: reversing.period,
      entryDate: reversing.entryDate,
      description: reversing.description,
      sourceType: reversing.sourceType,
      sourceId: reversing.sourceId,
      status: reversing.status,
      createdAt: reversing.createdAt,
      updatedAt: reversing.updatedAt,
    };
  }

  async getSummaryByPeriod(
    tenantId: string,
    propertyId: string,
    period: string,
  ): Promise<CostEntrySummary> {
    const entries = await this.prisma.costEntry.findMany({
      where: {
        tenantId,
        propertyId,
        period,
        status: { in: [CostEntryStatus.POSTED, CostEntryStatus.PENDING] },
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

    const byCenterMap = new Map<string, any>();
    const byCostTypeMap = new Map<string, any>();
    const grandTotal = { material: 0, labor: 0, overhead: 0, revenue: 0, net: 0 };

    for (const entry of entries) {
      const category = entry.costType.category.toUpperCase();
      const amount = entry.amount;

      // By center aggregation
      if (!byCenterMap.has(entry.costCenterId)) {
        byCenterMap.set(entry.costCenterId, {
          centerId: entry.costCenterId,
          centerName: entry.costCenter.name,
          material: 0,
          labor: 0,
          overhead: 0,
          revenue: 0,
          total: 0,
        });
      }
      const centerData = byCenterMap.get(entry.costCenterId);
      centerData[category] = (centerData[category] || 0) + amount;
      centerData.total += amount;

      // By cost type aggregation
      if (!byCostTypeMap.has(entry.costTypeId)) {
        byCostTypeMap.set(entry.costTypeId, {
          typeId: entry.costTypeId,
          typeName: entry.costType.name,
          category: entry.costType.category,
          total: 0,
        });
      }
      const typeData = byCostTypeMap.get(entry.costTypeId);
      typeData.total += amount;

      // Grand total aggregation
      grandTotal[category] = (grandTotal[category] || 0) + amount;
    }

    grandTotal.net =
      grandTotal.material + grandTotal.labor + grandTotal.overhead - grandTotal.revenue;

    return {
      byCenter: Array.from(byCenterMap.values()),
      byCostType: Array.from(byCostTypeMap.values()),
      grandTotal,
    };
  }

  async getMonthlyTrend(
    tenantId: string,
    propertyId: string,
    months: number,
  ): Promise<MonthlyTrend[]> {
    const entries = await this.prisma.costEntry.findMany({
      where: {
        tenantId,
        propertyId,
        status: { in: [CostEntryStatus.POSTED, CostEntryStatus.PENDING] },
      },
      include: {
        costType: {
          select: { category: true },
        },
      },
    });

    const trendMap = new Map<string, any>();

    for (const entry of entries) {
      const category = entry.costType.category.toUpperCase();
      if (!trendMap.has(entry.period)) {
        trendMap.set(entry.period, {
          period: entry.period,
          material: 0,
          labor: 0,
          overhead: 0,
          revenue: 0,
          netProfit: 0,
        });
      }
      const data = trendMap.get(entry.period);
      data[category] = (data[category] || 0) + entry.amount;
    }

    // Calculate netProfit for each period
    for (const data of trendMap.values()) {
      data.netProfit = data.material + data.labor + data.overhead - data.revenue;
    }

    // Sort by period (descending) and take last N months
    const sorted = Array.from(trendMap.values())
      .sort((a, b) => b.period.localeCompare(a.period))
      .slice(0, months);

    return sorted.reverse(); // Return in ascending order
  }
}
