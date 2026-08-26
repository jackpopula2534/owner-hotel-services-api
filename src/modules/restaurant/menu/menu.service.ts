import { Injectable, NotFoundException, BadRequestException, ConflictException, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogService } from '../../../audit-log/audit-log.service';
import { CreateMenuCategoryDto } from './dto/create-menu-category.dto';
import { UpdateMenuCategoryDto } from './dto/update-menu-category.dto';
import { ReorderCategoriesDto } from './dto/reorder-categories.dto';
import { AutoMockupCategoriesDto } from './dto/auto-mockup-categories.dto';
import { CreateMenuItemDto } from './dto/create-menu-item.dto';
import { UpdateMenuItemDto } from './dto/update-menu-item.dto';
import { CreateRecipeDto } from './dto/create-recipe.dto';
import { sampleMenuCategoryMockups } from './menu-category-mockups';

@Injectable()
export class MenuService {
  private readonly logger = new Logger(MenuService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
  ) {}

  // ─── Menu Categories ──────────────────────────────────────────────────────

  async findAllCategories(restaurantId: string, tenantId: string) {
    await this.validateRestaurant(restaurantId, tenantId);

    return this.prisma.menuCategory.findMany({
      where: { restaurantId, tenantId },
      orderBy: { displayOrder: 'asc' },
      include: {
        _count: { select: { items: true } },
      },
    });
  }

  async createCategory(
    restaurantId: string,
    dto: CreateMenuCategoryDto,
    tenantId: string,
    userId?: string,
  ) {
    await this.validateRestaurant(restaurantId, tenantId);

    const maxOrder = await this.prisma.menuCategory.aggregate({
      where: { restaurantId, tenantId },
      _max: { displayOrder: true },
    });

    const displayOrder = dto.displayOrder ?? (maxOrder._max.displayOrder ?? -1) + 1;

    const result = await this.prisma.menuCategory.create({
      data: { ...dto, displayOrder, restaurantId, tenantId },
    });

    this.auditLogService.log({
      action: 'menu_create' as any,
      resource: 'menu' as any,
      category: 'restaurant' as any,
      resourceId: result.id,
      userId,
      tenantId,
      description: 'สร้างหมวดหมู่เมนู: ' + dto.name,
    });

    return result;
  }

  async updateCategory(
    restaurantId: string,
    categoryId: string,
    dto: UpdateMenuCategoryDto,
    tenantId: string,
    userId?: string,
  ) {
    await this.findCategoryOrFail(categoryId, restaurantId, tenantId);

    const result = await this.prisma.menuCategory.update({
      where: { id: categoryId },
      data: dto,
    });

    this.auditLogService.log({
      action: 'menu_update' as any,
      resource: 'menu' as any,
      category: 'restaurant' as any,
      resourceId: categoryId,
      userId,
      tenantId,
      description: 'แก้ไขหมวดหมู่เมนู',
    });

    return result;
  }

  async removeCategory(
    restaurantId: string,
    categoryId: string,
    tenantId: string,
    userId?: string,
  ) {
    await this.findCategoryOrFail(categoryId, restaurantId, tenantId);

    const itemCount = await this.prisma.menuItem.count({
      where: { categoryId, isAvailable: true },
    });

    if (itemCount > 0) {
      throw new BadRequestException(
        `Cannot delete category with ${itemCount} active menu items. Deactivate items first.`,
      );
    }

    await this.prisma.menuCategory.delete({ where: { id: categoryId } });

    this.auditLogService.log({
      action: 'menu_delete' as any,
      resource: 'menu' as any,
      category: 'restaurant' as any,
      resourceId: categoryId,
      userId,
      tenantId,
      description: 'ลบหมวดหมู่เมนู',
    });
  }

  async reorderCategories(restaurantId: string, dto: ReorderCategoriesDto, tenantId: string) {
    await this.validateRestaurant(restaurantId, tenantId);

    await this.prisma.$transaction(
      dto.categories.map(({ id, displayOrder }) =>
        this.prisma.menuCategory.updateMany({
          where: { id, restaurantId, tenantId },
          data: { displayOrder },
        }),
      ),
    );

    return this.findAllCategories(restaurantId, tenantId);
  }

  /**
   * Seeds 5–10 random F&B categories for the given restaurant.
   *
   * The endpoint is idempotent in the sense that it never duplicates existing
   * names: if the restaurant already has a category named "Desserts" we skip
   * the matching mockup entry. This keeps the button safe to click multiple
   * times while still topping up the list with new entries.
   */
  async autoMockupCategories(
    restaurantId: string,
    dto: AutoMockupCategoriesDto,
    tenantId: string,
    userId?: string,
  ) {
    await this.validateRestaurant(restaurantId, tenantId);

    const existing = await this.prisma.menuCategory.findMany({
      where: { restaurantId, tenantId },
      select: { name: true, displayOrder: true },
    });

    const existingNames = new Set(existing.map((c) => c.name.trim().toLowerCase()));
    const startOrder =
      existing.reduce((max, c) => (c.displayOrder > max ? c.displayOrder : max), -1) + 1;

    const samples = sampleMenuCategoryMockups(dto?.count).filter(
      (mockup) => !existingNames.has(mockup.name.trim().toLowerCase()),
    );

    if (samples.length === 0) {
      return {
        created: [] as Awaited<ReturnType<typeof this.findAllCategories>>,
        skipped: dto?.count ?? 0,
        total: existing.length,
      };
    }

    const created = await this.prisma.$transaction(
      samples.map((mockup, idx) =>
        this.prisma.menuCategory.create({
          data: {
            ...mockup,
            displayOrder: startOrder + idx,
            isActive: true,
            restaurantId,
            tenantId,
          },
        }),
      ),
    );

    this.auditLogService.log({
      action: 'menu_create' as any,
      resource: 'menu' as any,
      category: 'restaurant' as any,
      resourceId: restaurantId,
      userId,
      tenantId,
      description: `Auto-mockup สร้างหมวดหมู่เมนู ${created.length} รายการ`,
    });

    return {
      created,
      skipped: 0,
      total: existing.length + created.length,
    };
  }

  // ─── Menu Items ───────────────────────────────────────────────────────────

  async findAllItems(
    restaurantId: string,
    query: {
      categoryId?: string;
      isAvailable?: string;
      search?: string;
      page?: number;
      limit?: number;
    },
    tenantId: string,
  ) {
    await this.validateRestaurant(restaurantId, tenantId);

    const { categoryId, isAvailable, search, page = 1, limit = 50 } = query;
    const skip = (Number(page) - 1) * Number(limit);

    const where: Record<string, unknown> = { restaurantId, tenantId };

    if (categoryId) where.categoryId = categoryId;
    if (isAvailable !== undefined) where.isAvailable = isAvailable === 'true';
    if (search) {
      where.OR = [{ name: { contains: search } }, { description: { contains: search } }];
    }

    const [data, total] = await Promise.all([
      this.prisma.menuItem.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
        include: {
          category: { select: { id: true, name: true } },
          inventoryItem: { select: { id: true, name: true, sku: true, unit: true, barcode: true } },
        },
      }),
      this.prisma.menuItem.count({ where }),
    ]);

    return {
      data: data.map((item) => this.parseItemAllergens(item)),
      total,
      page: Number(page),
      limit: Number(limit),
    };
  }

  async findOneItem(restaurantId: string, itemId: string, tenantId: string) {
    const item = await this.prisma.menuItem.findFirst({
      where: { id: itemId, restaurantId, tenantId },
      include: {
        category: true,
        inventoryItem: { select: { id: true, name: true, sku: true, unit: true, barcode: true } },
      },
    });

    if (!item) {
      throw new NotFoundException(`Menu item with ID ${itemId} not found`);
    }

    return this.parseItemAllergens(item);
  }

  /**
   * ยิงบาร์โค้ดที่หน้าขายร้านอาหาร → เมนูที่ผูกกับสินค้าชิ้นนั้น
   *
   * บาร์โค้ดอยู่ที่ตัวสินค้าในคลัง ไม่ได้อยู่ที่เมนู — เมนูของสำเร็จรูปเป็นแค่หน้าร้าน
   * ของสินค้าตัวเดียวกัน ที่นี่จึงวิ่งจากบาร์โค้ดผ่าน inventoryItem กลับมาที่เมนู
   *
   * ทำไมต้องมี endpoint ทั้งที่หน้าจอโหลดเมนูไว้แล้ว: หน้าขายโหลดมาแค่ 100 รายการแรก
   * ร้านที่มีเมนูมากกว่านั้นจะยิงของจริงแล้วขึ้นว่า "ไม่พบ" ทั้งที่ของมีอยู่
   */
  async findItemByBarcode(restaurantId: string, code: string, tenantId: string) {
    await this.validateRestaurant(restaurantId, tenantId);

    const barcode = code.trim();
    if (barcode.length < 3) {
      throw new BadRequestException('บาร์โค้ดสั้นเกินไป');
    }

    const matches = await this.prisma.menuItem.findMany({
      where: {
        restaurantId,
        tenantId,
        inventoryItem: { barcode, tenantId, deletedAt: null },
      },
      include: {
        category: { select: { id: true, name: true } },
        inventoryItem: { select: { id: true, name: true, sku: true, unit: true, barcode: true } },
      },
      take: 2,
    });

    if (matches.length === 0) {
      throw new NotFoundException(`ไม่พบเมนูที่ผูกกับบาร์โค้ด ${barcode} ในร้านนี้`);
    }

    // ของชิ้นเดียวถูกผูกไว้สองเมนู = ยิงแล้วไม่รู้ว่าจะคิดราคาไหน ต้องหยุดไม่ใช่เดา
    if (matches.length > 1) {
      throw new ConflictException(
        `บาร์โค้ด ${barcode} ผูกอยู่กับเมนูมากกว่าหนึ่งรายการในร้านนี้ — แก้ที่หน้าจัดการเมนูก่อน`,
      );
    }

    return this.parseItemAllergens(matches[0]);
  }

  async createItem(
    restaurantId: string,
    dto: CreateMenuItemDto,
    tenantId: string,
    userId?: string,
  ) {
    await this.validateRestaurant(restaurantId, tenantId);
    await this.findCategoryOrFail(dto.categoryId, restaurantId, tenantId);
    this.assertStockConfigValid(dto);
    if (dto.inventoryItemId) {
      await this.validateInventoryItem(dto.inventoryItemId, tenantId);
    }

    const maxOrder = await this.prisma.menuItem.aggregate({
      where: { categoryId: dto.categoryId, tenantId },
      _max: { displayOrder: true },
    });

    const displayOrder = dto.displayOrder ?? (maxOrder._max.displayOrder ?? -1) + 1;

    const item = await this.prisma.menuItem.create({
      data: {
        ...dto,
        price: dto.price,
        cost: dto.cost,
        // allergens is a Json? column — pass the array directly, no stringify needed
        allergens: dto.allergens ?? undefined,
        displayOrder,
        restaurantId,
        tenantId,
      },
      include: {
        category: { select: { id: true, name: true } },
        inventoryItem: { select: { id: true, name: true, sku: true, unit: true, barcode: true } },
      },
    });

    // ยอดยกมาต้องมีบรรทัดในสมุดเดินสต๊อกด้วย ไม่งั้นยอดคงเหลือจะอธิบายที่มาไม่ได้
    if (item.trackStock && item.stockQty > 0) {
      await this.recordOpeningStock(item.id, item.stockQty, tenantId, userId);
    }

    this.auditLogService.log({
      action: 'menu_create' as any,
      resource: 'menu' as any,
      category: 'restaurant' as any,
      resourceId: item.id,
      userId,
      tenantId,
      description: 'สร้างรายการเมนู: ' + dto.name,
    });

    return this.parseItemAllergens(item);
  }

  async updateItem(
    restaurantId: string,
    itemId: string,
    dto: UpdateMenuItemDto,
    tenantId: string,
    userId?: string,
  ) {
    const current = await this.findOneItem(restaurantId, itemId, tenantId);

    if (dto.categoryId) {
      await this.findCategoryOrFail(dto.categoryId, restaurantId, tenantId);
    }
    this.assertStockConfigValid({ ...current, ...dto });
    if (dto.inventoryItemId) {
      await this.validateInventoryItem(dto.inventoryItemId, tenantId);
      await this.assertNoRecipe(itemId);
    }

    // จำนวนคงเหลือแก้ตรง ๆ ผ่าน PATCH ไม่ได้ — ต้องเดินผ่าน /stock เพื่อให้มีบรรทัดอธิบาย
    // ข้อยกเว้นเดียวคือตอนเพิ่งเปิดการนับสต๊อก ซึ่งนับเป็นยอดยกมา
    const enablingTracking = dto.trackStock === true && !current.trackStock;
    const openingQty = enablingTracking ? dto.stockQty ?? 0 : undefined;
    const { stockQty: _ignoredStockQty, ...rest } = dto;

    const item = await this.prisma.menuItem.update({
      where: { id: itemId },
      data: {
        ...rest,
        ...(openingQty !== undefined ? { stockQty: openingQty } : {}),
        // allergens is a Json? column — pass the array directly, no stringify needed
        allergens: dto.allergens !== undefined ? dto.allergens : undefined,
      },
      include: {
        category: { select: { id: true, name: true } },
        inventoryItem: { select: { id: true, name: true, sku: true, unit: true, barcode: true } },
      },
    });

    if (openingQty !== undefined && openingQty > 0) {
      await this.recordOpeningStock(itemId, openingQty, tenantId, userId);
    }

    this.auditLogService.log({
      action: 'menu_update' as any,
      resource: 'menu' as any,
      category: 'restaurant' as any,
      resourceId: itemId,
      userId,
      tenantId,
      description: 'แก้ไขรายการเมนู',
    });

    return this.parseItemAllergens(item);
  }

  async toggleAvailability(
    restaurantId: string,
    itemId: string,
    isAvailable: boolean,
    tenantId: string,
    userId?: string,
  ) {
    await this.findOneItem(restaurantId, itemId, tenantId);

    const result = await this.prisma.menuItem.update({
      where: { id: itemId },
      data: { isAvailable },
    });

    this.auditLogService.log({
      action: 'menu_update' as any,
      resource: 'menu' as any,
      category: 'restaurant' as any,
      resourceId: itemId,
      userId,
      tenantId,
      description: 'เปลี่ยนสถานะเมนู: ' + (isAvailable ? 'พร้อมขาย' : 'หยุดขาย'),
    });

    return result;
  }

  async removeItem(restaurantId: string, itemId: string, tenantId: string, userId?: string) {
    await this.findOneItem(restaurantId, itemId, tenantId);

    await this.prisma.menuItem.delete({ where: { id: itemId } });

    this.auditLogService.log({
      action: 'menu_delete' as any,
      resource: 'menu' as any,
      category: 'restaurant' as any,
      resourceId: itemId,
      userId,
      tenantId,
      description: 'ลบรายการเมนู',
    });
  }

  // ─── Recipe ───────────────────────────────────────────────────────────────

  async getRecipe(restaurantId: string, itemId: string, tenantId: string) {
    await this.findOneItem(restaurantId, itemId, tenantId);

    return this.prisma.menuItemRecipe.findUnique({
      where: { menuItemId: itemId },
      include: {
        ingredients: {
          orderBy: { displayOrder: 'asc' },
          include: { item: { select: { id: true, name: true, unit: true, sku: true } } },
        },
      },
    });
  }

  async upsertRecipe(
    restaurantId: string,
    itemId: string,
    dto: CreateRecipeDto,
    tenantId: string,
    userId?: string,
  ) {
    const item = await this.findOneItem(restaurantId, itemId, tenantId);

    // สูตรอาหารตัดวัตถุดิบเอง จึงซ้อนกับการผูกสินค้าสำเร็จรูป 1:1 ไม่ได้ — ตัดสองรอบ
    if (item.inventoryItemId) {
      throw new BadRequestException(
        'เมนูนี้ผูกกับสินค้าในคลังโดยตรงแล้ว จึงเพิ่มสูตรอาหารไม่ได้ — ยกเลิกการผูกก่อนถ้าจะตั้งสูตร',
      );
    }

    const { ingredients, ...recipeData } = dto;

    const result = await this.prisma.$transaction(async (tx) => {
      const recipe = await tx.menuItemRecipe.upsert({
        where: { menuItemId: itemId },
        create: { ...recipeData, menuItemId: itemId },
        update: recipeData,
      });

      if (ingredients !== undefined) {
        // Replace all existing ingredients on every save
        await tx.recipeIngredient.deleteMany({ where: { recipeId: recipe.id } });

        if (ingredients.length > 0) {
          await tx.recipeIngredient.createMany({
            data: ingredients.map((ing, idx) => ({
              recipeId: recipe.id,
              name: ing.name,
              itemId: ing.itemId ?? null,
              quantity: ing.quantity ?? null,
              unit: ing.unit ?? null,
              wastagePercent: ing.wastagePercent ?? 0,
              notes: ing.notes ?? null,
              displayOrder: ing.displayOrder ?? idx,
            })),
          });
        }
      }

      return tx.menuItemRecipe.findUnique({
        where: { id: recipe.id },
        include: {
          ingredients: {
            orderBy: { displayOrder: 'asc' },
            include: { item: { select: { id: true, name: true, unit: true, sku: true } } },
          },
        },
      });
    });

    this.auditLogService.log({
      action: 'menu_update' as any,
      resource: 'menu' as any,
      category: 'restaurant' as any,
      resourceId: itemId,
      userId,
      tenantId,
      description: 'บันทึกสูตรเมนู',
    });

    return result;
  }

  async deleteRecipe(restaurantId: string, itemId: string, tenantId: string, userId?: string) {
    await this.findOneItem(restaurantId, itemId, tenantId);

    const recipe = await this.prisma.menuItemRecipe.findUnique({
      where: { menuItemId: itemId },
      select: { id: true },
    });

    if (!recipe) {
      throw new NotFoundException(`No recipe found for menu item ${itemId}`);
    }

    await this.prisma.menuItemRecipe.delete({ where: { id: recipe.id } });

    this.auditLogService.log({
      action: 'menu_delete' as any,
      resource: 'menu' as any,
      category: 'restaurant' as any,
      resourceId: itemId,
      userId,
      tenantId,
      description: 'ลบสูตรเมนู',
    });
  }

  // ─── Full Menu ────────────────────────────────────────────────────────────

  async getFullMenu(restaurantId: string, tenantId: string) {
    await this.validateRestaurant(restaurantId, tenantId);

    return this.prisma.menuCategory.findMany({
      where: { restaurantId, tenantId, isActive: true },
      orderBy: { displayOrder: 'asc' },
      include: {
        items: {
          where: { isAvailable: true },
          orderBy: { displayOrder: 'asc' },
        },
      },
    });
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────

  /**
   * Allergens are stored as a JSON string in MySQL (e.g. '["SHELLFISH","FISH"]').
   * Parse them back to a string array before returning to callers so the API
   * always exposes a consistent array type.
   */
  private parseItemAllergens<T extends { allergens: unknown }>(
    item: T,
  ): Omit<T, 'allergens'> & { allergens: string[] } {
    const raw = item.allergens;
    let parsed: string[] = [];

    if (Array.isArray(raw)) {
      parsed = raw as string[];
    } else if (typeof raw === 'string' && raw.length > 0) {
      try {
        const result = JSON.parse(raw);
        parsed = Array.isArray(result) ? result : [];
      } catch {
        this.logger.warn(`Failed to parse allergens JSON: ${raw}`);
      }
    }

    return { ...item, allergens: parsed };
  }

  private async validateRestaurant(restaurantId: string, tenantId: string) {
    const restaurant = await this.prisma.restaurant.findFirst({
      where: { id: restaurantId, tenantId },
    });

    if (!restaurant) {
      throw new NotFoundException(`Restaurant with ID ${restaurantId} not found`);
    }

    return restaurant;
  }

  /**
   * A direct-sale (retail) menu item must link to an active inventory item
   * belonging to the same tenant — e.g. bottled water sold straight from stock.
   */
  private async validateInventoryItem(inventoryItemId: string, tenantId: string) {
    const item = await this.prisma.inventoryItem.findFirst({
      where: { id: inventoryItemId, tenantId, isActive: true, deletedAt: null },
      select: { id: true },
    });

    if (!item) {
      throw new BadRequestException(`Inventory item ${inventoryItemId} not found in this tenant`);
    }

    return item;
  }

  /**
   * สต๊อกของเมนูหนึ่งรายการต้องมีเจ้าของแหล่งเดียว
   *
   * - ผูกคลังกลาง (`inventoryItemId`) + นับเอง (`trackStock`) พร้อมกัน = สองแหล่งความจริง
   *   ตัดสองรอบหรือชนกันเมื่อสิทธิ์คลังหมดอายุ
   * - เมนูที่ผูกคลังกลางต้องเป็นของสำเร็จรูป เพราะของที่ต้องปรุงตัดวัตถุดิบผ่านสูตรอยู่แล้ว
   * - ตั้งเกณฑ์ใกล้หมดโดยไม่นับสต๊อกก็ไม่มีอะไรให้เตือน
   */
  private assertStockConfigValid(config: {
    inventoryItemId?: string | null;
    trackStock?: boolean | null;
    itemKind?: string | null;
    lowStockThreshold?: number | null;
  }) {
    if (config.inventoryItemId && config.trackStock) {
      throw new BadRequestException(
        'เมนูนี้ผูกกับคลังสินค้าแล้ว จึงเปิด "นับสต๊อกในเมนูนี้" พร้อมกันไม่ได้ — เลือกอย่างใดอย่างหนึ่ง',
      );
    }

    if (config.inventoryItemId && config.itemKind === 'COOKED') {
      throw new BadRequestException(
        'เมนูที่ต้องปรุงตัดวัตถุดิบผ่านสูตรอาหาร — ถ้าจะผูกกับสินค้าในคลังโดยตรง ให้ตั้งเป็น "สินค้าสำเร็จรูป"',
      );
    }

    if (config.lowStockThreshold != null && !config.trackStock && !config.inventoryItemId) {
      throw new BadRequestException(
        'ตั้งเกณฑ์แจ้งเตือนใกล้หมดได้เฉพาะเมนูที่นับสต๊อก — เปิด "นับสต๊อกในเมนูนี้" ก่อน',
      );
    }
  }

  private async assertNoRecipe(menuItemId: string) {
    const recipe = await this.prisma.menuItemRecipe.findUnique({
      where: { menuItemId },
      select: { id: true },
    });

    if (recipe) {
      throw new BadRequestException(
        'เมนูนี้มีสูตรอาหารอยู่แล้ว จึงผูกกับสินค้าในคลังโดยตรงไม่ได้ — ลบสูตรก่อนถ้าจะเปลี่ยนเป็นสินค้าสำเร็จรูป',
      );
    }
  }

  /** ยอดยกมาตอนเปิดการนับสต๊อก — บันทึกเป็นบรรทัด OPENING ไม่ใช่การเซ็ตตัวเลขลอย ๆ */
  private async recordOpeningStock(
    menuItemId: string,
    quantity: number,
    tenantId: string,
    userId?: string,
  ) {
    await this.prisma.menuItemStockMovement.create({
      data: {
        tenantId,
        menuItemId,
        type: 'OPENING',
        quantity,
        balanceAfter: quantity,
        referenceType: 'manual',
        note: 'ยอดยกมาตอนเปิดการนับสต๊อก',
        createdBy: userId ?? 'system',
      },
    });
  }

  private async findCategoryOrFail(categoryId: string, restaurantId: string, tenantId: string) {
    const category = await this.prisma.menuCategory.findFirst({
      where: { id: categoryId, restaurantId, tenantId },
    });

    if (!category) {
      throw new NotFoundException(`Menu category with ID ${categoryId} not found`);
    }

    return category;
  }
}
