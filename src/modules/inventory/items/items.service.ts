import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateItemDto } from './dto/create-item.dto';
import { UpdateItemDto } from './dto/update-item.dto';
import { QueryItemDto, SortField, SortOrder } from './dto/query-item.dto';
import { SearchItemDto } from './dto/search-item.dto';

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface ItemWithStock {
  id: string;
  tenantId: string;
  sku: string;
  name: string;
  description: string | null;
  categoryId: string | null;
  unit: string;
  costMethod: string;
  reorderPoint: number;
  reorderQty: number;
  maxStock: number | null;
  minStock: number;
  barcode: string | null;
  brand: string | null;
  imageUrl: string | null;
  isPerishable: boolean;
  defaultShelfLifeDays: number | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  category: { id: string; name: string } | null;
  totalStock: number;
  lowStock: boolean;
}

export interface ItemSearchResult {
  id: string;
  sku: string;
  name: string;
  unit: string;
  barcode: string | null;
  categoryId: string | null;
  category: { id: string; name: string } | null;
  imageUrl: string | null;
  isPerishable: boolean;
  defaultShelfLifeDays: number | null;
  reorderPoint: number;
}

export interface StockSummary {
  totalItems: number;
  totalValue: number;
  lowStockCount: number;
  outOfStockCount: number;
}

@Injectable()
export class ItemsService {
  private readonly logger = new Logger(ItemsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Find all items with pagination and filters
   * Include category name, total stock across warehouses, and low stock flag
   */
  async findAll(tenantId: string, query: QueryItemDto): Promise<PaginatedResponse<ItemWithStock>> {
    try {
      const page = query.page || 1;
      const limit = query.limit || 20;
      const skip = (page - 1) * limit;
      const sort = query.sort || SortField.CREATED_AT;
      const order = query.order || SortOrder.DESC;

      // Build filter conditions
      const where: any = {
        tenantId,
        deletedAt: null,
      };

      if (query.search) {
        where.OR = [
          { name: { contains: query.search, mode: 'insensitive' } },
          { sku: { contains: query.search, mode: 'insensitive' } },
        ];
      }

      if (query.categoryId) {
        where.categoryId = query.categoryId;
      }

      if (query.isActive !== undefined) {
        where.isActive = query.isActive;
      }

      if (query.isPerishable !== undefined) {
        where.isPerishable = query.isPerishable;
      }

      // Get total count
      const total = await this.prisma.inventoryItem.count({ where });

      // Get paginated items
      const items = await this.prisma.inventoryItem.findMany({
        where,
        include: {
          category: {
            select: { id: true, name: true },
          },
          warehouseStocks: {
            select: { quantity: true },
          },
        },
        skip,
        take: limit,
        orderBy:
          sort === SortField.TOTAL_STOCK
            ? { warehouseStocks: { _count: order } }
            : { [sort]: order },
      });

      // Map items and calculate totals
      const data: ItemWithStock[] = items.map((item) => {
        const totalStock = item.warehouseStocks.reduce((sum, ws) => sum + ws.quantity, 0);
        return {
          ...item,
          category: item.category,
          totalStock,
          lowStock: totalStock < item.reorderPoint,
        };
      });

      return {
        data,
        meta: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      this.logger.error(`Error finding items: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Lightweight typeahead search for dropdowns (Goods Receive, Purchase Order, etc.).
   *
   * Trade-offs vs `findAll`:
   *   - No pagination metadata, no stock aggregation, no warehouseStocks join.
   *   - Requires `q` with at least 2 characters (enforced by SearchItemDto).
   *   - Capped at 50 results to protect the DB and keep payloads <10KB.
   *   - Only returns active, non-deleted items by default.
   *
   * Matches against `name`, `sku`, and `barcode` (case-insensitive for name/sku,
   * exact for barcode so scanners work). Ordering favours name matches first
   * — callers that need richer sorting should use `findAll`.
   */
  async searchItems(tenantId: string, dto: SearchItemDto): Promise<ItemSearchResult[]> {
    try {
      const limit = dto.limit ?? 20;
      const isActive = dto.isActive ?? true;
      const query = dto.q.trim();

      const where: Record<string, unknown> = {
        tenantId,
        deletedAt: null,
        isActive,
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { sku: { contains: query, mode: 'insensitive' } },
          { barcode: { equals: query } },
        ],
      };

      if (dto.categoryId) {
        where.categoryId = dto.categoryId;
      }

      const items = await this.prisma.inventoryItem.findMany({
        where,
        select: {
          id: true,
          sku: true,
          name: true,
          unit: true,
          barcode: true,
          categoryId: true,
          imageUrl: true,
          isPerishable: true,
          defaultShelfLifeDays: true,
          reorderPoint: true,
          category: { select: { id: true, name: true } },
        },
        take: limit,
        orderBy: [{ name: 'asc' }, { sku: 'asc' }],
      });

      return items.map((item) => ({
        ...item,
        category: item.category ?? null,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`Error searching items: ${message}`, stack);
      throw error;
    }
  }

  /**
   * Find a single item by ID with full details
   * Include category, suppliers, and stock per warehouse
   */
  async findOne(id: string, tenantId: string): Promise<any> {
    try {
      const item = await this.prisma.inventoryItem.findUnique({
        where: { id },
        include: {
          category: true,
          itemSuppliers: {
            include: {
              supplier: {
                select: {
                  id: true,
                  name: true,
                  contactPerson: true,
                  phone: true,
                  email: true,
                },
              },
            },
          },
          warehouseStocks: {
            include: {
              warehouse: {
                select: { id: true, name: true },
              },
            },
          },
        },
      });

      if (!item) {
        throw new NotFoundException(`Item with ID ${id} not found`);
      }

      if (item.tenantId !== tenantId) {
        throw new NotFoundException(`Item with ID ${id} not found`);
      }

      if (item.deletedAt) {
        throw new NotFoundException(`Item with ID ${id} not found`);
      }

      return item;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(`Error finding item ${id}: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Create a new item
   * Validate unique SKU per tenant
   */
  async create(dto: CreateItemDto, tenantId: string): Promise<any> {
    try {
      // Check for duplicate SKU within tenant
      const existing = await this.prisma.inventoryItem.findFirst({
        where: {
          tenantId,
          sku: dto.sku,
          deletedAt: null,
        },
      });

      if (existing) {
        throw new ConflictException(`Item with SKU ${dto.sku} already exists for this tenant`);
      }

      // Validate categoryId exists if provided
      if (dto.categoryId) {
        const category = await this.prisma.itemCategory.findUnique({
          where: { id: dto.categoryId },
        });

        if (!category || category.tenantId !== tenantId) {
          throw new BadRequestException('Invalid categoryId');
        }
      }

      const item = await this.prisma.inventoryItem.create({
        data: {
          tenantId,
          sku: dto.sku,
          name: dto.name,
          description: dto.description || null,
          categoryId: dto.categoryId || null,
          unit: dto.unit || 'PIECE',
          costMethod: dto.costMethod || 'WEIGHTED_AVG',
          reorderPoint: dto.reorderPoint || 0,
          reorderQty: dto.reorderQty || 0,
          maxStock: dto.maxStock || null,
          minStock: dto.minStock || 0,
          barcode: dto.barcode || null,
          brand: dto.brand || null,
          imageUrl: dto.imageUrl || null,
          isPerishable: dto.isPerishable || false,
          defaultShelfLifeDays: dto.defaultShelfLifeDays || null,
          isActive: true,
        },
        include: {
          category: true,
          itemSuppliers: true,
          warehouseStocks: true,
        },
      });

      return item;
    } catch (error) {
      if (error instanceof ConflictException || error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error(`Error creating item: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Update an item
   * Validate SKU uniqueness if changed
   */
  async update(id: string, dto: UpdateItemDto, tenantId: string): Promise<any> {
    try {
      const item = await this.findOne(id, tenantId);

      // Check for duplicate SKU if SKU is being changed
      if (dto.sku && dto.sku !== item.sku) {
        const existing = await this.prisma.inventoryItem.findFirst({
          where: {
            tenantId,
            sku: dto.sku,
            id: { not: id },
            deletedAt: null,
          },
        });

        if (existing) {
          throw new ConflictException(`Item with SKU ${dto.sku} already exists for this tenant`);
        }
      }

      // Validate categoryId if being changed
      if (dto.categoryId && dto.categoryId !== item.categoryId) {
        const category = await this.prisma.itemCategory.findUnique({
          where: { id: dto.categoryId },
        });

        if (!category || category.tenantId !== tenantId) {
          throw new BadRequestException('Invalid categoryId');
        }
      }

      const updated = await this.prisma.inventoryItem.update({
        where: { id },
        data: {
          ...(dto.sku && { sku: dto.sku }),
          ...(dto.name && { name: dto.name }),
          ...(dto.description !== undefined && { description: dto.description }),
          ...(dto.categoryId !== undefined && { categoryId: dto.categoryId }),
          ...(dto.unit && { unit: dto.unit }),
          ...(dto.costMethod && { costMethod: dto.costMethod }),
          ...(dto.reorderPoint !== undefined && { reorderPoint: dto.reorderPoint }),
          ...(dto.reorderQty !== undefined && { reorderQty: dto.reorderQty }),
          ...(dto.maxStock !== undefined && { maxStock: dto.maxStock }),
          ...(dto.minStock !== undefined && { minStock: dto.minStock }),
          ...(dto.barcode !== undefined && { barcode: dto.barcode }),
          ...(dto.brand !== undefined && { brand: dto.brand }),
          ...(dto.imageUrl !== undefined && { imageUrl: dto.imageUrl }),
          ...(dto.isPerishable !== undefined && { isPerishable: dto.isPerishable }),
          ...(dto.defaultShelfLifeDays !== undefined && {
            defaultShelfLifeDays: dto.defaultShelfLifeDays,
          }),
        },
        include: {
          category: true,
          itemSuppliers: true,
          warehouseStocks: true,
        },
      });

      return updated;
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ConflictException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      this.logger.error(`Error updating item ${id}: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Soft delete an item
   */
  async remove(id: string, tenantId: string): Promise<void> {
    try {
      const item = await this.findOne(id, tenantId);

      await this.prisma.inventoryItem.update({
        where: { id },
        data: {
          deletedAt: new Date(),
        },
      });

      this.logger.log(`Item ${id} soft deleted`);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(`Error deleting item ${id}: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get items with low stock (quantity < reorderPoint)
   * Optional filter by propertyId
   */
  async getLowStockItems(tenantId: string, propertyId?: string): Promise<any[]> {
    try {
      const items = await this.prisma.inventoryItem.findMany({
        where: {
          tenantId,
          isActive: true,
          deletedAt: null,
        },
        include: {
          category: {
            select: { id: true, name: true },
          },
          warehouseStocks: {
            select: {
              quantity: true,
              warehouse: { select: { id: true, name: true, propertyId: true } },
            },
          },
        },
      });

      // Filter items with low stock
      const lowStockItems = items.filter((item) => {
        const totalStock = item.warehouseStocks.reduce((sum, ws) => {
          if (propertyId && ws.warehouse.propertyId !== propertyId) {
            return sum;
          }
          return sum + ws.quantity;
        }, 0);

        return totalStock < item.reorderPoint;
      });

      return lowStockItems.map((item) => ({
        ...item,
        totalStock: item.warehouseStocks.reduce((sum, ws) => {
          if (propertyId && ws.warehouse.propertyId !== propertyId) {
            return sum;
          }
          return sum + ws.quantity;
        }, 0),
      }));
    } catch (error) {
      this.logger.error(`Error getting low stock items: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get stock summary for a tenant
   * Total items, total value, low stock count, out of stock count
   * Optional filter by propertyId
   */
  async getStockSummary(tenantId: string, propertyId?: string): Promise<StockSummary> {
    try {
      const items = await this.prisma.inventoryItem.findMany({
        where: {
          tenantId,
          isActive: true,
          deletedAt: null,
        },
        include: {
          warehouseStocks: {
            select: {
              quantity: true,
              totalValue: true,
              warehouse: { select: { propertyId: true } },
            },
          },
        },
      });

      let totalValue = 0;
      let lowStockCount = 0;
      let outOfStockCount = 0;

      items.forEach((item) => {
        let itemTotalStock = 0;
        let itemTotalValue = 0;

        item.warehouseStocks.forEach((ws) => {
          if (!propertyId || ws.warehouse.propertyId === propertyId) {
            itemTotalStock += Number(ws.quantity);
            itemTotalValue += Number(ws.totalValue);
          }
        });

        totalValue += itemTotalValue;

        if (itemTotalStock === 0) {
          outOfStockCount++;
        } else if (itemTotalStock < item.reorderPoint) {
          lowStockCount++;
        }
      });

      return {
        totalItems: items.length,
        totalValue: Number(totalValue.toFixed(2)),
        lowStockCount,
        outOfStockCount,
      };
    } catch (error) {
      this.logger.error(`Error getting stock summary: ${error.message}`, error.stack);
      throw error;
    }
  }
}
