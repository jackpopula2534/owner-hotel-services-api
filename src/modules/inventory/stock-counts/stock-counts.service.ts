import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateStockCountDto, CountTypeDto } from './dto/create-stock-count.dto';
import { UpdateStockCountItemDto } from './dto/update-stock-count-item.dto';
import { QueryStockCountDto } from './dto/query-stock-count.dto';

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface StockCountDetail {
  id: string;
  tenantId: string;
  scNumber: string;
  warehouseId: string;
  warehouseName?: string;
  countDate: string;
  countType: string;
  status: string;
  totalItemCount: number;
  countedItems: number;
  totalVariance: number;
  varianceItems: number;
  notes?: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  startedBy?: string;
  startedAt?: Date;
  completedBy?: string;
  completedAt?: Date;
  approvedBy?: string;
  approvedAt?: Date;
  items?: any[];
}

@Injectable()
export class StockCountsService {
  private readonly logger = new Logger(StockCountsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Generate Stock Count document number (SC-YYYYMM-NNNN)
   */
  private async generateSCNumber(tenantId: string, tx: any): Promise<string> {
    const now = new Date();
    const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;

    const seq = await tx.documentSequence.upsert({
      where: {
        tenantId_docType_yearMonth: {
          tenantId,
          docType: 'STOCK_COUNT',
          yearMonth,
        },
      },
      create: {
        tenantId,
        docType: 'STOCK_COUNT',
        prefix: 'SC',
        yearMonth,
        lastNumber: 1,
      },
      update: { lastNumber: { increment: 1 } },
    });

    return `SC-${yearMonth}-${String(seq.lastNumber).padStart(4, '0')}`;
  }

  /**
   * Find all stock counts with pagination and filters
   */
  async findAll(
    tenantId: string,
    query: QueryStockCountDto,
  ): Promise<PaginatedResponse<StockCountDetail>> {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;
    const sort = query.sort || 'createdAt';
    const order = query.order || 'desc';

    const where: Record<string, any> = { tenantId };

    if (query.warehouseId) {
      where.warehouseId = query.warehouseId;
    }

    if (query.status) {
      where.status = query.status;
    }

    if (query.countType) {
      where.countType = query.countType;
    }

    if (query.startDate || query.endDate) {
      where.countDate = {};
      if (query.startDate) {
        where.countDate.gte = new Date(query.startDate);
      }
      if (query.endDate) {
        where.countDate.lte = new Date(query.endDate);
      }
    }

    const [counts, total] = await Promise.all([
      this.prisma.stockCount.findMany({
        where,
        include: {
          warehouse: { select: { id: true, name: true } },
          items: true,
        },
        orderBy: { [sort]: order },
        skip,
        take: limit,
      }),
      this.prisma.stockCount.count({ where }),
    ]);

    const data = counts.map((sc) => this.mapToDetail(sc));

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Find a single stock count by ID with full details
   */
  async findOne(id: string, tenantId: string): Promise<StockCountDetail> {
    const count = await this.prisma.stockCount.findUnique({
      where: { id },
      include: {
        warehouse: { select: { id: true, name: true } },
        items: {
          include: {
            item: { select: { id: true, name: true, sku: true } },
          },
        },
      },
    });

    if (!count) {
      throw new NotFoundException(`Stock count with ID ${id} not found`);
    }

    if (count.tenantId !== tenantId) {
      throw new NotFoundException(`Stock count with ID ${id} not found`);
    }

    return this.mapToDetail(count);
  }

  /**
   * Create stock count with automatic item population
   */
  async create(
    dto: CreateStockCountDto,
    userId: string,
    tenantId: string,
  ): Promise<StockCountDetail> {
    return await this.prisma.$transaction(async (tx) => {
      // 1. Validate warehouse
      const warehouse = await tx.warehouse.findUnique({
        where: { id: dto.warehouseId },
      });

      if (!warehouse) {
        throw new NotFoundException(`Warehouse with ID ${dto.warehouseId} not found`);
      }

      if (warehouse.tenantId !== tenantId) {
        throw new NotFoundException(`Warehouse with ID ${dto.warehouseId} not found`);
      }

      // 2. Generate SC number
      const scNumber = await this.generateSCNumber(tenantId, tx);

      // 3. Create StockCount record
      const stockCount = await tx.stockCount.create({
        data: {
          tenantId,
          countNumber: scNumber,
          warehouseId: dto.warehouseId,
          countDate: new Date(dto.countDate),
          countType: dto.countType || CountTypeDto.FULL,
          status: 'PLANNED',
          notes: dto.notes,
          createdBy: userId,
        },
      });

      // 4. Create StockCountItems
      let itemsToCount: string[] = [];

      if (dto.items && dto.items.length > 0) {
        // Use provided items
        itemsToCount = dto.items.map((item) => item.itemId);
      } else {
        // Auto-populate all items with stock in warehouse
        const warehouseStocks = await tx.warehouseStock.findMany({
          where: {
            warehouseId: dto.warehouseId,
            quantity: { gt: 0 },
          },
          select: { itemId: true },
        });
        itemsToCount = warehouseStocks.map((ws) => ws.itemId);
      }

      // Validate all items exist and snapshot quantities
      const countItems = [];
      for (const itemId of itemsToCount) {
        const invItem = await tx.inventoryItem.findUnique({
          where: { id: itemId },
        });

        if (!invItem) {
          throw new NotFoundException(`Inventory item with ID ${itemId} not found`);
        }

        // Get current warehouse stock
        const warehouseStock = await tx.warehouseStock.findUnique({
          where: {
            warehouseId_itemId: {
              warehouseId: dto.warehouseId,
              itemId,
            },
          },
        });

        const systemQty = warehouseStock?.quantity || 0;
        const unitCost = warehouseStock ? Number(warehouseStock.avgCost) : 0;

        const countItem = await tx.stockCountItem.create({
          data: {
            stockCountId: stockCount.id,
            itemId,
            systemQty,
            unitCost,
            actualQty: null,
            variance: null,
            varianceValue: null,
          },
        });

        countItems.push(countItem);
      }

      return this.mapToDetail({
        ...stockCount,
        warehouse: { id: warehouse.id, name: warehouse.name },
        items: countItems,
      });
    });
  }

  /**
   * Start stock count (PLANNED → IN_PROGRESS)
   */
  async startCount(id: string, userId: string, tenantId: string): Promise<StockCountDetail> {
    const count = await this.prisma.stockCount.findUnique({
      where: { id },
    });

    if (!count) {
      throw new NotFoundException(`Stock count with ID ${id} not found`);
    }

    if (count.tenantId !== tenantId) {
      throw new NotFoundException(`Stock count with ID ${id} not found`);
    }

    if (count.status !== 'PLANNED') {
      throw new ConflictException('Stock count must be in PLANNED status to start');
    }

    const updated = await this.prisma.stockCount.update({
      where: { id },
      data: {
        status: 'IN_PROGRESS',
      },
      include: {
        warehouse: { select: { id: true, name: true } },
        items: {
          include: {
            item: { select: { id: true, name: true, sku: true } },
          },
        },
      },
    });

    return this.mapToDetail(updated);
  }

  /**
   * Record actual count for a specific item
   */
  async recordCount(
    id: string,
    itemId: string,
    dto: UpdateStockCountItemDto,
    userId: string,
    tenantId: string,
  ): Promise<any> {
    return await this.prisma.$transaction(async (tx) => {
      // Validate stock count exists
      const count = await tx.stockCount.findUnique({
        where: { id },
        include: { items: true },
      });

      if (!count) {
        throw new NotFoundException(`Stock count with ID ${id} not found`);
      }

      if (count.tenantId !== tenantId) {
        throw new NotFoundException(`Stock count with ID ${id} not found`);
      }

      if (count.status !== 'IN_PROGRESS') {
        throw new ConflictException('Stock count must be IN_PROGRESS to record counts');
      }

      // Find and update the item
      const countItem = await tx.stockCountItem.findFirst({
        where: {
          stockCountId: id,
          itemId,
        },
      });

      if (!countItem) {
        throw new NotFoundException(`Item ${itemId} not found in this stock count`);
      }

      const variance = dto.actualQty - countItem.systemQty;
      const varianceValue = variance * Number(countItem.unitCost);

      const updated = await tx.stockCountItem.update({
        where: { id: countItem.id },
        data: {
          actualQty: dto.actualQty,
          variance,
          varianceValue,
          countedBy: userId,
          countedAt: new Date(),
          notes: dto.notes,
        },
        include: {
          item: { select: { id: true, name: true, sku: true } },
        },
      });

      // Increment countedItems on parent StockCount
      const countedItemsCount = await tx.stockCountItem.count({
        where: {
          stockCountId: id,
          countedAt: { not: null },
        },
      });

      await tx.stockCount.update({
        where: { id },
        data: { countedItems: countedItemsCount },
      });

      return {
        id: updated.id,
        itemId: updated.itemId,
        itemName: updated.item?.name,
        itemSku: updated.item?.sku,
        systemQty: updated.systemQty,
        actualQty: updated.actualQty,
        variance: updated.variance,
        varianceValue: updated.varianceValue,
        countedBy: updated.countedBy,
        countedAt: updated.countedAt,
        notes: updated.notes,
      };
    });
  }

  /**
   * Complete stock count (IN_PROGRESS → COMPLETED)
   */
  async completeCount(id: string, userId: string, tenantId: string): Promise<StockCountDetail> {
    return await this.prisma.$transaction(async (tx) => {
      const count = await tx.stockCount.findUnique({
        where: { id },
        include: { items: true },
      });

      if (!count) {
        throw new NotFoundException(`Stock count with ID ${id} not found`);
      }

      if (count.tenantId !== tenantId) {
        throw new NotFoundException(`Stock count with ID ${id} not found`);
      }

      if (count.status !== 'IN_PROGRESS') {
        throw new ConflictException('Stock count must be IN_PROGRESS to complete');
      }

      // Calculate totals
      const itemsWithVariance = count.items.filter(
        (item: any) => item.variance !== 0 && item.variance !== null,
      );
      const totalVariance = count.items.reduce(
        (sum: number, item: any) => sum + (item.variance || 0),
        0,
      );

      const updated = await tx.stockCount.update({
        where: { id },
        data: {
          status: 'COMPLETED',
          totalVariance,
          varianceItems: itemsWithVariance.length,
        },
        include: {
          warehouse: { select: { id: true, name: true } },
          items: {
            include: {
              item: { select: { id: true, name: true, sku: true } },
            },
          },
        },
      });

      return this.mapToDetail(updated);
    });
  }

  /**
   * Approve stock count and post adjustments (COMPLETED → APPROVED)
   */
  async approveCount(id: string, userId: string, tenantId: string): Promise<StockCountDetail> {
    return await this.prisma.$transaction(async (tx) => {
      const count = await tx.stockCount.findUnique({
        where: { id },
        include: { items: true },
      });

      if (!count) {
        throw new NotFoundException(`Stock count with ID ${id} not found`);
      }

      if (count.tenantId !== tenantId) {
        throw new NotFoundException(`Stock count with ID ${id} not found`);
      }

      if (count.status !== 'COMPLETED') {
        throw new ConflictException('Stock count must be COMPLETED to approve');
      }

      // Process all items with variance
      for (const item of count.items) {
        if (item.variance !== 0 && item.variance !== null) {
          const movementType = item.variance > 0 ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT';

          // Create StockMovement
          await tx.stockMovement.create({
            data: {
              tenantId,
              warehouse: { connect: { id: count.warehouseId } },
              item: { connect: { id: item.itemId } },
              type: movementType,
              quantity: Math.abs(item.variance),
              unitCost: item.unitCost,
              totalCost: Math.abs(item.variance) * Number(item.unitCost),
              referenceType: 'STOCK_COUNT',
              referenceId: count.id,
              notes: `Variance from stock count ${count.countNumber}`,
              createdBy: userId,
            },
          });

          // Update WarehouseStock
          const currentStock = await tx.warehouseStock.findUnique({
            where: {
              warehouseId_itemId: {
                warehouseId: count.warehouseId,
                itemId: item.itemId,
              },
            },
          });

          if (currentStock) {
            const newQty = currentStock.quantity + item.variance;

            if (newQty > 0) {
              await tx.warehouseStock.update({
                where: {
                  warehouseId_itemId: {
                    warehouseId: count.warehouseId,
                    itemId: item.itemId,
                  },
                },
                data: {
                  quantity: newQty,
                },
              });
            } else if (newQty === 0) {
              // Delete if stock becomes zero
              await tx.warehouseStock.delete({
                where: {
                  warehouseId_itemId: {
                    warehouseId: count.warehouseId,
                    itemId: item.itemId,
                  },
                },
              });
            }
          } else if (item.variance > 0) {
            // Create new stock if variance is positive
            await tx.warehouseStock.create({
              data: {
                warehouseId: count.warehouseId,
                itemId: item.itemId,
                quantity: item.variance,
                avgCost: item.unitCost,
                totalValue: item.variance * Number(item.unitCost),
              },
            });
          }
        }
      }

      // Update count status
      const updated = await tx.stockCount.update({
        where: { id },
        data: {
          status: 'APPROVED',
          approvedBy: userId,
          approvedAt: new Date(),
        },
        include: {
          warehouse: { select: { id: true, name: true } },
          items: {
            include: {
              item: { select: { id: true, name: true, sku: true } },
            },
          },
        },
      });

      return this.mapToDetail(updated);
    });
  }

  /**
   * Cancel stock count
   */
  async cancelCount(id: string, tenantId: string): Promise<StockCountDetail> {
    const count = await this.prisma.stockCount.findUnique({
      where: { id },
    });

    if (!count) {
      throw new NotFoundException(`Stock count with ID ${id} not found`);
    }

    if (count.tenantId !== tenantId) {
      throw new NotFoundException(`Stock count with ID ${id} not found`);
    }

    if (count.status === 'APPROVED' || count.status === 'CANCELLED') {
      throw new ConflictException('Cannot cancel an already approved or cancelled stock count');
    }

    const updated = await this.prisma.stockCount.update({
      where: { id },
      data: { status: 'CANCELLED' },
      include: {
        warehouse: { select: { id: true, name: true } },
        items: {
          include: {
            item: { select: { id: true, name: true, sku: true } },
          },
        },
      },
    });

    return this.mapToDetail(updated);
  }

  /**
   * Map raw database record to response DTO
   */
  private mapToDetail(count: any): StockCountDetail {
    const items = count.items || [];
    const itemsWithVariance = items.filter(
      (item: any) => item.variance !== 0 && item.variance !== null,
    );
    const totalVariance = items.reduce((sum: number, item: any) => sum + (item.variance || 0), 0);

    return {
      id: count.id,
      tenantId: count.tenantId,
      scNumber: count.countNumber,
      warehouseId: count.warehouseId,
      warehouseName: count.warehouse?.name,
      countDate: new Date(count.countDate).toISOString(),
      countType: count.countType,
      status: count.status,
      totalItemCount: items.length,
      countedItems: count.countedItems || 0,
      totalVariance: count.totalVariance || totalVariance,
      varianceItems: count.varianceItems || itemsWithVariance.length,
      notes: count.notes,
      createdBy: count.createdBy,
      createdAt: count.createdAt,
      updatedAt: count.updatedAt,
      startedBy: count.startedBy,
      startedAt: count.startedAt,
      completedBy: count.completedBy,
      completedAt: count.completedAt,
      approvedBy: count.approvedBy,
      approvedAt: count.approvedAt,
      items:
        items.length > 0
          ? items.map((item: any) => ({
              id: item.id,
              itemId: item.itemId,
              itemName: item.item?.name,
              itemSku: item.item?.sku,
              systemQty: item.systemQty,
              actualQty: item.actualQty,
              variance: item.variance,
              varianceValue: item.varianceValue,
              unitCost: item.unitCost,
              countedBy: item.countedBy,
              countedAt: item.countedAt?.toISOString(),
              notes: item.notes,
            }))
          : undefined,
    };
  }
}
