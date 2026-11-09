import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { RevenueSegment, RevenueSourceModule } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import {
  bangkokDayRange,
  bangkokMonthRange,
  businessDateOf,
  daysOfMonth,
  toBangkokDate,
} from '@/common/utils/bangkok-day.util';
import { RevenueFilter, RevenueQueryService } from '@/modules/revenue/revenue-query.service';
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly revenue: RevenueQueryService,
  ) {}

  /**
   * รายได้ของช่วงหนึ่งตามสมุดรายได้ แยกเป็นห้อง / อาหาร / อื่น ๆ
   *
   * เดิมฝั่งรายได้ของ KPI มาจากสองที่ที่ไม่ตรงกันเลย: ยอดรวมนับจาก `cost_entries`
   * ที่ `sourceType='booking'` (รวมแถวร่างที่ยังไม่โพสต์) ส่วนค่าห้องบวก
   * `booking.totalPrice` ของทุกใบที่ "คาบ" วันนั้น — การจอง 3 คืน 9,000 บาทจึงถูก
   * นับ 9,000 ซ้ำทั้งสามวัน ตอนนี้ทุกตัวมาจากสมุดใบเดียวกับหน้าภาพรวมและรายงานรายได้
   *
   * ตัวหารของ ADR เป็น "จำนวนใบที่รับรู้ค่าห้องในช่วงนี้" ไม่ใช่จำนวนห้องที่มีคนพัก
   * คืนนี้ เพราะสมุดรับรู้ค่าห้องทั้งก้อนตอนเช็คเอาต์ ถ้าเอาสองชุดนี้มาหารกันจะได้
   * ตัวเลขที่ไม่มีความหมาย (ตัวตั้งของวันนี้ ตัวหารของอีกกลุ่มหนึ่ง)
   */
  private async ledgerRevenue(
    tenantId: string,
    propertyId: string,
    from: string,
    to: string,
  ): Promise<{ total: number; room: number; fb: number; other: number; roomStays: number }> {
    const scope: RevenueFilter = { tenantId, propertyId, from, to };
    const rooms: RevenueFilter = {
      ...scope,
      sourceModule: RevenueSourceModule.HOTEL,
      segment: RevenueSegment.ROOMS,
    };

    const [[all, room, fb], roomStays] = await Promise.all([
      this.revenue.totalsOfMany([
        scope,
        rooms,
        { ...scope, sourceModule: RevenueSourceModule.RESTAURANT },
      ]),
      this.revenue.countDocuments(rooms),
    ]);

    return {
      total: all.net,
      room: room.net,
      fb: fb.net,
      // ที่เหลือหลังหักห้องกับอาหาร — ลบแบบนี้ทำให้สามก้อนรวมกลับเป็นยอดรวมเสมอ
      // แม้จะมีช่องทางใหม่ (ร้านค้า/ลานกางเต็นท์) เพิ่มเข้ามาทีหลัง
      other: Math.round((all.net - room.net - fb.net) * 100) / 100,
      roomStays,
    };
  }

  /**
   * Generate daily KPI snapshot for a property
   * Calculates all KPIs for the specified date (defaults to today)
   */
  async generateDailySnapshot(tenantId: string, dto: GenerateDailySnapshotDto): Promise<any> {
    try {
      const { propertyId, snapshotDate } = dto;
      // หนึ่งแถว = หนึ่งวันปฏิทินไทย เก็บเป็นเที่ยงคืน UTC ของวันนั้น ตามกติกา
      // เดียวกับคอลัมน์วันที่อื่นในระบบ เดิมเก็บเที่ยงคืน "ของเครื่อง" แล้วอ่านกลับ
      // ด้วย toISOString() — เครื่องที่ตั้งเวลาไทยจึงรายงานวันย้อนหลังไปหนึ่งวัน
      const day = snapshotDate ? snapshotDate.slice(0, 10) : toBangkokDate(new Date());
      const snapshotDateObj = businessDateOf(day);

      // Calculate all KPIs
      const kpiData = await this.calculateDailyKpis(tenantId, propertyId, day);

      // Check if snapshot already exists for this date
      // NOTE: findFirst (not findUnique) because CostKpiSnapshot is tenant-scoped;
      // the tenant-scope middleware rejects findUnique on scoped models.
      const existingSnapshot = await this.prisma.costKpiSnapshot.findFirst({
        where: {
          tenantId,
          propertyId,
          snapshotDate: snapshotDateObj,
          granularity: 'daily',
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
    day: string,
    granularity: string = 'daily',
  ): Promise<any> {
    try {
      // findFirst (not findUnique): CostKpiSnapshot is tenant-scoped and the
      // tenant-scope middleware rejects findUnique on scoped models.
      const snapshot = await this.prisma.costKpiSnapshot.findFirst({
        where: {
          tenantId,
          propertyId,
          snapshotDate: businessDateOf(day),
          granularity,
        },
      });

      if (!snapshot) {
        // If no snapshot exists, calculate live
        const kpiData = await this.calculateDailyKpis(tenantId, propertyId, day);
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
      // เดือนตามปฏิทินไทย แถวรายวันถูกเก็บที่เที่ยงคืน UTC ของแต่ละวัน จึงเทียบ
      // ด้วยขอบเดียวกัน ไม่ใช่ new Date(year, month, 0) ที่เป็นเวลาของเครื่อง
      const days = daysOfMonth(periodStr);
      const firstDay = days[0];
      const lastDay = days[days.length - 1];
      const startDate = businessDateOf(firstDay);
      const endDate = businessDateOf(lastDay);

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
        const kpiData = await this.calculateMonthlyKpis(tenantId, propertyId, firstDay, lastDay);
        const existingMonthly = await this.prisma.costKpiSnapshot.findFirst({
          where: {
            tenantId,
            propertyId,
            snapshotDate: startDate,
            granularity: 'monthly',
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

      const existingMonthly = await this.prisma.costKpiSnapshot.findFirst({
        where: {
          tenantId,
          propertyId,
          snapshotDate: startDate,
          granularity: 'monthly',
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
    day: string,
  ): Promise<KpiSnapshotData> {
    // หน้าต่างวันเดียวกันทั้งฝั่งเงินและฝั่งต้นทุน: วันปฏิทินไทย ไม่ใช่วันของเครื่อง
    const { start: startOfDay, end: nextDay } = bangkokDayRange(day);
    const endOfDay = new Date(nextDay.getTime() - 1);

    try {
      // รายได้ทุกก้อนมาจากสมุดรายได้ — ที่เดียวกับหน้าภาพรวมและรายงานรายได้
      const revenue = await this.ledgerRevenue(tenantId, propertyId, day, day);
      const totalRevenue = revenue.total;
      const roomRevenue = revenue.room;

      // ห้องที่มีคนพักคืนนี้ — เป็นตัวเลขปฏิบัติการ ยังมาจากตารางการจองตามเดิม
      const bookingsToday = await this.prisma.booking.findMany({
        where: {
          tenantId,
          propertyId,
          checkIn: { lte: endOfDay },
          checkOut: { gt: startOfDay },
        },
        select: { id: true },
      });

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
      // หารด้วยจำนวนใบที่ "รับรู้ค่าห้อง" วันนี้ ไม่ใช่จำนวนห้องที่มีคนพักคืนนี้
      const adr = revenue.roomStays > 0 ? roomRevenue / revenue.roomStays : 0;
      const revPAR = totalRooms > 0 ? roomRevenue / totalRooms : 0;

      // Room department costs (category='material' or 'labor')
      const roomCosts = costsByCategory.material + costsByCategory.labor;
      const costPOR = occupiedRooms > 0 ? roomCosts / occupiedRooms : 0;

      // Profitability
      const grossProfit = totalRevenue - totalCost;
      const gopAmount = grossProfit; // For simplicity, GOP = gross profit
      const gopPercent = totalRevenue > 0 ? (gopAmount / totalRevenue) * 100 : 0;

      // F&B metrics (from cost entries with F&B-related cost types)
      const fbMetrics = this.calculateFbMetrics(costEntries, totalRevenue);

      // Inventory metrics
      const inventoryMetrics = await this.calculateInventoryMetrics(tenantId, propertyId);

      return {
        totalRevenue,
        roomRevenue,
        fbRevenue: revenue.fb,
        otherRevenue: revenue.other,
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
    from: string,
    to: string,
  ): Promise<KpiSnapshotData> {
    // เดือนตามปฏิทินไทยแบบรวมปลายทั้งสองข้าง — ขอบเดียวกับที่ส่งให้สมุดรายได้
    const { start: startDate, end: monthEnd } = bangkokMonthRange(from.slice(0, 7));
    const endDate = new Date(monthEnd.getTime() - 1);

    try {
      // รายได้ทั้งเดือนมาจากสมุดรายได้ ไม่ใช่ผลรวม cost_entries ที่ sourceType='booking'
      // (ซึ่งรวมแถวร่างที่ยังไม่ถูกโพสต์) และไม่ใช่ผลรวม booking.totalPrice ของใบที่
      // "คาบ" เดือนนี้ (ซึ่งนับเต็มก้อนแม้เข้าพักคร่อมเดือน)
      const revenue = await this.ledgerRevenue(tenantId, propertyId, from, to);
      const totalRevenue = revenue.total;
      const roomRevenue = revenue.room;

      // All bookings overlapping the month
      const bookingsInMonth = await this.prisma.booking.findMany({
        where: {
          tenantId,
          propertyId,
          checkIn: { lte: endDate },
          checkOut: { gte: startDate },
        },
        select: { id: true },
      });

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
      const totalDays = daysOfMonth(from.slice(0, 7)).length;
      const totalRooms = await this.prisma.room.count({
        where: {
          tenantId,
          propertyId,
        },
      });

      const roomNights = totalRooms * totalDays;
      const occupancyRate = roomNights > 0 ? (bookingsInMonth.length / roomNights) * 100 : 0;
      // ตัวหารเป็นใบที่รับรู้ค่าห้องในเดือนนี้ ชุดเดียวกับตัวตั้ง
      const adr = revenue.roomStays > 0 ? roomRevenue / revenue.roomStays : 0;
      const revPAR = roomNights > 0 ? roomRevenue / roomNights : 0;

      const costPOR =
        bookingsInMonth.length > 0
          ? (costsByCategory.material + costsByCategory.labor) / bookingsInMonth.length
          : 0;

      const grossProfit = totalRevenue - totalCost;
      const gopAmount = grossProfit;
      const gopPercent = totalRevenue > 0 ? (gopAmount / totalRevenue) * 100 : 0;

      const fbMetrics = this.calculateFbMetrics(costEntries, totalRevenue);
      const inventoryMetrics = await this.calculateInventoryMetrics(tenantId, propertyId);

      return {
        totalRevenue,
        roomRevenue,
        fbRevenue: revenue.fb,
        otherRevenue: revenue.other,
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
