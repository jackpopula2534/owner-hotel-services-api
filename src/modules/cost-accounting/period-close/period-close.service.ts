import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { CostCenterType, RevenueSegment } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { daysOfMonth, round2 } from '@/common/utils/bangkok-day.util';
import { RevenueQueryService } from '@/modules/revenue/revenue-query.service';
import { menuItemCosts } from '../shared/menu-item-cost';
import { menuItemSales } from '../shared/menu-item-sales';
import { percentOf } from '../shared/percent';
import { occupiedRoomNights } from '../shared/room-nights';
import { revenueByCostCenter } from '../shared/revenue-by-cost-center';
import { roomRevenueByType } from '../shared/room-revenue-by-type';
import { ClosePeriodDto } from './dto/close-period.dto';

@Injectable()
export class PeriodCloseService {
  private readonly logger = new Logger(PeriodCloseService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly revenue: RevenueQueryService,
  ) {}

  async findAll(tenantId: string, propertyId?: string) {
    const periods = await this.prisma.periodClose.findMany({
      where: {
        tenantId,
        ...(propertyId && { propertyId }),
      },
      include: {
        departmentPnLs: true,
        roomCostAnalyses: true,
        foodCostAnalyses: true,
      },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });

    return periods;
  }

  async findOne(id: string, tenantId: string) {
    // findFirst (NOT findUnique): PeriodClose is tenant-scoped and the
    // tenant-scope middleware rejects findUnique on scoped models.
    const period = await this.prisma.periodClose.findFirst({
      where: { id, tenantId },
      include: {
        departmentPnLs: {
          orderBy: { costCenterId: 'asc' },
        },
        roomCostAnalyses: {
          orderBy: { roomType: 'asc' },
        },
        foodCostAnalyses: {
          orderBy: { menuItemName: 'asc' },
        },
      },
    });

    if (!period || period.tenantId !== tenantId) {
      throw new NotFoundException(`Period close with ID ${id} not found`);
    }

    return period;
  }

  async getCurrentPeriod(tenantId: string, propertyId: string) {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const period = `${year}-${String(month).padStart(2, '0')}`;

    let periodClose = await this.prisma.periodClose.findFirst({
      where: {
        tenantId,
        propertyId,
        year,
        month,
      },
      include: {
        departmentPnLs: true,
        roomCostAnalyses: true,
        foodCostAnalyses: true,
      },
    });

    if (!periodClose) {
      periodClose = await this.prisma.periodClose.create({
        data: {
          tenantId,
          propertyId,
          year,
          month,
          period,
          status: 'OPEN',
        },
        include: {
          departmentPnLs: true,
          roomCostAnalyses: true,
          foodCostAnalyses: true,
        },
      });
    }

    return periodClose;
  }

  async closePeriod(dto: ClosePeriodDto, userId: string, tenantId: string) {
    const { propertyId, year, month, notes } = dto;
    const periodStr = `${year}-${String(month).padStart(2, '0')}`;

    // Find or create period
    let periodClose = await this.prisma.periodClose.findFirst({
      where: {
        tenantId,
        propertyId,
        year,
        month,
      },
      include: {
        departmentPnLs: true,
        roomCostAnalyses: true,
        foodCostAnalyses: true,
      },
    });

    if (!periodClose) {
      periodClose = await this.prisma.periodClose.create({
        data: {
          tenantId,
          propertyId,
          year,
          month,
          period: periodStr,
          status: 'OPEN',
        },
        include: {
          departmentPnLs: true,
          roomCostAnalyses: true,
          foodCostAnalyses: true,
        },
      });
    }

    // Validate period is not already closed
    if (periodClose.status === 'CLOSED' && !notes?.includes('force')) {
      throw new BadRequestException(
        `Period ${year}-${month} is already closed. Use reopen to modify.`,
      );
    }

    // Update status to CLOSING
    await this.prisma.periodClose.update({
      where: { id: periodClose.id },
      data: { status: 'CLOSING' },
    });

    // อ่านสมุดรายได้ก่อนเปิดทรานแซกชัน — ไม่มีเหตุให้ถือล็อกไว้ระหว่างอ่านรายงาน
    const monthDays = daysOfMonth(periodStr);
    const monthFrom = monthDays[0];
    const monthTo = monthDays[monthDays.length - 1];
    const ledgerScope = { tenantId, propertyId, from: monthFrom, to: monthTo };
    const [roomRevenue, menuRevenue, revenueByCenter, roomNights, roomsTotals] = await Promise.all([
      roomRevenueByType(this.prisma, this.revenue, ledgerScope),
      menuItemSales(this.prisma, this.revenue, ledgerScope),
      revenueByCostCenter(this.prisma, this.revenue, ledgerScope),
      occupiedRoomNights(this.prisma, { tenantId, propertyId, period: periodStr }),
      this.revenue.totals({ ...ledgerScope, segment: RevenueSegment.ROOMS }),
    ]);

    // เงินที่ยังไม่มีศูนย์ต้นทุนรองรับจะไม่โผล่ใน P&L รายแผนก แต่ยังอยู่ในยอดพาดหัว
    // — บอกไว้ให้ตามแก้ได้ ไม่ปล่อยให้ผลรวมรายแผนกไม่เท่ายอดรวมโดยไม่มีใครรู้
    for (const orphan of revenueByCenter.unmapped) {
      this.logger.warn(
        `Period ${periodStr}: ${orphan.revenue} of ${orphan.segment} revenue has no ` +
          `${orphan.expectedCostCenterType} cost center for property ${propertyId} — ` +
          `it is in the period total but not in any department P&L`,
      );
    }

    // ต้นทุนวัตถุดิบต่อจาน + ชื่อจานจริง (คอลัมน์ชื่อเคยเก็บ id ไว้)
    const menuCosts = await menuItemCosts(this.prisma, tenantId, [...menuRevenue.keys()]);

    try {
      // Execute in transaction
      const closedPeriod = await this.prisma.$transaction(async (tx) => {
        // 1. Clear existing analyses if reopened
        if (periodClose.status === 'REOPENED') {
          await tx.departmentPnL.deleteMany({
            where: { periodCloseId: periodClose.id },
          });
          await tx.roomCostAnalysis.deleteMany({
            where: { periodCloseId: periodClose.id },
          });
          await tx.foodCostAnalysis.deleteMany({
            where: { periodCloseId: periodClose.id },
          });
        }

        // 2. Aggregate cost entries by cost center and category
        const costEntries = await tx.costEntry.findMany({
          where: {
            tenantId,
            propertyId,
            period: periodStr,
            status: 'posted',
          },
          include: {
            costCenter: { select: { id: true, name: true, type: true } },
            costType: { select: { id: true, category: true } },
          },
        });

        // Group by costCenterId
        const costByCenterMap = new Map<string, Map<string, number>>();
        const centerIdToName = new Map<string, string>();
        costEntries.forEach((entry) => {
          const centerId = entry.costCenterId;
          centerIdToName.set(centerId, entry.costCenter.name);
          if (!costByCenterMap.has(centerId)) {
            costByCenterMap.set(centerId, new Map());
          }
          const centerMap = costByCenterMap.get(centerId)!;
          const key = entry.costType.category;
          centerMap.set(key, (centerMap.get(key) || 0) + Number(entry.amount));
        });

        // 3. Create department P&Ls
        //
        // รายได้ของแต่ละแผนกมาจากสมุดกลาง ไม่ใช่จากแถว `REVENUE` ใน cost_entries
        // อีกต่อไป (ดูเหตุผลใน shared/revenue-by-cost-center.ts) แถว REVENUE ที่ยัง
        // ค้างอยู่ในตารางต้นทุนจึงถูกข้าม — ถ้านับด้วยจะกลายเป็นรายได้ซ้ำสองเท่า
        let totalMaterialCost = 0;
        let totalLaborCost = 0;
        let totalOverhead = 0;
        let totalOtherCost = 0;
        let skippedRevenueEntries = 0;

        // ศูนย์ที่มีรายได้แต่ไม่มีต้นทุนต้องมีแถว P&L ด้วย ไม่งั้นแผนกที่ทำเงินได้แต่ยัง
        // ไม่ได้ลงต้นทุนจะหายไปทั้งแผนก
        const centersToReport = new Set<string>([
          ...costByCenterMap.keys(),
          ...revenueByCenter.byCostCenter.keys(),
        ]);

        for (const costCenterId of centersToReport) {
          const typeMap = costByCenterMap.get(costCenterId) ?? new Map<string, number>();
          const centerRevenue = revenueByCenter.byCostCenter.get(costCenterId) ?? 0;
          let centerMaterial = 0;
          let centerLabor = 0;
          let centerOverhead = 0;
          let centerOther = 0;

          for (const [category, amount] of typeMap) {
            if (category === 'REVENUE') {
              skippedRevenueEntries += amount;
            } else if (category === 'MATERIAL') {
              centerMaterial += amount;
              totalMaterialCost += amount;
            } else if (category === 'LABOR') {
              centerLabor += amount;
              totalLaborCost += amount;
            } else if (category === 'OVERHEAD') {
              centerOverhead += amount;
              totalOverhead += amount;
            } else {
              centerOther += amount;
              totalOtherCost += amount;
            }
          }

          const centerTotalCost = centerMaterial + centerLabor + centerOverhead + centerOther;
          const centerNetProfit = centerRevenue - centerTotalCost;
          const centerMargin = percentOf(centerNetProfit, centerRevenue);

          await tx.departmentPnL.create({
            data: {
              periodCloseId: periodClose.id,
              costCenterId,
              revenue: centerRevenue,
              materialCost: centerMaterial,
              laborCost: centerLabor,
              overheadCost: centerOverhead,
              otherCost: centerOther,
              totalCost: centerTotalCost,
              netProfit: centerNetProfit,
              profitMargin: centerMargin,
            },
          });
        }

        // 4. Calculate room metrics
        //
        // ยอดพาดหัวคือยอดของสมุด ไม่ใช่ผลบวกของแถวรายแผนก — ถ้าผู้ใช้ยังไม่ได้สร้าง
        // ศูนย์ต้นทุนครบทุกแผนก เงินส่วนนั้นยังต้องอยู่ในยอดรวม (เตือนไว้ข้างบนแล้ว)
        // ยอดนี้จึงตรงกับทุกหน้าจอในเฟส 3 เสมอ
        const totalRevenue = revenueByCenter.total;
        const totalCost = totalMaterialCost + totalLaborCost + totalOverhead + totalOtherCost;
        const netOperatingIncome = totalRevenue - totalCost;
        const grossProfit = totalRevenue - totalCost;

        if (skippedRevenueEntries > 0) {
          this.logger.warn(
            `Period ${periodStr}: ignored ${skippedRevenueEntries} of REVENUE-category ` +
              `cost entries for property ${propertyId} — revenue now comes from the ledger ` +
              `(${totalRevenue}). Those entries would double count.`,
          );
        }

        const { totalNights: totalRoomNights, occupiedNights, rate: occupancyRate } = roomNights;

        // ค่าห้องต่อคืนที่ขายได้ — ตัวตั้งเป็นค่าห้องตามสมุด ของเดิมกรองด้วย
        // `costCenter.name === 'ROOMS'` ทั้งที่ศูนย์จริงชื่อ "Rooms Division"
        // เงื่อนไขจึงไม่เคยเป็นจริง RevPAR เลยเป็น 0 เสมอมา
        const revPAR = totalRoomNights > 0 ? roomsTotals.net / totalRoomNights : 0;

        // ต้นทุนยังมาจาก cost_entries ตามเดิม (สมุดเก็บแต่รายได้) แต่เลือกศูนย์ด้วย
        // **ประเภท** ไม่ใช่ชื่อ และไม่นับแถว REVENUE ที่หลงอยู่ในตารางต้นทุน
        const roomsCost = costEntries
          .filter(
            (entry) =>
              entry.costCenter.type === CostCenterType.ROOMS &&
              entry.costType.category !== 'REVENUE',
          )
          .reduce((sum, entry) => sum + Number(entry.amount), 0);
        const costPerOccupiedRoom = occupiedNights > 0 ? roomsCost / occupiedNights : 0;

        // 5. Generate room cost analysis
        try {
          for (const [roomType, data] of roomRevenue) {
            const revenuePerNight = data.nights > 0 ? data.revenue / data.nights : 0;
            const costPerNight = 0; // Would require room type cost allocation
            const profitPerNight = revenuePerNight - costPerNight;
            const margin = percentOf(profitPerNight, revenuePerNight);

            await tx.roomCostAnalysis.create({
              data: {
                periodCloseId: periodClose.id,
                roomType,
                totalNights: data.nights,
                totalRevenue: data.revenue,
                amenityCost: 0,
                revenuePerNight,
                costPerNight,
                profitPerNight,
                margin,
              },
            });
          }
        } catch (error) {
          this.logger.warn(`Could not generate room cost analysis: ${error}`);
        }

        // 6. Generate food cost analysis
        try {
          for (const [menuItemId, data] of menuRevenue) {
            // ต้นทุนวัตถุดิบต่อจานมาจากสูตรอาหาร × ต้นทุนเฉลี่ยในคลัง
            const costed = menuCosts.get(menuItemId);
            const costPerUnit = costed?.costPerUnit ?? 0;
            // `ingredientCost` เป็นต้นทุนของ "ทั้งเดือน" ส่วน `costPerUnit` เป็นต่อจาน
            // ของเดิมใส่ค่าเดียวกัน (0) ทั้งสองช่องเลยไม่มีใครเห็นว่านิยามต่างกัน
            const ingredientCost = round2(costPerUnit * data.qty);
            const foodCostPercent = percentOf(ingredientCost, data.revenue);
            const sellingPrice = data.qty > 0 ? data.revenue / data.qty : 0;

            if (costed && costed.missingIngredients.length > 0) {
              this.logger.warn(
                `Period ${periodStr}: menu item "${costed.name}" costed without ` +
                  `${costed.missingIngredients.length} ingredient(s) ` +
                  `(${costed.missingIngredients.join(', ')}) — food cost is understated`,
              );
            }

            await tx.foodCostAnalysis.create({
              data: {
                periodCloseId: periodClose.id,
                menuItemId,
                menuItemName: costed?.name ?? menuItemId,
                quantitySold: data.qty,
                totalRevenue: data.revenue,
                ingredientCost,
                sellingPrice,
                costPerUnit,
                foodCostPercent,
                profitPerUnit: round2(sellingPrice - costPerUnit),
              },
            });
          }
        } catch (error) {
          this.logger.warn(`Could not generate food cost analysis: ${error}`);
        }

        // 7. Update period totals and close
        const updatedPeriod = await tx.periodClose.update({
          where: { id: periodClose.id },
          data: {
            status: 'CLOSED',
            totalRevenue,
            totalMaterialCost,
            totalLaborCost,
            totalOverhead,
            totalOtherCost,
            grossProfit,
            netOperatingIncome,
            totalRoomNights,
            occupiedRoomNights: occupiedNights,
            occupancyRate,
            revPAR,
            costPerOccupiedRoom,
            closedBy: userId,
            closedAt: new Date(),
            notes,
          },
          include: {
            departmentPnLs: { orderBy: { costCenterId: 'asc' } },
            roomCostAnalyses: { orderBy: { roomType: 'asc' } },
            foodCostAnalyses: { orderBy: { menuItemName: 'asc' } },
          },
        });

        return updatedPeriod;
      });

      return closedPeriod;
    } catch (error) {
      // Revert to OPEN status on error
      await this.prisma.periodClose.update({
        where: { id: periodClose.id },
        data: { status: 'OPEN' },
      });
      this.logger.error(`Failed to close period ${year}-${month}: ${error}`);
      throw error;
    }
  }

  async reopenPeriod(id: string, userId: string, tenantId: string) {
    const period = await this.findOne(id, tenantId);

    if (period.status !== 'CLOSED') {
      throw new BadRequestException(
        `Only closed periods can be reopened. Current status: ${period.status}`,
      );
    }

    // Delete existing analyses
    await this.prisma.$transaction(async (tx) => {
      await tx.departmentPnL.deleteMany({ where: { periodCloseId: id } });
      await tx.roomCostAnalysis.deleteMany({ where: { periodCloseId: id } });
      await tx.foodCostAnalysis.deleteMany({ where: { periodCloseId: id } });
    });

    const reopened = await this.prisma.periodClose.update({
      where: { id },
      data: {
        status: 'REOPENED',
        closedBy: null,
        closedAt: null,
      },
      include: {
        departmentPnLs: true,
        roomCostAnalyses: true,
        foodCostAnalyses: true,
      },
    });

    return reopened;
  }
}
