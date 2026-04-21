import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { GenerateSnapshotDto } from './dto/generate-snapshot.dto';
import { Decimal } from '@prisma/client/runtime/library';
import { MenuEngineeringSnapshotEntity } from './entities/menu-engineering-snapshot.entity';
import { MenuEngineeringItemEntity } from './entities/menu-engineering-item.entity';

interface ClassificationSummary {
  stars: Array<{
    name: string;
    marginPercent: Decimal;
    quantitySold: number;
    totalProfit: Decimal;
  }>;
  plowhorses: Array<{
    name: string;
    marginPercent: Decimal;
    quantitySold: number;
    totalProfit: Decimal;
  }>;
  puzzles: Array<{
    name: string;
    marginPercent: Decimal;
    quantitySold: number;
    totalProfit: Decimal;
  }>;
  dogs: Array<{
    name: string;
    marginPercent: Decimal;
    quantitySold: number;
    totalProfit: Decimal;
  }>;
  summary: {
    totalItems: number;
    avgMargin: Decimal;
    avgPopularity: Decimal;
  };
}

interface ComparisonResult {
  improved: Array<{
    name: string;
    fromClassification: string;
    toClassification: string;
    marginChange: Decimal;
  }>;
  declined: Array<{
    name: string;
    fromClassification: string;
    toClassification: string;
    marginChange: Decimal;
  }>;
  unchanged: number;
}

@Injectable()
export class MenuEngineeringService {
  private readonly logger = new Logger(MenuEngineeringService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Generate a new Menu Engineering snapshot using BCG matrix classification
   * Core algorithm:
   * 1. Calculate metrics for each menu item (qty, price, cost, margin)
   * 2. Calculate average popularity and margin across all items
   * 3. Classify items into quadrants (Stars, Plowhorses, Puzzles, Dogs)
   * 4. Generate recommendations per classification
   * 5. Save snapshot and items in transaction
   */
  async generateSnapshot(
    dto: GenerateSnapshotDto,
    userId: string,
    tenantId: string,
  ): Promise<MenuEngineeringSnapshotEntity> {
    try {
      // Validate period format
      if (!/^\d{4}-\d{2}$/.test(dto.period)) {
        throw new BadRequestException('Period must be in YYYY-MM format');
      }

      // Fetch FoodCostAnalysis records for the period
      const foodCostAnalyses = await this.prisma.foodCostAnalysis.findMany({
        where: {
          periodClose: {
            period: dto.period,
            propertyId: dto.propertyId,
          },
        },
        include: {
          periodClose: true,
        },
      });

      // If no FoodCostAnalysis, we need to calculate from orders
      // For now, we'll work with what's available
      if (foodCostAnalyses.length === 0) {
        this.logger.warn(
          `No FoodCostAnalysis records found for period ${dto.period}. Will attempt to calculate from orders.`,
        );
      }

      // Aggregate data by menu item
      const menuItemMetrics = this.aggregateMenuItemMetrics(foodCostAnalyses);

      if (menuItemMetrics.length === 0) {
        throw new BadRequestException(`No menu item data found for period ${dto.period}`);
      }

      // Calculate averages
      const avgPopularity = this.calculateAveragePopularity(menuItemMetrics);
      const avgMargin = this.calculateAverageMargin(menuItemMetrics);

      // Classify items and generate recommendations
      const classifiedItems = menuItemMetrics.map((item) =>
        this.classifyItem(item, avgPopularity, avgMargin),
      );

      // Count classifications
      const starsCount = classifiedItems.filter((i) => i.classification === 'STAR').length;
      const plowhorsesCount = classifiedItems.filter(
        (i) => i.classification === 'PLOWHORSE',
      ).length;
      const puzzlesCount = classifiedItems.filter((i) => i.classification === 'PUZZLE').length;
      const dogsCount = classifiedItems.filter((i) => i.classification === 'DOG').length;

      // Check if snapshot already exists for this period
      const existingSnapshot = await this.prisma.menuEngineeringSnapshot.findUnique({
        where: {
          tenantId_propertyId_period: {
            tenantId,
            propertyId: dto.propertyId,
            period: dto.period,
          },
        },
      });

      // Save in transaction
      const result = await this.prisma.$transaction(async (tx) => {
        // Delete existing items if updating
        if (existingSnapshot) {
          await tx.menuEngineeringItem.deleteMany({
            where: { snapshotId: existingSnapshot.id },
          });
        }

        // Create or update snapshot
        const snapshot = await tx.menuEngineeringSnapshot.upsert({
          where: {
            tenantId_propertyId_period: {
              tenantId,
              propertyId: dto.propertyId,
              period: dto.period,
            },
          },
          create: {
            tenantId,
            propertyId: dto.propertyId,
            restaurantId: dto.restaurantId,
            period: dto.period,
            avgPopularity,
            avgMargin,
            totalItems: classifiedItems.length,
            starsCount,
            plowhorsesCount,
            puzzlesCount,
            dogsCount,
            createdBy: userId,
          },
          update: {
            avgPopularity,
            avgMargin,
            totalItems: classifiedItems.length,
            starsCount,
            plowhorsesCount,
            puzzlesCount,
            dogsCount,
            createdBy: userId,
          },
        });

        // Create items
        const items = await tx.menuEngineeringItem.createMany({
          data: classifiedItems.map((item) => ({
            snapshotId: snapshot.id,
            menuItemId: item.menuItemId,
            menuItemName: item.menuItemName,
            categoryName: item.categoryName,
            quantitySold: item.quantitySold,
            sellingPrice: item.sellingPrice,
            ingredientCost: item.ingredientCost,
            contributionMargin: item.contributionMargin,
            marginPercent: item.marginPercent,
            totalRevenue: item.totalRevenue,
            totalCost: item.totalCost,
            totalProfit: item.totalProfit,
            popularityIndex: item.popularityIndex,
            classification: item.classification,
            recommendation: item.recommendation,
          })),
        });

        return {
          ...snapshot,
          items: classifiedItems,
        };
      });

      return result as MenuEngineeringSnapshotEntity;
    } catch (error) {
      this.logger.error(
        `Failed to generate snapshot for period ${dto.period}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  /**
   * Aggregate menu item metrics from FoodCostAnalysis records
   */
  private aggregateMenuItemMetrics(analyses: Array<any>): Array<{
    menuItemId: string;
    menuItemName: string;
    categoryName?: string;
    quantitySold: number;
    sellingPrice: Decimal;
    ingredientCost: Decimal;
    totalRevenue: Decimal;
  }> {
    const grouped = new Map<
      string,
      {
        menuItemId: string;
        menuItemName: string;
        categoryName?: string;
        quantitySold: number;
        totalRevenue: Decimal;
        totalCost: Decimal;
      }
    >();

    for (const analysis of analyses) {
      const key = analysis.menuItemId;
      const existing = grouped.get(key) || {
        menuItemId: analysis.menuItemId,
        menuItemName: analysis.menuItemName,
        categoryName: analysis.categoryName,
        quantitySold: 0,
        totalRevenue: new Decimal(0),
        totalCost: new Decimal(0),
      };

      existing.quantitySold += analysis.quantitySold || 0;
      existing.totalRevenue = existing.totalRevenue.plus(analysis.totalRevenue || 0);
      existing.totalCost = existing.totalCost.plus(analysis.ingredientCost || 0);

      grouped.set(key, existing);
    }

    return Array.from(grouped.values()).map((item) => ({
      menuItemId: item.menuItemId,
      menuItemName: item.menuItemName,
      categoryName: item.categoryName,
      quantitySold: item.quantitySold,
      sellingPrice:
        item.quantitySold > 0 ? item.totalRevenue.dividedBy(item.quantitySold) : new Decimal(0),
      ingredientCost:
        item.quantitySold > 0 ? item.totalCost.dividedBy(item.quantitySold) : new Decimal(0),
      totalRevenue: item.totalRevenue,
    }));
  }

  /**
   * Calculate average quantity sold across all items
   */
  private calculateAveragePopularity(items: Array<{ quantitySold: number }>): Decimal {
    if (items.length === 0) return new Decimal(0);
    const total = items.reduce((sum, item) => sum + item.quantitySold, 0);
    return new Decimal(total).dividedBy(items.length);
  }

  /**
   * Calculate average contribution margin across all items
   */
  private calculateAverageMargin(
    items: Array<{
      sellingPrice: Decimal;
      ingredientCost: Decimal;
    }>,
  ): Decimal {
    if (items.length === 0) return new Decimal(0);

    const margins = items.map((item) => {
      if (item.sellingPrice.equals(0)) return new Decimal(0);
      const margin = item.sellingPrice.minus(item.ingredientCost);
      return margin.dividedBy(item.sellingPrice).times(100);
    });

    const total = margins.reduce((sum, margin) => sum.plus(margin), new Decimal(0));
    return total.dividedBy(items.length);
  }

  /**
   * Classify item into BCG matrix quadrant and generate recommendation
   */
  private classifyItem(
    item: {
      menuItemId: string;
      menuItemName: string;
      categoryName?: string;
      quantitySold: number;
      sellingPrice: Decimal;
      ingredientCost: Decimal;
      totalRevenue: Decimal;
    },
    avgPopularity: Decimal,
    avgMargin: Decimal,
  ): {
    menuItemId: string;
    menuItemName: string;
    categoryName?: string;
    quantitySold: number;
    sellingPrice: Decimal;
    ingredientCost: Decimal;
    contributionMargin: Decimal;
    marginPercent: Decimal;
    totalRevenue: Decimal;
    totalCost: Decimal;
    totalProfit: Decimal;
    popularityIndex: Decimal;
    classification: string;
    recommendation: string;
  } {
    const contributionMargin = item.sellingPrice.minus(item.ingredientCost);
    const marginPercent = item.sellingPrice.equals(0)
      ? new Decimal(0)
      : contributionMargin.dividedBy(item.sellingPrice).times(100);

    const totalCost = item.ingredientCost.times(item.quantitySold);
    const totalProfit = item.totalRevenue.minus(totalCost);

    const popularityIndex = avgPopularity.equals(0)
      ? new Decimal(0)
      : new Decimal(item.quantitySold).dividedBy(avgPopularity).times(100);

    // Classify into quadrant
    const isHighPopularity = new Decimal(item.quantitySold).greaterThanOrEqualTo(avgPopularity);
    const isHighMargin = marginPercent.greaterThanOrEqualTo(avgMargin);

    let classification: string;
    let recommendation: string;

    if (isHighPopularity && isHighMargin) {
      classification = 'STAR';
      recommendation =
        'Maintain quality and consistency. Consider a modest price increase to enhance profitability further.';
    } else if (isHighPopularity && !isHighMargin) {
      classification = 'PLOWHORSE';
      recommendation =
        'High demand but low profitability. Reduce portion size, find cheaper ingredients, or optimize preparation to improve margin.';
    } else if (!isHighPopularity && isHighMargin) {
      classification = 'PUZZLE';
      recommendation =
        'High profitability but low demand. Increase promotion, feature on menu prominently, or bundle with popular items.';
    } else {
      classification = 'DOG';
      recommendation =
        'Low popularity and profitability. Consider removing from menu or complete recipe redesign with cost reduction.';
    }

    return {
      menuItemId: item.menuItemId,
      menuItemName: item.menuItemName,
      categoryName: item.categoryName,
      quantitySold: item.quantitySold,
      sellingPrice: item.sellingPrice,
      ingredientCost: item.ingredientCost,
      contributionMargin,
      marginPercent,
      totalRevenue: item.totalRevenue,
      totalCost,
      totalProfit,
      popularityIndex,
      classification,
      recommendation,
    };
  }

  /**
   * Get snapshot by ID with all items
   */
  async getSnapshot(id: string, tenantId: string): Promise<MenuEngineeringSnapshotEntity> {
    try {
      const snapshot = await this.prisma.menuEngineeringSnapshot.findUnique({
        where: { id },
        include: {
          items: {
            orderBy: [{ classification: 'asc' }, { totalProfit: 'desc' }],
          },
        },
      });

      if (!snapshot) {
        throw new NotFoundException(`Snapshot with ID ${id} not found`);
      }

      if (snapshot.tenantId !== tenantId) {
        throw new NotFoundException(`Snapshot with ID ${id} not found`);
      }

      return snapshot as MenuEngineeringSnapshotEntity;
    } catch (error) {
      this.logger.error(
        `Failed to get snapshot ${id}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  /**
   * Get latest snapshot for a property
   */
  async getLatestSnapshot(
    tenantId: string,
    propertyId: string,
  ): Promise<MenuEngineeringSnapshotEntity | null> {
    try {
      const snapshot = await this.prisma.menuEngineeringSnapshot.findFirst({
        where: {
          tenantId,
          propertyId,
        },
        orderBy: {
          period: 'desc',
        },
        include: {
          items: {
            orderBy: [{ classification: 'asc' }, { totalProfit: 'desc' }],
          },
        },
      });

      return (snapshot as MenuEngineeringSnapshotEntity) || null;
    } catch (error) {
      this.logger.error(
        `Failed to get latest snapshot for property ${propertyId}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  /**
   * List all snapshots for a property (paginated)
   */
  async getSnapshots(
    tenantId: string,
    propertyId: string,
    skip: number = 0,
    take: number = 20,
  ): Promise<{
    data: MenuEngineeringSnapshotEntity[];
    total: number;
  }> {
    try {
      const [snapshots, total] = await Promise.all([
        this.prisma.menuEngineeringSnapshot.findMany({
          where: {
            tenantId,
            propertyId,
          },
          orderBy: {
            period: 'desc',
          },
          skip,
          take,
        }),
        this.prisma.menuEngineeringSnapshot.count({
          where: {
            tenantId,
            propertyId,
          },
        }),
      ]);

      return {
        data: snapshots as MenuEngineeringSnapshotEntity[],
        total,
      };
    } catch (error) {
      this.logger.error(
        `Failed to list snapshots for property ${propertyId}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  /**
   * Get classification summary with items grouped by classification
   */
  async getClassificationSummary(
    tenantId: string,
    propertyId: string,
    period: string,
  ): Promise<ClassificationSummary> {
    try {
      const snapshot = await this.prisma.menuEngineeringSnapshot.findUnique({
        where: {
          tenantId_propertyId_period: {
            tenantId,
            propertyId,
            period,
          },
        },
        include: {
          items: {
            orderBy: { totalProfit: 'desc' },
          },
        },
      });

      if (!snapshot) {
        throw new NotFoundException(`No snapshot found for period ${period}`);
      }

      const stars = snapshot.items
        .filter((i) => i.classification === 'STAR')
        .map((i) => ({
          name: i.menuItemName,
          marginPercent: i.marginPercent,
          quantitySold: i.quantitySold,
          totalProfit: i.totalProfit,
        }));

      const plowhorses = snapshot.items
        .filter((i) => i.classification === 'PLOWHORSE')
        .map((i) => ({
          name: i.menuItemName,
          marginPercent: i.marginPercent,
          quantitySold: i.quantitySold,
          totalProfit: i.totalProfit,
        }));

      const puzzles = snapshot.items
        .filter((i) => i.classification === 'PUZZLE')
        .map((i) => ({
          name: i.menuItemName,
          marginPercent: i.marginPercent,
          quantitySold: i.quantitySold,
          totalProfit: i.totalProfit,
        }));

      const dogs = snapshot.items
        .filter((i) => i.classification === 'DOG')
        .map((i) => ({
          name: i.menuItemName,
          marginPercent: i.marginPercent,
          quantitySold: i.quantitySold,
          totalProfit: i.totalProfit,
        }));

      return {
        stars,
        plowhorses,
        puzzles,
        dogs,
        summary: {
          totalItems: snapshot.totalItems,
          avgMargin: snapshot.avgMargin,
          avgPopularity: snapshot.avgPopularity,
        },
      };
    } catch (error) {
      this.logger.error(
        `Failed to get classification summary for ${period}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  /**
   * Compare two snapshots to identify items that moved between classifications
   */
  async compareSnapshots(
    tenantId: string,
    snapshotId1: string,
    snapshotId2: string,
  ): Promise<ComparisonResult> {
    try {
      const [snapshot1, snapshot2] = await Promise.all([
        this.prisma.menuEngineeringSnapshot.findUnique({
          where: { id: snapshotId1 },
          include: { items: true },
        }),
        this.prisma.menuEngineeringSnapshot.findUnique({
          where: { id: snapshotId2 },
          include: { items: true },
        }),
      ]);

      if (!snapshot1 || !snapshot2) {
        throw new NotFoundException('One or both snapshots not found');
      }

      if (snapshot1.tenantId !== tenantId || snapshot2.tenantId !== tenantId) {
        throw new NotFoundException('Snapshots not found');
      }

      const improved: ComparisonResult['improved'] = [];
      const declined: ComparisonResult['declined'] = [];
      let unchanged = 0;

      // Create map of items in snapshot2 by menuItemId
      const itemsMap = new Map(snapshot2.items.map((i) => [i.menuItemId, i]));

      // Compare each item from snapshot1
      for (const item1 of snapshot1.items) {
        const item2 = itemsMap.get(item1.menuItemId);
        if (!item2) {
          // Item not in second snapshot, skip
          continue;
        }

        const marginChange = item2.marginPercent.minus(item1.marginPercent);

        if (item1.classification !== item2.classification) {
          const classificationOrder: Record<string, number> = {
            STAR: 4,
            PLOWHORSE: 3,
            PUZZLE: 2,
            DOG: 1,
          };

          const oldRank = classificationOrder[item1.classification] || 0;
          const newRank = classificationOrder[item2.classification] || 0;

          if (newRank > oldRank) {
            improved.push({
              name: item1.menuItemName,
              fromClassification: item1.classification,
              toClassification: item2.classification,
              marginChange,
            });
          } else {
            declined.push({
              name: item1.menuItemName,
              fromClassification: item1.classification,
              toClassification: item2.classification,
              marginChange,
            });
          }
        } else {
          unchanged++;
        }
      }

      return {
        improved: improved.sort((a, b) => Number(b.marginChange) - Number(a.marginChange)),
        declined: declined.sort((a, b) => Number(a.marginChange) - Number(b.marginChange)),
        unchanged,
      };
    } catch (error) {
      this.logger.error(
        'Failed to compare snapshots',
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }
}
