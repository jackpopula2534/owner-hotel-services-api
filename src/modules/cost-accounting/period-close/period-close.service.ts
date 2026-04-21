import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { ClosePeriodDto } from './dto/close-period.dto';

@Injectable()
export class PeriodCloseService {
  private readonly logger = new Logger(PeriodCloseService.name);

  constructor(private readonly prisma: PrismaService) {}

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
    const period = await this.prisma.periodClose.findUnique({
      where: { id },
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
            costCenter: { select: { id: true, name: true } },
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
        let totalRevenue = 0;
        let totalMaterialCost = 0;
        let totalLaborCost = 0;
        let totalOverhead = 0;
        let totalOtherCost = 0;

        for (const [costCenterId, typeMap] of costByCenterMap) {
          let centerRevenue = 0;
          let centerMaterial = 0;
          let centerLabor = 0;
          let centerOverhead = 0;
          let centerOther = 0;

          for (const [category, amount] of typeMap) {
            if (category === 'REVENUE') {
              centerRevenue += amount;
              totalRevenue += amount;
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
          const centerMargin = centerRevenue > 0 ? (centerNetProfit / centerRevenue) * 100 : 0;

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
        const totalCost = totalMaterialCost + totalLaborCost + totalOverhead + totalOtherCost;
        const netOperatingIncome = totalRevenue - totalCost;
        const grossProfit = totalRevenue - totalCost;
        let occupancyRate = 0;
        let revPAR = 0;
        let costPerOccupiedRoom = 0;
        let totalRoomNights = 0;
        let occupiedRoomNights = 0;

        try {
          const roomCount = await tx.room.count({ where: { propertyId } });
          const totalRoomCount = roomCount || 1;
          const daysInMonth = new Date(year, month, 0).getDate();
          totalRoomNights = totalRoomCount * daysInMonth;

          // Get bookings for the period
          const bookings = await tx.booking.findMany({
            where: {
              propertyId,
              tenantId,
              scheduledCheckIn: {
                gte: new Date(year, month - 1, 1),
                lt: new Date(year, month, 1),
              },
            },
          });

          occupiedRoomNights = bookings.reduce((sum, b) => {
            const checkIn = new Date(b.scheduledCheckIn);
            const checkOut = new Date(b.scheduledCheckOut);
            const nights = Math.ceil(
              (checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24),
            );
            return sum + nights;
          }, 0);

          occupancyRate = totalRoomNights > 0 ? (occupiedRoomNights / totalRoomNights) * 100 : 0;

          // Room revenue from cost entries (entries for cost centers in ROOMS category)
          const roomRevenue = costEntries
            .filter((e) => e.costCenter.name === 'ROOMS' && e.costType.category === 'REVENUE')
            .reduce((sum, e) => sum + Number(e.amount), 0);

          revPAR = totalRoomNights > 0 ? roomRevenue / totalRoomNights : 0;
          costPerOccupiedRoom =
            occupiedRoomNights > 0
              ? costEntries
                  .filter((e) => e.costCenter.name === 'ROOMS')
                  .reduce((sum, e) => sum + Number(e.amount), 0) / occupiedRoomNights
              : 0;
        } catch (error) {
          this.logger.warn(
            `Could not calculate room metrics for period ${year}-${month}: ${error}`,
          );
        }

        // 5. Generate room cost analysis
        try {
          const bookings = await tx.booking.findMany({
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
          bookings.forEach((booking) => {
            const roomType = booking.room?.type || 'Unknown';
            if (!roomTypeMap.has(roomType)) {
              roomTypeMap.set(roomType, {
                nights: 0,
                revenue: 0,
                bookings: [],
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
            data.bookings.push(booking.id);
          });

          for (const [roomType, data] of roomTypeMap) {
            const revenuePerNight = data.nights > 0 ? data.revenue / data.nights : 0;
            const costPerNight = 0; // Would require room type cost allocation
            const profitPerNight = revenuePerNight - costPerNight;
            const margin = revenuePerNight > 0 ? (profitPerNight / revenuePerNight) * 100 : 0;

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
          const restaurants = await tx.restaurant.findMany({
            where: { propertyId, tenantId },
            select: { id: true },
          });
          const restaurantIds = restaurants.map((r) => r.id);

          const orders = await tx.order.findMany({
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
              data.revenue += Number(item.unitPrice) * item.quantity;
            });
          });

          for (const [menuItemId, data] of menuItemMap) {
            const foodCostPercent = data.revenue > 0 ? (data.cost / data.revenue) * 100 : 0;
            const costPerUnit = data.qty > 0 ? data.cost / data.qty : 0;
            const sellingPrice = data.qty > 0 ? data.revenue / data.qty : 0;

            await tx.foodCostAnalysis.create({
              data: {
                periodCloseId: periodClose.id,
                menuItemId,
                menuItemName: menuItemId, // denormalized — would look up name in production
                quantitySold: data.qty,
                totalRevenue: data.revenue,
                ingredientCost: data.cost,
                sellingPrice,
                costPerUnit,
                foodCostPercent,
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
            occupiedRoomNights,
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
