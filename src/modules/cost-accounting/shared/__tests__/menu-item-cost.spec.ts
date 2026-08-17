/**
 * ต้นทุนวัตถุดิบต่อจาน
 *
 * ตัวเลขนี้ไหลต่อไปที่ menu engineering ซึ่งเอาไปจัดกลุ่มจาน (star / plowhorse /
 * puzzle / dog) ตอนที่มันถูกตรึงไว้ที่ 0 ทุกจานมีกำไรขั้นต้น 100% เท่ากันหมด
 * คำแนะนำที่ได้จึงไม่มีความหมาย ที่นี่จึงล็อกสองเรื่อง: คิดถูกเมื่อข้อมูลครบ และ
 * **ไม่เดา** เมื่อข้อมูลไม่ครบ — ต้นทุนต่ำกว่าจริงพร้อมรายชื่อที่ขาด ดีกว่าตัวเลข
 * ที่ผิดหลายพันเท่าโดยไม่มีใครรู้
 */
import { PrismaService } from '@/prisma/prisma.service';
import { menuItemCosts } from '../menu-item-cost';

const TENANT = 'tenant-1';

interface IngredientRow {
  name: string;
  quantity: number | null;
  unit: string;
  wastagePercent: number;
  itemId: string | null;
  item: { id: string; unit: string } | null;
}

interface MenuItemRow {
  id: string;
  name: string;
  cost: number | null;
  recipe: { servings: number | null; ingredients: IngredientRow[] } | null;
}

interface StockRow {
  itemId: string;
  quantity: number;
  avgCost: number;
}

/** วัตถุดิบที่ผูกกับสินค้าในคลังและหน่วยตรงกัน = เคสปกติ */
const ingredient = (
  name: string,
  itemId: string,
  quantity: number | null,
  unit: string,
  wastagePercent = 0,
  itemUnit = unit,
): IngredientRow => ({
  name,
  quantity,
  unit,
  wastagePercent,
  itemId,
  item: { id: itemId, unit: itemUnit },
});

function makeWorld(menuItems: MenuItemRow[], stocks: StockRow[]) {
  const menuFindMany = jest.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
    menuItems.filter((item) => where.id.in.includes(item.id)),
  );
  const stockFindMany = jest.fn(async ({ where }: { where: { itemId: { in: string[] } } }) =>
    stocks.filter((stock) => where.itemId.in.includes(stock.itemId)),
  );
  const prisma = {
    menuItem: { findMany: menuFindMany },
    warehouseStock: { findMany: stockFindMany },
  } as unknown as PrismaService;

  return {
    menuFindMany,
    stockFindMany,
    run: (ids: string[]) => menuItemCosts(prisma, TENANT, ids),
  };
}

describe('menuItemCosts', () => {
  it('คิดจากสูตร แล้วหารด้วยจำนวนจานที่ได้ต่อสูตร', async () => {
    const { run } = makeWorld(
      [
        {
          id: 'menu-tomyum',
          name: 'ต้มยำกุ้ง',
          cost: null,
          recipe: {
            servings: 2,
            ingredients: [ingredient('กุ้ง', 'ing-shrimp', 0.2, 'KG')],
          },
        },
      ],
      [{ itemId: 'ing-shrimp', quantity: 10, avgCost: 300 }],
    );

    const costs = await run(['menu-tomyum']);

    // 0.2 × 300 = 60 ต่อสูตร ÷ 2 จาน
    expect(costs.get('menu-tomyum')).toEqual({
      name: 'ต้มยำกุ้ง',
      costPerUnit: 30,
      source: 'RECIPE',
      missingIngredients: [],
    });
  });

  it('บวกเผื่อของเสียตามที่สูตรระบุ', async () => {
    const { run } = makeWorld(
      [
        {
          id: 'menu-salad',
          name: 'สลัด',
          cost: null,
          recipe: {
            servings: 1,
            ingredients: [ingredient('ผักสลัด', 'ing-lettuce', 0.1, 'KG', 10)],
          },
        },
      ],
      [{ itemId: 'ing-lettuce', quantity: 20, avgCost: 80 }],
    );

    const costs = await run(['menu-salad']);

    // 0.1 × 1.10 × 80 = 8.8
    expect(costs.get('menu-salad')?.costPerUnit).toBe(8.8);
  });

  it('เฉลี่ยต้นทุนแบบถ่วงน้ำหนักตามของที่มีจริง ไม่ใช่เฉลี่ยธรรมดา', async () => {
    const { run } = makeWorld(
      [
        {
          id: 'menu-rice',
          name: 'ข้าวเปล่า',
          cost: null,
          recipe: { servings: 1, ingredients: [ingredient('ข้าวสาร', 'ing-rice', 1, 'KG')] },
        },
      ],
      [
        // เฉลี่ยธรรมดาจะได้ 150 — ถ่วงน้ำหนักได้ (1,000 + 6,000) ÷ 40 = 175
        { itemId: 'ing-rice', quantity: 10, avgCost: 100 },
        { itemId: 'ing-rice', quantity: 30, avgCost: 200 },
      ],
    );

    const costs = await run(['menu-rice']);

    expect(costs.get('menu-rice')?.costPerUnit).toBe(175);
  });

  it('คลังที่ของหมดยังบอกราคาทุนล่าสุดได้ ไม่ตกหายไปทั้งคลัง', async () => {
    const { run } = makeWorld(
      [
        {
          id: 'menu-rice',
          name: 'ข้าวเปล่า',
          cost: null,
          recipe: { servings: 1, ingredients: [ingredient('ข้าวสาร', 'ing-rice', 1, 'KG')] },
        },
      ],
      [{ itemId: 'ing-rice', quantity: 0, avgCost: 120 }],
    );

    const costs = await run(['menu-rice']);

    expect(costs.get('menu-rice')?.costPerUnit).toBe(120);
  });

  it('หน่วยในสูตรไม่ตรงกับหน่วยนับในคลัง = ข้ามและรายงานชื่อ ห้ามแปลงหน่วยเอง', async () => {
    const { run } = makeWorld(
      [
        {
          id: 'menu-mixed',
          name: 'จานผสม',
          cost: null,
          recipe: {
            servings: 1,
            ingredients: [
              ingredient('กุ้ง', 'ing-shrimp', 0.2, 'KG'),
              // สูตรบอกกรัม คลังนับเป็นกิโล — คูณตรง ๆ จะผิดพันเท่า
              ingredient('เกลือ', 'ing-salt', 5, 'G', 0, 'KG'),
            ],
          },
        },
      ],
      [
        { itemId: 'ing-shrimp', quantity: 10, avgCost: 300 },
        { itemId: 'ing-salt', quantity: 10, avgCost: 15 },
      ],
    );

    const costs = await run(['menu-mixed']);

    expect(costs.get('menu-mixed')).toEqual({
      name: 'จานผสม',
      costPerUnit: 60,
      source: 'RECIPE',
      missingIngredients: ['เกลือ'],
    });
  });

  it('วัตถุดิบที่ยังไม่ผูกกับสินค้าในคลังถูกรายงาน ไม่ใช่คิดเป็นของฟรี', async () => {
    const { run } = makeWorld(
      [
        {
          id: 'menu-soup',
          name: 'ซุป',
          cost: null,
          recipe: {
            servings: 1,
            ingredients: [
              ingredient('น้ำซุป', 'ing-stock', 0.5, 'L'),
              { name: 'เครื่องเทศพิเศษ', quantity: 1, unit: 'KG', wastagePercent: 0, itemId: null, item: null },
            ],
          },
        },
      ],
      [{ itemId: 'ing-stock', quantity: 50, avgCost: 40 }],
    );

    const costs = await run(['menu-soup']);

    expect(costs.get('menu-soup')?.costPerUnit).toBe(20);
    expect(costs.get('menu-soup')?.missingIngredients).toEqual(['เครื่องเทศพิเศษ']);
  });

  it('สินค้าที่ยังไม่มีราคาทุนในคลังถูกรายงาน ไม่ใช่คิดเป็น 0', async () => {
    const { run } = makeWorld(
      [
        {
          id: 'menu-soup',
          name: 'ซุป',
          cost: null,
          recipe: { servings: 1, ingredients: [ingredient('น้ำซุป', 'ing-stock', 0.5, 'L')] },
        },
      ],
      [{ itemId: 'ing-stock', quantity: 50, avgCost: 0 }],
    );

    const costs = await run(['menu-soup']);

    expect(costs.get('menu-soup')).toMatchObject({
      costPerUnit: 0,
      source: 'NONE',
      missingIngredients: ['น้ำซุป'],
    });
  });

  it('จานที่ยังไม่มีสูตรใช้ต้นทุนมาตรฐานในเมนู', async () => {
    const { run } = makeWorld([{ id: 'menu-cola', name: 'โคล่า', cost: 35, recipe: null }], []);

    const costs = await run(['menu-cola']);

    expect(costs.get('menu-cola')).toEqual({
      name: 'โคล่า',
      costPerUnit: 35,
      source: 'MENU_ITEM',
      missingIngredients: [],
    });
  });

  it('มีสูตรแต่คิดไม่ได้สักตัว ถอยไปใช้ต้นทุนมาตรฐานแทนที่จะรายงาน 0', async () => {
    const { run } = makeWorld(
      [
        {
          id: 'menu-special',
          name: 'จานพิเศษ',
          cost: 90,
          recipe: {
            servings: 1,
            ingredients: [ingredient('ของหายาก', 'ing-rare', 1, 'G', 0, 'KG')],
          },
        },
      ],
      [{ itemId: 'ing-rare', quantity: 5, avgCost: 500 }],
    );

    const costs = await run(['menu-special']);

    expect(costs.get('menu-special')).toEqual({
      name: 'จานพิเศษ',
      costPerUnit: 90,
      source: 'MENU_ITEM',
      missingIngredients: ['ของหายาก'],
    });
  });

  it('ไม่มีทั้งสูตรและต้นทุนมาตรฐาน = บอกว่ายังไม่รู้ ไม่ใช่บอกว่าเป็นศูนย์', async () => {
    const { run } = makeWorld([{ id: 'menu-new', name: 'เมนูใหม่', cost: null, recipe: null }], []);

    const costs = await run(['menu-new']);

    expect(costs.get('menu-new')).toEqual({
      name: 'เมนูใหม่',
      costPerUnit: 0,
      source: 'NONE',
      missingIngredients: [],
    });
  });

  it('ดึงราคาทุนเฉพาะคลังของ tenant นั้น', async () => {
    const { run, stockFindMany } = makeWorld(
      [
        {
          id: 'menu-rice',
          name: 'ข้าวเปล่า',
          cost: null,
          recipe: { servings: 1, ingredients: [ingredient('ข้าวสาร', 'ing-rice', 1, 'KG')] },
        },
      ],
      [{ itemId: 'ing-rice', quantity: 10, avgCost: 100 }],
    );

    await run(['menu-rice']);

    expect(stockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { itemId: { in: ['ing-rice'] }, warehouse: { tenantId: TENANT } },
      }),
    );
  });

  it('ไม่มีจานให้คิดก็ไม่ต้องยิงคิวรี่', async () => {
    const { run, menuFindMany, stockFindMany } = makeWorld([], []);

    const costs = await run([]);

    expect(costs.size).toBe(0);
    expect(menuFindMany).not.toHaveBeenCalled();
    expect(stockFindMany).not.toHaveBeenCalled();
  });

  it('จานซ้ำถูกถามครั้งเดียว', async () => {
    const { run, menuFindMany } = makeWorld(
      [{ id: 'menu-cola', name: 'โคล่า', cost: 35, recipe: null }],
      [],
    );

    await run(['menu-cola', 'menu-cola', 'menu-cola']);

    expect(menuFindMany.mock.calls[0][0].where.id.in).toEqual(['menu-cola']);
  });

  it('จานที่ถูกลบไปแล้วไม่มีในผลลัพธ์ ผู้เรียกต้องเจอ undefined ไม่ใช่ 0 เงียบ ๆ', async () => {
    const { run } = makeWorld([{ id: 'menu-cola', name: 'โคล่า', cost: 35, recipe: null }], []);

    const costs = await run(['menu-cola', 'menu-deleted']);

    expect(costs.has('menu-deleted')).toBe(false);
  });
});
