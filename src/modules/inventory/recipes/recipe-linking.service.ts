import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

export interface LinkIngredientsResult {
  /** Free-text (unlinked) ingredients found before linking */
  scanned: number;
  /** Linked to an EXISTING inventory item matched by name */
  linkedExisting: number;
  /** New inventory items created (createMissing) then linked */
  createdItems: number;
  /** Ingredient names that stayed unlinked (createMissing = false) */
  unmatched: string[];
  /** Kitchen warehouses auto-created (property had no warehouse at all) */
  warehousesCreated: number;
}

/**
 * One-click "ผูกวัตถุดิบเข้าคลังอัตโนมัติ" for the recipe-readiness page.
 *
 * Recipes authored free-text (e.g. FE dev autofill, or typed before the
 * inventory module was activated) have every ingredient with itemId = null —
 * so the readiness page shows "นอกคลัง" everywhere even though the
 * restaurant→inventory integration is ON. That toggle is a system-level
 * permission; per-ingredient links are the data that actually drives stock
 * math. This service closes the gap:
 *
 *  1. Matches each unlinked ingredient to an existing InventoryItem by
 *     normalized name (tenant-scoped).
 *  2. Optionally creates a minimal inventory item for names with no match
 *     (unit derived from the recipe unit, SKU auto-generated) so brand-new
 *     tenants get a working setup in one click.
 *  3. Ensures each restaurant's property has a kitchen warehouse — without
 *     one the readiness calc can never resolve stock (status stays unknown).
 *
 * Idempotent: already-linked ingredients are never touched; re-running only
 * processes what is still free-text.
 */
@Injectable()
export class RecipeLinkingService {
  private readonly logger = new Logger(RecipeLinkingService.name);

  constructor(private prisma: PrismaService) {}

  async linkIngredients(
    tenantId: string,
    opts: { restaurantId?: string; createMissing?: boolean } = {},
  ): Promise<LinkIngredientsResult> {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }
    const createMissing = opts.createMissing !== false;

    const menuItemWhere: Record<string, unknown> = { tenantId };
    if (opts.restaurantId) menuItemWhere.restaurantId = opts.restaurantId;

    const recipes = await this.prisma.menuItemRecipe.findMany({
      where: { menuItem: menuItemWhere },
      select: {
        id: true,
        menuItem: { select: { restaurantId: true } },
        ingredients: {
          where: { itemId: null },
          select: { id: true, name: true, quantity: true, unit: true },
        },
      },
    });

    const result: LinkIngredientsResult = {
      scanned: 0,
      linkedExisting: 0,
      createdItems: 0,
      unmatched: [],
      warehousesCreated: 0,
    };

    const unlinkedTotal = recipes.reduce((sum, r) => sum + r.ingredients.length, 0);
    result.scanned = unlinkedTotal;

    // ── 1. Ensure each restaurant's property has a kitchen warehouse ─────────
    // Without any warehouse, readiness can never resolve stock — do this even
    // when every ingredient is already linked so re-runs can repair the setup.
    const restaurantIds = [
      ...new Set(recipes.map((r) => r.menuItem.restaurantId).filter(Boolean)),
    ] as string[];
    if (restaurantIds.length > 0) {
      const restaurants = await this.prisma.restaurant.findMany({
        where: { id: { in: restaurantIds }, tenantId },
        select: { propertyId: true },
      });
      const propertyIds = [...new Set(restaurants.map((r) => r.propertyId).filter(Boolean))];
      for (const propertyId of propertyIds) {
        const existing = await this.prisma.warehouse.findFirst({
          where: { tenantId, propertyId, isActive: true, deletedAt: null },
          select: { id: true },
        });
        if (!existing) {
          await this.prisma.warehouse.create({
            data: {
              tenantId,
              propertyId,
              name: 'คลังครัว',
              code: 'WH-KITCHEN',
              type: 'KITCHEN',
              isDefault: true,
            },
          });
          result.warehousesCreated += 1;
          this.logger.log(`Auto-created kitchen warehouse for property ${propertyId}`);
        }
      }
    }

    if (unlinkedTotal === 0) return result;

    // ── 2. Existing inventory items, matched by normalized name ──────────────
    const items = await this.prisma.inventoryItem.findMany({
      where: { tenantId, deletedAt: null, isActive: true },
      select: { id: true, name: true, unit: true, sku: true },
    });
    const itemByName = new Map(items.map((it) => [this.normalizeName(it.name), it]));

    // Next auto-SKU suffix (ING-AUTO-0001, ...) — scan once, count up locally.
    let autoSkuNo =
      items
        .map((it) => /^ING-AUTO-(\d+)$/.exec(it.sku ?? ''))
        .filter(Boolean)
        .reduce((max, m) => Math.max(max, Number((m as RegExpExecArray)[1])), 0) + 1;

    // ── 3. Link (or create + link) each free-text ingredient ─────────────────
    const createdThisRun = new Set<string>();
    for (const recipe of recipes) {
      for (const ing of recipe.ingredients) {
        const key = this.normalizeName(ing.name);
        let item = itemByName.get(key);

        if (!item && createMissing) {
          const created = await this.prisma.inventoryItem.create({
            data: {
              tenantId,
              sku: `ING-AUTO-${String(autoSkuNo++).padStart(4, '0')}`,
              name: ing.name.trim(),
              unit: this.toItemUnit(ing.unit),
              description: 'สร้างอัตโนมัติจากการผูกสูตรอาหารเข้าคลัง',
            },
            select: { id: true, name: true, unit: true, sku: true },
          });
          itemByName.set(key, created);
          createdThisRun.add(created.id);
          item = created;
          result.createdItems += 1;
        }

        if (!item) {
          result.unmatched.push(ing.name);
          continue;
        }

        // Readiness divides raw stock qty by raw recipe qty with NO unit
        // conversion — both sides must share the item's stocking unit.
        const conv = this.toStockUnit(Number(ing.quantity ?? 0), ing.unit ?? '', item.unit ?? '');
        await this.prisma.recipeIngredient.update({
          where: { id: ing.id },
          data: { itemId: item.id, quantity: conv.quantity, unit: conv.unit },
        });
        if (!createdThisRun.has(item.id)) {
          result.linkedExisting += 1;
        }
      }
    }

    this.logger.log(
      `Recipe linking (tenant ${tenantId}): ${result.linkedExisting} linked, ` +
        `${result.createdItems} created, ${result.unmatched.length} unmatched, ` +
        `${result.warehousesCreated} warehouses created`,
    );
    return result;
  }

  private normalizeName(name: string): string {
    return (name ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  /**
   * Map a free-text Thai/culinary recipe unit onto the ItemUnit enum for
   * NEWLY-CREATED items, so recipe qty and stock qty share a unit with no
   * conversion (stock will be received in this same unit).
   */
  private toItemUnit(recipeUnit: string | null | undefined): 'G' | 'KG' | 'ML' | 'L' | 'BOTTLE' | 'CAN' | 'PIECE' {
    const u = (recipeUnit ?? '').trim().toLowerCase();
    if (['กรัม', 'g', 'gram', 'grams'].includes(u)) return 'G';
    if (['กก.', 'กิโลกรัม', 'kg'].includes(u)) return 'KG';
    if (['มล.', 'ml', 'มิลลิลิตร'].includes(u)) return 'ML';
    if (['ลิตร', 'l', 'liter', 'litre'].includes(u)) return 'L';
    if (['ขวด', 'bottle'].includes(u)) return 'BOTTLE';
    if (['กระป๋อง', 'can'].includes(u)) return 'CAN';
    // ฟอง/ลูก/เม็ด/กลีบ/กำมือ/ช้อนโต๊ะ/ช้อนชา/ชิ้น and anything else → count as pieces
    return 'PIECE';
  }

  /**
   * Convert a culinary recipe quantity into an EXISTING item's stocking unit
   * (mirrors seeder.toStockUnit): กรัม→KG, มล.→L are ÷1000; everything else
   * is kept as-is with the recipe's own label for readability.
   */
  private toStockUnit(
    qty: number,
    recipeUnit: string,
    itemUnit: string,
  ): { quantity: number; unit: string } {
    const u = (itemUnit || '').toUpperCase();
    const r = recipeUnit || '';
    if ((u === 'KG' || u === 'L') && (r === 'กรัม' || r === 'มล.')) {
      return { quantity: Math.round((qty / 1000) * 1000) / 1000, unit: u };
    }
    return { quantity: qty, unit: recipeUnit || itemUnit };
  }
}
