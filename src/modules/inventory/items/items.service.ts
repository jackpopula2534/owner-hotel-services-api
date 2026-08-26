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
import { ScanBarcodeDto } from './dto/scan-barcode.dto';

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
  /** RAW_MATERIAL = วัตถุดิบ · FINISHED_GOOD = ของสำเร็จรูปที่ผูกเป็นเมนูขายได้ */
  itemType: string;
  /** ราคาขายแนะนำต่อหน่วย — null = ยังไม่ตั้ง */
  sellingPrice: unknown;
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
  /**
   * ราคาขายที่ตั้งไว้กับตัวสินค้า — null = ยังไม่ตั้ง
   * ต้องติดมากับผลค้นหาด้วย ไม่ใช่เฉพาะ findAll เพราะหน้าขายหยิบของจากช่องค้นหา
   * แล้วเข้าตะกร้าเลย ถ้าไม่มีราคามาให้ หน้าจอจะไปเดาราคาเอง
   */
  sellingPrice: number | null;
  categoryId: string | null;
  category: { id: string; name: string } | null;
  imageUrl: string | null;
  isPerishable: boolean;
  defaultShelfLifeDays: number | null;
  reorderPoint: number;
  /**
   * On-hand balance of the item in the warehouse passed via `warehouseId`.
   * `null` when no warehouse was supplied (the generic typeahead does not join
   * stock rows). Used by the requisition form to show what can be drawn from
   * the source warehouse.
   */
  stockQuantity?: number | null;
}

/** ผลของการยิงบาร์โค้ดหนึ่งครั้ง — ต้องเป็นของชิ้นเดียวเสมอ ไม่ใช่รายการให้เลือก */
export interface ScannedItem {
  id: string;
  sku: string;
  name: string;
  unit: string;
  barcode: string | null;
  imageUrl: string | null;
  /** ราคาขายที่ผูกกับตัวสินค้า — null = ยังไม่ตั้ง หน้าขายต้องไม่เดาราคาเอง */
  sellingPrice: number | null;
  category: { id: string; name: string } | null;
  /** ยอดคงเหลือของคลังที่ส่ง warehouseId มา — null = ไม่ได้ระบุคลัง */
  stockQuantity: number | null;
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
   * Resolve a category id to itself plus every descendant id (any depth),
   * scoped to the tenant. Used so a parent-category filter includes items that
   * live on child categories. Returns [rootId] when the category has no
   * children (or is unknown), keeping leaf-category filters unchanged.
   */
  private async resolveCategoryTree(tenantId: string, rootId: string): Promise<string[]> {
    const cats = await this.prisma.itemCategory.findMany({
      where: { tenantId },
      select: { id: true, parentId: true },
    });
    const childrenOf = new Map<string, string[]>();
    for (const c of cats) {
      if (!c.parentId) continue;
      const list = childrenOf.get(c.parentId) ?? [];
      list.push(c.id);
      childrenOf.set(c.parentId, list);
    }
    const ids: string[] = [];
    const seen = new Set<string>();
    const stack = [rootId];
    while (stack.length > 0) {
      const id = stack.pop() as string;
      if (seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
      for (const child of childrenOf.get(id) ?? []) stack.push(child);
    }
    return ids;
  }

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
        // mode: 'insensitive' is not supported by Prisma v5 + MySQL
        // MySQL utf8mb4_unicode_ci is already case-insensitive by default
        where.OR = [{ name: { contains: query.search } }, { sku: { contains: query.search } }];
      }

      if (query.categoryId) {
        // Categories form a tree (e.g. "F&B วัตถุดิบ" → ผักและผลไม้ / ของแห้ง /
        // เนื้อสัตว์ …). Items sit on the leaf categories, so an exact match on a
        // parent returns nothing. Expand the selected category to itself + all
        // descendants so picking a parent shows every item beneath it.
        const categoryIds = await this.resolveCategoryTree(tenantId, query.categoryId);
        where.categoryId = categoryIds.length > 1 ? { in: categoryIds } : query.categoryId;
      }

      if (query.isActive !== undefined) {
        where.isActive = query.isActive;
      }

      if (query.isPerishable !== undefined) {
        where.isPerishable = query.isPerishable;
      }

      if (query.itemType) {
        where.itemType = query.itemType;
      }

      // When filtering by warehouse, only return items that hold stock in it.
      if (query.warehouseId) {
        where.warehouseStocks = { some: { warehouseId: query.warehouseId } };
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
            // Scope the stock rows to the selected warehouse so totalStock
            // reflects that warehouse only; otherwise aggregate across all.
            ...(query.warehouseId ? { where: { warehouseId: query.warehouseId } } : {}),
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

      // NOTE: `mode: 'insensitive'` is not supported by Prisma v5 with MySQL
      // and throws a PrismaClientValidationError (→ 400 Bad Request).
      // MySQL with utf8mb4_unicode_ci is already case-insensitive by default,
      // so omitting the mode flag produces the same behavior without errors.
      const where: Record<string, unknown> = {
        tenantId,
        deletedAt: null,
        isActive,
        OR: [
          { name: { contains: query } },
          { sku: { contains: query } },
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
          sellingPrice: true,
          categoryId: true,
          imageUrl: true,
          isPerishable: true,
          defaultShelfLifeDays: true,
          requiresLotTracking: true,
          reorderPoint: true,
          category: { select: { id: true, name: true } },
          // Only join stock rows when a warehouse was supplied — keeps the
          // generic typeahead lightweight (see DTO docblock).
          ...(dto.warehouseId
            ? {
                warehouseStocks: {
                  where: { warehouseId: dto.warehouseId },
                  select: { quantity: true },
                },
              }
            : {}),
        },
        take: limit,
        orderBy: [{ name: 'asc' }, { sku: 'asc' }],
      });

      return items.map((item) => {
        const { warehouseStocks, ...rest } = item as typeof item & {
          warehouseStocks?: Array<{ quantity: number }>;
        };
        return {
          ...rest,
          category: item.category ?? null,
          // Decimal → number ตั้งแต่ตรงนี้ หน้าจอจะได้ไม่ต้องแปลงเอง (แล้วลืมแปลง)
          sellingPrice: item.sellingPrice === null ? null : Number(item.sellingPrice),
          stockQuantity: dto.warehouseId
            ? (warehouseStocks ?? []).reduce((sum, ws) => sum + ws.quantity, 0)
            : null,
        };
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`Error searching items: ${message}`, stack);
      throw error;
    }
  }

  /**
   * ยิงบาร์โค้ดหนึ่งครั้ง = ได้ของชิ้นเดียว หรือไม่ได้เลย
   *
   * ทำไมไม่ใช้ `searchItems`: ตัวนั้นเทียบ name/sku แบบ contains ด้วย แล้วเรียงตามชื่อ
   * ยิงบาร์โค้ด "8850001000011" จึงมีโอกาสได้ของตัวอื่นมาเป็นรายการแรก ถ้าหน้าขาย
   * หยิบตัวแรกเข้าตะกร้าอัตโนมัติ แขกจะโดนคิดเงินของผิดตัวโดยไม่มีใครอ่านซ้ำ
   *
   * เจอมากกว่าหนึ่ง = ข้อมูลผิดตั้งแต่ต้นทาง ต้องหยุดแล้วบอกว่าไปแก้ที่ไหน
   * ไม่ใช่เลือกให้เองเงียบ ๆ (กันไว้ตอนสร้าง/แก้สินค้าอีกชั้นด้วย)
   */
  async findByBarcode(tenantId: string, dto: ScanBarcodeDto): Promise<ScannedItem> {
    const code = dto.code.trim();

    const matches = await this.prisma.inventoryItem.findMany({
      where: { tenantId, deletedAt: null, isActive: true, barcode: code },
      select: {
        id: true,
        sku: true,
        name: true,
        unit: true,
        barcode: true,
        imageUrl: true,
        sellingPrice: true,
        category: { select: { id: true, name: true } },
        ...(dto.warehouseId
          ? {
              warehouseStocks: {
                where: { warehouseId: dto.warehouseId },
                select: { quantity: true, reservedQty: true },
              },
            }
          : {}),
      },
      take: 2,
    });

    if (matches.length === 0) {
      throw new NotFoundException(`ไม่พบสินค้าที่ผูกกับบาร์โค้ด ${code}`);
    }

    if (matches.length > 1) {
      throw new ConflictException(
        `บาร์โค้ด ${code} ผูกอยู่กับสินค้ามากกว่าหนึ่งรายการ — แก้ที่หน้ารายการสินค้าก่อนจึงจะยิงขายได้`,
      );
    }

    const item = matches[0] as (typeof matches)[number] & {
      warehouseStocks?: Array<{ quantity: number; reservedQty: number }>;
    };

    return {
      id: item.id,
      sku: item.sku,
      name: item.name,
      unit: item.unit,
      barcode: item.barcode,
      imageUrl: item.imageUrl,
      sellingPrice: item.sellingPrice === null ? null : Number(item.sellingPrice),
      category: item.category ?? null,
      // ยอดที่หยิบได้จริงคือคงเหลือหักที่ถูกกันไว้ ไม่ใช่คงเหลือดิบ
      stockQuantity: dto.warehouseId
        ? (item.warehouseStocks ?? []).reduce(
            (sum, ws) => sum + Math.max(ws.quantity - ws.reservedQty, 0),
            0,
          )
        : null,
    };
  }

  /**
   * บาร์โค้ดต้องชี้ไปที่ของชิ้นเดียวในกิจการเดียวกัน
   * ปล่อยให้ซ้ำได้เมื่อไหร่ หน้าขายจะยิงแล้วได้ของผิดตัวทันที
   */
  private async assertBarcodeIsFree(
    tenantId: string,
    barcode: string | null | undefined,
    excludeItemId?: string,
  ): Promise<void> {
    const code = typeof barcode === 'string' ? barcode.trim() : '';
    if (!code) return;

    const clash = await this.prisma.inventoryItem.findFirst({
      where: {
        tenantId,
        barcode: code,
        deletedAt: null,
        ...(excludeItemId ? { id: { not: excludeItemId } } : {}),
      },
      select: { sku: true, name: true },
    });

    if (clash) {
      throw new ConflictException(
        `บาร์โค้ด ${code} ถูกใช้กับ "${clash.name}" (${clash.sku}) อยู่แล้ว`,
      );
    }
  }

  /**
   * Find a single item by ID with full details
   * Include category, suppliers, and stock per warehouse
   */
  async findOne(id: string, tenantId: string): Promise<any> {
    try {
      const item = await this.prisma.inventoryItem.findFirst({
        where: { id, tenantId },
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

      await this.assertBarcodeIsFree(tenantId, dto.barcode);

      // Validate categoryId exists if provided
      if (dto.categoryId) {
        const category = await this.prisma.itemCategory.findFirst({
          where: { id: dto.categoryId, tenantId },
        });

        if (!category) {
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
          itemType: dto.itemType || 'RAW_MATERIAL',
          sellingPrice: dto.sellingPrice ?? null,
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

      if (dto.barcode !== undefined && dto.barcode !== item.barcode) {
        await this.assertBarcodeIsFree(tenantId, dto.barcode, id);
      }

      // Validate categoryId if being changed
      if (dto.categoryId && dto.categoryId !== item.categoryId) {
        const category = await this.prisma.itemCategory.findFirst({
          where: { id: dto.categoryId, tenantId },
        });

        if (!category) {
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
          ...(dto.itemType && { itemType: dto.itemType }),
          // null = ล้างราคาขายทิ้ง ต้องเช็ค undefined ไม่ใช่ truthy (0 บาทก็เป็นราคาที่ตั้งได้)
          ...(dto.sellingPrice !== undefined && { sellingPrice: dto.sellingPrice }),
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
   * Set the item's image URL (called after a successful file upload).
   * Validates tenant ownership via findOne before persisting.
   */
  async setImageUrl(id: string, imageUrl: string, tenantId: string): Promise<any> {
    try {
      await this.findOne(id, tenantId);

      const updated = await this.prisma.inventoryItem.update({
        where: { id },
        data: { imageUrl },
      });

      this.logger.log(`Item ${id} image updated`);
      return updated;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(
        `Error setting image for item ${id}: ${error.message}`,
        error.stack,
      );
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
