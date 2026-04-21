import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';

interface DepartmentPnLItem {
  name: string;
  type: string;
  revenue: number;
  materialCost: number;
  laborCost: number;
  overheadCost: number;
  totalCost: number;
  netProfit: number;
  margin: number;
}

interface RoomCostItem {
  roomType: string;
  nights: number;
  revenue: number;
  cost: number;
  revenuePerNight: number;
  costPerNight: number;
  profit: number;
  margin: number;
}

interface FoodCostItem {
  menuItemName: string;
  qtySold: number;
  revenue: number;
  ingredientCost: number;
  foodCostPercent: number;
  profitPerUnit: number;
}

interface BudgetVarianceItem {
  costCenter: string;
  costType: string;
  budget: number;
  actual: number;
  variance: number;
  variancePercent: number;
  status: 'under' | 'over' | 'on_target';
}

@Injectable()
export class CostReportsService {
  private readonly logger = new Logger(CostReportsService.name);

  constructor(private readonly prisma: PrismaService) {}

  private parsePeriod(period: string): { year: number; month: number } {
    // Format: YYYY-MM
    const [yearStr, monthStr] = period.split('-');
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);

    if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
      throw new BadRequestException('Invalid period format. Use YYYY-MM');
    }

    return { year, month };
  }

  async getDepartmentPnL(tenantId: string, propertyId: string, period: string) {
    const { year, month } = this.parsePeriod(period);

    // Try to get closed period first
    const closedPeriod = await this.prisma.periodClose.findFirst({
      where: {
        tenantId,
        propertyId,
        year,
        month,
        status: 'CLOSED',
      },
      include: {
        departmentPnLs: true,
      },
    });

    if (closedPeriod) {
      const departments: DepartmentPnLItem[] = closedPeriod.departmentPnLs.map((d) => ({
        name: d.costCenterId,
        type: 'DEPARTMENT',
        revenue: Number(d.revenue),
        materialCost: Number(d.materialCost),
        laborCost: Number(d.laborCost),
        overheadCost: Number(d.overheadCost),
        totalCost: Number(d.totalCost),
        netProfit: Number(d.netProfit),
        margin: Number(d.profitMargin),
      }));

      const periodTotalRevenue = Number(closedPeriod.totalRevenue);
      const periodTotalCost =
        Number(closedPeriod.totalMaterialCost) +
        Number(closedPeriod.totalLaborCost) +
        Number(closedPeriod.totalOverhead) +
        Number(closedPeriod.totalOtherCost);

      return {
        period: `${year}-${String(month).padStart(2, '0')}`,
        departments,
        totals: {
          revenue: periodTotalRevenue,
          totalCost: periodTotalCost,
          grossProfit: periodTotalRevenue - periodTotalCost,
          netOperatingIncome: Number(closedPeriod.netOperatingIncome),
        },
      };
    }

    // Calculate live from cost entries
    const costEntries = await this.prisma.costEntry.findMany({
      where: {
        tenantId,
        propertyId,
        period: `${year}-${String(month).padStart(2, '0')}`,
        status: 'posted',
      },
      include: {
        costCenter: { select: { id: true, name: true } },
        costType: { select: { id: true, category: true } },
      },
    });

    const costByCenterMap = new Map<string, Map<string, number>>();
    costEntries.forEach((entry) => {
      const centerKey = entry.costCenter.name;
      if (!costByCenterMap.has(centerKey)) {
        costByCenterMap.set(centerKey, new Map());
      }
      const centerMap = costByCenterMap.get(centerKey)!;
      const key = entry.costType.category;
      centerMap.set(key, (centerMap.get(key) || 0) + Number(entry.amount));
    });

    const departments: DepartmentPnLItem[] = [];
    let totalRevenue = 0;
    let totalMaterialCost = 0;
    let totalLaborCost = 0;
    let totalOverheadCost = 0;

    for (const [costCenter, typeMap] of costByCenterMap) {
      let centerRevenue = 0;
      let centerMaterial = 0;
      let centerLabor = 0;
      let centerOverhead = 0;
      let centerOther = 0;

      for (const [costType, amount] of typeMap) {
        if (costType === 'REVENUE') {
          centerRevenue += amount;
          totalRevenue += amount;
        } else if (costType === 'MATERIAL') {
          centerMaterial += amount;
          totalMaterialCost += amount;
        } else if (costType === 'LABOR') {
          centerLabor += amount;
          totalLaborCost += amount;
        } else if (costType === 'OVERHEAD') {
          centerOverhead += amount;
          totalOverheadCost += amount;
        } else {
          centerOther += amount;
        }
      }

      const centerTotalCost = centerMaterial + centerLabor + centerOverhead + centerOther;
      const centerNetProfit = centerRevenue - centerTotalCost;
      const centerMargin = centerRevenue > 0 ? (centerNetProfit / centerRevenue) * 100 : 0;

      departments.push({
        name: costCenter,
        type: costCenter === 'ROOMS' ? 'ROOMS' : 'OVERHEAD',
        revenue: centerRevenue,
        materialCost: centerMaterial,
        laborCost: centerLabor,
        overheadCost: centerOverhead,
        totalCost: centerTotalCost,
        netProfit: centerNetProfit,
        margin: centerMargin,
      });
    }

    const totalCost = totalMaterialCost + totalLaborCost + totalOverheadCost;

    return {
      period: `${year}-${String(month).padStart(2, '0')}`,
      departments,
      totals: {
        revenue: totalRevenue,
        totalCost,
        grossProfit: totalRevenue - totalCost,
        netOperatingIncome: totalRevenue - totalCost,
      },
    };
  }

  async getRoomCostReport(tenantId: string, propertyId: string, period: string) {
    const { year, month } = this.parsePeriod(period);

    // Check if period is closed
    const closedPeriod = await this.prisma.periodClose.findFirst({
      where: {
        tenantId,
        propertyId,
        year,
        month,
        status: 'CLOSED',
      },
      include: {
        roomCostAnalyses: true,
      },
    });

    let occupancy = {
      rate: 0,
      totalNights: 0,
      occupiedNights: 0,
    };

    let byRoomType: RoomCostItem[] = [];
    let averages = {
      avgRevenuePerNight: 0,
      avgCostPerNight: 0,
      avgProfit: 0,
      avgMargin: 0,
    };

    if (closedPeriod) {
      occupancy = {
        rate: Number(closedPeriod.occupancyRate),
        totalNights: closedPeriod.totalRoomNights,
        occupiedNights: closedPeriod.occupiedRoomNights,
      };

      byRoomType = closedPeriod.roomCostAnalyses.map((a) => ({
        roomType: a.roomType,
        nights: a.totalNights,
        revenue: Number(a.totalRevenue),
        cost: Number(a.amenityCost),
        revenuePerNight: Number(a.revenuePerNight),
        costPerNight: Number(a.costPerNight),
        profit: Number(a.profitPerNight) * a.totalNights,
        margin: Number(a.margin),
      }));

      if (byRoomType.length > 0) {
        const totalNights = byRoomType.reduce((sum, r) => sum + r.nights, 0);
        const totalRevenue = byRoomType.reduce((sum, r) => sum + r.revenue, 0);
        const totalCost = byRoomType.reduce((sum, r) => sum + r.cost, 0);
        const totalProfit = byRoomType.reduce((sum, r) => sum + r.profit, 0);

        averages = {
          avgRevenuePerNight: totalNights > 0 ? totalRevenue / totalNights : 0,
          avgCostPerNight: totalNights > 0 ? totalCost / totalNights : 0,
          avgProfit: totalNights > 0 ? totalProfit / totalNights : 0,
          avgMargin:
            byRoomType.length > 0
              ? byRoomType.reduce((sum, r) => sum + r.margin, 0) / byRoomType.length
              : 0,
        };
      }
    } else {
      try {
        // Calculate live from bookings
        const property = await this.prisma.property.findUnique({
          where: { id: propertyId },
        });

        if (property) {
          const roomCount = await this.prisma.room.count({ where: { propertyId } });
          const totalRoomCount = roomCount || 1;
          const daysInMonth = new Date(year, month, 0).getDate();
          const totalRoomNights = totalRoomCount * daysInMonth;

          const bookings = await this.prisma.booking.findMany({
            where: {
              propertyId,
              tenantId,
              scheduledCheckIn: {
                gte: new Date(year, month - 1, 1),
                lt: new Date(year, month, 1),
              },
            },
            include: { room: true },
          });

          const roomTypeMap = new Map<string, any>();
          let occupiedNights = 0;

          bookings.forEach((booking) => {
            const roomType = booking.room?.type || 'Unknown';
            if (!roomTypeMap.has(roomType)) {
              roomTypeMap.set(roomType, {
                nights: 0,
                revenue: 0,
              });
            }
            const data = roomTypeMap.get(roomType)!;
            const nights = Math.ceil(
              (new Date(booking.scheduledCheckOut).getTime() -
                new Date(booking.scheduledCheckIn).getTime()) /
                (1000 * 60 * 60 * 24),
            );
            data.nights += nights;
            data.revenue += Number(booking.totalPrice) || 0;
            occupiedNights += nights;
          });

          occupancy = {
            rate: totalRoomNights > 0 ? (occupiedNights / totalRoomNights) * 100 : 0,
            totalNights: totalRoomNights,
            occupiedNights,
          };

          let totalRevenue = 0;
          const totalCost = 0;
          let totalProfit = 0;

          for (const [roomType, data] of roomTypeMap) {
            const revenuePerNight = data.nights > 0 ? data.revenue / data.nights : 0;
            const costPerNight = 0;
            const profit = (revenuePerNight - costPerNight) * data.nights;
            const margin =
              revenuePerNight > 0 ? ((revenuePerNight - costPerNight) / revenuePerNight) * 100 : 0;

            byRoomType.push({
              roomType,
              nights: data.nights,
              revenue: data.revenue,
              cost: 0,
              revenuePerNight,
              costPerNight,
              profit,
              margin,
            });

            totalRevenue += data.revenue;
            totalProfit += profit;
          }

          if (byRoomType.length > 0) {
            averages = {
              avgRevenuePerNight: occupiedNights > 0 ? totalRevenue / occupiedNights : 0,
              avgCostPerNight: 0,
              avgProfit: occupiedNights > 0 ? totalProfit / occupiedNights : 0,
              avgMargin:
                byRoomType.length > 0
                  ? byRoomType.reduce((sum, r) => sum + r.margin, 0) / byRoomType.length
                  : 0,
            };
          }
        }
      } catch (error) {
        this.logger.warn(`Could not calculate room cost report: ${error}`);
      }
    }

    return {
      period: `${year}-${String(month).padStart(2, '0')}`,
      occupancy,
      byRoomType,
      averages,
    };
  }

  async getFoodCostReport(tenantId: string, propertyId: string, period: string) {
    const { year, month } = this.parsePeriod(period);

    // Check if period is closed
    const closedPeriod = await this.prisma.periodClose.findFirst({
      where: {
        tenantId,
        propertyId,
        year,
        month,
        status: 'CLOSED',
      },
      include: {
        foodCostAnalyses: true,
      },
    });

    let byMenuItem: FoodCostItem[] = [];
    let overview = {
      totalRevenue: 0,
      totalIngredientCost: 0,
      avgFoodCostPercent: 0,
    };

    if (closedPeriod) {
      byMenuItem = closedPeriod.foodCostAnalyses.map((a) => ({
        menuItemName: a.menuItemName,
        qtySold: a.quantitySold,
        revenue: Number(a.totalRevenue),
        ingredientCost: Number(a.ingredientCost),
        foodCostPercent: Number(a.foodCostPercent),
        profitPerUnit: Number(a.sellingPrice) - Number(a.costPerUnit),
      }));

      const totalRevenue = closedPeriod.foodCostAnalyses.reduce(
        (sum, a) => sum + Number(a.totalRevenue),
        0,
      );
      const totalCost = closedPeriod.foodCostAnalyses.reduce(
        (sum, a) => sum + Number(a.ingredientCost),
        0,
      );

      overview = {
        totalRevenue,
        totalIngredientCost: totalCost,
        avgFoodCostPercent: totalRevenue > 0 ? (totalCost / totalRevenue) * 100 : 0,
      };
    } else {
      try {
        // Order model uses restaurantId (no propertyId directly) — filter via restaurant
        const restaurants = await this.prisma.restaurant.findMany({
          where: { propertyId, tenantId },
          select: { id: true },
        });
        const restaurantIds = restaurants.map((r) => r.id);

        const orders = await this.prisma.order.findMany({
          where: {
            restaurantId: { in: restaurantIds },
            createdAt: {
              gte: new Date(year, month - 1, 1),
              lt: new Date(year, month, 1),
            },
          },
          include: { items: true },
        });

        const menuItemMap = new Map<string, any>();
        let totalRevenue = 0;
        const totalCost = 0;

        orders.forEach((order) => {
          order.items.forEach((item) => {
            const key = item.menuItemId;
            if (!menuItemMap.has(key)) {
              menuItemMap.set(key, {
                qty: 0,
                revenue: 0,
                cost: 0,
              });
            }
            const data = menuItemMap.get(key)!;
            data.qty += item.quantity;
            const lineRevenue = Number(item.unitPrice) * item.quantity;
            data.revenue += lineRevenue;
            totalRevenue += lineRevenue;
          });
        });

        for (const [menuItemId, data] of menuItemMap) {
          const foodCostPercent = data.revenue > 0 ? (data.cost / data.revenue) * 100 : 0;
          const costPerUnit = data.qty > 0 ? data.cost / data.qty : 0;

          byMenuItem.push({
            menuItemName: menuItemId,
            qtySold: data.qty,
            revenue: data.revenue,
            ingredientCost: data.cost,
            foodCostPercent,
            profitPerUnit: data.qty > 0 ? data.revenue / data.qty - costPerUnit : 0,
          });
        }

        overview = {
          totalRevenue,
          totalIngredientCost: totalCost,
          avgFoodCostPercent: totalRevenue > 0 ? (totalCost / totalRevenue) * 100 : 0,
        };
      } catch (error) {
        this.logger.warn(`Could not calculate food cost report: ${error}`);
      }
    }

    const alertItems = byMenuItem.filter((item) => item.foodCostPercent > 35);

    return {
      period: `${year}-${String(month).padStart(2, '0')}`,
      overview,
      byMenuItem,
      alertItems,
    };
  }

  async getCostTrend(tenantId: string, propertyId: string, periods: number) {
    const now = new Date();
    const trendPeriods: any[] = [];

    for (let i = periods - 1; i >= 0; i--) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const year = date.getFullYear();
      const month = date.getMonth() + 1;

      const period = await this.prisma.periodClose.findFirst({
        where: {
          tenantId,
          propertyId,
          year,
          month,
          status: 'CLOSED',
        },
      });

      if (period) {
        trendPeriods.push({
          period: `${year}-${String(month).padStart(2, '0')}`,
          revenue: Number(period.totalRevenue),
          materialCost: Number(period.totalMaterialCost),
          laborCost: Number(period.totalLaborCost),
          overheadCost: Number(period.totalOverhead),
          netProfit: Number(period.netOperatingIncome),
          occupancyRate: Number(period.occupancyRate),
          revPAR: Number(period.revPAR),
          costPerRoom: Number(period.costPerOccupiedRoom),
        });
      }
    }

    return { periods: trendPeriods };
  }

  async getBudgetVarianceReport(tenantId: string, propertyId: string, period: string) {
    const { year, month } = this.parsePeriod(period);
    const periodStr = `${year}-${String(month).padStart(2, '0')}`;

    const budgets = await this.prisma.costBudget.findMany({
      where: {
        tenantId,
        propertyId,
        period: periodStr,
      },
      include: {
        costCenter: { select: { id: true, name: true } },
        costType: { select: { id: true, name: true } },
      },
    });

    const costEntries = await this.prisma.costEntry.findMany({
      where: {
        tenantId,
        propertyId,
        period: periodStr,
        status: 'posted',
      },
    });

    const actualByCenterType = new Map<string, number>();
    costEntries.forEach((entry) => {
      const key = `${entry.costCenterId}:${entry.costTypeId}`;
      actualByCenterType.set(key, (actualByCenterType.get(key) || 0) + Number(entry.amount));
    });

    const items: BudgetVarianceItem[] = [];
    let totalBudget = 0;
    let totalActual = 0;

    budgets.forEach((budget) => {
      const key = `${budget.costCenterId}:${budget.costTypeId}`;
      const actual = actualByCenterType.get(key) || 0;
      const budgetAmount = Number(budget.budgetAmount);
      const variance = budgetAmount - actual;
      const variancePercent = budgetAmount > 0 ? (variance / budgetAmount) * 100 : 0;

      let status: 'under' | 'over' | 'on_target' = 'on_target';
      if (variance > budgetAmount * 0.05) status = 'under';
      else if (variance < -budgetAmount * 0.05) status = 'over';

      items.push({
        costCenter: budget.costCenter.name,
        costType: budget.costType.name,
        budget: budgetAmount,
        actual,
        variance,
        variancePercent,
        status,
      });

      totalBudget += budgetAmount;
      totalActual += actual;
    });

    return {
      period: periodStr,
      items,
      totals: {
        totalBudget,
        totalActual,
        totalVariance: totalBudget - totalActual,
      },
    };
  }
}
