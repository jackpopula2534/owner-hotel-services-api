/**
 * ปิดงวดต้นทุน — ยอดขายทุกตัวมาจากสมุดรายได้ ต้นทุนมาจาก cost_entries
 *
 * งวดที่ปิดแล้วคือตัวเลขที่ถูกอ้างอิงต่อในรายงานทุกใบ ของเดิมมันบวกเอาเองจาก
 * ตารางต้นทาง: ค่าห้องบวก `booking.totalPrice` ของใบที่ "กำหนดเช็คอิน" ในเดือนนั้น
 * (นับใบที่ยกเลิก ใบที่ยังไม่มาพัก และผลักยอดของการเข้าพักคร่อมเดือนมาไว้ทั้งก้อน)
 * ส่วนยอดรายเมนูกวาดทุก `order.createdAt` ในเดือนโดยไม่ดูสถานะ — บิลที่ถูกยกเลิก
 * ก็ถูกนับเป็นยอดขาย
 *
 * ## เฟส 4 ปิดช่องสุดท้าย
 * ส่วนหัวของงวด (`totalRevenue`) กับ P&L รายแผนกเคยเอา "รายได้" มาจากแถวใน
 * `cost_entries` ที่ประเภทเป็น `REVENUE` — คือให้คนคีย์รายได้เข้ามาเองในตารางต้นทุน
 * เป็นแหล่งความจริงที่สองที่ไม่ผูกกับยอดขายจริงเลย (ในฐานข้อมูลจริงต่างกัน 680,000
 * กับ 18,658) ตอนนี้ทั้งสองอย่างมาจากสมุด และแถว REVENUE ที่ยังค้างอยู่ต้องถูกข้าม
 * ไม่ใช่บวกทับเข้าไป
 */
import { BadRequestException } from '@nestjs/common';
import {
  CostCenterType,
  RevenueSegment,
  RevenueSourceModule,
  RevenueSourceType,
  RevenueType,
} from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { RevenueQueryService } from '@/modules/revenue/revenue-query.service';
import {
  buildRevenueQueryStub,
  LedgerRow,
} from '@/modules/revenue/__tests__/revenue-query.stub';
import { PeriodCloseService } from '../period-close.service';

const TENANT = 'tenant-1';
const PROPERTY = 'prop-1';
const USER = 'user-1';
const DTO = { propertyId: PROPERTY, year: 2026, month: 8 };

interface CostCenterRow {
  id: string;
  name: string;
  type: CostCenterType;
  code: string;
  sortOrder: number;
}

/** ศูนย์ต้นทุนของจริงตั้งชื่อว่า "Rooms Division" ไม่ใช่ 'ROOMS' — ชื่อเชื่อไม่ได้ */
const ROOMS_CENTER: CostCenterRow = {
  id: 'cc-rooms',
  name: 'Rooms Division',
  type: CostCenterType.ROOMS,
  code: 'CC-ROOMS',
  sortOrder: 0,
};
const FB_CENTER: CostCenterRow = {
  id: 'cc-fb',
  name: 'Food & Beverage',
  type: CostCenterType.FOOD_BEVERAGE,
  code: 'CC-FB',
  sortOrder: 1,
};
const ADMIN_CENTER: CostCenterRow = {
  id: 'cc-admin',
  name: 'Administrative & General',
  type: CostCenterType.ADMIN_GENERAL,
  code: 'CC-ADMIN',
  sortOrder: 2,
};

const roomRow = (sourceId: string, amount: number, businessDate: string): LedgerRow => ({
  businessDate,
  sourceId,
  amount,
  sourceType: RevenueSourceType.BOOKING,
  sourceModule: RevenueSourceModule.HOTEL,
  segment: RevenueSegment.ROOMS,
  propertyId: PROPERTY,
});

const orderRow = (
  sourceId: string,
  amount: number,
  businessDate: string,
  extra: Partial<LedgerRow> = {},
): LedgerRow => ({
  businessDate,
  sourceId,
  amount,
  sourceType: RevenueSourceType.ORDER,
  sourceModule: RevenueSourceModule.RESTAURANT,
  segment: RevenueSegment.FOOD_BEVERAGE,
  revenueType: RevenueType.FOOD,
  propertyId: PROPERTY,
  ...extra,
});

const otherRow = (sourceId: string, amount: number, businessDate: string): LedgerRow => ({
  businessDate,
  sourceId,
  amount,
  sourceType: RevenueSourceType.RETAIL_SALE,
  sourceModule: RevenueSourceModule.RETAIL,
  segment: RevenueSegment.OTHER_OPERATED,
  propertyId: PROPERTY,
});

interface CostEntryRow {
  costCenterId: string;
  amount: number;
  costCenter: { id: string; name: string; type: CostCenterType };
  costType: { id: string; category: string };
}

/** แถวต้นทุนหนึ่งบรรทัด — ผูกกับศูนย์จริงเพื่อให้ `type` ตรงกับของที่ค้นเจอ */
const cost = (
  center: CostCenterRow,
  category: string,
  amount: number,
): CostEntryRow => ({
  costCenterId: center.id,
  amount,
  costCenter: { id: center.id, name: center.name, type: center.type },
  costType: { id: `ct-${category}`, category },
});

interface RecipeIngredientRow {
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
  recipe: { servings: number | null; ingredients: RecipeIngredientRow[] } | null;
}

interface WorldOptions {
  status?: string;
  bookings?: Array<{
    id: string;
    scheduledCheckIn: Date;
    scheduledCheckOut: Date;
    room: { type: string } | null;
  }>;
  orders?: Array<{
    id: string;
    items: Array<{ menuItemId: string; quantity: number; unitPrice: number }>;
  }>;
  costEntries?: CostEntryRow[];
  costCenters?: CostCenterRow[];
  menuItems?: MenuItemRow[];
  /** สต๊อกในคลัง: itemId → รายการ (จำนวน, ต้นทุนเฉลี่ย) ต่อคลัง */
  stocks?: Array<{ itemId: string; quantity: number; avgCost: number }>;
  totalRooms?: number;
}

function makeService(rows: LedgerRow[], options: WorldOptions = {}) {
  const {
    status = 'OPEN',
    bookings = [],
    orders = [],
    costEntries = [],
    costCenters = [ROOMS_CENTER, FB_CENTER, ADMIN_CENTER],
    menuItems = [],
    stocks = [],
    totalRooms = 10,
  } = options;

  const roomCostAnalysis = { create: jest.fn(async () => ({})), deleteMany: jest.fn() };
  const foodCostAnalysis = { create: jest.fn(async () => ({})), deleteMany: jest.fn() };
  const departmentPnL = { create: jest.fn(async () => ({})), deleteMany: jest.fn() };
  const periodUpdate = jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 'period-1',
    ...data,
  }));

  /** จริง ๆ แล้วสมุดถูกอ่านตอนไหน — ต้องก่อนเปิดทรานแซกชัน */
  const ledgerReadBeforeTransaction = { value: false };

  const tx = {
    costEntry: { findMany: jest.fn(async () => costEntries) },
    room: { count: jest.fn(async () => totalRooms) },
    booking: { findMany: jest.fn(async () => bookings) },
    departmentPnL,
    roomCostAnalysis,
    foodCostAnalysis,
    periodClose: { update: periodUpdate },
  };

  // การนับคืนพักถามด้วยช่วงวัน ส่วนการต่อประเภทห้องถามด้วย id — คนละคำถาม
  const bookingFindMany = jest.fn(
    async ({ where }: { where: { id?: { in: string[] } } }) =>
      where.id?.in ? bookings.filter((booking) => where.id!.in.includes(booking.id)) : bookings,
  );

  const prisma = {
    periodClose: {
      findFirst: jest.fn(async () => ({ id: 'period-1', status, tenantId: TENANT })),
      create: jest.fn(),
      update: jest.fn(async () => ({})),
    },
    order: {
      findMany: jest.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        orders.filter((order) => where.id.in.includes(order.id)),
      ),
    },
    booking: { findMany: bookingFindMany },
    room: { count: jest.fn(async () => totalRooms) },
    costCenter: { findMany: jest.fn(async () => costCenters) },
    menuItem: {
      findMany: jest.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        menuItems.filter((item) => where.id.in.includes(item.id)),
      ),
    },
    warehouseStock: {
      findMany: jest.fn(async ({ where }: { where: { itemId: { in: string[] } } }) =>
        stocks.filter((stock) => where.itemId.in.includes(stock.itemId)),
      ),
    },
    $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) => {
      ledgerReadBeforeTransaction.value = revenue.documents.mock.calls.length > 0;
      return callback(tx);
    }),
  } as unknown as PrismaService;

  const revenue = buildRevenueQueryStub(rows);
  const service = new PeriodCloseService(prisma, revenue as unknown as RevenueQueryService);

  return {
    service,
    prisma: prisma as any,
    revenue,
    tx,
    roomCostAnalysis,
    foodCostAnalysis,
    departmentPnL,
    periodUpdate,
    ledgerReadBeforeTransaction,
    close: () => service.closePeriod(DTO, USER, TENANT),
  };
}

const dataOf = (create: jest.Mock) =>
  create.mock.calls.map(([args]) => (args as { data: Record<string, any> }).data);

/** แถว P&L ของศูนย์ที่ระบุ */
const pnlOf = (departmentPnL: { create: jest.Mock }, costCenterId: string) =>
  dataOf(departmentPnL.create).find((row) => row.costCenterId === costCenterId);

describe('PeriodCloseService.closePeriod', () => {
  describe('ยอดค่าห้องรายประเภท', () => {
    it('มาจากสมุดรายได้ ไม่ใช่ราคาหน้าใบจองของใบที่กำหนดเช็คอินเดือนนี้', async () => {
      const { close, roomCostAnalysis } = makeService(
        [roomRow('bk-1', 9000, '2026-08-10'), roomRow('bk-2', 4000, '2026-08-12')],
        {
          bookings: [
            {
              id: 'bk-1',
              scheduledCheckIn: new Date('2026-08-07T07:00:00.000Z'),
              scheduledCheckOut: new Date('2026-08-10T05:00:00.000Z'),
              room: { type: 'Deluxe' },
            },
            {
              id: 'bk-2',
              scheduledCheckIn: new Date('2026-08-11T07:00:00.000Z'),
              scheduledCheckOut: new Date('2026-08-12T05:00:00.000Z'),
              room: { type: 'Standard' },
            },
          ],
        },
      );

      await close();

      expect(dataOf(roomCostAnalysis.create)).toEqual([
        expect.objectContaining({
          roomType: 'Deluxe',
          totalNights: 3,
          totalRevenue: 9000,
          revenuePerNight: 3000,
        }),
        expect.objectContaining({
          roomType: 'Standard',
          totalNights: 1,
          totalRevenue: 4000,
          revenuePerNight: 4000,
        }),
      ]);
    });

    it('ถามสมุดเป็นเดือนไทยเต็มเดือน ปลายเดือนรวมวันสุดท้าย', async () => {
      const { close, revenue } = makeService([]);

      await close();

      expect(revenue.documents).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: TENANT,
          propertyId: PROPERTY,
          from: '2026-08-01',
          to: '2026-08-31',
          sourceModule: RevenueSourceModule.HOTEL,
          segment: RevenueSegment.ROOMS,
        }),
      );
    });
  });

  describe('ยอดขายรายเมนู', () => {
    it('นับเฉพาะบิลที่อยู่ในสมุด บิลที่ยกเลิกหรือยังไม่ปิดไม่ถูกนับเป็นยอดขาย', async () => {
      const { close, foodCostAnalysis, prisma } = makeService(
        [orderRow('ord-1', 800, '2026-08-05')],
        {
          orders: [
            {
              id: 'ord-1',
              items: [
                { menuItemId: 'menu-tomyum', quantity: 2, unitPrice: 250 },
                { menuItemId: 'menu-cola', quantity: 3, unitPrice: 100 },
              ],
            },
            // บิลที่ถูกยกเลิก — อยู่ในตาราง order ของเดือนนี้แต่ไม่เคยลงสมุด
            {
              id: 'ord-void',
              items: [{ menuItemId: 'menu-tomyum', quantity: 99, unitPrice: 250 }],
            },
          ],
        },
      );

      await close();

      expect(prisma.order.findMany.mock.calls[0][0].where.id.in).toEqual(['ord-1']);
      expect(dataOf(foodCostAnalysis.create)).toEqual([
        expect.objectContaining({
          menuItemId: 'menu-tomyum',
          quantitySold: 2,
          totalRevenue: 500,
          sellingPrice: 250,
        }),
        expect.objectContaining({
          menuItemId: 'menu-cola',
          quantitySold: 3,
          totalRevenue: 300,
          sellingPrice: 100,
        }),
      ]);
    });

    it('รวมจานเดียวกันจากหลายบิลเข้าเป็นแถวเดียว', async () => {
      const { close, foodCostAnalysis } = makeService(
        [orderRow('ord-1', 500, '2026-08-05'), orderRow('ord-2', 250, '2026-08-06')],
        {
          orders: [
            { id: 'ord-1', items: [{ menuItemId: 'menu-tomyum', quantity: 2, unitPrice: 250 }] },
            { id: 'ord-2', items: [{ menuItemId: 'menu-tomyum', quantity: 1, unitPrice: 250 }] },
          ],
        },
      );

      await close();

      expect(dataOf(foodCostAnalysis.create)).toEqual([
        expect.objectContaining({ menuItemId: 'menu-tomyum', quantitySold: 3, totalRevenue: 750 }),
      ]);
    });

    it('ถามสมุดเฉพาะช่องทางร้านอาหารของโรงแรมหลังนั้น', async () => {
      const { close, revenue } = makeService([]);

      await close();

      expect(revenue.documents).toHaveBeenCalledWith({
        tenantId: TENANT,
        propertyId: PROPERTY,
        from: '2026-08-01',
        to: '2026-08-31',
        sourceModule: RevenueSourceModule.RESTAURANT,
        // ค่าบริการกับรายได้อื่นในบิลไม่ใช่ยอดของจานไหน
        revenueType: [RevenueType.FOOD, RevenueType.BEVERAGE],
      });
    });

    it('ส่วนลดท้ายบิลถูกเฉลี่ยลงจานตามสัดส่วน ยอดรายจานจึงเท่ากับยอดสุทธิของสมุด', async () => {
      const { close, foodCostAnalysis } = makeService(
        // ขายหน้าเมนู 380 ลด 30 → สมุดรับรู้ 350
        [orderRow('ord-1', 380, '2026-08-05', { discount: 30 })],
        {
          orders: [
            {
              id: 'ord-1',
              items: [
                { menuItemId: 'menu-padthai', quantity: 1, unitPrice: 220 },
                { menuItemId: 'menu-tea', quantity: 2, unitPrice: 80 },
              ],
            },
          ],
        },
      );

      await close();

      const rows = dataOf(foodCostAnalysis.create);
      expect(rows).toEqual([
        expect.objectContaining({ menuItemId: 'menu-padthai', totalRevenue: 202.63 }),
        expect.objectContaining({ menuItemId: 'menu-tea', totalRevenue: 147.37 }),
      ]);
      expect(rows.reduce((sum, row) => sum + row.totalRevenue, 0)).toBe(350);
    });

    it('ค่าบริการไม่ถูกยัดเข้าจานไหน — ไม่ใช่ยอดขายอาหาร', async () => {
      const { close, foodCostAnalysis } = makeService(
        [
          orderRow('ord-1', 220, '2026-08-05', { revenueType: RevenueType.FOOD }),
          orderRow('ord-1', 160, '2026-08-05', { revenueType: RevenueType.BEVERAGE }),
          orderRow('ord-1', 38, '2026-08-05', { revenueType: RevenueType.SERVICE_CHARGE }),
        ],
        {
          orders: [
            {
              id: 'ord-1',
              items: [
                { menuItemId: 'menu-padthai', quantity: 1, unitPrice: 220 },
                { menuItemId: 'menu-tea', quantity: 2, unitPrice: 80 },
              ],
            },
          ],
        },
      );

      await close();

      // 380 ของอาหาร+เครื่องดื่ม ไม่ใช่ 418 ที่รวมค่าบริการ
      expect(dataOf(foodCostAnalysis.create).reduce((sum, row) => sum + row.totalRevenue, 0)).toBe(
        380,
      );
    });

    it('เศษสตางค์จากการปัดไปอยู่บรรทัดใหญ่สุด ไม่หายไปจากยอด', async () => {
      const { close, foodCostAnalysis } = makeService(
        [orderRow('ord-1', 100, '2026-08-05')],
        {
          orders: [
            {
              id: 'ord-1',
              items: [
                { menuItemId: 'menu-a', quantity: 1, unitPrice: 10 },
                { menuItemId: 'menu-b', quantity: 1, unitPrice: 10 },
                { menuItemId: 'menu-c', quantity: 1, unitPrice: 10 },
              ],
            },
          ],
        },
      );

      await close();

      const rows = dataOf(foodCostAnalysis.create);
      // 33.33 × 3 = 99.99 — เศษ 0.01 ต้องไปอยู่ที่ใดที่หนึ่ง ไม่ใช่ระเหย
      expect(rows.map((row) => row.totalRevenue)).toEqual([33.34, 33.33, 33.33]);
      expect(rows.reduce((sum, row) => sum + row.totalRevenue, 0)).toBe(100);
    });

    it('เดือนที่ไม่มีบิลในสมุดไม่ต้องกวนตาราง order', async () => {
      const { close, prisma, foodCostAnalysis } = makeService([]);

      await close();

      expect(prisma.order.findMany).not.toHaveBeenCalled();
      expect(prisma.menuItem.findMany).not.toHaveBeenCalled();
      expect(foodCostAnalysis.create).not.toHaveBeenCalled();
    });
  });

  describe('ต้นทุนวัตถุดิบต่อจาน (เฟส 4)', () => {
    /** ต้มยำ 1 สูตรได้ 2 จาน: กุ้ง 0.2 กก. @300 + เห็ด 0.1 กก. เผื่อเสีย 10% @80 */
    const tomYum: MenuItemRow = {
      id: 'menu-tomyum',
      name: 'ต้มยำกุ้ง',
      cost: null,
      recipe: {
        servings: 2,
        ingredients: [
          {
            name: 'กุ้ง',
            quantity: 0.2,
            unit: 'KG',
            wastagePercent: 0,
            itemId: 'ing-shrimp',
            item: { id: 'ing-shrimp', unit: 'KG' },
          },
          {
            name: 'เห็ด',
            quantity: 0.1,
            unit: 'KG',
            wastagePercent: 10,
            itemId: 'ing-mushroom',
            item: { id: 'ing-mushroom', unit: 'KG' },
          },
        ],
      },
    };

    const kitchenStocks = [
      { itemId: 'ing-shrimp', quantity: 10, avgCost: 300 },
      { itemId: 'ing-mushroom', quantity: 5, avgCost: 80 },
    ];

    it('คิดจากสูตร × ต้นทุนเฉลี่ยในคลัง หารด้วยจำนวนจานต่อสูตร', async () => {
      const { close, foodCostAnalysis } = makeService([orderRow('ord-1', 500, '2026-08-05')], {
        orders: [
          { id: 'ord-1', items: [{ menuItemId: 'menu-tomyum', quantity: 2, unitPrice: 250 }] },
        ],
        menuItems: [tomYum],
        stocks: kitchenStocks,
      });

      await close();

      // (0.2×300) + (0.1×1.1×80) = 60 + 8.8 = 68.8 ต่อสูตร ÷ 2 จาน = 34.40 ต่อจาน
      expect(dataOf(foodCostAnalysis.create)[0]).toMatchObject({
        menuItemId: 'menu-tomyum',
        costPerUnit: 34.4,
        // ต้นทุนของทั้งเดือน = ต่อจาน × จำนวนที่ขาย ไม่ใช่ต้นทุนต่อจานซ้ำอีกที
        ingredientCost: 68.8,
        quantitySold: 2,
        profitPerUnit: 215.6,
      });
    });

    it('ชื่อจานถูกเก็บเป็นชื่อจริง ไม่ใช่ id', async () => {
      const { close, foodCostAnalysis } = makeService([orderRow('ord-1', 500, '2026-08-05')], {
        orders: [
          { id: 'ord-1', items: [{ menuItemId: 'menu-tomyum', quantity: 2, unitPrice: 250 }] },
        ],
        menuItems: [tomYum],
        stocks: kitchenStocks,
      });

      await close();

      expect(dataOf(foodCostAnalysis.create)[0].menuItemName).toBe('ต้มยำกุ้ง');
    });

    it('ต้นทุนต่อหน่วยเฉลี่ยแบบถ่วงน้ำหนักตามของที่มีจริงในแต่ละคลัง', async () => {
      const { close, foodCostAnalysis } = makeService([orderRow('ord-1', 250, '2026-08-05')], {
        orders: [
          { id: 'ord-1', items: [{ menuItemId: 'menu-plain', quantity: 1, unitPrice: 250 }] },
        ],
        menuItems: [
          {
            id: 'menu-plain',
            name: 'ข้าวเปล่า',
            cost: null,
            recipe: {
              servings: 1,
              ingredients: [
                {
                  name: 'ข้าวสาร',
                  quantity: 1,
                  unit: 'KG',
                  wastagePercent: 0,
                  itemId: 'ing-rice',
                  item: { id: 'ing-rice', unit: 'KG' },
                },
              ],
            },
          },
        ],
        // ซื้อคนละล็อต: 10 หน่วย @100 กับ 30 หน่วย @200 → (1000+6000)/40 = 175
        stocks: [
          { itemId: 'ing-rice', quantity: 10, avgCost: 100 },
          { itemId: 'ing-rice', quantity: 30, avgCost: 200 },
        ],
      });

      await close();

      expect(dataOf(foodCostAnalysis.create)[0].costPerUnit).toBe(175);
    });

    it('หน่วยในสูตรไม่ตรงกับหน่วยนับในคลัง = ข้ามไป ไม่แปลงหน่วยแบบเดา', async () => {
      const { close, foodCostAnalysis } = makeService([orderRow('ord-1', 250, '2026-08-05')], {
        orders: [
          { id: 'ord-1', items: [{ menuItemId: 'menu-mixed', quantity: 1, unitPrice: 250 }] },
        ],
        menuItems: [
          {
            id: 'menu-mixed',
            name: 'จานผสม',
            cost: null,
            recipe: {
              servings: 1,
              ingredients: [
                {
                  name: 'กุ้ง',
                  quantity: 0.2,
                  unit: 'KG',
                  wastagePercent: 0,
                  itemId: 'ing-shrimp',
                  item: { id: 'ing-shrimp', unit: 'KG' },
                },
                // สูตรบอกกรัม คลังนับเป็นถุง — คูณกันตรง ๆ จะผิดพันเท่า
                {
                  name: 'เกลือ',
                  quantity: 5,
                  unit: 'G',
                  wastagePercent: 0,
                  itemId: 'ing-salt',
                  item: { id: 'ing-salt', unit: 'KG' },
                },
              ],
            },
          },
        ],
        stocks: [
          { itemId: 'ing-shrimp', quantity: 10, avgCost: 300 },
          { itemId: 'ing-salt', quantity: 10, avgCost: 15 },
        ],
      });

      await close();

      // นับเฉพาะกุ้ง 0.2×300 = 60 — เกลือถูกข้าม ไม่ใช่คิดเป็น 5×15 = 75
      expect(dataOf(foodCostAnalysis.create)[0].costPerUnit).toBe(60);
    });

    it('จานที่ยังไม่มีสูตรใช้ต้นทุนมาตรฐานที่คีย์ไว้ในเมนู', async () => {
      const { close, foodCostAnalysis } = makeService([orderRow('ord-1', 100, '2026-08-05')], {
        orders: [
          { id: 'ord-1', items: [{ menuItemId: 'menu-cola', quantity: 1, unitPrice: 100 }] },
        ],
        menuItems: [{ id: 'menu-cola', name: 'โคล่า', cost: 35, recipe: null }],
      });

      await close();

      expect(dataOf(foodCostAnalysis.create)[0]).toMatchObject({
        menuItemName: 'โคล่า',
        costPerUnit: 35,
        ingredientCost: 35,
      });
    });
  });

  describe('รายได้รายแผนก (เฟส 4)', () => {
    const august = [
      roomRow('bk-1', 9000, '2026-08-10'),
      orderRow('ord-1', 1500, '2026-08-05'),
      otherRow('sale-1', 500, '2026-08-06'),
    ];

    it('ยอดพาดหัวมาจากสมุด ไม่ใช่แถว REVENUE ใน cost_entries', async () => {
      const { close, periodUpdate } = makeService(august, {
        // ตัวเลขที่คีย์มือไว้ในตารางต้นทุน — ห่างจากยอดขายจริงคนละโลก
        costEntries: [cost(ROOMS_CENTER, 'REVENUE', 485000), cost(FB_CENTER, 'REVENUE', 195000)],
      });

      await close();

      expect(periodUpdate.mock.calls[0][0].data.totalRevenue).toBe(11000);
    });

    it('จับคู่แผนกด้วยประเภทศูนย์ต้นทุน ไม่ใช่ชื่อ', async () => {
      const { close, departmentPnL } = makeService(august);

      await close();

      // ศูนย์ชื่อ "Rooms Division" ต้องได้ค่าห้อง 9,000 — ของเดิมเทียบชื่อกับ 'ROOMS'
      // จึงไม่เคยแมตช์
      expect(pnlOf(departmentPnL, ROOMS_CENTER.id)).toMatchObject({ revenue: 9000 });
      expect(pnlOf(departmentPnL, FB_CENTER.id)).toMatchObject({ revenue: 1500 });
    });

    it('แผนกที่มีรายได้แต่ยังไม่ลงต้นทุนต้องมีแถวของตัวเอง', async () => {
      const { close, departmentPnL } = makeService(august, {
        // ลงต้นทุนไว้แผนกเดียว
        costEntries: [cost(ADMIN_CENTER, 'LABOR', 85000)],
      });

      await close();

      expect(pnlOf(departmentPnL, ROOMS_CENTER.id)).toMatchObject({
        revenue: 9000,
        totalCost: 0,
        netProfit: 9000,
      });
      expect(pnlOf(departmentPnL, ADMIN_CENTER.id)).toMatchObject({
        revenue: 0,
        laborCost: 85000,
        netProfit: -85000,
      });
    });

    it('แถว REVENUE ที่ค้างอยู่ในตารางต้นทุนไม่ถูกนับเป็นต้นทุนแทน', async () => {
      const { close, departmentPnL, periodUpdate } = makeService(august, {
        costEntries: [cost(ROOMS_CENTER, 'REVENUE', 485000), cost(ROOMS_CENTER, 'LABOR', 95000)],
      });

      await close();

      expect(pnlOf(departmentPnL, ROOMS_CENTER.id)).toMatchObject({
        revenue: 9000,
        laborCost: 95000,
        totalCost: 95000,
      });
      expect(periodUpdate.mock.calls[0][0].data.totalMaterialCost).toBe(0);
    });

    it('รายได้ของแผนกที่ยังไม่มีศูนย์ต้นทุนยังอยู่ในยอดรวม แค่ลงแผนกไม่ได้', async () => {
      const { close, departmentPnL, periodUpdate } = makeService(august, {
        // ไม่มีศูนย์ประเภท OTHER_OPERATED รองรับยอดขายหน้าร้าน 500
        costCenters: [ROOMS_CENTER, FB_CENTER],
      });

      await close();

      expect(periodUpdate.mock.calls[0][0].data.totalRevenue).toBe(11000);
      const rows = dataOf(departmentPnL.create);
      expect(rows.reduce((sum, row) => sum + row.revenue, 0)).toBe(10500);
    });
  });

  describe('ตัวชี้วัดห้องพัก (เฟส 4)', () => {
    const stay = (id: string, checkIn: string, checkOut: string) => ({
      id,
      scheduledCheckIn: new Date(`${checkIn}T07:00:00.000Z`),
      scheduledCheckOut: new Date(`${checkOut}T05:00:00.000Z`),
      room: { type: 'Standard' },
    });

    it('RevPAR หารค่าห้องตามสมุดด้วยคืนที่ขายได้ทั้งเดือน', async () => {
      const { close, periodUpdate } = makeService([roomRow('bk-1', 18600, '2026-08-10')], {
        bookings: [stay('bk-1', '2026-08-07', '2026-08-10')],
        totalRooms: 10,
      });

      await close();

      // 18,600 ÷ (10 ห้อง × 31 วัน) = 60 — ของเดิมได้ 0 เสมอเพราะกรองด้วยชื่อศูนย์
      expect(periodUpdate.mock.calls[0][0].data.revPAR).toBe(60);
      expect(periodUpdate.mock.calls[0][0].data.totalRoomNights).toBe(310);
    });

    it('ต้นทุนต่อห้องที่ขายได้เลือกศูนย์ด้วยประเภท และไม่นับแถว REVENUE', async () => {
      const { close, periodUpdate } = makeService([roomRow('bk-1', 9000, '2026-08-10')], {
        bookings: [stay('bk-1', '2026-08-07', '2026-08-10')],
        costEntries: [
          cost(ROOMS_CENTER, 'LABOR', 9000),
          cost(ROOMS_CENTER, 'REVENUE', 485000),
          cost(FB_CENTER, 'LABOR', 72000),
        ],
      });

      await close();

      // ต้นทุนแผนกห้อง 9,000 ÷ 3 คืนที่จองไว้ = 3,000 (ไม่รวม 485,000 และไม่รวม F&B)
      expect(periodUpdate.mock.calls[0][0].data.costPerOccupiedRoom).toBe(3000);
      expect(periodUpdate.mock.calls[0][0].data.occupiedRoomNights).toBe(3);
    });

    it('ตัดเดือนด้วยวันไทย ไม่ใช่เวลาท้องถิ่นของเครื่อง', async () => {
      const { close, prisma } = makeService([]);

      await close();

      const call = prisma.booking.findMany.mock.calls.find(
        ([args]: [any]) => args.where.scheduledCheckIn,
      );
      // เที่ยงคืนวันที่ 1 ส.ค. เวลาไทย = 31 ก.ค. 17:00 UTC
      expect(call[0].where.scheduledCheckIn).toEqual({
        gte: new Date('2026-07-31T17:00:00.000Z'),
        lt: new Date('2026-08-31T17:00:00.000Z'),
      });
    });

    it('property ที่ยังไม่ได้ตั้งห้องได้ศูนย์ ไม่ใช่รายได้ทั้งเดือนหารสามสิบเอ็ด', async () => {
      const { close, periodUpdate } = makeService([roomRow('bk-1', 18600, '2026-08-10')], {
        totalRooms: 0,
      });

      await close();

      expect(periodUpdate.mock.calls[0][0].data.revPAR).toBe(0);
      expect(periodUpdate.mock.calls[0][0].data.occupancyRate).toBe(0);
    });
  });

  describe('ลำดับการทำงาน', () => {
    it('อ่านสมุดให้เสร็จก่อนเปิดทรานแซกชัน จะได้ไม่ถือล็อกไว้ระหว่างอ่านรายงาน', async () => {
      const { close, ledgerReadBeforeTransaction, prisma } = makeService([
        roomRow('bk-1', 9000, '2026-08-10'),
      ]);

      await close();

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(ledgerReadBeforeTransaction.value).toBe(true);
    });

    it('งวดที่ปิดไปแล้วถูกปฏิเสธก่อน ไม่แตะสมุดและไม่เปิดทรานแซกชัน', async () => {
      const { close, revenue, prisma } = makeService([roomRow('bk-1', 9000, '2026-08-10')], {
        status: 'CLOSED',
      });

      await expect(close()).rejects.toBeInstanceOf(BadRequestException);
      expect(revenue.documents).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
