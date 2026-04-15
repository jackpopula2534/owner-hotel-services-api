import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { KpiSnapshotsService } from '../kpi-snapshots/kpi-snapshots.service';

interface KpiCard {
  value: number;
  changePercent: number;
  trend: 'up' | 'down' | 'flat';
  target?: number;
  achievedPercent?: number;
  alertLevel?: 'normal' | 'warning' | 'critical';
}

interface OverviewCards {
  todayRevenue: KpiCard;
  monthRevenue: KpiCard;
  occupancyRate: KpiCard;
  gopPercent: KpiCard;
  foodCostPercent: KpiCard;
  costPerRoom: KpiCard;
  inventoryValue: KpiCard;
  lowStockAlerts: { count: number; criticalCount: number };
}

interface ChartDataset {
  label: string;
  data: number[];
  borderColor?: string;
  backgroundColor?: string;
  fill?: boolean;
}

interface RevenueChart {
  labels: string[];
  datasets: {
    room: number[];
    fb: number[];
    other: number[];
    total: number[];
  };
}

interface CostBreakdownChart {
  labels: string[];
  values: number[];
  percentages: number[];
  colors: string[];
}

interface OccupancyChart {
  labels: string[];
  datasets: {
    occupancyRate: number[];
    adr: number[];
    revPAR: number[];
  };
}

interface DepartmentData {
  name: string;
  revenue: number;
  cost: number;
  profit: number;
  margin: number;
}

interface AlertItem {
  type: 'low_stock' | 'high_food_cost' | 'over_budget' | 'waste_spike';
  severity: 'warning' | 'critical';
  message: string;
  link?: string;
}

interface TopAlerts {
  alerts: AlertItem[];
}

@Injectable()
export class DashboardWidgetsService {
  private readonly logger = new Logger(DashboardWidgetsService.name);

  private readonly chartColors = {
    primary: '#8b5cf6',
    secondary: '#ec4899',
    success: '#10b981',
    warning: '#f59e0b',
    danger: '#ef4444',
    info: '#3b82f6',
    light: '#f3f4f6',
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly kpiSnapshotsService: KpiSnapshotsService,
  ) {}

  /**
   * Get KPI overview cards for dashboard
   */
  async getOverviewCards(
    tenantId: string,
    propertyId: string,
  ): Promise<{ success: boolean; data: OverviewCards }> {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      // Get today's and yesterday's snapshots
      const todaySnapshot = await this.kpiSnapshotsService.getSnapshot(
        tenantId,
        propertyId,
        today,
        'daily',
      );

      const yesterdaySnapshot = await this.kpiSnapshotsService.getSnapshot(
        tenantId,
        propertyId,
        yesterday,
        'daily',
      );

      // Get current month snapshot
      const currentDate = new Date();
      const monthStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
      const monthSnapshot = await this.kpiSnapshotsService.getSnapshot(
        tenantId,
        propertyId,
        monthStart,
        'monthly',
      );

      // Get budget target (assuming 20% GOP target)
      const budgetTarget = todaySnapshot.totalRevenue * 0.2;

      // Calculate changes
      const revenueChange =
        yesterdaySnapshot.totalRevenue > 0
          ? ((todaySnapshot.totalRevenue - yesterdaySnapshot.totalRevenue) /
              yesterdaySnapshot.totalRevenue) *
            100
          : 0;

      const occupancyChange =
        yesterdaySnapshot.occupancyRate > 0
          ? todaySnapshot.occupancyRate - yesterdaySnapshot.occupancyRate
          : 0;

      const gopChange =
        yesterdaySnapshot.gopPercent > 0
          ? todaySnapshot.gopPercent - yesterdaySnapshot.gopPercent
          : 0;

      const costChange =
        yesterdaySnapshot.totalCost > 0
          ? ((todaySnapshot.totalCost - yesterdaySnapshot.totalCost) /
              yesterdaySnapshot.totalCost) *
            100
          : 0;

      // Determine alert level for food cost
      let foodCostAlert: 'normal' | 'warning' | 'critical' = 'normal';
      if (todaySnapshot.foodCostPercent > 40) {
        foodCostAlert = 'critical';
      } else if (todaySnapshot.foodCostPercent > 35) {
        foodCostAlert = 'warning';
      }

      // Get low stock alerts
      const lowStockItems = await this.prisma.warehouseStock.findMany({
        where: {
          warehouse: {
            propertyId,
          },
          item: {
            tenantId,
          },
        },
        include: {
          item: true,
        },
      });

      let lowStockCount = 0;
      let criticalCount = 0;
      for (const stock of lowStockItems) {
        if (stock.quantity === 0) {
          criticalCount += 1;
        } else if (stock.quantity <= (stock.item?.reorderPoint || 0)) {
          lowStockCount += 1;
        }
      }

      const cards: OverviewCards = {
        todayRevenue: {
          value: todaySnapshot.totalRevenue,
          changePercent: revenueChange,
          trend: revenueChange > 2 ? 'up' : revenueChange < -2 ? 'down' : 'flat',
        },
        monthRevenue: {
          value: monthSnapshot.totalRevenue,
          changePercent: 0,
          trend: 'flat',
          target: budgetTarget,
          achievedPercent: (monthSnapshot.totalRevenue / budgetTarget) * 100,
        },
        occupancyRate: {
          value: todaySnapshot.occupancyRate,
          changePercent: occupancyChange,
          trend: occupancyChange > 2 ? 'up' : occupancyChange < -2 ? 'down' : 'flat',
        },
        gopPercent: {
          value: todaySnapshot.gopPercent,
          changePercent: gopChange,
          trend: gopChange > 2 ? 'up' : gopChange < -2 ? 'down' : 'flat',
        },
        foodCostPercent: {
          value: todaySnapshot.foodCostPercent,
          changePercent: 0,
          trend: 'flat',
          alertLevel: foodCostAlert,
        },
        costPerRoom: {
          value: todaySnapshot.costPOR,
          changePercent:
            yesterdaySnapshot.costPOR > 0
              ? ((todaySnapshot.costPOR - yesterdaySnapshot.costPOR) / yesterdaySnapshot.costPOR) *
                100
              : 0,
          trend: costChange > 2 ? 'up' : costChange < -2 ? 'down' : 'flat',
        },
        inventoryValue: {
          value: todaySnapshot.inventoryValue,
          changePercent: 0,
          trend: 'flat',
        },
        lowStockAlerts: {
          count: lowStockCount,
          criticalCount,
        },
      };

      return { success: true, data: cards };
    } catch (error) {
      this.logger.error(
        `Error getting overview cards: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw new InternalServerErrorException('Failed to get overview cards');
    }
  }

  /**
   * Get revenue chart data (last N days breakdown)
   */
  async getRevenueChart(
    tenantId: string,
    propertyId: string,
    days: number = 30,
  ): Promise<RevenueChart> {
    try {
      const endDate = new Date();
      endDate.setHours(23, 59, 59, 999);

      const startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - days);
      startDate.setHours(0, 0, 0, 0);

      const snapshots = await this.prisma.costKpiSnapshot.findMany({
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

      const labels: string[] = [];
      const roomData: number[] = [];
      const fbData: number[] = [];
      const otherData: number[] = [];
      const totalData: number[] = [];

      for (let i = 0; i < days; i++) {
        const date = new Date(startDate);
        date.setDate(date.getDate() + i);
        const dateStr = date.toISOString().split('T')[0];
        labels.push(dateStr);

        const snapshot = snapshots.find(
          (s) => s.snapshotDate.toISOString().split('T')[0] === dateStr,
        );

        if (snapshot) {
          roomData.push(Number(snapshot.roomRevenue));
          fbData.push(Number(snapshot.fbRevenue));
          otherData.push(Number(snapshot.otherRevenue));
          totalData.push(Number(snapshot.totalRevenue));
        } else {
          roomData.push(0);
          fbData.push(0);
          otherData.push(0);
          totalData.push(0);
        }
      }

      return {
        labels,
        datasets: {
          room: roomData,
          fb: fbData,
          other: otherData,
          total: totalData,
        },
      };
    } catch (error) {
      this.logger.error(
        `Error getting revenue chart: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw new InternalServerErrorException('Failed to get revenue chart');
    }
  }

  /**
   * Get cost breakdown pie chart
   */
  async getCostBreakdownChart(
    tenantId: string,
    propertyId: string,
    period: string, // YYYY-MM
  ): Promise<CostBreakdownChart> {
    try {
      const [year, month] = period.split('-').map(Number);
      const startDate = new Date(year, month - 1, 1);
      const endDate = new Date(year, month, 0);

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

      const costsByCategory: { [key: string]: number } = {};

      for (const entry of costEntries) {
        const category = entry.costType?.category || 'Other';
        const amount = Number(entry.amount);
        costsByCategory[category] = (costsByCategory[category] || 0) + amount;
      }

      const labels = Object.keys(costsByCategory);
      const values = Object.values(costsByCategory);
      const totalCost = values.reduce((sum, val) => sum + val, 0);
      const percentages = values.map((val) => (totalCost > 0 ? (val / totalCost) * 100 : 0));

      const colorMap: { [key: string]: string } = {
        material: this.chartColors.primary,
        labor: this.chartColors.secondary,
        overhead: this.chartColors.warning,
        utility: this.chartColors.info,
        maintenance: this.chartColors.danger,
        other: this.chartColors.light,
      };

      const colors = labels.map((label) => colorMap[label.toLowerCase()] || this.chartColors.info);

      return {
        labels,
        values,
        percentages,
        colors,
      };
    } catch (error) {
      this.logger.error(
        `Error getting cost breakdown: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw new InternalServerErrorException('Failed to get cost breakdown chart');
    }
  }

  /**
   * Get occupancy trend chart
   */
  async getOccupancyChart(
    tenantId: string,
    propertyId: string,
    days: number = 30,
  ): Promise<OccupancyChart> {
    try {
      const endDate = new Date();
      endDate.setHours(23, 59, 59, 999);

      const startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - days);
      startDate.setHours(0, 0, 0, 0);

      const snapshots = await this.prisma.costKpiSnapshot.findMany({
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

      const labels: string[] = [];
      const occupancyRates: number[] = [];
      const adrData: number[] = [];
      const revParData: number[] = [];

      for (let i = 0; i < days; i++) {
        const date = new Date(startDate);
        date.setDate(date.getDate() + i);
        const dateStr = date.toISOString().split('T')[0];
        labels.push(dateStr);

        const snapshot = snapshots.find(
          (s) => s.snapshotDate.toISOString().split('T')[0] === dateStr,
        );

        if (snapshot) {
          occupancyRates.push(Number(snapshot.occupancyRate));
          adrData.push(Number(snapshot.adr));
          revParData.push(Number(snapshot.revPAR));
        } else {
          occupancyRates.push(0);
          adrData.push(0);
          revParData.push(0);
        }
      }

      return {
        labels,
        datasets: {
          occupancyRate: occupancyRates,
          adr: adrData,
          revPAR: revParData,
        },
      };
    } catch (error) {
      this.logger.error(
        `Error getting occupancy chart: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw new InternalServerErrorException('Failed to get occupancy chart');
    }
  }

  /**
   * Get department comparison chart
   */
  async getDepartmentComparison(
    tenantId: string,
    propertyId: string,
    period: string, // YYYY-MM
  ): Promise<{ departments: DepartmentData[] }> {
    try {
      const [year, month] = period.split('-').map(Number);
      const startDate = new Date(year, month - 1, 1);
      const endDate = new Date(year, month, 0);

      // Get cost centers for the property
      const costCenters = await this.prisma.costCenter.findMany({
        where: {
          tenantId,
          propertyId,
        },
      });

      const departments: DepartmentData[] = [];

      for (const center of costCenters) {
        const costEntries = await this.prisma.costEntry.findMany({
          where: {
            tenantId,
            propertyId,
            costCenterId: center.id,
            entryDate: {
              gte: startDate,
              lte: endDate,
            },
            status: 'posted',
          },
        });

        const totalCost = costEntries.reduce((sum, entry) => sum + Number(entry.amount), 0);

        // Estimate revenue for the department (simplified)
        const revenue = totalCost > 0 ? totalCost * 2 : 0; // 2x markup assumption

        const profit = revenue - totalCost;
        const margin = revenue > 0 ? (profit / revenue) * 100 : 0;

        departments.push({
          name: center.name,
          revenue,
          cost: totalCost,
          profit,
          margin,
        });
      }

      return {
        departments: departments.sort((a, b) => b.profit - a.profit),
      };
    } catch (error) {
      this.logger.error(
        `Error getting department comparison: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw new InternalServerErrorException('Failed to get department comparison');
    }
  }

  /**
   * Get top alerts for dashboard
   */
  async getTopAlerts(tenantId: string, propertyId: string): Promise<TopAlerts> {
    try {
      const alerts: AlertItem[] = [];
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Get today's KPI
      const todaySnapshot = await this.kpiSnapshotsService.getSnapshot(
        tenantId,
        propertyId,
        today,
        'daily',
      );

      // 1. Low stock alerts
      const lowStocks = await this.prisma.warehouseStock.findMany({
        where: {
          warehouse: {
            propertyId,
          },
          item: {
            tenantId,
          },
        },
        include: {
          item: true,
        },
      });

      for (const stock of lowStocks) {
        if (stock.quantity === 0) {
          alerts.push({
            type: 'low_stock',
            severity: 'critical',
            message: `${stock.item?.name || 'Item'} is out of stock`,
            link: `/inventory/items/${stock.itemId}`,
          });
        } else if (stock.quantity <= (stock.item?.reorderPoint || 0)) {
          alerts.push({
            type: 'low_stock',
            severity: 'warning',
            message: `${stock.item?.name || 'Item'} stock is low (${stock.quantity} units)`,
            link: `/inventory/items/${stock.itemId}`,
          });
        }
      }

      // 2. High food cost alert
      if (todaySnapshot.foodCostPercent > 40) {
        alerts.push({
          type: 'high_food_cost',
          severity: 'critical',
          message: `Food cost is critical at ${todaySnapshot.foodCostPercent.toFixed(1)}%`,
          link: '/cost-accounting/cost-entries',
        });
      } else if (todaySnapshot.foodCostPercent > 35) {
        alerts.push({
          type: 'high_food_cost',
          severity: 'warning',
          message: `Food cost is high at ${todaySnapshot.foodCostPercent.toFixed(1)}%`,
          link: '/cost-accounting/cost-entries',
        });
      }

      // 3. Budget overrun alert
      const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
      const monthSnapshot = await this.kpiSnapshotsService.getSnapshot(
        tenantId,
        propertyId,
        monthStart,
        'monthly',
      );

      const budgetTarget = monthSnapshot.totalRevenue * 0.2; // 20% target
      if (monthSnapshot.gopAmount < budgetTarget * 0.9) {
        const percentUnder = ((1 - monthSnapshot.gopAmount / budgetTarget) * 100).toFixed(0);
        alerts.push({
          type: 'over_budget',
          severity: 'warning',
          message: `Monthly profit is ${percentUnder}% below target`,
          link: '/cost-accounting/budgets',
        });
      }

      return {
        alerts: alerts.slice(0, 10), // Limit to top 10 alerts
      };
    } catch (error) {
      this.logger.error(
        `Error getting top alerts: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw new InternalServerErrorException('Failed to get top alerts');
    }
  }
}
