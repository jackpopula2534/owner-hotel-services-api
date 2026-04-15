import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { Decimal } from '@prisma/client/runtime/library';
import {
  QueryKpiSnapshotDto,
  KPIGranularity,
  GenerateDailySnapshotDto,
} from './dto/query-kpi-snapshot.dto';

interface KpiSnapshotData {
  totalRevenue: number;
  roomRevenue: number;
  fbRevenue: number;
  otherRevenue: number;
  totalCost: number;
  materialCost: number;
  laborCost: number;
  overheadCost: number;
  grossProfit: number;
  gopAmount: number;
  gopPercent: number;
  occupancyRate: number;
  adr: number;
  revPAR: number;
  costPOR: number;
  foodCostPercent: number;
  beverageCostPercent: number;
  inventoryValue: number;
  lowStockAlerts: number;
  outOfStockItems: number;
}

@Injectable()
export class KpiSnapshotsService {
  private readonly logger = new Logger(KpiSnapshotsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Generate daily KPI snapshot for a property
   * Calculates all KPIs for the specified date (defaults to today)
   */
  async generateDailySnapshot(tenantId: string, dto: GenerateDailySnapshotDto): Promise<any> {
    try {
      const { propertyId, snapshotDate } = dto;
      const snapshotDateObj = snapshotDate ? new Date(snapshotDate) : new Date();

      // Set to start of day
      snapshotDateObj.setHours(0, 0, 0, 0);

      // Calculate all KPIs
      const kpiData = await this.calculateDailyKpis(tenantId, propertyId, snapshotDateObj);

      // Check if snapshot already exists for this date
      const existingSnapshot = await this.prisma.costKpiSnapshot.findUnique({
        where: {
          tenantId_propertyId_snapshotDate_granularity: {
            tenantId,
            propertyId,
            snapshotDate: snapshotDateObj,
            granularity: 'daily',
          },
        },
      });

      let snapshot;
      if (existingSnapshot) {
        // Update existing snapshot
        snapshot = await this.prisma.costKpiSnapshot.update({
          where: { id: existingSnapshot.id },
          data: {
            ...kpiData,
            snapshotDate: snapshotDateObj,
          },
        });
      } else {
        // Create new snapshot
        snapshot = await this.prisma.costKpiSnapshot.create({
          data: {
            tenantId,
            propertyId,
            snapshotDate: snapshotDateObj,
            granularity: 'daily',
            ...kpiData,
          },
        });
      }

      return this.formatSnapshot(snapshot);
    } catch (error) {
      this.logger.error(
        `Error generating daily snapshot: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw new InternalServerErrorException('Failed to generate daily snapshot');
    }
  }

  /**
   * Get a specific KPI snapshot
   */
  async getSnapshot(
    tenantId: string,
    propertyId: string,
    snapshotDate: Date,
    granularity: string = 'daily',
  ): Promise<any> {
    try {
      const snapshot = await this.prisma.costKpiSnapshot.findUnique({
        where: {
          tenantId_propertyId_snapshotDate_granularity: {
            tenantId,
            propertyId,
            snapshotDate,
            granularity,
          },
        },
      });

      if (!snapshot) {
        // If no snapshot exists, calculate live
        const kpiData = await this.calculateDailyKpis(tenantId, propertyId, snapshotDate);
        return this.formatKpiData(kpiData);
      }

      return this.formatSnapshot(snapshot);
    } catch (error) {
      this.logger.error(
        `Error fetching snapshot: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw new InternalServerErrorException('Failed to fetch snapshot');
    }
  }

  /**
   * Get range of KPI snapshots
   */
  async getRange(
    tenantId: string,
    query: QueryKpiSnapshotDto,
  ): Promise<{ data: any[]; total: number }> {
    try {
      const { propertyId, startDate, endDate, granularity = 'daily' } = query;

      const where: any = {
        tenantId,
        propertyId,
        granularity,
      };

      if (startDate || endDate) {
        where.snapshotDate = {};
        if (startDate) {
          const start = new Date(startDate);
          start.setHours(0, 0, 0, 0);
          where.snapshotDate.gte = start;
        }
        if (endDate) {
          const end = new Date(endDate);
          end.setHours(23, 59, 59, 999);
          where.snapshotDate.lte = end;
        }
      }

      const [snapshots, total] = await Promise.all([
        this.prisma.costKpiSnapshot.findMany({
          where,
          orderBy: { snapshotDate: 'asc' },
        }),
        this.prisma.costKpiSnapshot.count({ where }),
      ]);

      return {
        data: snapshots.map((s) => this.formatSnapshot(s)),
        total,
      };
    } catch (error) {
      this.logger.error(
        `Error fetching snapshot range: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw new InternalServerErrorException('Failed to fetch snapshot range');
    }
  }

  /**
   * Calculate monthly KPI snapshot (aggregated from daily)
   */
  async calculateMonthlyKpi(
    tenantId: string,
    propertyId: string,
    periodStr: string, // YYYY-MM format
  ): Promise<any> {
    try {
      const [year, month] = periodStr.split('-').map(Number);
      const startDate = new Date(year, month - 1, 1);
      const endDate = new Date(year, month, 0);

      // Get all daily snapshots for the period
      const dailySnapshots = await this.prisma.costKpiSnapshot.findMany({
        where: {
          tenantId,
          propertyId,
          granularity: 'daily',
          snapshotDate: {
            gte: startDate,
            lte: endDate,
          },
        },
        orderBy: { snapshotDate: 'asc' },
      });

      if (dailySnapshots.length === 0) {
        // If no daily snapshots, calculate fresh
        const kpiData = await this.calculateMonthlyKpis(tenantId, propertyId, startDate, endDate);
        startDate.setHours(0, 0, 0, 0);
        const existingMonthly = await this.prisma.costKpiSnapshot.findUnique({
          where: {
            tenantId_propertyId_snapshotDate_granularity: {
              tenantId,
              propertyId,
              snapshotDate: startDate,
              granularity: 'monthly',
            },
          },
        });

        if (existingMonthly) {
          const updated = await this.prisma.costKpiSnapshot.update({
            where: { id: existingMonthly.id },
            data: {
              ...kpiData,
            },
          });
          return this.formatSnapshot(updated);
        }

        return await this.prisma.costKpiSnapshot.create({
          data: {
            tenantId,
            propertyId,
            snapshotDate: startDate,
            granularity: 'monthly',
            ...kpiData,
          },
        });
      }

      // Aggregate daily snapshots
      const aggregated = this.aggregateSnapshots(dailySnapshots);

      startDate.setHours(0, 0, 0, 0);
      const existingMonthly = await this.prisma.costKpiSnapshot.findUnique({
        where: {
          tenantId_propertyId_snapshotDate_granularity: {
            tenantId,
            propertyId,
            snapshotDate: startDate,
            granularity: 'monthly',
          },
        },
      });

      let snapshot;
      if (existingMonthly) {
        snapshot = await this.prisma.costKpiSnapshot.update({
          where: { id: existingMonthly.id },
          data: aggregated,
        });
      } else {
        snapshot = await this.prisma.costKpiSnapshot.create({
          data: {
            tenantId,
            propertyId,
            snapshotDate: startDate,
            granularity: 'monthly',
            ...aggregated,
          },
        });
      }

      return this.formatSnapshot(snapshot);
    } catch (error) {
      this.logger.error(
        `Error calculating monthly KPI: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw new InternalServerErrorException('Failed to calculate monthly KPI');
    }
  }

  /**
   * Internal: Calculate daily KPIs
   */
  private async calculateDailyKpis(
    tenantId: string,
    propertyId: string,
    date: Date,
  ): Promise<KpiSnapshotData> {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    try {
      // Revenue: sum cost entries where sourceType='booking' for the day
      const revenueEntries = await this.prisma.costEntry.findMany({
        where: {
          tenantId,
          propertyId,
          entryDate: {
            gte: startOfDay,
            lte: endOfDay,
          },
          sourceType: 'booking',
        },
      });

      const totalRevenue = this.sumAmount(revenueEntries);

      // Room revenue from bookings
      const bookingsToday = await this.prisma.booking.findMany({
        where: {
          tenantId,
          propertyId,
          checkIn: { lte: endOfDay },
          checkOut: { gt: startOfDay },
        },
      });

      const roomRevenue = this.sumAmount(bookingsToday.map((b) => ({ amount: b.totalPrice })));

      // Costs by category
      const costEntries = await this.prisma.costEntry.findMany({
        where: {
          tenantId,
          propertyId,
          entryDate: {
            gte: startOfDay,
            lte: endOfDay,
          },
          status: 'posted',
        },
        include: {
          costType: true,
        },
      });

      const costsByCategory = this.aggregateCostsByCategory(costEntries);
      const totalCost = this.sumAmount(costEntries);

      // Occupancy metrics
      const totalRooms = await this.prisma.room.count({
        where: {
          tenantId,
          propertyId,
        },
      });

      const occupiedRooms = bookingsToday.length;
      const occupancyRate = totalRooms > 0 ? (occupiedRooms / totalRooms) * 100 : 0;
      const adr = occupiedRooms > 0 ? Number(roomRevenue) / occupiedRooms : 0;
      const revPAR = totalRooms > 0 ? Number(roomRevenue) / totalRooms : 0;

      // Room department costs (category='material' or 'labor')
      const roomCosts = costsByCategory.material + costsByCategory.labor;
      const costPOR = occupiedRooms > 0 ? roomCosts / occupiedRooms : 0;

      // Profitability
      const grossProfit = Number(totalRevenue) - totalCost;
      const gopAmount = grossProfit; // For simplicity, GOP = gross profit
      const gopPercent = Number(totalRevenue) > 0 ? (gopAmount / Number(totalRevenue)) * 100 : 0;

      // F&B metrics (from cost entries with F&B-related cost types)
      const fbMetrics = this.calculateFbMetrics(costEntries, Number(totalRevenue));

      // Inventory metrics
      const inventoryMetrics = await this.calculateInventoryMetrics(tenantId, propertyId);

      return {
        totalRevenue: Number(totalRevenue),
        roomRevenue: Number(roomRevenue),
        fbRevenue: 0, // Can be enhanced with restaurant revenue
        otherRevenue: Number(totalRevenue) - Number(roomRevenue),
        totalCost,
        materialCost: costsByCategory.material,
        laborCost: costsByCategory.labor,
        overheadCost: costsByCategory.overhead,
        grossProfit,
        gopAmount,
        gopPercent,
        occupancyRate,
        adr,
        revPAR,
        costPOR,
        foodCostPercent: fbMetrics.foodCostPercent,
        beverageCostPercent: fbMetrics.beverageCostPercent,
        inventoryValue: inventoryMetrics.totalValue,
        lowStockAlerts: inventoryMetrics.lowStockCount,
        outOfStockItems: inventoryMetrics.outOfStockCount,
      };
    } catch (error) {
      this.logger.warn(
        `Error calculating daily KPIs, using defaults: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      // Return defaults if calculation fails
      return this.getDefaultKpis();
    }
  }

  /**
   * Internal: Calculate monthly KPIs from cost entries across the period
   */
  private async calculateMonthlyKpis(
    tenantId: string,
    propertyId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<KpiSnapshotData> {
    try {
      // Sum all revenue entries in the month
      const revenueEntries = await this.prisma.costEntry.findMany({
        where: {
          tenantId,
          propertyId,
          entryDate: {
            gte: startDate,
            lte: endDate,
          },
          sourceType: 'booking',
        },
      });

      const totalRevenue = this.sumAmount(revenueEntries);

      // All bookings overlapping the month
      const bookingsInMonth = await this.prisma.booking.findMany({
        where: {
          tenantId,
          propertyId,
          checkIn: { lte: endDate },
          checkOut: { gte: startDate },
        },
      });

      const roomRevenue = this.sumAmount(bookingsInMonth.map((b) => ({ amount: b.totalPrice })));

      // All cost entries in the month
      const costEntries = await this.prisma.costEntry.findMany({
        where: {
          tenantId,
          propertyId,
          entryDate: {
            gte: startDate,
            lte: endDate,
          },
          status: 'posted',
        },
        include: {
          costType: true,
        },
      });

      const costsByCategory = this.aggregateCostsByCategory(costEntries);
      const totalCost = this.sumAmount(costEntries);

      // Average occupancy for the month
      const totalDays = Math.ceil(
        (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24),
      );
      const totalRooms = await this.prisma.room.count({
        where: {
          tenantId,
          propertyId,
        },
      });

      const occupancyRate = (bookingsInMonth.length / (totalRooms * totalDays)) * 100;
      const adr = bookingsInMonth.length > 0 ? Number(roomRevenue) / bookingsInMonth.length : 0;
      const revPAR = Number(roomRevenue) / (totalRooms * totalDays);

      const costPOR =
        bookingsInMonth.length > 0
          ? (costsByCategory.material + costsByCategory.labor) / bookingsInMonth.length
          : 0;

      const grossProfit = Number(totalRevenue) - totalCost;
      const gopAmount = grossProfit;
      const gopPercent = Number(totalRevenue) > 0 ? (gopAmount / Number(totalRevenue)) * 100 : 0;

      const fbMetrics = this.calculateFbMetrics(costEntries, Number(totalRevenue));
      const inventoryMetrics = await this.calculateInventoryMetrics(tenantId, propertyId);

      return {
        totalRevenue: Number(totalRevenue),
        roomRevenue: Number(roomRevenue),
        fbRevenue: 0,
        otherRevenue: Number(totalRevenue) - Number(roomRevenue),
        totalCost,
        materialCost: costsByCategory.material,
        laborCost: costsByCategory.labor,
        overheadCost: costsByCategory.overhead,
        grossProfit,
        gopAmount,
        gopPercent,
        occupancyRate,
        adr,
        revPAR,
        costPOR,
        foodCostPercent: fbMetrics.foodCostPercent,
        beverageCostPercent: fbMetrics.beverageCostPercent,
        inventoryValue: inventoryMetrics.totalValue,
        lowStockAlerts: inventoryMetrics.lowStockCount,
        outOfStockItems: inventoryMetrics.outOfStockCount,
      };
    } catch (error) {
      this.logger.warn(
        `Error calculating monthly KPIs, using defaults: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      return this.getDefaultKpis();
    }
  }

  /**
   * Aggregate costs by category
   */
  private aggregateCostsByCategory(entries: any[]): {
    material: number;
    labor: number;
    overhead: number;
  } {
    const result = { material: 0, labor: 0, overhead: 0 };

    for (const entry of entries) {
      const amount = Number(entry.amount);
      const category = entry.costType?.category?.toLowerCase() || '';

      if (category.includes('material')) {
        result.material += amount;
      } else if (category.includes('labor')) {
        result.labor += amount;
      } else if (category.includes('overhead')) {
        result.overhead += amount;
      }
    }

    return result;
  }

  /**
   * Calculate F&B metrics
   */
  private calculateFbMetrics(
    entries: any[],
    totalRevenue: number,
  ): { foodCostPercent: number; beverageCostPercent: number } {
    let foodCost = 0;
    let beverageCost = 0;

    for (const entry of entries) {
      const amount = Number(entry.amount);
      const typeName = entry.costType?.name?.toLowerCase() || '';

      if (typeName.includes('food') || typeName.includes('meal')) {
        foodCost += amount;
      } else if (typeName.includes('beverage') || typeName.includes('drink')) {
        beverageCost += amount;
      }
    }

    return {
      foodCostPercent: totalRevenue > 0 ? (foodCost / totalRevenue) * 100 : 0,
      beverageCostPercent: totalRevenue > 0 ? (beverageCost / totalRevenue) * 100 : 0,
    };
  }

  /**
   * Calculate inventory metrics
   */
  private async calculateInventoryMetrics(
    tenantId: string,
    propertyId: string,
  ): Promise<{ totalValue: number; lowStockCount: number; outOfStockCount: number }> {
    try {
      const stocks = await this.prisma.warehouseStock.findMany({
        where: {
          warehouse: {
            propertyId,
          },
        },
        include: {
          item: true,
        },
      });

      let totalValue = 0;
      let lowStockCount = 0;
      let outOfStockCount = 0;

      for (const stock of stocks) {
        totalValue += Number(stock.totalValue);

        if (stock.quantity === 0) {
          outOfStockCount += 1;
        } else if (stock.quantity <= (stock.item?.reorderPoint || 0)) {
          lowStockCount += 1;
        }
      }

      return { totalValue, lowStockCount, outOfStockCount };
    } catch (error) {
      this.logger.warn(
        `Error calculating inventory metrics: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      return { totalValue: 0, lowStockCount: 0, outOfStockCount: 0 };
    }
  }

  /**
   * Aggregate multiple snapshots
   */
  private aggregateSnapshots(snapshots: any[]): Partial<KpiSnapshotData> {
    if (snapshots.length === 0) {
      return this.getDefaultKpis();
    }

    const sum = (key: string) => snapshots.reduce((acc, s) => acc + Number(s[key] || 0), 0);
    const avg = (key: string) => sum(key) / snapshots.length;

    return {
      totalRevenue: sum('totalRevenue'),
      roomRevenue: sum('roomRevenue'),
      fbRevenue: sum('fbRevenue'),
      otherRevenue: sum('otherRevenue'),
      totalCost: sum('totalCost'),
      materialCost: sum('materialCost'),
      laborCost: sum('laborCost'),
      overheadCost: sum('overheadCost'),
      grossProfit: sum('grossProfit'),
      gopAmount: sum('gopAmount'),
      gopPercent: avg('gopPercent'),
      occupancyRate: avg('occupancyRate'),
      adr: avg('adr'),
      revPAR: avg('revPAR'),
      costPOR: avg('costPOR'),
      foodCostPercent: avg('foodCostPercent'),
      beverageCostPercent: avg('beverageCostPercent'),
      inventoryValue: snapshots[snapshots.length - 1].inventoryValue,
      lowStockAlerts: Math.max(...snapshots.map((s) => s.lowStockAlerts)),
      outOfStockItems: Math.max(...snapshots.map((s) => s.outOfStockItems)),
    };
  }

  /**
   * Sum amount field from array of objects
   */
  private sumAmount(items: any[]): number {
    return items.reduce((sum, item) => sum + Number(item.amount || item.totalPrice || 0), 0);
  }

  /**
   * Get default KPI values
   */
  private getDefaultKpis(): KpiSnapshotData {
    return {
      totalRevenue: 0,
      roomRevenue: 0,
      fbRevenue: 0,
      otherRevenue: 0,
      totalCost: 0,
      materialCost: 0,
      laborCost: 0,
      overheadCost: 0,
      grossProfit: 0,
      gopAmount: 0,
      gopPercent: 0,
      occupancyRate: 0,
      adr: 0,
      revPAR: 0,
      costPOR: 0,
      foodCostPercent: 0,
      beverageCostPercent: 0,
      inventoryValue: 0,
      lowStockAlerts: 0,
      outOfStockItems: 0,
    };
  }

  /**
   * Format KPI data for response
   */
  private formatKpiData(data: KpiSnapshotData): any {
    return {
      totalRevenue: Number(data.totalRevenue.toFixed(2)),
      roomRevenue: Number(data.roomRevenue.toFixed(2)),
      fbRevenue: Number(data.fbRevenue.toFixed(2)),
      otherRevenue: Number(data.otherRevenue.toFixed(2)),
      totalCost: Number(data.totalCost.toFixed(2)),
      materialCost: Number(data.materialCost.toFixed(2)),
      laborCost: Number(data.laborCost.toFixed(2)),
      overheadCost: Number(data.overheadCost.toFixed(2)),
      grossProfit: Number(data.grossProfit.toFixed(2)),
      gopAmount: Number(data.gopAmount.toFixed(2)),
      gopPercent: Number(data.gopPercent.toFixed(2)),
      occupancyRate: Number(data.occupancyRate.toFixed(2)),
      adr: Number(data.adr.toFixed(2)),
      revPAR: Number(data.revPAR.toFixed(2)),
      costPOR: Number(data.costPOR.toFixed(2)),
      foodCostPercent: Number(data.foodCostPercent.toFixed(2)),
      beverageCostPercent: Number(data.beverageCostPercent.toFixed(2)),
      inventoryValue: Number(data.inventoryValue.toFixed(2)),
      lowStockAlerts: data.lowStockAlerts,
      outOfStockItems: data.outOfStockItems,
    };
  }

  /**
   * Format snapshot for response
   */
  private formatSnapshot(snapshot: any): any {
    return {
      id: snapshot.id,
      tenantId: snapshot.tenantId,
      propertyId: snapshot.propertyId,
      snapshotDate: snapshot.snapshotDate.toISOString().split('T')[0],
      granularity: snapshot.granularity,
      totalRevenue: Number(snapshot.totalRevenue),
      roomRevenue: Number(snapshot.roomRevenue),
      fbRevenue: Number(snapshot.fbRevenue),
      otherRevenue: Number(snapshot.otherRevenue),
      totalCost: Number(snapshot.totalCost),
      materialCost: Number(snapshot.materialCost),
      laborCost: Number(snapshot.laborCost),
      overheadCost: Number(snapshot.overheadCost),
      grossProfit: Number(snapshot.grossProfit),
      gopAmount: Number(snapshot.gopAmount),
      gopPercent: Number(snapshot.gopPercent),
      occupancyRate: Number(snapshot.occupancyRate),
      adr: Number(snapshot.adr),
      revPAR: Number(snapshot.revPAR),
      costPOR: Number(snapshot.costPOR),
      foodCostPercent: Number(snapshot.foodCostPercent),
      beverageCostPercent: Number(snapshot.beverageCostPercent),
      inventoryValue: Number(snapshot.inventoryValue),
      lowStockAlerts: snapshot.lowStockAlerts,
      outOfStockItems: snapshot.outOfStockItems,
      createdAt: snapshot.createdAt.toISOString(),
    };
  }
}
