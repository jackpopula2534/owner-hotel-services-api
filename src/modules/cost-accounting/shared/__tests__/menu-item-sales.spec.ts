/**
 * ยอดขายรายเมนู — สะพานระหว่างสมุดรายได้กับรายการในบิล
 *
 * ตัวช่วยนี้ถูกใช้สองที่: ตอนปิดงวด (เขียนลง `food_cost_analyses`) กับรายงานต้นทุน
 * อาหารแบบสด ด้วยเหตุผลเดียวกับ `room-revenue-by-type` คือถ้าสองที่นี้คำนวณคนละแบบ
 * ตัวเลขบนหน้าจอเดียวกันจะกระโดดตอนงวดถูกปิด
 *
 * หัวใจของสเปกชุดนี้คือ **ผลรวมรายจานต้องเท่ากับยอดสุทธิของสมุดเสมอ** เพราะตัวเลขนี้
 * เป็นตัวหารของ food cost % ถ้าตัวหารใหญ่กว่าเงินที่ได้จริง ต้นทุนอาหารจะดูต่ำกว่า
 * ความจริงทุกจานที่อยู่ในบิลที่มีส่วนลด
 */
import { RevenueSourceModule, RevenueSourceType, RevenueType } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { RevenueQueryService } from '@/modules/revenue/revenue-query.service';
import { buildRevenueQueryStub, LedgerRow } from '@/modules/revenue/__tests__/revenue-query.stub';
import { menuItemSales } from '../menu-item-sales';

const TENANT = 'tenant-1';
const PROPERTY = 'prop-1';
const SCOPE = { tenantId: TENANT, propertyId: PROPERTY, from: '2026-08-01', to: '2026-08-31' };

/** บรรทัดในบิลที่ Prisma จะคืนให้ตัวช่วย */
interface OrderRow {
  id: string;
  items: { menuItemId: string; quantity: number; unitPrice: number }[];
}

/** แถวขายอาหารในสมุด — ค่าเริ่มต้นตรงกับที่ `order-revenue.source.ts` ลงจริง */
const saleRow = (overrides: Partial<LedgerRow> & { sourceId: string }): LedgerRow => ({
  businessDate: '2026-08-10',
  amount: 0,
  sourceType: RevenueSourceType.ORDER,
  sourceModule: RevenueSourceModule.RESTAURANT,
  revenueType: RevenueType.FOOD,
  propertyId: PROPERTY,
  ...overrides,
});

const order = (id: string, items: [string, number, number][]): OrderRow => ({
  id,
  items: items.map(([menuItemId, quantity, unitPrice]) => ({ menuItemId, quantity, unitPrice })),
});

function makeDeps(rows: LedgerRow[], orders: OrderRow[]) {
  const findMany = jest.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
    orders.filter((row) => where.id.in.includes(row.id)),
  );
  const prisma = { order: { findMany } } as unknown as PrismaService;
  const revenue = buildRevenueQueryStub(rows);
  return {
    findMany,
    revenue,
    run: () => menuItemSales(prisma, revenue as unknown as RevenueQueryService, SCOPE),
  };
}

/** ผลรวมของทุกจาน — ตัวเลขที่ต้องเท่ากับยอดสมุดพอดี */
const totalOf = (sales: Map<string, { revenue: number }>): number =>
  Math.round([...sales.values()].reduce((sum, item) => sum + item.revenue, 0) * 100) / 100;

describe('menuItemSales', () => {
  it('ถามสมุดเฉพาะอาหารกับเครื่องดื่มของร้านในโรงแรมหลังนั้น', async () => {
    const { revenue, run } = makeDeps([], []);

    await run();

    expect(revenue.documents).toHaveBeenCalledWith({
      tenantId: TENANT,
      propertyId: PROPERTY,
      from: '2026-08-01',
      to: '2026-08-31',
      sourceModule: RevenueSourceModule.RESTAURANT,
      revenueType: [RevenueType.FOOD, RevenueType.BEVERAGE],
    });
  });

  it('บิลที่ไม่มีในสมุด (ยกเลิก/ยังไม่ปิด) ไม่ถูกนับเป็นยอดขาย', async () => {
    const { run } = makeDeps(
      [saleRow({ sourceId: 'ord-paid', amount: 100 })],
      [order('ord-paid', [['menu-a', 1, 100]]), order('ord-void', [['menu-b', 5, 100]])],
    );

    const sales = await run();

    expect([...sales.keys()]).toEqual(['menu-a']);
  });

  it('ส่วนลดท้ายบิลถูกเฉลี่ยลงแต่ละบรรทัดตามสัดส่วนมูลค่า', async () => {
    const { run } = makeDeps(
      // ขายหน้าเมนู 380 ลด 30 → สมุดรับรู้ 350
      [saleRow({ sourceId: 'ord-1', amount: 380, discount: 30 })],
      [order('ord-1', [['menu-padthai', 1, 220], ['menu-tea', 2, 80]])],
    );

    const sales = await run();

    expect(sales.get('menu-padthai')).toEqual({ qty: 1, revenue: 202.63 });
    expect(sales.get('menu-tea')).toEqual({ qty: 2, revenue: 147.37 });
    expect(totalOf(sales)).toBe(350);
  });

  it('ค่าบริการไม่ใช่ยอดของจานไหน จึงไม่ถูกเฉลี่ยลงจาน', async () => {
    const { run } = makeDeps(
      [
        saleRow({ sourceId: 'ord-1', amount: 220, revenueType: RevenueType.FOOD }),
        saleRow({ sourceId: 'ord-1', amount: 160, revenueType: RevenueType.BEVERAGE }),
        saleRow({ sourceId: 'ord-1', amount: 38, revenueType: RevenueType.SERVICE_CHARGE }),
      ],
      [order('ord-1', [['menu-padthai', 1, 220], ['menu-tea', 2, 80]])],
    );

    const sales = await run();

    expect(totalOf(sales)).toBe(380);
  });

  it('เศษจากการปัดไปอยู่บรรทัดใหญ่สุด ผลรวมจึงไม่ขาดไม่เกิน', async () => {
    const { run } = makeDeps(
      [saleRow({ sourceId: 'ord-1', amount: 100 })],
      [order('ord-1', [['menu-a', 1, 10], ['menu-b', 1, 10], ['menu-c', 1, 10]])],
    );

    const sales = await run();

    // 33.33 × 3 = 99.99 — เศษ 0.01 ต้องไปอยู่ที่ใดที่หนึ่ง ไม่ใช่ระเหย
    expect(sales.get('menu-a')?.revenue).toBe(33.34);
    expect(totalOf(sales)).toBe(100);
  });

  it('บิลหนึ่งมีหลายแถวในสมุด เงินต้องบวกทุกแถวก่อนเฉลี่ย', async () => {
    const { run } = makeDeps(
      [
        saleRow({ sourceId: 'ord-1', amount: 220, revenueType: RevenueType.FOOD }),
        saleRow({ sourceId: 'ord-1', amount: 160, revenueType: RevenueType.BEVERAGE }),
      ],
      [order('ord-1', [['menu-padthai', 1, 220], ['menu-tea', 2, 80]])],
    );

    const sales = await run();

    expect(sales.get('menu-padthai')?.revenue).toBe(220);
    expect(sales.get('menu-tea')?.revenue).toBe(160);
  });

  it('จานเดียวกันจากหลายบิลถูกรวมเป็นรายการเดียว', async () => {
    const { run } = makeDeps(
      [
        saleRow({ sourceId: 'ord-1', amount: 100, businessDate: '2026-08-03' }),
        saleRow({ sourceId: 'ord-2', amount: 200, businessDate: '2026-08-09' }),
      ],
      [order('ord-1', [['menu-a', 1, 100]]), order('ord-2', [['menu-a', 2, 100]])],
    );

    const sales = await run();

    expect(sales.get('menu-a')).toEqual({ qty: 3, revenue: 300 });
  });

  it('บิลของแถม (ทุกบรรทัดราคาศูนย์) ยังนับจำนวนได้ แต่ไม่มีเงินให้เฉลี่ย', async () => {
    const { run } = makeDeps(
      [saleRow({ sourceId: 'ord-1', amount: 0 })],
      [order('ord-1', [['menu-a', 2, 0]])],
    );

    const sales = await run();

    expect(sales.get('menu-a')).toEqual({ qty: 2, revenue: 0 });
  });

  it('บิลที่ถูกลบหลังลงสมุดไม่ทำให้จานอื่นเพี้ยน', async () => {
    const { run } = makeDeps(
      [
        saleRow({ sourceId: 'ord-gone', amount: 500 }),
        saleRow({ sourceId: 'ord-1', amount: 100 }),
      ],
      [order('ord-1', [['menu-a', 1, 100]])],
    );

    const sales = await run();

    // เงินของบิลที่หายไปลงจานไหนไม่ได้ — แต่ต้องไม่ไปโผล่ที่จานอื่น
    expect(sales.get('menu-a')).toEqual({ qty: 1, revenue: 100 });
  });

  it('ดึงบิลเฉพาะของ tenant นั้น และเฉพาะใบที่อยู่ในสมุด', async () => {
    const { run, findMany } = makeDeps(
      [saleRow({ sourceId: 'ord-1', amount: 100 })],
      [order('ord-1', [['menu-a', 1, 100]])],
    );

    await run();

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['ord-1'] }, tenantId: TENANT } }),
    );
  });

  it('เดือนที่ไม่มีบิลในสมุดไม่ต้องยิงคิวรี่หาบิล', async () => {
    const { run, findMany } = makeDeps([], [order('ord-1', [['menu-a', 1, 100]])]);

    const sales = await run();

    expect(sales.size).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });
});
