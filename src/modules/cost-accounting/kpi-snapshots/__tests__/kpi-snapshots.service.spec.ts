/**
 * KPI รายวันของฝั่งต้นทุน — ฝั่งรายได้ต้องมาจากสมุดรายได้เท่านั้น
 *
 * ของเดิมนับเงินจากสองที่ที่ไม่มีทางตรงกัน: ยอดรวมมาจาก `cost_entries` ที่
 * `sourceType='booking'` (รวมแถวร่างที่ยังไม่โพสต์) ส่วนค่าห้องบวก
 * `booking.totalPrice` ของทุกใบที่ "คาบ" วันนั้น — การจอง 3 คืน 9,000 บาทจึงถูกนับ
 * 9,000 ซ้ำทั้งสามวัน และ ADR ก็เอายอดที่พองแล้วไปหารด้วยจำนวนห้องที่มีคนพัก
 *
 * สองเรื่องที่สเปกชุดนี้กันไม่ให้ย้อนกลับมา:
 *
 *   1. ตัวเงินทุกช่องมาจากสมุด และสามก้อน (ห้อง/อาหาร/อื่น ๆ) รวมกลับเป็นยอดรวมเสมอ
 *   2. ตัวหารของ ADR เป็น "ใบที่รับรู้ค่าห้องในช่วงนี้" ชุดเดียวกับตัวตั้ง ไม่ใช่
 *      จำนวนห้องที่มีคนพักคืนนี้ (สมุดรับรู้ค่าห้องทั้งก้อนตอนเช็คเอาต์)
 *
 * บวกกับกติกาวันที่: หนึ่งแถว = หนึ่งวันปฏิทินไทย เก็บที่เที่ยงคืน UTC ของวันนั้น
 * เดิมเก็บเที่ยงคืน "ของเครื่อง" แล้วอ่านกลับด้วย toISOString() เครื่องที่ตั้งเวลาไทย
 * จึงรายงานย้อนหลังไปหนึ่งวันแบบเงียบ ๆ และ getToday() หาแถวของตัวเองไม่เจอ
 */
import { RevenueSegment, RevenueSourceModule, RevenueSourceType } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { RevenueQueryService } from '@/modules/revenue/revenue-query.service';
import {
  buildRevenueQueryStub,
  LedgerRow,
} from '@/modules/revenue/__tests__/revenue-query.stub';
import { KpiSnapshotsService } from '../kpi-snapshots.service';

const TENANT = 'tenant-1';
const PROPERTY = 'prop-1';
const DAY = '2026-08-17';

const utcMidnight = (date: string) => new Date(`${date}T00:00:00.000Z`);

/** ค่าห้องหนึ่งใบ — สมุดรับรู้ทั้งก้อนวันเช็คเอาต์ ไม่ได้เกลี่ยรายคืน */
const roomRow = (sourceId: string, amount: number, businessDate = DAY): LedgerRow => ({
  businessDate,
  sourceId,
  amount,
  sourceType: RevenueSourceType.BOOKING,
  sourceModule: RevenueSourceModule.HOTEL,
  segment: RevenueSegment.ROOMS,
  propertyId: PROPERTY,
});

const orderRow = (sourceId: string, amount: number, businessDate = DAY): LedgerRow => ({
  businessDate,
  sourceId,
  amount,
  sourceType: RevenueSourceType.ORDER,
  sourceModule: RevenueSourceModule.RESTAURANT,
  segment: RevenueSegment.FOOD_BEVERAGE,
  propertyId: PROPERTY,
});

const retailRow = (sourceId: string, amount: number, businessDate = DAY): LedgerRow => ({
  businessDate,
  sourceId,
  amount,
  sourceType: RevenueSourceType.RETAIL_SALE,
  sourceModule: RevenueSourceModule.RETAIL,
  segment: RevenueSegment.OTHER_OPERATED,
  propertyId: PROPERTY,
});

interface WorldOptions {
  /** ใบจองที่ "มีคนพัก" คืนนั้น — ตัวเลขปฏิบัติการ ไม่ใช่ตัวเงิน */
  occupiedRooms?: number;
  totalRooms?: number;
  costEntries?: Array<{ amount: number; costType: { category: string; name: string } }>;
  /** แถว snapshot ที่มีอยู่แล้วในฐานข้อมูล */
  existingSnapshot?: Record<string, unknown> | null;
}

function makeService(rows: LedgerRow[], options: WorldOptions = {}) {
  const {
    occupiedRooms = 0,
    totalRooms = 10,
    costEntries = [],
    existingSnapshot = null,
  } = options;

  const created: Record<string, unknown>[] = [];
  const prisma = {
    booking: {
      findMany: jest.fn(async () =>
        Array.from({ length: occupiedRooms }, (_unused, index) => ({ id: `stay-${index}` })),
      ),
    },
    costEntry: { findMany: jest.fn(async () => costEntries) },
    room: { count: jest.fn(async () => totalRooms) },
    warehouseStock: { findMany: jest.fn(async () => []) },
    costKpiSnapshot: {
      findFirst: jest.fn(async () => existingSnapshot),
      findMany: jest.fn(async () => []),
      count: jest.fn(async () => 0),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return { id: 'snap-1', createdAt: utcMidnight(DAY), ...data };
      }),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'snap-1',
        tenantId: TENANT,
        propertyId: PROPERTY,
        granularity: 'daily',
        createdAt: utcMidnight(DAY),
        snapshotDate: utcMidnight(DAY),
        ...data,
      })),
    },
  } as unknown as PrismaService;

  const revenue = buildRevenueQueryStub(rows);
  const service = new KpiSnapshotsService(prisma, revenue as unknown as RevenueQueryService);

  return { service, prisma: prisma as any, revenue, created };
}

describe('KpiSnapshotsService', () => {
  describe('รายได้ของ KPI', () => {
    it('ตัวเงินทุกช่องมาจากสมุด และสามก้อนรวมกลับเป็นยอดรวมเสมอ', async () => {
      const { service } = makeService([
        roomRow('bk-1', 9000),
        orderRow('ord-1', 1500),
        retailRow('sale-1', 500),
      ]);

      const kpi = await service.getSnapshot(TENANT, PROPERTY, DAY);

      expect(kpi.totalRevenue).toBe(11000);
      expect(kpi.roomRevenue).toBe(9000);
      expect(kpi.fbRevenue).toBe(1500);
      // ช่องทางที่ไม่ใช่ห้องและไม่ใช่ร้านอาหารถูกคิดด้วยการลบ ยอดจึงไม่มีทางหาย
      expect(kpi.otherRevenue).toBe(500);
      expect(kpi.roomRevenue + kpi.fbRevenue + kpi.otherRevenue).toBe(kpi.totalRevenue);
    });

    it('ถามสมุดด้วยขอบเขตของโรงแรมหลังนั้นและวันเดียว', async () => {
      const { service, revenue } = makeService([roomRow('bk-1', 9000)]);

      await service.getSnapshot(TENANT, PROPERTY, DAY);

      const [scope, rooms, fb] = revenue.totalsOfMany.mock.calls[0][0];
      expect(scope).toEqual({ tenantId: TENANT, propertyId: PROPERTY, from: DAY, to: DAY });
      expect(rooms).toMatchObject({
        sourceModule: RevenueSourceModule.HOTEL,
        segment: RevenueSegment.ROOMS,
      });
      expect(fb).toMatchObject({ sourceModule: RevenueSourceModule.RESTAURANT });
      // จำนวนใบต้องนับจากตัวกรองเดียวกับตัวตั้งของ ADR
      expect(revenue.countDocuments).toHaveBeenCalledWith(rooms);
    });

    it('ค่าห้องของวันอื่นไม่รั่วเข้ามา แม้เป็นการเข้าพักที่คาบวันนี้', async () => {
      const { service } = makeService([
        roomRow('bk-1', 9000, '2026-08-16'),
        roomRow('bk-2', 4000, DAY),
      ]);

      const kpi = await service.getSnapshot(TENANT, PROPERTY, DAY);

      expect(kpi.roomRevenue).toBe(4000);
    });

    it('บิลที่ถูกกลับรายการวันนี้หักยอดของวันนี้ออก', async () => {
      const { service } = makeService([orderRow('ord-1', 1500), orderRow('ord-2', -500)]);

      const kpi = await service.getSnapshot(TENANT, PROPERTY, DAY);

      expect(kpi.fbRevenue).toBe(1000);
      expect(kpi.totalRevenue).toBe(1000);
    });
  });

  describe('ADR / RevPAR', () => {
    it('ADR หารด้วยจำนวนใบที่รับรู้ค่าห้องวันนี้ ไม่ใช่จำนวนห้องที่มีคนพัก', async () => {
      // เข้าพัก 3 คืน 9,000 เช็คเอาต์วันนี้ = รับรู้ใบเดียววันนี้
      // ขณะเดียวกันมีคนพักอยู่ 6 ห้อง — ถ้าเอา 6 มาหารจะได้ ADR 1,500 ซึ่งไม่ใช่ราคาห้อง
      const { service } = makeService([roomRow('bk-1', 9000)], {
        occupiedRooms: 6,
        totalRooms: 10,
      });

      const kpi = await service.getSnapshot(TENANT, PROPERTY, DAY);

      expect(kpi.adr).toBe(9000);
      expect(kpi.occupancyRate).toBe(60);
    });

    it('RevPAR หารด้วยจำนวนห้องทั้งหมด', async () => {
      const { service } = makeService([roomRow('bk-1', 5000), roomRow('bk-2', 5000)], {
        totalRooms: 10,
      });

      const kpi = await service.getSnapshot(TENANT, PROPERTY, DAY);

      expect(kpi.adr).toBe(5000);
      expect(kpi.revPAR).toBe(1000);
    });

    it('วันที่ไม่มีรายได้เลยได้ศูนย์ ไม่ใช่ NaN', async () => {
      const { service } = makeService([], { totalRooms: 0, occupiedRooms: 0 });

      const kpi = await service.getSnapshot(TENANT, PROPERTY, DAY);

      expect(kpi.adr).toBe(0);
      expect(kpi.revPAR).toBe(0);
      expect(kpi.occupancyRate).toBe(0);
      expect(kpi.totalRevenue).toBe(0);
    });
  });

  describe('กำไรกับต้นทุน', () => {
    it('ต้นทุนยังมาจาก cost_entries กำไรจึงเป็นรายได้จากสมุดลบต้นทุนของงานต้นทุน', async () => {
      const { service } = makeService([roomRow('bk-1', 10000)], {
        costEntries: [
          { amount: 2000, costType: { category: 'material', name: 'Food cost' } },
          { amount: 1000, costType: { category: 'labor', name: 'Housekeeping wages' } },
        ],
        occupiedRooms: 2,
      });

      const kpi = await service.getSnapshot(TENANT, PROPERTY, DAY);

      expect(kpi.totalCost).toBe(3000);
      expect(kpi.materialCost).toBe(2000);
      expect(kpi.laborCost).toBe(1000);
      expect(kpi.grossProfit).toBe(7000);
      expect(kpi.gopPercent).toBe(70);
      // ต้นทุนต่อห้องที่ขายได้ยังหารด้วยห้องที่มีคนพัก — เป็นตัวเลขฝั่งปฏิบัติการ
      expect(kpi.costPOR).toBe(1500);
    });
  });

  describe('วันที่ของ snapshot', () => {
    it('เก็บเป็นเที่ยงคืน UTC ของวันไทย ไม่ใช่เที่ยงคืนของเครื่อง', async () => {
      const { service, created } = makeService([roomRow('bk-1', 9000)]);

      const snapshot = await service.generateDailySnapshot(TENANT, {
        propertyId: PROPERTY,
        snapshotDate: DAY,
      });

      expect(created[0].snapshotDate).toEqual(utcMidnight(DAY));
      // อ่านกลับได้วันเดิม — เดิมเลื่อนไปหนึ่งวันบนเครื่องที่ตั้งเวลาไทย
      expect(snapshot.snapshotDate).toBe(DAY);
      expect(snapshot.roomRevenue).toBe(9000);
    });

    it('หาแถวเดิมด้วยขอบวันเดียวกับที่เขียน ไม่งั้นจะสร้างซ้ำทุกวัน', async () => {
      const { service, prisma } = makeService([roomRow('bk-1', 9000)]);

      await service.generateDailySnapshot(TENANT, { propertyId: PROPERTY, snapshotDate: DAY });

      expect(prisma.costKpiSnapshot.findFirst).toHaveBeenCalledWith({
        where: {
          tenantId: TENANT,
          propertyId: PROPERTY,
          snapshotDate: utcMidnight(DAY),
          granularity: 'daily',
        },
      });
    });

    it('มีแถวของวันนั้นอยู่แล้วให้ทับ ไม่สร้างใบใหม่', async () => {
      const { service, prisma } = makeService([roomRow('bk-1', 9000)], {
        existingSnapshot: { id: 'snap-1' },
      });

      await service.generateDailySnapshot(TENANT, { propertyId: PROPERTY, snapshotDate: DAY });

      expect(prisma.costKpiSnapshot.create).not.toHaveBeenCalled();
      expect(prisma.costKpiSnapshot.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'snap-1' } }),
      );
    });

    it('getSnapshot อ่านแถวของวันไทยที่ขอ', async () => {
      const { service, prisma } = makeService([]);

      await service.getSnapshot(TENANT, PROPERTY, DAY);

      expect(prisma.costKpiSnapshot.findFirst).toHaveBeenCalledWith({
        where: {
          tenantId: TENANT,
          propertyId: PROPERTY,
          snapshotDate: utcMidnight(DAY),
          granularity: 'daily',
        },
      });
    });

    it('ไม่มีแถวเก็บไว้ก็คำนวณสดจากสมุดให้ ไม่ต้องรอ job', async () => {
      const { service, revenue } = makeService([roomRow('bk-1', 9000)]);

      const kpi = await service.getSnapshot(TENANT, PROPERTY, DAY);

      expect(revenue.totalsOfMany).toHaveBeenCalled();
      expect(kpi.roomRevenue).toBe(9000);
      expect(kpi.id).toBeUndefined();
    });
  });
});
