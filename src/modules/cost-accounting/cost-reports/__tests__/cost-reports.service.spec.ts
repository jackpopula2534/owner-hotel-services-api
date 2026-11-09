/**
 * รายงานต้นทุน — ตัวเงินต้องไม่กระโดดตอนงวดถูกปิด
 *
 * หน้านี้มีสองทางเดิน: งวดที่ยังไม่ปิดคำนวณสด ส่วนงวดที่ปิดแล้วอ่านจาก
 * `room_cost_analyses` ที่เขียนไว้ตอนปิด ถ้าสองทางนี้คิดเลขคนละแบบ ผู้ใช้จะเห็น
 * ตัวเลขของเดือนเดียวกันเปลี่ยนไปเฉย ๆ ในวันที่บัญชีกดปิดงวด — ซึ่งเคยเป็นแบบนั้น
 * จริง (ทางสดบวก `booking.totalPrice` ของใบที่กำหนดเช็คอินเดือนนี้ ทางที่ปิดแล้ว
 * บวกอีกชุดหนึ่ง) ตอนนี้ทั้งสองทางใช้ `roomRevenueByType` ตัวเดียวกัน
 *
 * อีกกติกาที่ตรึงไว้: อัตราเข้าพักยังนับจากใบจองที่กำหนดเข้าพักในเดือนนี้ ไม่ใช่จาก
 * ใบที่รับรู้รายได้แล้ว ไม่งั้นเดือนที่ยังไม่จบจะดูว่างเปล่าเพราะแขกที่ยังไม่เช็คเอาต์
 * ยังไม่มีแถวในสมุด — ตัวเลขปฏิบัติการกับตัวเงินตอบคนละคำถาม
 *
 * ## P&L รายแผนก (เฟส 4)
 * เดิม "รายได้" ของแต่ละแผนกมาจากแถวใน `cost_entries` ที่ประเภทเป็น `REVENUE`
 * คือรายได้ที่คนคีย์เข้ามาเองในตารางต้นทุน ไม่ผูกกับยอดขายจริง ตอนนี้มาจากสมุดกลาง
 * ผ่าน `revenueByCostCenter` ตัวเดียวกับที่การปิดงวดใช้ ทั้งสองทางจึงตรงกัน
 */
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
import { CostReportsService } from '../cost-reports.service';

const TENANT = 'tenant-1';
const PROPERTY = 'prop-1';
const PERIOD = '2026-08';

interface BookingRow {
  id: string;
  scheduledCheckIn: Date;
  scheduledCheckOut: Date;
  room: { type: string } | null;
}

const booking = (id: string, type: string | null, checkIn: string, checkOut: string): BookingRow => ({
  id,
  scheduledCheckIn: new Date(`${checkIn}T07:00:00.000Z`),
  scheduledCheckOut: new Date(`${checkOut}T05:00:00.000Z`),
  room: type ? { type } : null,
});

const roomRow = (sourceId: string, amount: number, businessDate: string): LedgerRow => ({
  businessDate,
  sourceId,
  amount,
  sourceType: RevenueSourceType.BOOKING,
  sourceModule: RevenueSourceModule.HOTEL,
  segment: RevenueSegment.ROOMS,
  propertyId: PROPERTY,
});

const fbRow = (
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

interface CenterRow {
  id: string;
  name: string;
  type: CostCenterType;
  code: string;
  sortOrder: number;
}

/** ศูนย์ต้นทุนของจริงตั้งชื่ออิสระ — "Rooms Division" ไม่ใช่ 'ROOMS' */
const ROOMS_CENTER: CenterRow = {
  id: 'cc-rooms',
  name: 'Rooms Division',
  type: CostCenterType.ROOMS,
  code: 'CC-ROOMS',
  sortOrder: 0,
};
const FB_CENTER: CenterRow = {
  id: 'cc-fb',
  name: 'Food & Beverage',
  type: CostCenterType.FOOD_BEVERAGE,
  code: 'CC-FB',
  sortOrder: 1,
};
const ADMIN_CENTER: CenterRow = {
  id: 'cc-admin',
  name: 'Administrative & General',
  type: CostCenterType.ADMIN_GENERAL,
  code: 'CC-ADMIN',
  sortOrder: 2,
};

interface CostEntryRow {
  costCenterId: string;
  amount: number;
  costCenter: { id: string; name: string; type: CostCenterType };
  costType: { id: string; category: string };
}

const cost = (center: CenterRow, category: string, amount: number): CostEntryRow => ({
  costCenterId: center.id,
  amount,
  costCenter: { id: center.id, name: center.name, type: center.type },
  costType: { id: `ct-${category}`, category },
});

/** บิลกับสูตรอาหารที่ Prisma จะคืนให้ตัวช่วยฝั่ง F&B */
interface OrderRow {
  id: string;
  items: { menuItemId: string; quantity: number; unitPrice: number }[];
}

interface MenuItemRow {
  id: string;
  name: string;
  cost: number | null;
  recipe: {
    servings: number | null;
    ingredients: {
      name: string;
      quantity: number | null;
      unit: string;
      wastagePercent: number;
      itemId: string | null;
      item: { id: string; unit: string } | null;
    }[];
  } | null;
}

const order = (id: string, items: [string, number, number][]): OrderRow => ({
  id,
  items: items.map(([menuItemId, quantity, unitPrice]) => ({ menuItemId, quantity, unitPrice })),
});

/** จานที่คิดต้นทุนจากสูตร: วัตถุดิบหนึ่งตัวผูกกับสินค้าในคลัง หน่วยตรงกัน */
const dish = (id: string, name: string, itemId: string, quantity: number): MenuItemRow => ({
  id,
  name,
  cost: null,
  recipe: {
    servings: 1,
    ingredients: [{ name: `วัตถุดิบของ${name}`, quantity, unit: 'KG', wastagePercent: 0, itemId, item: { id: itemId, unit: 'KG' } }],
  },
});

interface WorldOptions {
  bookings?: BookingRow[];
  totalRooms?: number;
  /** งวดที่ปิดแล้วพร้อมแถว room_cost_analyses ที่เขียนไว้ตอนปิด */
  closedPeriod?: Record<string, unknown> | null;
  costEntries?: CostEntryRow[];
  costCenters?: CenterRow[];
  orders?: OrderRow[];
  menuItems?: MenuItemRow[];
  stocks?: { itemId: string; quantity: number; avgCost: number }[];
}

function makeService(rows: LedgerRow[], options: WorldOptions = {}) {
  const {
    bookings = [],
    totalRooms = 10,
    closedPeriod = null,
    costEntries = [],
    costCenters = [ROOMS_CENTER, FB_CENTER, ADMIN_CENTER],
    orders = [],
    menuItems = [],
    stocks = [],
  } = options;

  const findManyBookings = jest.fn(
    async ({ where }: { where: { id?: { in: string[] } } }) =>
      where.id?.in
        ? // การอ่านของ roomRevenueByType — หยิบใบตาม sourceId ที่อยู่ในสมุด
          bookings.filter((row) => where.id!.in.includes(row.id))
        : // การอ่านของอัตราเข้าพัก — ใบที่กำหนดเข้าพักในเดือนนี้
          bookings,
  );

  const findManyOrders = jest.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
    orders.filter((row) => where.id.in.includes(row.id)),
  );

  const prisma = {
    periodClose: { findFirst: jest.fn(async () => closedPeriod) },
    property: { findFirst: jest.fn(async () => ({ id: PROPERTY, tenantId: TENANT })) },
    room: { count: jest.fn(async () => totalRooms) },
    booking: { findMany: findManyBookings },
    costCenter: { findMany: jest.fn(async () => costCenters) },
    costEntry: { findMany: jest.fn(async () => costEntries) },
    order: { findMany: findManyOrders },
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
  } as unknown as PrismaService;

  const revenue = buildRevenueQueryStub(rows);
  const service = new CostReportsService(prisma, revenue as unknown as RevenueQueryService);

  return { service, prisma: prisma as any, revenue, findManyBookings, findManyOrders };
}

/** แถว P&L ของแผนกที่ชื่อว่า ... */
const departmentOf = <T extends { name: string }>(report: { departments: T[] }, name: string) =>
  report.departments.find((department) => department.name === name);

describe('CostReportsService — งวดที่ส่งมาไม่ถูกต้อง', () => {
  it.each([
    ['ไม่ได้ส่งมาเลย', undefined as unknown as string],
    ['ผิดรูปแบบ', '2026/08'],
    ['เดือนเกินสิบสอง', '2026-13'],
  ])('%s ต้องได้ 400 ไม่ใช่ 500 พร้อมข้อความภายใน', async (_label, period) => {
    const { service } = makeService([]);

    await expect(service.getDepartmentPnL(TENANT, PROPERTY, period)).rejects.toThrow(
      'Invalid period format. Use YYYY-MM',
    );
  });
});

describe('CostReportsService.getRoomCostReport', () => {
  describe('งวดที่ยังไม่ปิด', () => {
    it('ตัวเงินรายประเภทห้องมาจากสมุดรายได้', async () => {
      const { service } = makeService(
        [roomRow('bk-1', 9000, '2026-08-10'), roomRow('bk-2', 4000, '2026-08-12')],
        {
          bookings: [
            booking('bk-1', 'Deluxe', '2026-08-07', '2026-08-10'),
            booking('bk-2', 'Standard', '2026-08-11', '2026-08-12'),
          ],
        },
      );

      const report = await service.getRoomCostReport(TENANT, PROPERTY, PERIOD);

      expect(report.byRoomType).toEqual([
        expect.objectContaining({
          roomType: 'Deluxe',
          nights: 3,
          revenue: 9000,
          revenuePerNight: 3000,
        }),
        expect.objectContaining({
          roomType: 'Standard',
          nights: 1,
          revenue: 4000,
          revenuePerNight: 4000,
        }),
      ]);
    });

    it('แขกที่ยังไม่เช็คเอาต์ดันอัตราเข้าพักขึ้น แต่ยังไม่มีเงินให้รายงาน', async () => {
      const { service } = makeService([roomRow('bk-1', 9000, '2026-08-10')], {
        bookings: [
          booking('bk-1', 'Deluxe', '2026-08-07', '2026-08-10'),
          // ยังพักอยู่ ยังไม่มีแถวในสมุด
          booking('bk-2', 'Deluxe', '2026-08-15', '2026-08-18'),
        ],
        totalRooms: 10,
      });

      const report = await service.getRoomCostReport(TENANT, PROPERTY, PERIOD);

      // 6 คืนที่จองไว้ จาก 10 ห้อง × 31 วัน
      expect(report.occupancy).toEqual({
        rate: (6 / 310) * 100,
        totalNights: 310,
        occupiedNights: 6,
      });
      expect(report.byRoomType[0]).toMatchObject({ nights: 3, revenue: 9000 });
    });

    it('ยอดเฉลี่ยต่อคืนหารด้วยคืนของใบที่รับรู้รายได้แล้ว ชุดเดียวกับตัวตั้ง', async () => {
      const { service } = makeService(
        [roomRow('bk-1', 9000, '2026-08-10'), roomRow('bk-2', 4000, '2026-08-12')],
        {
          bookings: [
            booking('bk-1', 'Deluxe', '2026-08-07', '2026-08-10'),
            booking('bk-2', 'Standard', '2026-08-11', '2026-08-12'),
            booking('bk-3', 'Standard', '2026-08-20', '2026-08-25'),
          ],
        },
      );

      const report = await service.getRoomCostReport(TENANT, PROPERTY, PERIOD);

      // 13,000 ÷ 4 คืนที่รับรู้แล้ว — ไม่ใช่ ÷ 9 คืนที่จองไว้ทั้งเดือน
      expect(report.averages.avgRevenuePerNight).toBe(3250);
      expect(report.occupancy.occupiedNights).toBe(9);
    });

    it('ถามสมุดเป็นเดือนไทยเต็มเดือนของงวดที่ขอ', async () => {
      const { service, revenue } = makeService([]);

      await service.getRoomCostReport(TENANT, PROPERTY, '2026-02');

      expect(revenue.documents).toHaveBeenCalledWith({
        tenantId: TENANT,
        propertyId: PROPERTY,
        from: '2026-02-01',
        to: '2026-02-28',
        sourceModule: RevenueSourceModule.HOTEL,
        segment: RevenueSegment.ROOMS,
      });
    });

    it('เดือนที่ยังไม่มีรายได้เลยได้ศูนย์ ไม่ใช่ NaN', async () => {
      const { service } = makeService([], { bookings: [], totalRooms: 0 });

      const report = await service.getRoomCostReport(TENANT, PROPERTY, PERIOD);

      expect(report.byRoomType).toEqual([]);
      expect(report.averages).toEqual({
        avgRevenuePerNight: 0,
        avgCostPerNight: 0,
        avgProfit: 0,
        avgMargin: 0,
      });
    });
  });

  describe('ความต่อเนื่องกับงวดที่ปิดแล้ว', () => {
    it('ปิดงวดแล้วตัวเลขรายประเภทห้องต้องเท่าเดิม ไม่กระโดด', async () => {
      const rows = [roomRow('bk-1', 9000, '2026-08-10'), roomRow('bk-2', 4000, '2026-08-12')];
      const bookings = [
        booking('bk-1', 'Deluxe', '2026-08-07', '2026-08-10'),
        booking('bk-2', 'Standard', '2026-08-11', '2026-08-12'),
      ];

      const live = await makeService(rows, { bookings }).service.getRoomCostReport(
        TENANT,
        PROPERTY,
        PERIOD,
      );

      // แถวที่การปิดงวดเขียนไว้ มาจากตัวช่วยตัวเดียวกัน จึงสร้างได้จากผลลัพธ์สด
      const roomCostAnalyses = live.byRoomType.map((item) => ({
        roomType: item.roomType,
        totalNights: item.nights,
        totalRevenue: item.revenue,
        amenityCost: 0,
        revenuePerNight: item.revenuePerNight,
        costPerNight: 0,
        profitPerNight: item.revenuePerNight,
        margin: item.margin,
      }));

      const closed = await makeService(rows, {
        bookings,
        closedPeriod: {
          occupancyRate: 0,
          totalRoomNights: 310,
          occupiedRoomNights: 4,
          roomCostAnalyses,
        },
      }).service.getRoomCostReport(TENANT, PROPERTY, PERIOD);

      expect(closed.byRoomType).toEqual(live.byRoomType);
      expect(closed.averages).toEqual(live.averages);
    });

    it('งวดที่ปิดแล้วอ่านจากแถวที่เก็บไว้ ไม่ไปถามสมุดซ้ำ', async () => {
      const { service, revenue } = makeService([roomRow('bk-1', 9000, '2026-08-10')], {
        closedPeriod: {
          occupancyRate: 50,
          totalRoomNights: 310,
          occupiedRoomNights: 155,
          roomCostAnalyses: [],
        },
      });

      await service.getRoomCostReport(TENANT, PROPERTY, PERIOD);

      expect(revenue.documents).not.toHaveBeenCalled();
    });
  });
});

describe('CostReportsService.getDepartmentPnL', () => {
  const august = [
    roomRow('bk-1', 9000, '2026-08-10'),
    fbRow('ord-1', 1500, '2026-08-05'),
    otherRow('sale-1', 500, '2026-08-06'),
  ];

  describe('งวดที่ยังไม่ปิด', () => {
    it('รายได้รายแผนกมาจากสมุด จับคู่ด้วยประเภทศูนย์ ไม่ใช่ชื่อ', async () => {
      const { service } = makeService(august, {
        costEntries: [cost(ROOMS_CENTER, 'LABOR', 95000), cost(FB_CENTER, 'MATERIAL', 40000)],
      });

      const report = await service.getDepartmentPnL(TENANT, PROPERTY, PERIOD);

      expect(departmentOf(report, 'Rooms Division')).toMatchObject({
        type: CostCenterType.ROOMS,
        revenue: 9000,
        laborCost: 95000,
        netProfit: -86000,
      });
      expect(departmentOf(report, 'Food & Beverage')).toMatchObject({
        revenue: 1500,
        materialCost: 40000,
      });
    });

    it('แถว REVENUE ที่ค้างในตารางต้นทุนไม่ถูกนับ ทั้งเป็นรายได้และเป็นต้นทุน', async () => {
      const { service } = makeService(august, {
        costEntries: [cost(ROOMS_CENTER, 'REVENUE', 485000), cost(ROOMS_CENTER, 'LABOR', 95000)],
      });

      const report = await service.getDepartmentPnL(TENANT, PROPERTY, PERIOD);

      expect(departmentOf(report, 'Rooms Division')).toMatchObject({
        revenue: 9000,
        totalCost: 95000,
      });
      expect(report.totals.totalCost).toBe(95000);
    });

    it('แผนกที่มีรายได้แต่ยังไม่ลงต้นทุนต้องมีแถวของตัวเอง', async () => {
      const { service } = makeService(august, {
        costEntries: [cost(ADMIN_CENTER, 'LABOR', 85000)],
      });

      const report = await service.getDepartmentPnL(TENANT, PROPERTY, PERIOD);

      expect(departmentOf(report, 'Rooms Division')).toMatchObject({
        revenue: 9000,
        totalCost: 0,
        netProfit: 9000,
        margin: 100,
      });
      expect(departmentOf(report, 'Administrative & General')).toMatchObject({
        revenue: 0,
        laborCost: 85000,
      });
    });

    it('ยอดพาดหัวเป็นยอดของสมุด รวมเงินที่ยังไม่มีศูนย์ต้นทุนรองรับ', async () => {
      const { service } = makeService(august, {
        // ไม่มีศูนย์ประเภท OTHER_OPERATED รองรับยอดขายหน้าร้าน 500
        costCenters: [ROOMS_CENTER, FB_CENTER],
      });

      const report = await service.getDepartmentPnL(TENANT, PROPERTY, PERIOD);

      expect(report.totals.revenue).toBe(11000);
      const mapped = report.departments.reduce((sum, department) => sum + department.revenue, 0);
      expect(mapped).toBe(10500);
    });

    it('เงินที่ยังไม่มีศูนย์ต้นทุนรองรับถูกส่งออกไปให้หน้าจอบอกผู้ใช้', async () => {
      const { service } = makeService(august, {
        costCenters: [ROOMS_CENTER, FB_CENTER],
      });

      const report = await service.getDepartmentPnL(TENANT, PROPERTY, PERIOD);

      // ส่วนต่าง 500 ระหว่างยอดพาดหัวกับผลบวกของแถว ต้องมีคำอธิบายว่าเป็นเงินของใคร
      expect(report.unmappedRevenue).toBe(500);
      expect(report.unmapped).toEqual([
        {
          segment: RevenueSegment.OTHER_OPERATED,
          expectedCostCenterType: CostCenterType.OTHER_OPERATED,
          revenue: 500,
        },
      ]);
    });

    it('tenant ที่ยังไม่ได้ตั้งศูนย์ต้นทุนเลย ต้องรู้ว่าเงินไปค้างอยู่ตรงไหน', async () => {
      // เคสจริง: ร้านอาหารขายได้แล้วแต่ยังไม่มีใครตั้งผังศูนย์ต้นทุน หน้าจอเดิม
      // ได้ departments ว่าง เลยขึ้น "ไม่มีข้อมูล P&L สำหรับงวดนี้" ทั้งที่มียอดขาย
      const { service } = makeService([fbRow('ord-1', 748, '2026-08-17')], { costCenters: [] });

      const report = await service.getDepartmentPnL(TENANT, PROPERTY, PERIOD);

      expect(report.departments).toEqual([]);
      expect(report.totals.revenue).toBe(748);
      expect(report.unmappedRevenue).toBe(748);
      expect(report.unmapped).toEqual([
        {
          segment: RevenueSegment.FOOD_BEVERAGE,
          expectedCostCenterType: CostCenterType.FOOD_BEVERAGE,
          revenue: 748,
        },
      ]);
    });

    it('ต้นทุนประเภทอื่นถูกนับในยอดรวม ไม่หายไประหว่างทาง', async () => {
      const { service } = makeService(august, {
        costEntries: [
          cost(ROOMS_CENTER, 'LABOR', 95000),
          // ประเภทที่ไม่ใช่ MATERIAL/LABOR/OVERHEAD เคยถูกนับในแถวแผนกแต่ตกจากยอดรวม
          cost(ROOMS_CENTER, 'OTHER', 5000),
        ],
      });

      const report = await service.getDepartmentPnL(TENANT, PROPERTY, PERIOD);

      expect(departmentOf(report, 'Rooms Division')?.totalCost).toBe(100000);
      expect(report.totals.totalCost).toBe(100000);
      expect(report.totals.grossProfit).toBe(11000 - 100000);
    });

    it('ถามต้นทุนเฉพาะแถวที่ผ่านการบันทึกแล้วของงวดนั้น', async () => {
      const { service, prisma } = makeService([]);

      await service.getDepartmentPnL(TENANT, PROPERTY, PERIOD);

      expect(prisma.costEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: TENANT, propertyId: PROPERTY, period: PERIOD, status: 'posted' },
        }),
      );
    });

    it('เดือนที่ยังไม่มีทั้งรายได้และต้นทุนได้ศูนย์ ไม่ใช่ NaN', async () => {
      const { service } = makeService([]);

      const report = await service.getDepartmentPnL(TENANT, PROPERTY, PERIOD);

      expect(report.departments).toEqual([]);
      expect(report.totals).toEqual({
        revenue: 0,
        totalCost: 0,
        grossProfit: 0,
        netOperatingIncome: 0,
      });
    });
  });

  describe('ความต่อเนื่องกับงวดที่ปิดแล้ว', () => {
    it('งวดที่ปิดแล้วแสดงชื่อแผนกจริง ไม่ใช่ uuid ของศูนย์ต้นทุน', async () => {
      const { service } = makeService([], {
        closedPeriod: {
          totalRevenue: 11000,
          totalMaterialCost: 0,
          totalLaborCost: 95000,
          totalOverhead: 0,
          totalOtherCost: 0,
          netOperatingIncome: -84000,
          departmentPnLs: [
            {
              costCenterId: ROOMS_CENTER.id,
              revenue: 9000,
              materialCost: 0,
              laborCost: 95000,
              overheadCost: 0,
              totalCost: 95000,
              netProfit: -86000,
              profitMargin: -955.5555555555555,
            },
          ],
        },
      });

      const report = await service.getDepartmentPnL(TENANT, PROPERTY, PERIOD);

      expect(report.departments[0]).toMatchObject({
        name: 'Rooms Division',
        type: CostCenterType.ROOMS,
      });
    });

    it('ปิดงวดแล้วแถวรายแผนกกับยอดรวมต้องเท่าเดิม ไม่กระโดด', async () => {
      const costEntries = [cost(ROOMS_CENTER, 'LABOR', 95000), cost(FB_CENTER, 'MATERIAL', 40000)];

      const live = await makeService(august, { costEntries }).service.getDepartmentPnL(
        TENANT,
        PROPERTY,
        PERIOD,
      );

      // แถวที่การปิดงวดเขียนไว้ มาจากตัวช่วยตัวเดียวกัน จึงสร้างได้จากผลลัพธ์สด
      const departmentPnLs = live.departments.map((department) => ({
        costCenterId: [ROOMS_CENTER, FB_CENTER, ADMIN_CENTER].find(
          (center) => center.name === department.name,
        )!.id,
        revenue: department.revenue,
        materialCost: department.materialCost,
        laborCost: department.laborCost,
        overheadCost: department.overheadCost,
        totalCost: department.totalCost,
        netProfit: department.netProfit,
        profitMargin: department.margin,
      }));

      const closed = await makeService(august, {
        costEntries,
        closedPeriod: {
          totalRevenue: live.totals.revenue,
          totalMaterialCost: 40000,
          totalLaborCost: 95000,
          totalOverhead: 0,
          totalOtherCost: 0,
          netOperatingIncome: live.totals.netOperatingIncome,
          departmentPnLs,
        },
      }).service.getDepartmentPnL(TENANT, PROPERTY, PERIOD);

      expect(closed.departments).toEqual(live.departments);
      expect(closed.totals).toEqual(live.totals);
      // งวดที่ปิดแล้วไม่ได้เก็บว่าเงินที่ลงแผนกไม่ได้เป็นของแผนกใด แต่ยอดต้องเท่ากัน
      // ไม่งั้นวันที่บัญชีกดปิดงวด คำเตือนบนหน้าจอจะหายไปทั้งที่เงินยังค้างเหมือนเดิม
      expect(closed.unmappedRevenue).toBe(live.unmappedRevenue);
      expect(closed.unmappedRevenue).toBe(500);
    });

    it('งวดที่ปิดแล้วไม่ไปคิดสดซ้ำ', async () => {
      const { service, revenue, prisma } = makeService(august, {
        closedPeriod: {
          totalRevenue: 11000,
          totalMaterialCost: 0,
          totalLaborCost: 0,
          totalOverhead: 0,
          totalOtherCost: 0,
          netOperatingIncome: 11000,
          departmentPnLs: [],
        },
      });

      await service.getDepartmentPnL(TENANT, PROPERTY, PERIOD);

      expect(revenue.bySegment).not.toHaveBeenCalled();
      expect(prisma.costEntry.findMany).not.toHaveBeenCalled();
    });
  });
});

/**
 * รายงานต้นทุนอาหาร (เฟส 4)
 *
 * ทางสดของหน้านี้เคยเป็นของเก่ายกชุด: กวาด `order` ทุกใบที่ `createdAt` อยู่ในเดือน
 * ตามเวลาเครื่อง โดยไม่ดูสถานะบิล คิดยอดจากราคาหน้าเมนูก่อนหักส่วนลด ตรึงต้นทุน
 * วัตถุดิบไว้ที่ 0 และส่ง id ของเมนูออกไปให้หน้าจอแสดงเป็นชื่อ ตอนนี้ใช้ตัวช่วย
 * `menuItemSales` + `menuItemCosts` ชุดเดียวกับตอนปิดงวด
 */
describe('CostReportsService.getFoodCostReport', () => {
  /** ขายหน้าเมนู 380 ลด 30 → สมุดรับรู้ 350 */
  const discounted = [fbRow('ord-1', 380, '2026-08-05', { discount: 30 })];
  const ORDERS = [order('ord-1', [['menu-padthai', 1, 220], ['menu-tea', 2, 80]])];
  const MENU = [dish('menu-padthai', 'ผัดไทยกุ้งสด', 'ing-shrimp', 0.15), dish('menu-tea', 'ชาไทยเย็น', 'ing-tea', 0.02)];
  const STOCKS = [
    { itemId: 'ing-shrimp', quantity: 10, avgCost: 300 },
    { itemId: 'ing-tea', quantity: 5, avgCost: 400 },
  ];

  const itemOf = <T extends { menuItemName: string }>(report: { byMenuItem: T[] }, name: string) =>
    report.byMenuItem.find((item) => item.menuItemName === name);

  describe('งวดที่ยังไม่ปิด', () => {
    it('ยอดรายจานเป็นยอดสุทธิของสมุด ไม่ใช่ผลบวกราคาหน้าเมนู', async () => {
      const { service } = makeService(discounted, {
        orders: ORDERS,
        menuItems: MENU,
        stocks: STOCKS,
      });

      const report = await service.getFoodCostReport(TENANT, PROPERTY, PERIOD);

      expect(itemOf(report, 'ผัดไทยกุ้งสด')).toMatchObject({ qtySold: 1, revenue: 202.63 });
      expect(itemOf(report, 'ชาไทยเย็น')).toMatchObject({ qtySold: 2, revenue: 147.37 });
      // 350 ที่ร้านได้รับจริง ไม่ใช่ 380 ที่ตั้งราคาไว้
      expect(report.overview.totalRevenue).toBe(350);
    });

    it('ต้นทุนวัตถุดิบมาจากสูตร × ต้นทุนในคลัง ไม่ใช่ศูนย์', async () => {
      const { service } = makeService(discounted, {
        orders: ORDERS,
        menuItems: MENU,
        stocks: STOCKS,
      });

      const report = await service.getFoodCostReport(TENANT, PROPERTY, PERIOD);

      // ผัดไทย 0.15 × 300 = 45 ต่อจาน × 1 จาน
      expect(itemOf(report, 'ผัดไทยกุ้งสด')).toMatchObject({ ingredientCost: 45 });
      // ชาไทย 0.02 × 400 = 8 ต่อแก้ว × 2 แก้ว
      expect(itemOf(report, 'ชาไทยเย็น')).toMatchObject({ ingredientCost: 16 });
      expect(report.overview.totalIngredientCost).toBe(61);
    });

    it('ชื่อจานเป็นชื่อจริง ไม่ใช่ uuid ของเมนู', async () => {
      const { service } = makeService(discounted, {
        orders: ORDERS,
        menuItems: MENU,
        stocks: STOCKS,
      });

      const report = await service.getFoodCostReport(TENANT, PROPERTY, PERIOD);

      expect(report.byMenuItem.map((item) => item.menuItemName).sort()).toEqual([
        'ชาไทยเย็น',
        'ผัดไทยกุ้งสด',
      ]);
    });

    it('food cost % หารด้วยเงินที่ได้จริง ตัวเลขจึงสูงกว่าตอนหารด้วยยอดก่อนลด', async () => {
      const { service } = makeService(discounted, {
        orders: ORDERS,
        menuItems: MENU,
        stocks: STOCKS,
      });

      const report = await service.getFoodCostReport(TENANT, PROPERTY, PERIOD);

      // 45 ÷ 202.63 = 22.21% — ถ้าหารด้วย 220 ที่ตั้งราคาไว้จะได้แค่ 20.45%
      expect(itemOf(report, 'ผัดไทยกุ้งสด')?.foodCostPercent).toBe(22.21);
      expect(report.overview.avgFoodCostPercent).toBe(17.43);
    });

    it('บิลที่ไม่อยู่ในสมุด (ยกเลิก/ยังไม่ปิด) ไม่ถูกนับเป็นยอดขาย', async () => {
      const { service } = makeService(discounted, {
        orders: [...ORDERS, order('ord-void', [['menu-padthai', 99, 220]])],
        menuItems: MENU,
        stocks: STOCKS,
      });

      const report = await service.getFoodCostReport(TENANT, PROPERTY, PERIOD);

      expect(itemOf(report, 'ผัดไทยกุ้งสด')?.qtySold).toBe(1);
    });

    it('จานที่ต้นทุนเกิน 35% ของยอดขายขึ้นรายการเฝ้าระวัง', async () => {
      const { service } = makeService([fbRow('ord-1', 100, '2026-08-05')], {
        orders: [order('ord-1', [['menu-padthai', 1, 100]])],
        menuItems: [dish('menu-padthai', 'ผัดไทยกุ้งสด', 'ing-shrimp', 0.2)],
        stocks: [{ itemId: 'ing-shrimp', quantity: 10, avgCost: 300 }],
      });

      const report = await service.getFoodCostReport(TENANT, PROPERTY, PERIOD);

      // 60 ÷ 100 = 60%
      expect(report.alertItems.map((item) => item.menuItemName)).toEqual(['ผัดไทยกุ้งสด']);
    });

    it('ถามสมุดเป็นเดือนไทยเต็มเดือน เฉพาะอาหารกับเครื่องดื่ม', async () => {
      const { service, revenue } = makeService([]);

      await service.getFoodCostReport(TENANT, PROPERTY, '2026-02');

      expect(revenue.documents).toHaveBeenCalledWith({
        tenantId: TENANT,
        propertyId: PROPERTY,
        from: '2026-02-01',
        to: '2026-02-28',
        sourceModule: RevenueSourceModule.RESTAURANT,
        revenueType: [RevenueType.FOOD, RevenueType.BEVERAGE],
      });
    });

    it('เดือนที่ยังไม่มียอดขายได้ศูนย์ ไม่ใช่ NaN', async () => {
      const { service } = makeService([]);

      const report = await service.getFoodCostReport(TENANT, PROPERTY, PERIOD);

      expect(report.byMenuItem).toEqual([]);
      expect(report.overview).toEqual({
        totalRevenue: 0,
        totalIngredientCost: 0,
        avgFoodCostPercent: 0,
      });
    });
  });

  describe('ความต่อเนื่องกับงวดที่ปิดแล้ว', () => {
    it('ปิดงวดแล้วตัวเลขรายจานกับยอดรวมต้องเท่าเดิม ไม่กระโดด', async () => {
      const world = { orders: ORDERS, menuItems: MENU, stocks: STOCKS };

      const live = await makeService(discounted, world).service.getFoodCostReport(
        TENANT,
        PROPERTY,
        PERIOD,
      );

      // แถวที่การปิดงวดเขียนไว้ มาจากตัวช่วยชุดเดียวกัน จึงสร้างได้จากผลลัพธ์สด
      const foodCostAnalyses = live.byMenuItem.map((item) => ({
        menuItemName: item.menuItemName,
        quantitySold: item.qtySold,
        totalRevenue: item.revenue,
        ingredientCost: item.ingredientCost,
        foodCostPercent: item.foodCostPercent,
        sellingPrice: item.revenue / item.qtySold,
        costPerUnit: item.ingredientCost / item.qtySold,
      }));

      const closed = await makeService(discounted, {
        ...world,
        closedPeriod: { foodCostAnalyses },
      }).service.getFoodCostReport(TENANT, PROPERTY, PERIOD);

      expect(closed.byMenuItem).toEqual(live.byMenuItem);
      expect(closed.overview).toEqual(live.overview);
      expect(closed.alertItems).toEqual(live.alertItems);
    });

    it('งวดที่ปิดแล้วอ่านจากแถวที่เก็บไว้ ไม่ไปถามสมุดซ้ำ', async () => {
      const { service, revenue, findManyOrders } = makeService(discounted, {
        orders: ORDERS,
        closedPeriod: { foodCostAnalyses: [] },
      });

      await service.getFoodCostReport(TENANT, PROPERTY, PERIOD);

      expect(revenue.documents).not.toHaveBeenCalled();
      expect(findManyOrders).not.toHaveBeenCalled();
    });
  });
});
