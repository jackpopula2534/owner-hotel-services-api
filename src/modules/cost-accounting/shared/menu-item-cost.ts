/**
 * ต้นทุนวัตถุดิบต่อจาน — คิดจากสูตรอาหาร × ต้นทุนเฉลี่ยของวัตถุดิบในคลัง
 *
 * ของเดิมการปิดงวดเขียน `const cost = 0` ไว้ตรง ๆ แล้วบันทึกลง
 * `food_cost_analyses.ingredientCost` ผลคือทุกจานมีต้นทุน 0 กำไรขั้นต้น 100%
 * และหน้า menu engineering ที่อ่านคอลัมน์นี้ไปจัดกลุ่ม (star / plowhorse / puzzle /
 * dog) จึงจัดทุกจานเป็น star เหมือนกันหมด — คำแนะนำที่ได้จึงไม่มีความหมายเลย
 *
 * ## ที่มาของตัวเลข (ตามลำดับ)
 * 1. **สูตรอาหาร** — ผลรวมของ (ปริมาณ × (1 + ของเสีย%) × ต้นทุนเฉลี่ยต่อหน่วย)
 *    หารด้วยจำนวนที่ได้ต่อสูตร (`servings`)
 * 2. **`menu_items.cost`** — ต้นทุนมาตรฐานที่คีย์ไว้เอง ใช้เมื่อยังไม่มีสูตร
 * 3. ถ้าไม่มีทั้งสองอย่าง คืน 0 พร้อมบอกว่า `source: 'NONE'` — ผู้เรียกต้องรู้ว่า
 *    นี่คือ "ยังไม่รู้ต้นทุน" ไม่ใช่ "ต้นทุนเป็นศูนย์"
 *
 * ## หน่วยต้องตรงกัน ห้ามเดา
 * `avgCost` เป็นราคาต่อ **หน่วยนับของสินค้าในคลัง** (ต่อกิโล ต่อลิตร ต่อขวด) ส่วน
 * สูตรระบุหน่วยของตัวเอง ถ้าสองหน่วยไม่ตรงกัน (สูตรบอกกรัม แต่คลังนับเป็นถุง 25 กก.)
 * การคูณกันตรง ๆ จะได้ต้นทุนที่ผิดหลายพันเท่าแบบเงียบ ๆ ที่นี่จึง **ข้ามวัตถุดิบนั้น
 * แล้วรายงานชื่อไว้ใน `missingIngredients`** แทนที่จะแปลงหน่วยแบบเดา — ตัวเลขที่ไม่รู้
 * ดีกว่าตัวเลขที่ผิดโดยไม่มีใครรู้
 */
import { round2 } from '@/common/utils/bangkok-day.util';
import { PrismaService } from '@/prisma/prisma.service';

export type MenuItemCostSource = 'RECIPE' | 'MENU_ITEM' | 'NONE';

export interface MenuItemCost {
  /** ชื่อจานตามเมนู ณ ตอนคิด — ใช้แทนการเก็บ id ลงคอลัมน์ชื่อ */
  name: string;
  /** ต้นทุนวัตถุดิบต่อหนึ่งจาน */
  costPerUnit: number;
  source: MenuItemCostSource;
  /**
   * วัตถุดิบที่คิดต้นทุนไม่ได้ — ไม่ผูกกับสินค้าในคลัง หน่วยไม่ตรง หรือยังไม่มีราคา
   * ถ้ารายการนี้ไม่ว่าง แปลว่า `costPerUnit` ต่ำกว่าความจริง
   */
  missingIngredients: string[];
}

interface StockCost {
  quantity: number;
  totalValue: number;
}

/**
 * ต้นทุนเฉลี่ยต่อหน่วยของแต่ละสินค้า — ถ่วงน้ำหนักด้วยจำนวนที่มีอยู่จริงในแต่ละคลัง
 *
 * ของชิ้นเดียวกันอาจอยู่หลายคลังในราคาทุนคนละราคา (ซื้อคนละล็อต) การเฉลี่ยแบบ
 * ถ่วงน้ำหนักให้ตัวเลขเดียวกับที่ระบบคลังตีมูลค่าสต๊อกอยู่ ถ้าใช้ค่าเฉลี่ยธรรมดา
 * คลังที่มีของเหลือ 2 ชิ้นจะมีน้ำหนักเท่ากับคลังที่มี 2,000 ชิ้น
 */
async function unitCostByItem(
  prisma: PrismaService,
  tenantId: string,
  itemIds: string[],
): Promise<Map<string, number>> {
  if (itemIds.length === 0) return new Map();

  const stocks = await prisma.warehouseStock.findMany({
    where: { itemId: { in: itemIds }, warehouse: { tenantId } },
    select: { itemId: true, quantity: true, avgCost: true },
  });

  const totals = new Map<string, StockCost>();
  for (const stock of stocks) {
    const quantity = stock.quantity;
    const avgCost = Number(stock.avgCost);
    if (avgCost <= 0) continue;

    const current = totals.get(stock.itemId) ?? { quantity: 0, totalValue: 0 };
    // คลังที่ของหมดยังบอกราคาทุนล่าสุดได้ ให้ถือเป็นน้ำหนัก 1 เพื่อไม่ให้ตกไปเลย
    const weight = quantity > 0 ? quantity : 1;
    totals.set(stock.itemId, {
      quantity: current.quantity + weight,
      totalValue: current.totalValue + weight * avgCost,
    });
  }

  const unitCost = new Map<string, number>();
  for (const [itemId, { quantity, totalValue }] of totals) {
    if (quantity > 0) unitCost.set(itemId, totalValue / quantity);
  }
  return unitCost;
}

export async function menuItemCosts(
  prisma: PrismaService,
  tenantId: string,
  menuItemIds: string[],
): Promise<Map<string, MenuItemCost>> {
  const result = new Map<string, MenuItemCost>();
  const ids = [...new Set(menuItemIds)];
  if (ids.length === 0) return result;

  const menuItems = await prisma.menuItem.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      name: true,
      cost: true,
      recipe: {
        select: {
          servings: true,
          ingredients: {
            select: {
              name: true,
              quantity: true,
              unit: true,
              wastagePercent: true,
              itemId: true,
              item: { select: { id: true, unit: true } },
            },
          },
        },
      },
    },
  });

  const wantedItemIds = menuItems.flatMap(
    (menuItem) =>
      menuItem.recipe?.ingredients
        .map((ingredient) => ingredient.item?.id)
        .filter((id): id is string => Boolean(id)) ?? [],
  );
  const unitCost = await unitCostByItem(prisma, tenantId, wantedItemIds);

  for (const menuItem of menuItems) {
    const standardCost = menuItem.cost === null ? null : Number(menuItem.cost);
    const ingredients = menuItem.recipe?.ingredients ?? [];

    if (ingredients.length === 0) {
      result.set(menuItem.id, {
        name: menuItem.name,
        costPerUnit: standardCost ?? 0,
        source: standardCost === null ? 'NONE' : 'MENU_ITEM',
        missingIngredients: [],
      });
      continue;
    }

    const missingIngredients: string[] = [];
    let recipeCost = 0;

    for (const ingredient of ingredients) {
      const quantity = ingredient.quantity === null ? null : Number(ingredient.quantity);
      const perUnit = ingredient.item ? unitCost.get(ingredient.item.id) : undefined;
      // หน่วยของสูตรต้องตรงกับหน่วยนับของสินค้า ไม่งั้นคูณกันไม่ได้ (ดูหมายเหตุหัวไฟล์)
      const sameUnit = ingredient.item ? ingredient.unit === ingredient.item.unit : false;

      if (!quantity || quantity <= 0 || perUnit === undefined || !sameUnit) {
        missingIngredients.push(ingredient.name);
        continue;
      }

      const wastage = 1 + Number(ingredient.wastagePercent) / 100;
      recipeCost += quantity * wastage * perUnit;
    }

    // สูตรหนึ่งอาจได้หลายจาน ต้นทุนที่ต้องการคือต่อจาน
    const servings = menuItem.recipe?.servings ?? 1;
    const perServing = servings > 0 ? recipeCost / servings : recipeCost;

    // สูตรมีแต่คิดไม่ได้สักตัว — ถ้ามีต้นทุนมาตรฐานคีย์ไว้ ใช้ตัวนั้นดีกว่าคืน 0
    const noneCosted = missingIngredients.length === ingredients.length;
    if (noneCosted && standardCost !== null) {
      result.set(menuItem.id, {
        name: menuItem.name,
        costPerUnit: round2(standardCost),
        source: 'MENU_ITEM',
        missingIngredients,
      });
      continue;
    }

    result.set(menuItem.id, {
      name: menuItem.name,
      costPerUnit: round2(perServing),
      source: noneCosted ? 'NONE' : 'RECIPE',
      missingIngredients,
    });
  }

  return result;
}
