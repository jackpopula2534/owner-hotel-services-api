/**
 * One-off, idempotent migration.
 *
 * Folds the deprecated InventoryRecipe / InventoryRecipeIngredient (the old
 * standalone "Recipes" page keyed off the warehouse) into the unified
 * MenuItemRecipe / RecipeIngredient (Menu → Recipe tab) as stock-linked
 * ingredients, so there is a single source of truth for each dish.
 *
 * Convention: MenuItemRecipe stores quantities for the whole `servings` batch.
 * InventoryRecipeIngredient.quantity was per-plate, so batch qty = perPlate * servings.
 *
 * Run: npx ts-node scripts/migrate-inventory-recipes-to-menu.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const invRecipes = await prisma.inventoryRecipe.findMany({
    include: { ingredients: { include: { item: { select: { name: true } } } } },
  });

  let created = 0;
  let addedIngredients = 0;
  let skipped = 0;

  let orphaned = 0;

  for (const inv of invRecipes) {
    // Skip inventory recipes whose menu item no longer exists (stale/mock data).
    const menuItem = await prisma.menuItem.findUnique({
      where: { id: inv.menuItemId },
      select: { id: true },
    });
    if (!menuItem) {
      orphaned += 1;
      continue;
    }

    const servings = inv.servings && inv.servings > 0 ? inv.servings : 1;

    let recipe = await prisma.menuItemRecipe.findUnique({
      where: { menuItemId: inv.menuItemId },
      include: { ingredients: true },
    });

    if (!recipe) {
      const base = await prisma.menuItemRecipe.create({
        data: { menuItemId: inv.menuItemId, servings, notes: inv.notes ?? undefined },
      });
      recipe = await prisma.menuItemRecipe.findUnique({
        where: { id: base.id },
        include: { ingredients: true },
      });
      created += 1;
    }
    if (!recipe) continue;

    const existingItemIds = new Set(
      recipe.ingredients.map((i) => i.itemId).filter(Boolean) as string[],
    );
    const baseOrder = recipe.ingredients.length;

    for (const [idx, ing] of inv.ingredients.entries()) {
      if (existingItemIds.has(ing.itemId)) {
        skipped += 1;
        continue;
      }
      await prisma.recipeIngredient.create({
        data: {
          recipeId: recipe.id,
          name: ing.item?.name ?? 'Ingredient',
          itemId: ing.itemId,
          quantity: Number(ing.quantity) * servings, // per-plate → batch qty
          unit: ing.unit,
          wastagePercent: ing.wastagePercent ?? 0,
          notes: ing.notes ?? undefined,
          displayOrder: baseOrder + idx,
        },
      });
      addedIngredients += 1;
    }
  }

  console.log(
    `Done. recipes created: ${created}, ingredients linked: ${addedIngredients}, ` +
      `skipped (already linked): ${skipped}, orphaned (no menu item): ${orphaned}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
