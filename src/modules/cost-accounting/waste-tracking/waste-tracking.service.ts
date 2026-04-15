import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateWasteRecordDto, WasteReason } from './dto/create-waste-record.dto';
import { QueryWasteDto } from './dto/query-waste.dto';
import { v4 as uuidv4 } from 'uuid';

interface WasteSummaryByReason {
  reason: WasteReason;
  count: number;
  totalValue: number;
  percentage: number;
}

interface WasteSummaryByDepartment {
  department: string;
  count: number;
  totalValue: number;
}

interface WasteSummaryByItem {
  itemId: string;
  itemName: string;
  sku: string;
  totalQty: number;
  totalValue: number;
}

interface WasteTrendData {
  date: string;
  value: number;
}

interface WasteSummary {
  totalWasteValue: number;
  totalRecords: number;
  byReason: WasteSummaryByReason[];
  byDepartment: WasteSummaryByDepartment[];
  byItem: WasteSummaryByItem[];
  trend: WasteTrendData[];
}

interface WasteHistoryByItem {
  itemName: string;
  sku: string;
  totalWaste: number;
  totalValue: number;
  avgMonthlyWaste: number;
  records: any[];
  monthlyTrend: Array<{ period: string; qty: number; value: number }>;
}

interface TopWastedItem {
  itemId: string;
  itemName: string;
  sku: string;
  totalQty: number;
  totalValue: number;
  mainReason: WasteReason;
  wastePercent: number;
}

@Injectable()
export class WasteTrackingService {
  private readonly logger = new Logger(WasteTrackingService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a waste record and optionally create a WASTE stock movement
   */
  async create(dto: CreateWasteRecordDto, userId: string, tenantId: string): Promise<any> {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    // Verify property exists
    const property = await this.prisma.property.findFirst({
      where: { id: dto.propertyId, tenantId },
    });

    if (!property) {
      throw new NotFoundException(`Property with ID ${dto.propertyId} not found`);
    }

    // Verify warehouse exists
    const warehouse = await this.prisma.warehouse.findFirst({
      where: { id: dto.warehouseId, tenantId },
    });

    if (!warehouse) {
      throw new NotFoundException(`Warehouse with ID ${dto.warehouseId} not found`);
    }

    // Verify item exists
    const item = await this.prisma.inventoryItem.findFirst({
      where: { id: dto.itemId, tenantId },
    });

    if (!item) {
      throw new NotFoundException(`Item with ID ${dto.itemId} not found`);
    }

    try {
      // Create waste record and stock movement in transaction
      const result = await this.prisma.$transaction(async (tx) => {
        // Create waste record
        const wasteRecord = await tx.wasteRecord.create({
          data: {
            id: uuidv4(),
            propertyId: dto.propertyId,
            warehouseId: dto.warehouseId,
            itemId: dto.itemId,
            quantity: dto.quantity,
            unit: dto.unit,
            estimatedCost: dto.estimatedCost,
            reason: dto.reason.toUpperCase() as any,
            department: dto.department,
            notes: dto.notes,
            wasteDate: dto.wasteDate ? new Date(dto.wasteDate) : new Date(),
            recordedBy: userId,
            tenantId,
          },
          include: {
            item: {
              select: { id: true, name: true, sku: true },
            },
          },
        });

        // Create WASTE stock movement (deduct from inventory)
        const stockMovement = await tx.stockMovement.create({
          data: {
            id: uuidv4(),
            itemId: dto.itemId,
            warehouseId: dto.warehouseId,
            type: 'WASTE',
            quantity: Math.abs(dto.quantity), // StockMovement.quantity is Int (always positive)
            unitCost: dto.quantity > 0 ? dto.estimatedCost / dto.quantity : 0,
            totalCost: Math.abs(dto.estimatedCost),
            notes: `Waste: ${dto.reason}`,
            referenceId: wasteRecord.id,
            referenceType: 'WASTE_RECORD',
            createdBy: userId,
            tenantId,
          },
        });

        return { wasteRecord, stockMovement };
      });

      this.logger.log(
        `Created waste record ${result.wasteRecord.id} for item ${item.name} (${dto.reason})`,
      );

      return result.wasteRecord;
    } catch (error) {
      this.logger.error(`Failed to create waste record: ${error.message}`);
      throw error;
    }
  }

  /**
   * Find all waste records with filters and pagination
   */
  async findAll(
    tenantId: string,
    query: QueryWasteDto,
  ): Promise<{ data: any[]; total: number; page: number; limit: number }> {
    const {
      page = 1,
      limit = 20,
      propertyId,
      warehouseId,
      itemId,
      reason,
      department,
      startDate,
      endDate,
    } = query;
    const skip = (page - 1) * limit;

    const where: any = { tenantId };

    if (propertyId) where.propertyId = propertyId;
    if (warehouseId) where.warehouseId = warehouseId;
    if (itemId) where.itemId = itemId;
    if (reason) where.reason = reason;
    if (department) where.department = department;

    if (startDate || endDate) {
      where.wasteDate = {};
      if (startDate) where.wasteDate.gte = new Date(startDate);
      if (endDate) where.wasteDate.lte = new Date(endDate);
    }

    const [data, total] = await Promise.all([
      this.prisma.wasteRecord.findMany({
        where,
        skip,
        take: limit,
        include: {
          item: {
            select: { id: true, name: true, sku: true },
          },
        },
        orderBy: { wasteDate: 'desc' },
      }),
      this.prisma.wasteRecord.count({ where }),
    ]);

    return {
      data: data.map((record) => ({
        id: record.id,
        propertyId: record.propertyId,
        warehouseId: record.warehouseId,
        itemId: record.itemId,
        item: record.item,
        quantity: Number(record.quantity),
        unit: record.unit,
        estimatedCost: Number(record.estimatedCost),
        reason: record.reason,
        department: record.department,
        notes: record.notes,
        wasteDate: record.wasteDate,
        recordedBy: record.recordedBy,
        createdAt: record.createdAt,
      })),
      total,
      page,
      limit,
    };
  }

  /**
   * Find a single waste record by ID
   */
  async findOne(id: string, tenantId: string): Promise<any> {
    const record = await this.prisma.wasteRecord.findFirst({
      where: { id, tenantId },
      include: {
        item: {
          select: { id: true, name: true, sku: true, category: true },
        },
      },
    });

    if (!record) {
      throw new NotFoundException(`Waste record with ID ${id} not found`);
    }

    return record;
  }

  /**
   * Get aggregated waste summary for a property within a date range
   */
  async getWasteSummary(
    tenantId: string,
    propertyId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<WasteSummary> {
    if (!propertyId) {
      throw new BadRequestException('propertyId is required');
    }

    const where = {
      tenantId,
      propertyId,
      wasteDate: {
        gte: startDate,
        lte: endDate,
      },
    };

    // Get all waste records in the range
    const records = await this.prisma.wasteRecord.findMany({
      where,
      include: {
        item: {
          select: { id: true, name: true, sku: true },
        },
      },
    });

    if (records.length === 0) {
      return {
        totalWasteValue: 0,
        totalRecords: 0,
        byReason: [],
        byDepartment: [],
        byItem: [],
        trend: [],
      };
    }

    // Calculate total waste value
    const totalWasteValue = records.reduce((sum, r) => sum + Number(r.estimatedCost), 0);

    // Group by reason with percentage
    const byReasonMap = new Map<string, WasteSummaryByReason>();
    records.forEach((record) => {
      const reasonKey = String(record.reason).toLowerCase() as WasteReason;
      const existing = byReasonMap.get(reasonKey) || {
        reason: reasonKey,
        count: 0,
        totalValue: 0,
        percentage: 0,
      };
      existing.count += 1;
      existing.totalValue += Number(record.estimatedCost);
      byReasonMap.set(reasonKey, existing);
    });

    const byReason = Array.from(byReasonMap.values()).map((item) => ({
      ...item,
      percentage:
        totalWasteValue > 0 ? Math.round((item.totalValue / totalWasteValue) * 10000) / 100 : 0,
    }));

    // Group by department
    const byDepartmentMap = new Map<string, WasteSummaryByDepartment>();
    records.forEach((record) => {
      const dept = record.department || 'Unassigned';
      const existing = byDepartmentMap.get(dept) || {
        department: dept,
        count: 0,
        totalValue: 0,
      };
      existing.count += 1;
      existing.totalValue += Number(record.estimatedCost);
      byDepartmentMap.set(dept, existing);
    });

    const byDepartment = Array.from(byDepartmentMap.values());

    // Group by item
    const byItemMap = new Map<string, WasteSummaryByItem>();
    records.forEach((record) => {
      const itemId = record.itemId;
      const existing = byItemMap.get(itemId) || {
        itemId,
        itemName: record.item?.name || 'Unknown',
        sku: record.item?.sku || 'N/A',
        totalQty: 0,
        totalValue: 0,
      };
      existing.totalQty += Number(record.quantity);
      existing.totalValue += Number(record.estimatedCost);
      byItemMap.set(itemId, existing);
    });

    const byItem = Array.from(byItemMap.values());

    // Daily trend
    const trendMap = new Map<string, WasteTrendData>();
    records.forEach((record) => {
      const dateStr = record.wasteDate.toISOString().split('T')[0];
      const existing = trendMap.get(dateStr) || {
        date: dateStr,
        value: 0,
      };
      existing.value += Number(record.estimatedCost);
      trendMap.set(dateStr, existing);
    });

    const trend = Array.from(trendMap.values()).sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
    );

    return {
      totalWasteValue,
      totalRecords: records.length,
      byReason,
      byDepartment,
      byItem,
      trend,
    };
  }

  /**
   * Get detailed waste history for a specific item
   */
  async getWasteByItem(
    tenantId: string,
    propertyId: string,
    itemId: string,
    months: number = 12,
  ): Promise<WasteHistoryByItem> {
    // Calculate date range (last N months)
    const endDate = new Date();
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - months);

    const where = {
      tenantId,
      propertyId,
      itemId,
      wasteDate: {
        gte: startDate,
        lte: endDate,
      },
    };

    // Get item details
    const item = await this.prisma.inventoryItem.findFirst({
      where: { id: itemId, tenantId },
    });

    if (!item) {
      throw new NotFoundException(`Item with ID ${itemId} not found`);
    }

    // Get waste records for this item
    const records = await this.prisma.wasteRecord.findMany({
      where,
      orderBy: { wasteDate: 'desc' },
    });

    if (records.length === 0) {
      return {
        itemName: item.name,
        sku: item.sku || 'N/A',
        totalWaste: 0,
        totalValue: 0,
        avgMonthlyWaste: 0,
        records: [],
        monthlyTrend: [],
      };
    }

    // Calculate totals
    const totalWaste = records.reduce((sum, r) => sum + Number(r.quantity), 0);
    const totalValue = records.reduce((sum, r) => sum + Number(r.estimatedCost), 0);

    // Monthly trend
    const monthlyMap = new Map<string, { qty: number; value: number; count: number }>();
    records.forEach((record) => {
      const year = record.wasteDate.getFullYear();
      const month = String(record.wasteDate.getMonth() + 1).padStart(2, '0');
      const period = `${year}-${month}`;
      const existing = monthlyMap.get(period) || {
        qty: 0,
        value: 0,
        count: 0,
      };
      existing.qty += Number(record.quantity);
      existing.value += Number(record.estimatedCost);
      existing.count += 1;
      monthlyMap.set(period, existing);
    });

    const monthlyTrend = Array.from(monthlyMap.entries())
      .map(([period, data]) => ({
        period,
        qty: Math.round(data.qty * 100) / 100,
        value: Math.round(data.value * 100) / 100,
      }))
      .sort((a, b) => a.period.localeCompare(b.period));

    const avgMonthlyWaste = monthlyTrend.length > 0 ? totalWaste / monthlyTrend.length : 0;

    return {
      itemName: item.name,
      sku: item.sku || 'N/A',
      totalWaste,
      totalValue,
      avgMonthlyWaste: Math.round(avgMonthlyWaste * 1000) / 1000,
      records: records.map((r) => ({
        id: r.id,
        quantity: r.quantity,
        unit: r.unit,
        estimatedCost: r.estimatedCost,
        reason: r.reason,
        department: r.department,
        wasteDate: r.wasteDate,
        notes: r.notes,
      })),
      monthlyTrend,
    };
  }

  /**
   * Get top N wasted items by value within a date range
   */
  async getTopWastedItems(
    tenantId: string,
    propertyId: string,
    period: string,
    limit: number = 10,
  ): Promise<TopWastedItem[]> {
    if (!propertyId) {
      throw new BadRequestException('propertyId is required');
    }

    // Parse period (YYYY-MM or YYYY-MM-DD)
    const [year, month, day] = period.split('-').map(Number);

    let startDate: Date;
    let endDate: Date;

    if (day) {
      // Single day
      startDate = new Date(year, month - 1, day, 0, 0, 0);
      endDate = new Date(year, month - 1, day, 23, 59, 59);
    } else {
      // Entire month
      startDate = new Date(year, month - 1, 1, 0, 0, 0);
      endDate = new Date(year, month, 0, 23, 59, 59);
    }

    const where = {
      tenantId,
      propertyId,
      wasteDate: {
        gte: startDate,
        lte: endDate,
      },
    };

    // Get all waste records
    const records = await this.prisma.wasteRecord.findMany({
      where,
      include: {
        item: {
          select: { id: true, name: true, sku: true },
        },
      },
    });

    // Calculate total waste value for percentage calculation
    const totalValue = records.reduce((sum, r) => sum + Number(r.estimatedCost), 0);

    // Group by item and find main reason
    const itemMap = new Map<
      string,
      {
        itemId: string;
        itemName: string;
        sku: string;
        totalQty: number;
        totalValue: number;
        reasonCounts: Map<WasteReason, number>;
      }
    >();

    records.forEach((record) => {
      const key = record.itemId;
      const existing = itemMap.get(key) || {
        itemId: record.itemId,
        itemName: record.item?.name || 'Unknown',
        sku: record.item?.sku || 'N/A',
        totalQty: 0,
        totalValue: 0,
        reasonCounts: new Map<WasteReason, number>(),
      };

      existing.totalQty += Number(record.quantity);
      existing.totalValue += Number(record.estimatedCost);
      const reasonKey = String(record.reason).toLowerCase() as WasteReason;
      const reasonCount = existing.reasonCounts.get(reasonKey) || 0;
      existing.reasonCounts.set(reasonKey, reasonCount + 1);

      itemMap.set(key, existing);
    });

    // Convert to array, calculate main reason and waste percent
    const topItems = Array.from(itemMap.values())
      .map((item) => {
        // Find reason with highest count
        let mainReason = WasteReason.OTHER;
        let maxCount = 0;
        item.reasonCounts.forEach((count, reason) => {
          if (count > maxCount) {
            maxCount = count;
            mainReason = reason;
          }
        });

        return {
          itemId: item.itemId,
          itemName: item.itemName,
          sku: item.sku,
          totalQty: Math.round(item.totalQty * 1000) / 1000,
          totalValue: Math.round(item.totalValue * 100) / 100,
          mainReason,
          wastePercent:
            totalValue > 0 ? Math.round((item.totalValue / totalValue) * 10000) / 100 : 0,
        };
      })
      .sort((a, b) => b.totalValue - a.totalValue)
      .slice(0, limit);

    return topItems;
  }
}
