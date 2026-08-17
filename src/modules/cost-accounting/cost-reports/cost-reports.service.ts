import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { daysOfMonth, round2 } from '@/common/utils/bangkok-day.util';
import { RevenueQueryService } from '@/modules/revenue/revenue-query.service';
import { menuItemCosts } from '../shared/menu-item-cost';
import { menuItemSales } from '../shared/menu-item-sales';
import { percentOf } from '../shared/percent';
import { revenueByCostCenter } from '../shared/revenue-by-cost-center';
import { occupiedRoomNights } from '../shared/room-nights';
import { roomRevenueByType } from '../shared/room-revenue-by-type';

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

/**
 * เงินในสมุดที่ยังไม่มีศูนย์ต้นทุนรองรับ — ลง P&L รายแผนกไม่ได้แต่ยังอยู่ในยอดพาดหัว
 *
 * ต้องส่งออกไปให้หน้าจอบอกผู้ใช้ ไม่งั้นผลบวกของแถวไม่เท่ายอดรวมโดยไม่มีคำอธิบาย
 * (และ tenant ที่ยังไม่ได้สร้างศูนย์ต้นทุนเลยจะเห็นแค่ "ไม่มีข้อมูล" ทั้งที่ขายได้)
 */
interface UnmappedRevenueItem {
  segment: string;
  /** ประเภทศูนย์ต้นทุนที่ต้องสร้างเพื่อให้เงินก้อนนี้ลงแผนกได้ */
  expectedCostCenterType: string;
  revenue: number;
}

interface DepartmentPnLReport {
  period: string;
  departments: DepartmentPnLItem[];
  /** รวมเงินที่ยังไม่มีแผนกรองรับ — `totals.revenue` − ผลบวกรายได้ของทุกแถว */
  unmappedRevenue: number;
  /** รายละเอียดว่าเป็นเงินของแผนกไหนและต้องสร้างศูนย์ต้นทุนประเภทใด */
  unmapped: UnmappedRevenueItem[];
  totals: {
    revenue: number;
    totalCost: number;
    grossProfit: number;
    netOperatingIncome: number;
  };
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly revenue: RevenueQueryService,
  ) {}

  private parsePeriod(period: string): { year: number; month: number } {
    // ไม่ส่ง `period` มาเลยก็ต้องได้ 400 เหมือนส่งมาผิดรูปแบบ ของเดิมเรียก
    // `.split()` บน undefined ทันที ผู้เรียกจึงได้ 500 พร้อมข้อความภายในของ V8
    if (typeof period !== 'string') {
      throw new BadRequestException('Invalid period format. Use YYYY-MM');
    }

    // Format: YYYY-MM
    const [yearStr, monthStr] = period.split('-');
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);

    if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
      throw new BadRequestException('Invalid period format. Use YYYY-MM');
    }

    return { year, month };
  }

  async getDepartmentPnL(
    tenantId: string,
    propertyId: string,
    period: string,
  ): Promise<DepartmentPnLReport> {
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

    // ชื่อและประเภทของศูนย์ต้นทุน ใช้ร่วมกันทั้งงวดที่ปิดแล้วและงวดสด เพื่อให้สองทาง
    // แสดงผลเหมือนกัน ของเดิมทางที่ปิดแล้วเอา `costCenterId` (uuid) มาใส่ช่องชื่อ
    const centers = await this.prisma.costCenter.findMany({
      where: { tenantId, propertyId },
      select: { id: true, name: true, type: true },
    });
    const centerById = new Map(centers.map((center) => [center.id, center]));

    if (closedPeriod) {
      const departments: DepartmentPnLItem[] = closedPeriod.departmentPnLs.map((d) => ({
        name: centerById.get(d.costCenterId)?.name ?? d.costCenterId,
        type: centerById.get(d.costCenterId)?.type ?? 'DEPARTMENT',
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

      // งวดที่ปิดแล้วเก็บเฉพาะแถวรายแผนก ไม่ได้เก็บว่าเงินที่ลงแผนกไม่ได้เป็นของแผนกใด
      // — บอกได้แค่ส่วนต่าง แต่ต้องบอก ไม่งั้นผลบวกไม่เท่ายอดพาดหัวแบบไร้คำอธิบาย
      const mappedRevenue = round2(departments.reduce((sum, d) => sum + d.revenue, 0));
      const unmappedRevenue = round2(Math.max(0, periodTotalRevenue - mappedRevenue));

      return {
        period: `${year}-${String(month).padStart(2, '0')}`,
        departments,
        unmappedRevenue,
        unmapped: [],
        totals: {
          revenue: periodTotalRevenue,
          totalCost: periodTotalCost,
          grossProfit: periodTotalRevenue - periodTotalCost,
          netOperatingIncome: Number(closedPeriod.netOperatingIncome),
        },
      };
    }

    // งวดที่ยังไม่ปิด — ต้นทุนจาก cost_entries รายได้จากสมุดกลาง ด้วยตัวช่วยตัวเดียว
    // กับตอนปิดงวด ตัวเลขจึงไม่กระโดดในวันที่บัญชีกดปิด
    const periodStr = `${year}-${String(month).padStart(2, '0')}`;
    const monthDays = daysOfMonth(periodStr);
    const [costEntries, revenueByCenter] = await Promise.all([
      this.prisma.costEntry.findMany({
        where: { tenantId, propertyId, period: periodStr, status: 'posted' },
        include: {
          costCenter: { select: { id: true, name: true, type: true } },
          costType: { select: { id: true, category: true } },
        },
      }),
      revenueByCostCenter(this.prisma, this.revenue, {
        tenantId,
        propertyId,
        from: monthDays[0],
        to: monthDays[monthDays.length - 1],
      }),
    ]);

    // จัดกลุ่มด้วย id ไม่ใช่ชื่อ — ชื่อซ้ำกันได้และผู้ใช้แก้ได้ตลอดเวลา
    const costByCenterMap = new Map<string, Map<string, number>>();
    costEntries.forEach((entry) => {
      const centerKey = entry.costCenterId;
      if (!costByCenterMap.has(centerKey)) {
        costByCenterMap.set(centerKey, new Map());
      }
      const centerMap = costByCenterMap.get(centerKey)!;
      const key = entry.costType.category;
      centerMap.set(key, (centerMap.get(key) || 0) + Number(entry.amount));
    });

    const departments: DepartmentPnLItem[] = [];
    let totalMaterialCost = 0;
    let totalLaborCost = 0;
    let totalOverheadCost = 0;
    let totalOtherCost = 0;

    // แผนกที่มีรายได้แต่ยังไม่มีต้นทุนก็ต้องมีแถว ไม่งั้นแผนกที่ทำเงินได้จะหายไปเลย
    const centerIds = new Set<string>([
      ...costByCenterMap.keys(),
      ...revenueByCenter.byCostCenter.keys(),
    ]);

    for (const centerId of centerIds) {
      const typeMap = costByCenterMap.get(centerId) ?? new Map<string, number>();
      // รายได้มาจากสมุด แถว REVENUE ใน cost_entries ถูกข้าม (จะนับซ้ำ)
      const centerRevenue = revenueByCenter.byCostCenter.get(centerId) ?? 0;
      let centerMaterial = 0;
      let centerLabor = 0;
      let centerOverhead = 0;
      let centerOther = 0;

      for (const [costType, amount] of typeMap) {
        if (costType === 'MATERIAL') {
          centerMaterial += amount;
          totalMaterialCost += amount;
        } else if (costType === 'LABOR') {
          centerLabor += amount;
          totalLaborCost += amount;
        } else if (costType === 'OVERHEAD') {
          centerOverhead += amount;
          totalOverheadCost += amount;
        } else if (costType !== 'REVENUE') {
          centerOther += amount;
          totalOtherCost += amount;
        }
      }

      const centerTotalCost = centerMaterial + centerLabor + centerOverhead + centerOther;
      const centerNetProfit = centerRevenue - centerTotalCost;
      const centerMargin = percentOf(centerNetProfit, centerRevenue);

      const center = centerById.get(centerId);
      departments.push({
        name: center?.name ?? centerId,
        type: center?.type ?? 'DEPARTMENT',
        revenue: centerRevenue,
        materialCost: centerMaterial,
        laborCost: centerLabor,
        overheadCost: centerOverhead,
        totalCost: centerTotalCost,
        netProfit: centerNetProfit,
        margin: centerMargin,
      });
    }

    // `totalOtherCost` เคยตกหล่นจากยอดรวมของงวดสด ทั้งที่ถูกนับอยู่ใน totalCost ของ
    // แต่ละแผนก และงวดที่ปิดแล้วก็รวมไว้ — สองทางจึงเคยได้ยอดรวมไม่เท่ากัน
    const totalCost = totalMaterialCost + totalLaborCost + totalOverheadCost + totalOtherCost;
    // ยอดพาดหัวเป็นยอดของสมุด (รวมเงินที่ยังไม่มีศูนย์ต้นทุนรองรับ) ตรงกับทุกหน้าจอ
    const totalRevenue = revenueByCenter.total;
    // เงินที่ไม่มีศูนย์ต้นทุนของแผนกนั้นรองรับ ส่งออกไปให้หน้าจอชี้ทางแก้ได้
    const unmapped: UnmappedRevenueItem[] = revenueByCenter.unmapped.map((orphan) => ({
      segment: orphan.segment,
      expectedCostCenterType: orphan.expectedCostCenterType,
      revenue: orphan.revenue,
    }));
    const unmappedRevenue = round2(unmapped.reduce((sum, orphan) => sum + orphan.revenue, 0));

    return {
      period: periodStr,
      departments,
      unmappedRevenue,
      unmapped,
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
        // findFirst (NOT findUnique): Property is tenant-scoped and the
        // tenant-scope middleware rejects findUnique on scoped models.
        const property = await this.prisma.property.findFirst({
          where: { id: propertyId, tenantId },
        });

        if (property) {
          const periodStr = `${year}-${String(month).padStart(2, '0')}`;

          // อัตราเข้าพักเป็นตัวเลขปฏิบัติการ — นับจากใบจองที่กำหนดเข้าพักในเดือนนี้
          // ตามเดิม ไม่ใช่จากใบที่รับรู้รายได้แล้ว ไม่งั้นเดือนที่ยังไม่จบจะดูว่างเปล่า
          // เพราะแขกที่ยังไม่เช็คเอาต์ยังไม่มีแถวในสมุด
          //
          // ใช้ตัวช่วยตัวเดียวกับตอนปิดงวด ด้วยเหตุผลเดียวกับตัวเงิน: สองทางนี้เคยนับ
          // คนละแบบ ตัวเลขจึงเปลี่ยนตอนงวดถูกปิด
          occupancy = await occupiedRoomNights(this.prisma, {
            tenantId,
            propertyId,
            period: periodStr,
          });

          // ตัวเงินรายประเภทห้องมาจากสมุดรายได้ ด้วยตัวช่วยตัวเดียวกับตอนปิดงวด
          // ตัวเลขบนหน้าจอนี้จึงไม่กระโดดตอนงวดถูกปิด
          const monthDays = daysOfMonth(periodStr);
          const roomTypeMap = await roomRevenueByType(this.prisma, this.revenue, {
            tenantId,
            propertyId,
            from: monthDays[0],
            to: monthDays[monthDays.length - 1],
          });

          let totalRevenue = 0;
          const totalCost = 0;
          let totalProfit = 0;

          for (const [roomType, data] of roomTypeMap) {
            const revenuePerNight = data.nights > 0 ? data.revenue / data.nights : 0;
            const costPerNight = 0;
            const profit = (revenuePerNight - costPerNight) * data.nights;
            const margin = percentOf(revenuePerNight - costPerNight, revenuePerNight);

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
            // หารด้วยคืนของ "ใบที่รับรู้รายได้แล้ว" ชุดเดียวกับตัวตั้ง ไม่ใช่คืนที่
            // จองไว้ทั้งเดือน (ซึ่งรวมใบที่ยังไม่เช็คเอาต์และยังไม่มีเงินในสมุด)
            const recognisedNights = byRoomType.reduce((sum, r) => sum + r.nights, 0);
            averages = {
              avgRevenuePerNight: recognisedNights > 0 ? totalRevenue / recognisedNights : 0,
              avgCostPerNight: 0,
              avgProfit: recognisedNights > 0 ? totalProfit / recognisedNights : 0,
              avgMargin: byRoomType.reduce((sum, r) => sum + r.margin, 0) / byRoomType.length,
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
    const periodStr = `${year}-${String(month).padStart(2, '0')}`;

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
        profitPerUnit: round2(Number(a.sellingPrice) - Number(a.costPerUnit)),
      }));

      const totalRevenue = round2(
        closedPeriod.foodCostAnalyses.reduce((sum, a) => sum + Number(a.totalRevenue), 0),
      );
      const totalCost = round2(
        closedPeriod.foodCostAnalyses.reduce((sum, a) => sum + Number(a.ingredientCost), 0),
      );

      overview = {
        totalRevenue,
        totalIngredientCost: totalCost,
        // ปัดแบบเดียวกับทางสด ไม่งั้นตัวเลขขยับตอนงวดถูกปิดทั้งที่ข้อมูลเท่าเดิม
        avgFoodCostPercent: percentOf(totalCost, totalRevenue),
      };
    } else {
      try {
        // ตัวช่วยชุดเดียวกับตอนปิดงวด ตัวเลขบนหน้าจอนี้จึงไม่กระโดดตอนงวดถูกปิด
        //
        // ของเดิมกวาด `order` ทุกใบที่ `createdAt` อยู่ในเดือนตามเวลาเครื่อง โดยไม่ดู
        // สถานะบิล คิดยอดจากราคาหน้าเมนูก่อนหักส่วนลด และตรึงต้นทุนวัตถุดิบไว้ที่ 0
        // — ทั้งสามอย่างถูกแก้พร้อมกันในเฟส 4 เพราะแก้แยกกันไม่ได้: ต้นทุนจริงที่หาร
        // ด้วยยอดก่อนหักส่วนลดก็ยังให้ food cost % ที่ผิดอยู่ดี
        const monthDays = daysOfMonth(periodStr);
        const sales = await menuItemSales(this.prisma, this.revenue, {
          tenantId,
          propertyId,
          from: monthDays[0],
          to: monthDays[monthDays.length - 1],
        });

        const costs = await menuItemCosts(this.prisma, tenantId, [...sales.keys()]);

        let totalRevenue = 0;
        let totalCost = 0;

        for (const [menuItemId, data] of sales) {
          const costed = costs.get(menuItemId);
          const costPerUnit = costed?.costPerUnit ?? 0;
          const ingredientCost = round2(costPerUnit * data.qty);
          const sellingPrice = data.qty > 0 ? data.revenue / data.qty : 0;

          byMenuItem.push({
            // ชื่อจานจริง ของเดิมส่ง id ออกไปให้หน้าจอแสดงเป็นชื่อ
            menuItemName: costed?.name ?? menuItemId,
            qtySold: data.qty,
            revenue: data.revenue,
            ingredientCost,
            foodCostPercent: percentOf(ingredientCost, data.revenue),
            profitPerUnit: round2(sellingPrice - costPerUnit),
          });

          totalRevenue = round2(totalRevenue + data.revenue);
          totalCost = round2(totalCost + ingredientCost);
        }

        overview = {
          totalRevenue,
          totalIngredientCost: totalCost,
          avgFoodCostPercent: percentOf(totalCost, totalRevenue),
        };
      } catch (error) {
        this.logger.warn(`Could not calculate food cost report: ${error}`);
      }
    }

    const alertItems = byMenuItem.filter((item) => item.foodCostPercent > 35);

    return {
      period: periodStr,
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
