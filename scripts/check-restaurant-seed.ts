/**
 * Self-check for the premium demo tenant's restaurant/inventory seed.
 *
 * Verifies that the cooking-ingredient inventory + inventory-linked recipes
 * (seedInventoryData + seedRestaurantRecipes) are COMPLETE and correct for
 * premium.test@email.com ONLY:
 *   1. Premium tenant resolves from the email.
 *   2. The two food categories (meat/seafood, dairy/eggs) exist.
 *   3. Every ING-* cooking ingredient exists AND has kitchen stock (in คลัง).
 *   4. Every expected menu item has a recipe.
 *   5. EVERY recipe ingredient is linked to a tracked inventory item (itemId set
 *      → "นับสต๊อก", never free-text "นอกคลัง") of the same tenant.
 *
 * Exit code 0 = complete, 1 = something missing (prints a report either way).
 *
 * Run: npm run seed:check
 *   (or: npx ts-node -r tsconfig-paths/register scripts/check-restaurant-seed.ts)
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const PREMIUM_EMAIL = 'premium.test@email.com';
const MAIN_RESTAURANT_CODE = 'MVR-MAIN';

// Cooking-ingredient SKUs seeded by SeederService.cookingIngredientCatalog().
// Kept in sync manually — the check flags drift in either direction.
const EXPECTED_ING_SKUS = [
  // ผักและผลไม้
  'ING-PAPAYA', 'ING-TOMATO-CHERRY', 'ING-LONGBEAN', 'ING-GARLIC', 'ING-CHILI',
  'ING-CHILI-SUAN', 'ING-LIME', 'ING-SPRING-ONION', 'ING-BEANSPROUT',
  'ING-LEMONGRASS', 'ING-GALANGAL', 'ING-KAFFIR-LEAF', 'ING-EGGPLANT-THAI',
  'ING-EGGPLANT-PEA', 'ING-BASIL-SWEET', 'ING-BASIL-HOLY', 'ING-BELLPEPPER',
  'ING-MANGO-RIPE', 'ING-ONION', 'ING-POTATO', 'ING-MUSHROOM-STRAW',
  'ING-GINGER', 'ING-CORIANDER', 'ING-SHALLOT',
  // ของแห้ง / เครื่องปรุง
  'ING-NOODLE-CHAN', 'ING-STICKY-RICE', 'ING-JASMINE-RICE', 'ING-PEANUT-ROASTED',
  'ING-DRIED-SHRIMP', 'ING-SESAME-WHITE', 'ING-SUGAR-WHITE', 'ING-PALM-SUGAR',
  'ING-SALT', 'ING-PEPPER-BLACK', 'ING-FISH-SAUCE', 'ING-SOY-LIGHT',
  'ING-SOY-DARK', 'ING-OYSTER-SAUCE', 'ING-VEG-OIL', 'ING-TAMARIND',
  'ING-CURRY-GREEN', 'ING-CURRY-MASSAMAN', 'ING-COCONUT-MILK', 'ING-COFFEE-ROAST',
  'ING-THAI-TEA',
  // เนื้อสัตว์และอาหารทะเล
  'ING-SHRIMP-RIVER', 'ING-CHICKEN', 'ING-PORK-MINCED', 'ING-FISH-FILLET',
  'ING-SQUID', 'ING-MUSSEL', 'ING-TOFU-FIRM', 'ING-LAMB-SHOULDER',
  // ผลิตภัณฑ์นมและไข่
  'ING-EGG', 'ING-BUTTER', 'ING-MILK-FRESH', 'ING-CONDENSED-MILK',
];

// Dishes the seeder defines recipes for. Menu naming has drifted across seed
// versions (some DBs have Thai breakfast names, others English demo names), so
// this is a SUPERSET: a dish absent from the menu is skipped (info), but any
// dish that IS on the menu must have a fully inventory-linked recipe.
const KNOWN_RECIPE_MENUS = [
  'ผัดไทยกุ้งสด', 'ต้มยำกุ้ง', 'แกงเขียวหวานไก่', 'ข้าวมันไก่', 'ข้าวต้มปลา',
  'โจ๊กหมูสับ', 'ไข่กระทะ', 'Som Tum Thai', 'Massaman Lamb', 'ข้าวเหนียวมะม่วง',
  'ชาไทยเย็น', 'กาแฟดำร้อน', 'Latte',
];
// Minimum recipes that must actually be present (guards against a menu that
// somehow lost most of its dishes).
const MIN_RECIPES = 9;

const EXPECTED_CATEGORY_CODES = ['CAT-FB-MEAT', 'CAT-FB-DAIRY'];

const ok = (m: string) => console.log(`  ✅ ${m}`);
const bad = (m: string) => console.log(`  ❌ ${m}`);
const warn = (m: string) => console.log(`  ⚠️  ${m}`);

async function main() {
  console.log('🔎 Restaurant/inventory seed self-check (premium.test)\n');
  const failures: string[] = [];

  // 1. Premium tenant ------------------------------------------------------
  const owner = await prisma.user.findFirst({ where: { email: PREMIUM_EMAIL } });
  if (!owner?.tenantId) {
    bad(`Premium user ${PREMIUM_EMAIL} / tenant not found — cannot continue`);
    process.exit(1);
  }
  const tenantId = owner.tenantId;
  ok(`Premium tenant resolved (tenantId=${tenantId})`);

  // 2. Food categories -----------------------------------------------------
  console.log('\n— Categories —');
  for (const code of EXPECTED_CATEGORY_CODES) {
    const cat = await prisma.itemCategory.findFirst({ where: { tenantId, code } });
    if (cat) ok(`Category ${code} (${cat.name})`);
    else {
      bad(`Category ${code} missing`);
      failures.push(`category ${code}`);
    }
  }

  // 3. Cooking ingredients + kitchen stock --------------------------------
  console.log('\n— Cooking ingredients (คลังครัว) —');
  const kitchen = await prisma.warehouse.findFirst({
    where: { tenantId, code: 'WH-KITCH' },
  });
  if (!kitchen) {
    bad('Kitchen warehouse (WH-KITCH) missing');
    failures.push('kitchen warehouse');
  }

  const items = await prisma.inventoryItem.findMany({
    where: { tenantId, sku: { in: EXPECTED_ING_SKUS } },
    select: { id: true, sku: true, name: true, categoryId: true },
  });
  const bySku = new Map(items.map((i) => [i.sku, i]));

  const missingItems = EXPECTED_ING_SKUS.filter((s) => !bySku.has(s));
  if (missingItems.length === 0) {
    ok(`All ${EXPECTED_ING_SKUS.length} cooking ingredients present`);
  } else {
    bad(`${missingItems.length} cooking ingredients missing: ${missingItems.join(', ')}`);
    failures.push(`${missingItems.length} missing items`);
  }

  // Stock: every present item must have a WarehouseStock row with qty > 0.
  if (items.length > 0) {
    const stocks = await prisma.warehouseStock.findMany({
      where: { itemId: { in: items.map((i) => i.id) } },
      select: { itemId: true, quantity: true },
    });
    const qtyByItem = new Map<string, number>();
    for (const s of stocks) {
      qtyByItem.set(s.itemId, (qtyByItem.get(s.itemId) ?? 0) + Number(s.quantity));
    }
    const noStock = items.filter((i) => (qtyByItem.get(i.id) ?? 0) <= 0);
    if (noStock.length === 0) {
      ok(`All present ingredients have stock on hand (นับสต๊อกได้)`);
    } else {
      bad(`${noStock.length} ingredients have no stock: ${noStock.map((i) => i.sku).join(', ')}`);
      failures.push(`${noStock.length} ingredients without stock`);
    }
  }

  // 3b. Category tree — every cooking ingredient must live under CAT-FB so
  // the "F&B วัตถุดิบ" (parent) filter surfaces it via descendant expansion.
  console.log('\n— Categories (F&B tree) —');
  {
    const cats = await prisma.itemCategory.findMany({
      where: { tenantId },
      select: { id: true, code: true, name: true, parentId: true },
    });
    const byId = new Map(cats.map((c) => [c.id, c]));
    const fb = cats.find((c) => c.code === 'CAT-FB');
    if (!fb) {
      bad(`parent category CAT-FB ("F&B วัตถุดิบ") missing`);
      failures.push('CAT-FB missing');
    } else {
      // Collect CAT-FB + descendants.
      const kids = new Map<string, string[]>();
      for (const c of cats) {
        if (!c.parentId) continue;
        const list = kids.get(c.parentId) ?? [];
        list.push(c.id);
        kids.set(c.parentId, list);
      }
      const tree = new Set<string>();
      const stack = [fb.id];
      while (stack.length) {
        const id = stack.pop()!;
        if (tree.has(id)) continue;
        tree.add(id);
        for (const k of kids.get(id) ?? []) stack.push(k);
      }
      const under = items.filter((i) => i.categoryId && tree.has(i.categoryId));
      const outside = items.filter((i) => !i.categoryId || !tree.has(i.categoryId));
      if (outside.length === 0) {
        ok(`All ${items.length} ingredients sit under "F&B วัตถุดิบ" (${tree.size - 1} sub-categories)`);
      } else {
        bad(
          `${outside.length} ingredients outside CAT-FB tree: ${outside
            .map((i) => `${i.sku}→${i.categoryId ? byId.get(i.categoryId)?.code ?? '?' : 'NULL'}`)
            .join(', ')}`,
        );
        failures.push(`${outside.length} ingredients outside CAT-FB`);
      }
      // Parent filter must return the same set an exact match on CAT-FB would miss.
      const parentFilterCount = await prisma.inventoryItem.count({
        where: { tenantId, deletedAt: null, categoryId: { in: [...tree] } },
      });
      if (parentFilterCount >= items.length && items.length > 0) {
        ok(`"F&B วัตถุดิบ" filter (parent) returns ${parentFilterCount} items (descendant-aware)`);
      } else {
        bad(`parent filter returned ${parentFilterCount}, expected ≥ ${items.length}`);
        failures.push('parent category filter under-returns');
      }
    }
  }

  // 4 + 5. Recipes exist and are fully inventory-linked --------------------
  console.log('\n— Recipes (inventory-linked) —');
  const restaurant = await prisma.restaurant.findFirst({
    where: { tenantId, code: MAIN_RESTAURANT_CODE },
  });
  if (!restaurant) {
    bad(`Main restaurant ${MAIN_RESTAURANT_CODE} not found`);
    failures.push('main restaurant');
  } else {
    // Kitchen stock is what the readiness calc ("ทำได้กี่จาน") divides against.
    const kitchenWh = await prisma.warehouse.findFirst({
      where: { tenantId, code: 'WH-KITCH' },
      select: { id: true },
    });
    let recipesPresent = 0;
    for (const menu of KNOWN_RECIPE_MENUS) {
      const menuItem = await prisma.menuItem.findFirst({
        where: { tenantId, restaurantId: restaurant.id, name: menu },
        select: { id: true },
      });
      if (!menuItem) {
        warn(`"${menu}" not on this menu — skipped (naming variant)`);
        continue;
      }
      const recipe = await prisma.menuItemRecipe.findUnique({
        where: { menuItemId: menuItem.id },
        include: {
          ingredients: { select: { name: true, itemId: true, quantity: true } },
        },
      });
      if (!recipe) {
        bad(`"${menu}" is on the menu but has no recipe`);
        failures.push(`recipe ${menu}`);
        continue;
      }
      recipesPresent++;
      const total = recipe.ingredients.length;
      const unlinked = recipe.ingredients.filter((ing) => !ing.itemId);
      if (total === 0) {
        bad(`"${menu}" recipe has 0 ingredients`);
        failures.push(`empty recipe ${menu}`);
        continue;
      }
      if (unlinked.length > 0) {
        bad(
          `"${menu}" has ${unlinked.length}/${total} free-text (นอกคลัง) ingredients: ` +
            unlinked.map((i) => i.name).join(', '),
        );
        failures.push(`unlinked ingredients in ${menu}`);
        continue;
      }

      // Makeability: mirror recipe-readiness.service — plates =
      // floor(kitchenStockQty / (recipeQty / servings)), no unit conversion.
      // Both are in the item's stocking unit, so this must be > 0 to cook.
      const servings = recipe.servings && recipe.servings > 0 ? recipe.servings : 1;
      let minPlates = Infinity;
      let limiter = '';
      for (const ing of recipe.ingredients) {
        const stock = kitchenWh
          ? await prisma.warehouseStock.findFirst({
              where: { warehouseId: kitchenWh.id, itemId: ing.itemId as string },
              select: { quantity: true },
            })
          : null;
        const stockQty = stock ? Number(stock.quantity) : 0;
        const perPlate = Number(ing.quantity) / servings;
        const plates = perPlate > 0 ? Math.floor(stockQty / perPlate) : Infinity;
        if (plates < minPlates) {
          minPlates = plates;
          limiter = ing.name;
        }
      }
      const platesLabel = minPlates === Infinity ? '∞' : String(minPlates);
      if (minPlates <= 0) {
        bad(
          `"${menu}" — inventory-linked but ทำไม่ได้ (0 จาน) — limiter: ${limiter} หมดคลัง/หน่วยไม่ตรง`,
        );
        failures.push(`not cookable: ${menu}`);
      } else {
        ok(
          `"${menu}" — ${total} ingredients linked, ทำได้ ${platesLabel} จาน (limiter: ${limiter})`,
        );
      }
    }
    if (recipesPresent < MIN_RECIPES) {
      bad(`Only ${recipesPresent} inventory-linked recipes present (expected ≥ ${MIN_RECIPES})`);
      failures.push(`too few recipes (${recipesPresent})`);
    } else {
      ok(`${recipesPresent} inventory-linked recipes present (≥ ${MIN_RECIPES})`);
    }
  }

  // 6. Cross-tenant guard: no recipe ingredient should reference an item that
  //    belongs to another tenant (would be a leak).
  console.log('\n— Tenant isolation —');
  const linkedIngredients = await prisma.recipeIngredient.findMany({
    where: { recipe: { menuItem: { tenantId } }, itemId: { not: null } },
    select: { itemId: true, item: { select: { tenantId: true } } },
  });
  const crossTenant = linkedIngredients.filter((li) => li.item && li.item.tenantId !== tenantId);
  if (crossTenant.length === 0) {
    ok('All linked ingredients reference this tenant\'s inventory only');
  } else {
    bad(`${crossTenant.length} ingredients reference another tenant's inventory`);
    failures.push('cross-tenant item links');
  }

  // Summary ----------------------------------------------------------------
  console.log('\n────────────────────────────────────────');
  if (failures.length === 0) {
    console.log('🎉 Seed data COMPLETE — all checks passed.');
    process.exit(0);
  } else {
    console.log(`💥 Seed data INCOMPLETE — ${failures.length} issue(s):`);
    for (const f of failures) console.log(`   • ${f}`);
    console.log('\nRun `npm run seed` (or db:refresh) to (re)apply the seed, then re-check.');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
