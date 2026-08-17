/**
 * กติกาของสมุดรายได้กลาง
 *
 * ทั้งชุดนี้ตรึงข้อตกลงที่ทำให้ตัวเลขทุกหน้าจอตรงกันได้:
 *
 *   1. netAmount = gross − discount เท่านั้น VAT กับ service charge ห้ามปนเข้าไป
 *   2. วันธุรกิจตัดตามเวลาไทย ไม่ใช่ UTC และไม่ใช่ timezone ของเครื่อง
 *   3. ยิงซ้ำต้องไม่เกิดรายได้ซ้ำ (idempotent บน sourceType+sourceId+revenueType)
 *   4. ยกเลิกข้ามวันต้องไม่ไปแก้ยอดของวันที่ปิดไปแล้ว
 *
 * หมายเหตุ: สเปกชุดนี้ mock Prisma จึงไม่ผ่าน tenant-scope middleware และไม่แตะ
 * ข้อจำกัดจริงของ MySQL — ส่วนนั้นพิสูจน์ด้วย scripts/verify-revenue-ledger.ts
 * ที่ยิงเข้าฐานข้อมูลจริง
 */
import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma, RevenueSourceModule, RevenueType } from '@prisma/client';
import { RevenuePostingService, segmentOf } from '../revenue-posting.service';
import { PrismaService } from '@/prisma/prisma.service';

const TENANT = 'tenant-1';
const ORDER = 'order-1';
const USER = 'user-1';

/** บ่ายสามโมงครึ่งของวันที่ 14 ส.ค. เวลาไทย */
const AFTERNOON = new Date('2026-08-14T08:30:00.000Z');
/** ครึ่งชั่วโมงหลังเที่ยงคืนไทยของวันที่ 15 — UTC ยังเป็นวันที่ 14 อยู่ */
const AFTER_MIDNIGHT = new Date('2026-08-14T17:30:00.000Z');

const utcMidnight = (date: string) => new Date(`${date}T00:00:00.000Z`);

/** แถวที่เหมือนของจริงจากฐานข้อมูล — คอลัมน์เงินเป็น Prisma.Decimal ไม่ใช่ number */
function row(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'entry-1',
    tenantId: TENANT,
    propertyId: 'prop-1',
    businessDate: utcMidnight('2026-08-14'),
    occurredAt: AFTERNOON,
    sourceModule: RevenueSourceModule.RESTAURANT,
    segment: 'FOOD_BEVERAGE',
    revenueType: RevenueType.FOOD,
    outletId: 'rest-1',
    outletName: 'ห้องอาหารริมสระ',
    costCenterId: null,
    sourceType: 'ORDER',
    sourceId: ORDER,
    documentNo: 'ORD-0001',
    grossAmount: new Prisma.Decimal(500),
    discount: new Prisma.Decimal(0),
    netAmount: new Prisma.Decimal(500),
    serviceCharge: new Prisma.Decimal(50),
    taxAmount: new Prisma.Decimal(38.5),
    totalAmount: new Prisma.Decimal(588.5),
    settlement: 'CASH',
    accountCode: '4201',
    entryKind: 'ORIGINAL',
    status: 'POSTED',
    ...overrides,
  };
}

function buildPrisma() {
  const mock: any = {
    revenueEntry: {
      // ไม่มี findUnique ให้เรียก — tenant-scope middleware ห้ามใช้กับ model ที่มี
      // tenantId แล้ว throw ตอน runtime ถ้า mock มีให้ เทสต์จะเขียวทั้งที่ยิงจริงพัง
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation(({ data }: any) => ({ id: 'entry-new', ...data })),
      update: jest.fn().mockImplementation(({ data }: any) => ({ id: 'entry-1', ...data })),
    },
  };
  mock.$transaction = jest.fn((cb: any) => cb(mock));
  return mock;
}

/** ค่าที่ findFirst จะคืนตาม entryKind ที่ถูกถาม (บริการเช็ค REVERSAL ก่อนเสมอ) */
function respondByKind(mock: any, byKind: { ORIGINAL?: unknown; REVERSAL?: unknown }) {
  mock.revenueEntry.findFirst.mockImplementation(({ where }: any) =>
    Promise.resolve(byKind[where.entryKind as 'ORIGINAL' | 'REVERSAL'] ?? null),
  );
}

const ORDER_INPUT = {
  tenantId: TENANT,
  propertyId: 'prop-1',
  sourceModule: RevenueSourceModule.RESTAURANT,
  sourceType: 'ORDER' as const,
  sourceId: ORDER,
  documentNo: 'ORD-0001',
  occurredAt: AFTERNOON,
  outletId: 'rest-1',
  outletName: 'ห้องอาหารริมสระ',
  settlement: 'CASH' as const,
};

describe('RevenuePostingService', () => {
  let service: RevenuePostingService;
  let prisma: any;

  beforeEach(async () => {
    prisma = buildPrisma();
    const moduleRef = await Test.createTestingModule({
      providers: [RevenuePostingService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(RevenuePostingService);
  });

  describe('แผนกของรายได้ (USALI)', () => {
    it('ผูกชนิดรายได้เข้าแผนกตามตารางเดียว ไม่ให้ผู้เรียกกรอกเอง', () => {
      expect(segmentOf(RevenueType.ROOM, RevenueSourceModule.HOTEL)).toBe('ROOMS');
      expect(segmentOf(RevenueType.FOOD, RevenueSourceModule.RESTAURANT)).toBe('FOOD_BEVERAGE');
      expect(segmentOf(RevenueType.BEVERAGE, RevenueSourceModule.RESTAURANT)).toBe('FOOD_BEVERAGE');
      expect(segmentOf(RevenueType.RETAIL_GOODS, RevenueSourceModule.RETAIL)).toBe('OTHER_OPERATED');
      expect(segmentOf(RevenueType.OTHER, RevenueSourceModule.CAMP)).toBe('OTHER_OPERATED');
    });

    it('ค่าบริการเกาะไปกับแผนกที่ให้บริการ ไม่ตกไปอยู่แผนกเบ็ดเตล็ด', () => {
      // 10% ของบิลอาหารเป็นรายได้ F&B ถ้าหลุดไป OTHER_OPERATED ตัวหารของ
      // Food Cost% จะเล็กกว่าความจริง แล้วเปอร์เซ็นต์ต้นทุนจะดูสูงเกินจริงทุกเดือน
      expect(segmentOf(RevenueType.SERVICE_CHARGE, RevenueSourceModule.RESTAURANT)).toBe(
        'FOOD_BEVERAGE',
      );
      expect(segmentOf(RevenueType.SERVICE_CHARGE, RevenueSourceModule.HOTEL)).toBe('ROOMS');
    });
  });

  describe('post()', () => {
    it('netAmount = gross − discount และไม่กิน VAT กับ service charge เข้าไป', async () => {
      const result = await service.post({
        ...ORDER_INPUT,
        lines: [
          {
            revenueType: RevenueType.FOOD,
            grossAmount: 500,
            discount: 50,
            serviceCharge: 45,
            taxAmount: 34.65,
          },
        ],
      });

      expect(result.netAmount).toBe(450);
      const { data } = prisma.revenueEntry.create.mock.calls[0][0];
      expect(data.netAmount).toBe(450);
      expect(data.serviceCharge).toBe(45);
      expect(data.taxAmount).toBe(34.65);
      // ยอดหน้าบิล = รายได้ + ค่าบริการ + ภาษี — คนละตัวกับรายได้
      expect(data.totalAmount).toBe(529.65);
      expect(data.segment).toBe('FOOD_BEVERAGE');
      expect(data.accountCode).toBe('4201');
    });

    it('รวมบรรทัดชนิดเดียวกันให้เอง ไม่ใช่ทับกันจนยอดหาย', async () => {
      // POS map จากรายการอาหารทีละจาน จานที่สองต้องบวกเพิ่ม ไม่ใช่เขียนทับจานแรก
      const result = await service.post({
        ...ORDER_INPUT,
        lines: [
          { revenueType: RevenueType.FOOD, grossAmount: 200 },
          { revenueType: RevenueType.FOOD, grossAmount: 150, discount: 20 },
          { revenueType: RevenueType.BEVERAGE, grossAmount: 80 },
        ],
      });

      expect(prisma.revenueEntry.create).toHaveBeenCalledTimes(2);
      const byType = Object.fromEntries(
        prisma.revenueEntry.create.mock.calls.map(([{ data }]: any) => [data.revenueType, data]),
      );
      expect(byType.FOOD.grossAmount).toBe(350);
      expect(byType.FOOD.discount).toBe(20);
      expect(byType.FOOD.netAmount).toBe(330);
      expect(byType.BEVERAGE.netAmount).toBe(80);
      expect(result.netAmount).toBe(410);
    });

    it('บิลหลังเที่ยงคืนไทยตกวันใหม่ ไม่ใช่วันตาม UTC', async () => {
      // 2026-08-14T17:30Z = 15 ส.ค. 00:30 ตามเวลาไทย ยอดต้องเป็นของวันที่ 15
      const result = await service.post({
        ...ORDER_INPUT,
        occurredAt: AFTER_MIDNIGHT,
        lines: [{ revenueType: RevenueType.FOOD, grossAmount: 100 }],
      });

      expect(result.businessDate).toBe('2026-08-15');
      const { data } = prisma.revenueEntry.create.mock.calls[0][0];
      expect(data.businessDate.toISOString()).toBe('2026-08-15T00:00:00.000Z');
      // occurredAt เก็บเวลาจริงไว้ ไม่ถูกกลืนไปกับวันธุรกิจ
      expect(data.occurredAt).toBe(AFTER_MIDNIGHT);
    });

    it('ยิงซ้ำด้วยยอดเดิม ไม่สร้างแถวใหม่และไม่เขียนทับ', async () => {
      respondByKind(prisma, { ORIGINAL: row() });

      const result = await service.post({
        ...ORDER_INPUT,
        lines: [
          { revenueType: RevenueType.FOOD, grossAmount: 500, serviceCharge: 50, taxAmount: 38.5 },
        ],
      });

      expect(prisma.revenueEntry.create).not.toHaveBeenCalled();
      expect(prisma.revenueEntry.update).not.toHaveBeenCalled();
      expect(result.unchanged).toBe(1);
      expect(result.entryIds).toEqual(['entry-1']);
    });

    it('ยอดเปลี่ยน (เอกสารถูกแก้แล้วโพสต์ใหม่) เขียนทับแถวเดิม ไม่เพิ่มแถว', async () => {
      respondByKind(prisma, { ORIGINAL: row() });

      const result = await service.post({
        ...ORDER_INPUT,
        lines: [{ revenueType: RevenueType.FOOD, grossAmount: 700 }],
      });

      expect(prisma.revenueEntry.create).not.toHaveBeenCalled();
      expect(result.updated).toBe(1);
      const { where, data } = prisma.revenueEntry.update.mock.calls[0][0];
      expect(where.id).toBe('entry-1');
      expect(data.netAmount).toBe(700);
    });

    it('แถวที่เคยถูกตีตกในวันเดียวกัน เปิดเก็บเงินใหม่ได้ และกลับมาเป็น POSTED', async () => {
      respondByKind(prisma, {
        ORIGINAL: row({ status: 'VOIDED', voidedAt: AFTERNOON, voidedBy: USER }),
      });

      await service.post({
        ...ORDER_INPUT,
        lines: [{ revenueType: RevenueType.FOOD, grossAmount: 500 }],
      });

      const { data } = prisma.revenueEntry.update.mock.calls[0][0];
      expect(data.status).toBe('POSTED');
      expect(data.voidedAt).toBeNull();
      expect(data.voidReason).toBeNull();
    });

    it('เอกสารที่กลับรายการข้ามวันไปแล้ว ห้ามโพสต์ทับ', async () => {
      // ถ้าปล่อยผ่าน แถวติดลบที่คาอยู่จะหักยอดใหม่จนเหลือศูนย์ ทั้งที่จอบอกว่าสำเร็จ
      respondByKind(prisma, { REVERSAL: { id: 'entry-rev' } });

      await expect(
        service.post({
          ...ORDER_INPUT,
          lines: [{ revenueType: RevenueType.FOOD, grossAmount: 500 }],
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.revenueEntry.create).not.toHaveBeenCalled();
    });

    it('ยอดติดลบต้องเข้าทางกลับรายการ ไม่ใช่โพสต์ลบตรง ๆ', async () => {
      await expect(
        service.post({
          ...ORDER_INPUT,
          lines: [{ revenueType: RevenueType.FOOD, grossAmount: -100 }],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('ส่วนลดมากกว่ายอดขาย = ปฏิเสธ ไม่ใช่ปล่อยให้รายได้ติดลบ', async () => {
      await expect(
        service.post({
          ...ORDER_INPUT,
          lines: [{ revenueType: RevenueType.FOOD, grossAmount: 100, discount: 150 }],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('ส่วนลดเต็มจำนวนยังต้องบันทึก เพราะของออกจากคลังไปแล้ว', async () => {
      const result = await service.post({
        ...ORDER_INPUT,
        lines: [{ revenueType: RevenueType.FOOD, grossAmount: 120, discount: 120 }],
      });

      expect(prisma.revenueEntry.create).toHaveBeenCalledTimes(1);
      const { data } = prisma.revenueEntry.create.mock.calls[0][0];
      expect(data.grossAmount).toBe(120);
      expect(data.netAmount).toBe(0);
      expect(result.netAmount).toBe(0);
    });

    it('ไม่มีรายการ / ทุกช่องเป็นศูนย์ = ปฏิเสธ ไม่เก็บแถวขยะ', async () => {
      await expect(service.post({ ...ORDER_INPUT, lines: [] })).rejects.toThrow(
        BadRequestException,
      );
      await expect(
        service.post({
          ...ORDER_INPUT,
          lines: [{ revenueType: RevenueType.FOOD, grossAmount: 0 }],
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('void()', () => {
    it('ยกเลิกวันเดียวกับที่ขาย = ตีตกแถวเดิม ไม่ออกแถวใหม่', async () => {
      prisma.revenueEntry.findMany.mockResolvedValue([row()]);

      const result = await service.void({
        tenantId: TENANT,
        sourceType: 'ORDER',
        sourceId: ORDER,
        voidedBy: USER,
        reason: 'ลูกค้ายกเลิก',
        at: new Date('2026-08-14T11:00:00.000Z'),
      });

      expect(result).toEqual({ voided: 1, reversed: 0, unchanged: 0 });
      expect(prisma.revenueEntry.create).not.toHaveBeenCalled();
      const { data } = prisma.revenueEntry.update.mock.calls[0][0];
      expect(data.status).toBe('VOIDED');
      expect(data.voidedBy).toBe(USER);
      expect(data.voidReason).toBe('ลูกค้ายกเลิก');
    });

    it('ยกเลิกข้ามวัน = แถวเดิมอยู่เฉย ๆ แล้วออกแถวติดลบลงวันที่ยกเลิก', async () => {
      // ยอดของวันที่ 14 ถูกปิดวันและพิมพ์รายงานไปแล้ว ถ้าไปตีตกย้อนหลัง
      // รายงานใบเดิมจะให้ตัวเลขคนละค่าเมื่อพิมพ์ซ้ำ
      prisma.revenueEntry.findMany.mockResolvedValue([row()]);

      const result = await service.void({
        tenantId: TENANT,
        sourceType: 'ORDER',
        sourceId: ORDER,
        voidedBy: USER,
        at: new Date('2026-08-16T04:00:00.000Z'),
      });

      expect(result).toEqual({ voided: 0, reversed: 1, unchanged: 0 });
      expect(prisma.revenueEntry.update).not.toHaveBeenCalled();

      const { data } = prisma.revenueEntry.create.mock.calls[0][0];
      expect(data.entryKind).toBe('REVERSAL');
      expect(data.status).toBe('POSTED');
      expect(data.reversalOfId).toBe('entry-1');
      expect(data.businessDate.toISOString()).toBe('2026-08-16T00:00:00.000Z');
      expect(Number(data.netAmount)).toBe(-500);
      expect(Number(data.totalAmount)).toBe(-588.5);
      // มิติต้องลอกมาครบ ไม่งั้นแถวติดลบจะไปหักผิดร้าน/ผิดแผนก
      expect(data.segment).toBe('FOOD_BEVERAGE');
      expect(data.outletId).toBe('rest-1');
    });

    it('ยกเลิกซ้ำไม่เกิดแถวกลับรายการซ้ำ', async () => {
      prisma.revenueEntry.findMany.mockResolvedValue([row()]);
      prisma.revenueEntry.findFirst.mockResolvedValue({ id: 'entry-rev' });

      const result = await service.void({
        tenantId: TENANT,
        sourceType: 'ORDER',
        sourceId: ORDER,
        voidedBy: USER,
        at: new Date('2026-08-16T04:00:00.000Z'),
      });

      expect(result).toEqual({ voided: 0, reversed: 0, unchanged: 1 });
      expect(prisma.revenueEntry.create).not.toHaveBeenCalled();
    });

    it('ไม่มีอะไรให้ยกเลิกก็เรียกได้ ผู้เรียกไม่ต้องเช็คก่อน', async () => {
      const result = await service.void({
        tenantId: TENANT,
        sourceType: 'ORDER',
        sourceId: 'never-posted',
        voidedBy: USER,
      });

      expect(result).toEqual({ voided: 0, reversed: 0, unchanged: 0 });
    });

    it('ยกเลิกทุกชนิดรายได้ของบิลใบเดียวกัน ไม่ใช่แค่บรรทัดแรก', async () => {
      prisma.revenueEntry.findMany.mockResolvedValue([
        row(),
        row({ id: 'entry-2', revenueType: RevenueType.SERVICE_CHARGE }),
      ]);

      const result = await service.void({
        tenantId: TENANT,
        sourceType: 'ORDER',
        sourceId: ORDER,
        voidedBy: USER,
        at: new Date('2026-08-14T11:00:00.000Z'),
      });

      expect(result.voided).toBe(2);
    });
  });
});
