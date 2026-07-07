import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

/** A menu is flagged "near empty" when it can make this many plates or fewer. */
const LOW_PLATES_THRESHOLD = 10;

export interface ReadinessIngredient {
  name: string;
  linked: boolean;
  itemId: string | null;
  perPlateQty: number;
  unit: string | null;
  wastagePercent: number;
  stockQty: number | null;
  plates: number | null;
  isLimiting: boolean;
  isLow: boolean;
}

export interface ReadinessMenu {
  menuItemId: string;
  menuItemName: string;
  image: string | null;
  categoryName: string | null;
  servings: number;
  ingredientCount: number;
  trackedCount: number;
  maxPlates: number | null; // null = cannot be determined (no kitchen warehouse)
  bottleneck: { name: string; plates: number } | null;
  status: 'ok' | 'low' | 'out' | 'unknown';
  price: number;
  costPerPlate: number;
  gpPercent: number | null;
  ingredients: ReadinessIngredient[];
}

export interface ReadinessSummary {
  ok: number;
  low: number;
  out: number;
  unknown: number;
  lowStockItems: number;
}

@Injectable()
export class RecipeReadinessService {
  private readonly logger = new Logger(RecipeReadinessService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Reads every menu-item recipe for the tenant and cross-references its
   * stock-tracked ingredients against the kitchen warehouse stock to answer:
   * how many plates can we make right now, and which ingredient is the bottleneck.
   */
  async getReadiness(
    tenantId: string,
    opts: { search?: string; restaurantId?: string } = {},
  ): Promise<{ menus: ReadinessMenu[]; summary: ReadinessSummary }> {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    const menuItemWhere: any = { tenantId };
    if (opts.restaurantId) menuItemWhere.restaurantId = opts.restaurantId;
    if (opts.search) menuItemWhere.name = { contains: opts.search };

    const recipes = await this.prisma.menuItemRecipe.findMany({
      where: { menuItem: menuItemWhere },
      include: {
        menuItem: {
          select: { id: true, name: true, image: true, price: true, restaurantId: true },
        },
        ingredients: {
          orderBy: { displayOrder: 'asc' },
          include: {
            item: { select: { id: true, name: true, unit: true, reorderPoint: true } },
          },
        },
      },
    });

    if (recipes.length === 0) {
      return { menus: [], summary: { ok: 0, low: 0, out: 0, unknown: 0, lowStockItems: 0 } };
    }

    // Resolve each restaurant to its property's kitchen warehouse.
    const restaurantIds = [
      ...new Set(recipes.map((r) => r.menuItem.restaurantId).filter(Boolean)),
    ] as string[];
    const restaurants = await this.prisma.restaurant.findMany({
      where: { id: { in: restaurantIds } },
      select: { id: true, propertyId: true },
    });
    const propertyByRestaurant = new Map(restaurants.map((r) => [r.id, r.propertyId]));

    const propertyIds = [
      ...new Set([...propertyByRestaurant.values()].filter(Boolean)),
    ] as string[];
    const warehouseByProperty = new Map<string, string>();
    for (const propertyId of propertyIds) {
      const warehouse = await this.findKitchenWarehouse(tenantId, propertyId);
      if (warehouse) warehouseByProperty.set(propertyId, warehouse.id);
    }

    // Batch-fetch stock for every (warehouse, item) pair we need.
    const warehouseIds = [...new Set(warehouseByProperty.values())];
    const itemIds = [
      ...new Set(recipes.flatMap((r) => r.ingredients.map((i) => i.itemId).filter(Boolean))),
    ] as string[];
    const stocks =
      warehouseIds.length && itemIds.length
        ? await this.prisma.warehouseStock.findMany({
            where: { warehouseId: { in: warehouseIds }, itemId: { in: itemIds } },
            select: { warehouseId: true, itemId: true, quantity: true, avgCost: true },
          })
        : [];
    const stockMap = new Map(stocks.map((s) => [`${s.warehouseId}:${s.itemId}`, s]));

    const lowStockItemIds = new Set<string>();
    const menus: ReadinessMenu[] = recipes.map((recipe) => {
      const servings = recipe.servings && recipe.servings > 0 ? recipe.servings : 1;
      const propertyId = propertyByRestaurant.get(recipe.menuItem.restaurantId ?? '') ?? null;
      const warehouseId = propertyId ? warehouseByProperty.get(propertyId) : undefined;

      let maxPlates: number | null = null;
      let bottleneck: { name: string; plates: number } | null = null;
      let costPerPlate = 0;
      let trackedCount = 0;

      const ingredients: ReadinessIngredient[] = recipe.ingredients.map((ing) => {
        const perPlateQty = Number(ing.quantity ?? 0) / servings;
        const wastagePercent = Number(ing.wastagePercent ?? 0);
        const withWastage = perPlateQty * (1 + wastagePercent / 100);
        const displayName = ing.item?.name ?? ing.name;

        // Free-text (unlinked) ingredient — shown but not stock-tracked.
        if (!ing.itemId) {
          return {
            name: displayName,
            linked: false,
            itemId: null,
            perPlateQty,
            unit: ing.unit ?? null,
            wastagePercent,
            stockQty: null,
            plates: null,
            isLimiting: false,
            isLow: false,
          };
        }

        trackedCount += 1;
        const stock = warehouseId ? stockMap.get(`${warehouseId}:${ing.itemId}`) : undefined;
        const avgCost = stock ? Number(stock.avgCost) : 0;
        costPerPlate += withWastage * avgCost;

        // No kitchen warehouse resolved → readiness for this menu is unknown.
        if (!warehouseId) {
          return {
            name: displayName,
            linked: true,
            itemId: ing.itemId,
            perPlateQty,
            unit: ing.unit ?? null,
            wastagePercent,
            stockQty: null,
            plates: null,
            isLimiting: false,
            isLow: false,
          };
        }

        const stockQty = stock?.quantity ?? 0;
        const plates = withWastage > 0 ? Math.floor(stockQty / withWastage) : null;
        const reorderPoint = ing.item?.reorderPoint ?? 0;
        const isLow =
          (plates !== null && plates <= LOW_PLATES_THRESHOLD) ||
          (reorderPoint > 0 && stockQty <= reorderPoint);
        if (isLow) lowStockItemIds.add(ing.itemId);

        if (plates !== null && (maxPlates === null || plates < maxPlates)) {
          maxPlates = plates;
          bottleneck = { name: displayName, plates };
        }

        return {
          name: displayName,
          linked: true,
          itemId: ing.itemId,
          perPlateQty,
          unit: ing.unit ?? null,
          wastagePercent,
          stockQty,
          plates,
          isLimiting: false,
          isLow,
        };
      });

      // Mark the limiting ingredient(s).
      if (bottleneck) {
        for (const ing of ingredients) {
          if (ing.linked && ing.plates === maxPlates) ing.isLimiting = true;
        }
      }

      const price = Number(recipe.menuItem.price ?? 0);
      const gpPercent =
        price > 0 ? Math.round(((price - costPerPlate) / price) * 100) : null;

      let status: ReadinessMenu['status'];
      if (trackedCount === 0 || maxPlates === null) status = 'unknown';
      else if (maxPlates <= 0) status = 'out';
      else if (maxPlates <= LOW_PLATES_THRESHOLD) status = 'low';
      else status = 'ok';

      return {
        menuItemId: recipe.menuItem.id,
        menuItemName: recipe.menuItem.name,
        image: recipe.menuItem.image ?? null,
        categoryName: null,
        servings,
        ingredientCount: recipe.ingredients.length,
        trackedCount,
        maxPlates,
        bottleneck,
        status,
        price,
        costPerPlate: Math.round(costPerPlate * 100) / 100,
        gpPercent,
        ingredients,
      };
    });

    // Sort: fewest plates first (out → low → ok → unknown last).
    const rank = { out: 0, low: 1, ok: 2, unknown: 3 };
    menus.sort((a, b) => {
      if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
      return (a.maxPlates ?? Infinity) - (b.maxPlates ?? Infinity);
    });

    const summary: ReadinessSummary = {
      ok: menus.filter((m) => m.status === 'ok').length,
      low: menus.filter((m) => m.status === 'low').length,
      out: menus.filter((m) => m.status === 'out').length,
      unknown: menus.filter((m) => m.status === 'unknown').length,
      lowStockItems: lowStockItemIds.size,
    };

    return { menus, summary };
  }

  private async findKitchenWarehouse(
    tenantId: string,
    propertyId: string,
  ): Promise<{ id: string } | null> {
    const base = { tenantId, propertyId, isActive: true, deletedAt: null };
    return (
      (await this.prisma.warehouse.findFirst({
        where: { ...base, type: 'KITCHEN' as any },
        select: { id: true },
      })) ??
      (await this.prisma.warehouse.findFirst({
        where: { ...base, isDefault: true },
        select: { id: true },
      })) ??
      (await this.prisma.warehouse.findFirst({
        where: base,
        select: { id: true },
        orderBy: { createdAt: 'asc' },
      }))
    );
  }
}
