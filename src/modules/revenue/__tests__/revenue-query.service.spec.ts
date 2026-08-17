/**
 * ฝั่งอ่านของสมุดรายได้ — กติกาที่ทุกหน้าจอในเฟส 3 พึ่งพา
 *
 * สเปกชุดนี้ตรึงสี่ข้อที่ถ้าหลุดไปข้อเดียว หน้าจอสองหน้าจะรายงานคนละยอดทันที:
 *
 *   1. นับเฉพาะแถว `POSTED` — แถวที่ถูกยกเลิกทิ้ง (`VOIDED`) ต้องหายไปทั้งใบ
 *   2. บวก `netAmount` เท่านั้น ค่าบริการกับ VAT อยู่คนละช่อง ห้ามไหลเข้า net
 *   3. ช่วงวันเป็นวันธุรกิจไทยแบบ **รวมปลายทั้งสองข้าง** เทียบกับคอลัมน์ `@db.Date`
 *      ที่เก็บเป็นเที่ยงคืน UTC — ห้ามเลื่อนเพราะโซนเวลาของเครื่อง
 *   4. "จำนวนเอกสาร" คือจำนวนบิล ไม่ใช่จำนวนบรรทัดในสมุด
 *
 * Prisma ถูกแทนที่ด้วยเครื่องค้นหาจิ๋วที่ทำตาม `where` ที่เซอร์วิสส่งมาจริง ๆ ไม่ใช่
 * ค่าที่เตรียมไว้ล่วงหน้า สเปกจึงจับได้เมื่อ `where()` ลืมกรองอะไรบางอย่างไป
 * (mock Prisma ไม่ผ่าน tenant-scope middleware — ส่วนนั้นพิสูจน์ด้วย
 * scripts/verify-revenue-ledger.ts ที่ยิงเข้าฐานข้อมูลจริง)
 */
import {
  Prisma,
  RevenueSegment,
  RevenueSourceModule,
  RevenueSourceType,
  RevenueType,
  SettlementType,
} from '@prisma/client';
import { RevenueQueryService } from '../revenue-query.service';
import { PrismaService } from '@/prisma/prisma.service';

const TENANT = 'tenant-1';
const OTHER_TENANT = 'tenant-2';
const PROPERTY = 'prop-1';

const utcMidnight = (date: string) => new Date(`${date}T00:00:00.000Z`);

type MoneyField =
  | 'grossAmount'
  | 'discount'
  | 'netAmount'
  | 'serviceCharge'
  | 'taxAmount'
  | 'totalAmount';

const MONEY_FIELDS: MoneyField[] = [
  'grossAmount',
  'discount',
  'netAmount',
  'serviceCharge',
  'taxAmount',
  'totalAmount',
];

interface LedgerRow {
  tenantId: string;
  propertyId: string | null;
  businessDate: Date;
  status: string;
  sourceModule: RevenueSourceModule;
  segment: RevenueSegment;
  revenueType: RevenueType;
  settlement: SettlementType | null;
  outletId: string | null;
  outletName: string | null;
  accountCode: string | null;
  sourceType: RevenueSourceType;
  sourceId: string;
  grossAmount: number;
  discount: number;
  netAmount: number;
  serviceCharge: number;
  taxAmount: number;
  totalAmount: number;
}

/**
 * หนึ่งบรรทัดในสมุด — ระบุแค่ที่ต่างจากค่าเริ่มต้น
 *
 * `amount` เติม gross/net/total พร้อมกัน ซึ่งคือหน้าตาของการขายที่ไม่มีส่วนลด
 * ไม่มีค่าบริการ และไม่มี VAT
 */
function row(
  overrides: Partial<LedgerRow> & { amount?: number } = {},
): LedgerRow {
  const { amount = 0, ...rest } = overrides;
  return {
    tenantId: TENANT,
    propertyId: PROPERTY,
    businessDate: utcMidnight('2026-08-14'),
    status: 'POSTED',
    sourceModule: RevenueSourceModule.RESTAURANT,
    segment: RevenueSegment.FOOD_BEVERAGE,
    revenueType: RevenueType.FOOD,
    settlement: SettlementType.CASH,
    outletId: 'rest-1',
    outletName: 'ห้องอาหารริมสระ',
    accountCode: '4201',
    sourceType: RevenueSourceType.ORDER,
    sourceId: 'order-1',
    grossAmount: amount,
    discount: 0,
    netAmount: amount,
    serviceCharge: 0,
    taxAmount: 0,
    totalAmount: amount,
    ...rest,
  };
}

/** เทียบค่าเดียว/หลายค่า/ช่วง ให้เหมือนที่ Prisma ตีความ `where` */
function matchesCondition(value: unknown, condition: unknown): boolean {
  if (condition === undefined) return true;
  if (condition !== null && typeof condition === 'object' && !(condition instanceof Date)) {
    const clause = condition as Record<string, unknown>;
    if ('in' in clause) return (clause.in as unknown[]).includes(value);
    let ok = true;
    if (clause.gte instanceof Date) ok = ok && (value as Date).getTime() >= clause.gte.getTime();
    if (clause.lte instanceof Date) ok = ok && (value as Date).getTime() <= clause.lte.getTime();
    return ok;
  }
  return value === condition;
}

const matches = (entry: LedgerRow, where: Record<string, unknown>): boolean =>
  Object.entries(where).every(([field, condition]) =>
    matchesCondition((entry as unknown as Record<string, unknown>)[field], condition),
  );

/** ผลรวมหน้าตาเหมือนที่ Prisma คืน — ทุกช่องเป็น null เมื่อไม่มีแถวเข้าเงื่อนไข */
function sumOf(rows: LedgerRow[]): Record<MoneyField, Prisma.Decimal | null> {
  const empty = Object.fromEntries(MONEY_FIELDS.map((field) => [field, null])) as Record<
    MoneyField,
    Prisma.Decimal | null
  >;
  if (rows.length === 0) return empty;

  return Object.fromEntries(
    MONEY_FIELDS.map((field) => [
      field,
      new Prisma.Decimal(rows.reduce((total, entry) => total + entry[field], 0)),
    ]),
  ) as Record<MoneyField, Prisma.Decimal | null>;
}

/**
 * Prisma จิ๋วที่รู้จักแค่ตารางเดียว — ตอบตาม `where` ที่เซอร์วิสส่งมาจริง
 *
 * ถ้าเตรียมคำตอบไว้ล่วงหน้าแทน สเปกจะยังเขียวต่อไปแม้ `where()` จะลืมกรอง
 * `status: POSTED` หรือกลับด้านขอบวัน ซึ่งเป็นสองบั๊กที่แพงที่สุดของสมุดนี้
 */
function makeService(rows: LedgerRow[]) {
  const revenueEntry = {
    aggregate: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const hit = rows.filter((entry) => matches(entry, where));
      return { _sum: sumOf(hit), _count: { _all: hit.length } };
    }),
    groupBy: jest.fn(
      async ({ by, where }: { by: string[]; where: Record<string, unknown> }) => {
        const buckets = new Map<string, LedgerRow[]>();
        for (const entry of rows.filter((candidate) => matches(candidate, where))) {
          const key = by
            .map((field) => String((entry as unknown as Record<string, unknown>)[field]))
            .join('|');
          buckets.set(key, [...(buckets.get(key) ?? []), entry]);
        }
        return [...buckets.values()].map((group) => ({
          ...Object.fromEntries(
            by.map((field) => [field, (group[0] as unknown as Record<string, unknown>)[field]]),
          ),
          _sum: sumOf(group),
          _count: { _all: group.length },
        }));
      },
    ),
  };

  const prisma = { revenueEntry } as unknown as PrismaService;
  return { service: new RevenueQueryService(prisma), revenueEntry };
}

const SCOPE = { tenantId: TENANT, from: '2026-08-14', to: '2026-08-16' };

describe('RevenueQueryService', () => {
  describe('where()', () => {
    it('กรอง POSTED เสมอ และคิดขอบวันแบบรวมปลายทั้งสองข้างที่เที่ยงคืน UTC', () => {
      const { service } = makeService([]);

      const where = service.where(SCOPE);

      expect(where.status).toBe('POSTED');
      expect(where.businessDate).toEqual({
        gte: utcMidnight('2026-08-14'),
        lte: utcMidnight('2026-08-16'),
      });
      expect(where.tenantId).toBe(TENANT);
    });

    it('ไม่ระบุ property = ไม่กรอง property เพื่อให้รายการที่ไม่ผูกโรงแรมยังถูกนับ', () => {
      const { service } = makeService([]);

      expect(service.where(SCOPE)).not.toHaveProperty('propertyId');
      expect(service.where({ ...SCOPE, propertyId: null })).not.toHaveProperty('propertyId');
      expect(service.where({ ...SCOPE, propertyId: PROPERTY }).propertyId).toBe(PROPERTY);
    });

    it('ส่งหลายค่าให้กลายเป็น IN ส่งค่าเดียวให้เทียบตรง ๆ', () => {
      const { service } = makeService([]);

      const many = service.where({
        ...SCOPE,
        sourceModule: [RevenueSourceModule.HOTEL, RevenueSourceModule.RESTAURANT],
        settlement: SettlementType.CASH,
      });

      expect(many.sourceModule).toEqual({
        in: [RevenueSourceModule.HOTEL, RevenueSourceModule.RESTAURANT],
      });
      expect(many.settlement).toBe(SettlementType.CASH);
    });
  });

  describe('totals()', () => {
    it('บวกเฉพาะแถว POSTED ที่อยู่ในช่วง แถวที่ถูกยกเลิกทิ้งไม่ถูกนับ', async () => {
      const { service } = makeService([
        row({ amount: 1000, businessDate: utcMidnight('2026-08-14') }),
        row({ amount: 500, businessDate: utcMidnight('2026-08-16') }),
        // นอกช่วงหนึ่งวันพอดีทั้งสองข้าง — ต้องไม่ถูกนับ
        row({ amount: 999, businessDate: utcMidnight('2026-08-13') }),
        row({ amount: 999, businessDate: utcMidnight('2026-08-17') }),
        row({ amount: 999, status: 'VOIDED' }),
        row({ amount: 999, tenantId: OTHER_TENANT }),
      ]);

      const totals = await service.totals(SCOPE);

      expect(totals.net).toBe(1500);
      expect(totals.entries).toBe(2);
    });

    it('net = gross − ส่วนลด ค่าบริการกับ VAT อยู่คนละช่องและไปรวมที่ total', async () => {
      const { service } = makeService([
        row({
          grossAmount: 1000,
          discount: 100,
          netAmount: 900,
          serviceCharge: 90,
          taxAmount: 69.3,
          totalAmount: 1059.3,
        }),
      ]);

      const totals = await service.totals(SCOPE);

      expect(totals).toEqual({
        gross: 1000,
        discount: 100,
        net: 900,
        serviceCharge: 90,
        tax: 69.3,
        total: 1059.3,
        entries: 1,
      });
    });

    it('แถวกลับรายการติดลบถูกนับด้วย ยอดสุทธิของช่วงจึงหักบิลที่ยกเลิกข้ามวันเอง', async () => {
      const { service } = makeService([
        row({ amount: 1000, businessDate: utcMidnight('2026-08-14') }),
        row({ amount: -1000, businessDate: utcMidnight('2026-08-16') }),
      ]);

      const totals = await service.totals(SCOPE);

      expect(totals.net).toBe(0);
      expect(totals.entries).toBe(2);
    });

    it('ช่วงที่ไม่มีแถวเลยได้ศูนย์ทุกช่อง ไม่ใช่ null', async () => {
      const { service } = makeService([]);

      await expect(service.totals(SCOPE)).resolves.toEqual({
        gross: 0,
        discount: 0,
        net: 0,
        serviceCharge: 0,
        tax: 0,
        total: 0,
        entries: 0,
      });
    });

    it('ระบุ property = ตัดรายการที่ไม่ผูกโรงแรมออก ไม่ระบุ = นับรวม', async () => {
      const rows = [
        row({ amount: 1000, propertyId: PROPERTY }),
        row({ amount: 300, propertyId: null, sourceModule: RevenueSourceModule.CAMP }),
      ];

      const scoped = await makeService(rows).service.totals({ ...SCOPE, propertyId: PROPERTY });
      const all = await makeService(rows).service.totals(SCOPE);

      expect(scoped.net).toBe(1000);
      expect(all.net).toBe(1300);
    });
  });

  describe('byDay()', () => {
    it('คืนคีย์เป็นวันธุรกิจตรงตามที่เก็บ ไม่บวกเวลาไทยซ้ำ และเรียงตามวัน', async () => {
      const { service } = makeService([
        row({ amount: 200, businessDate: utcMidnight('2026-08-16'), sourceId: 'order-2' }),
        row({ amount: 100, businessDate: utcMidnight('2026-08-14') }),
      ]);

      const days = await service.byDay(SCOPE);

      expect(days.map((day) => day.key)).toEqual(['2026-08-14', '2026-08-16']);
      expect(days.map((day) => day.net)).toEqual([100, 200]);
    });
  });

  describe('bySegment() / byModule()', () => {
    it('แยกยอดตามแผนกแล้วรวมกลับได้เท่ายอดรวมของช่วง', async () => {
      const rows = [
        row({
          amount: 4000,
          sourceModule: RevenueSourceModule.HOTEL,
          segment: RevenueSegment.ROOMS,
          revenueType: RevenueType.ROOM,
          sourceType: RevenueSourceType.BOOKING,
          sourceId: 'booking-1',
        }),
        row({ amount: 600 }),
        row({ amount: 400, sourceId: 'order-2' }),
      ];
      const { service } = makeService(rows);

      const [segments, totals] = await Promise.all([
        service.bySegment(SCOPE),
        service.totals(SCOPE),
      ]);

      expect(Object.fromEntries(segments.map((group) => [group.key, group.net]))).toEqual({
        ROOMS: 4000,
        FOOD_BEVERAGE: 1000,
      });
      expect(segments.reduce((sum, group) => sum + group.net, 0)).toBe(totals.net);
    });
  });

  describe('byOutlet()', () => {
    it('ร้านที่เปลี่ยนชื่อกลางช่วงถูกยุบเป็นแถวเดียว และใช้ชื่อที่ทำยอดได้มากกว่า', async () => {
      const { service } = makeService([
        row({ amount: 300, outletId: 'rest-1', outletName: 'ชื่อเก่า' }),
        row({ amount: 700, outletId: 'rest-1', outletName: 'ชื่อใหม่', sourceId: 'order-2' }),
        row({ amount: 2000, outletId: 'rest-2', outletName: 'ห้องอาหารชั้นดาดฟ้า', sourceId: 'order-3' }),
      ]);

      const outlets = await service.byOutlet(SCOPE);

      expect(outlets).toHaveLength(2);
      // เรียงยอดมากไปน้อย
      expect(outlets[0]).toMatchObject({ key: 'rest-2', net: 2000 });
      expect(outlets[1]).toMatchObject({ key: 'rest-1', net: 1000, label: 'ชื่อใหม่' });
    });
  });

  describe('countDocuments()', () => {
    it('นับเป็นใบ ไม่ใช่บรรทัด — บิลใบเดียวที่ลงสมุดหลายบรรทัดนับหนึ่ง', async () => {
      const { service } = makeService([
        row({ amount: 600, revenueType: RevenueType.FOOD }),
        row({ amount: 400, revenueType: RevenueType.BEVERAGE }),
        row({ amount: 100, revenueType: RevenueType.SERVICE_CHARGE }),
        row({ amount: 250, sourceId: 'order-2' }),
      ]);

      const [documents, totals] = await Promise.all([
        service.countDocuments(SCOPE),
        service.totals(SCOPE),
      ]);

      expect(documents).toBe(2);
      expect(totals.entries).toBe(4);
    });

    it('ใบเดียวกันที่ปรากฏหลายวันยังนับเป็นใบเดียว', async () => {
      const { service } = makeService([
        row({ amount: 1000, businessDate: utcMidnight('2026-08-14') }),
        row({ amount: -1000, businessDate: utcMidnight('2026-08-16') }),
      ]);

      await expect(service.countDocuments(SCOPE)).resolves.toBe(1);
    });
  });

  describe('documents()', () => {
    it('รวมทุกบรรทัดของใบเดียวกันในวันเดียวกัน แล้วยอดรวมกลับเท่ากับ totals()', async () => {
      const { service } = makeService([
        row({ amount: 600, revenueType: RevenueType.FOOD }),
        row({ amount: 400, revenueType: RevenueType.BEVERAGE }),
        row({ amount: 250, sourceId: 'order-2', businessDate: utcMidnight('2026-08-16') }),
      ]);

      const [documents, totals] = await Promise.all([
        service.documents(SCOPE),
        service.totals(SCOPE),
      ]);

      expect(documents).toHaveLength(2);
      expect(documents[0]).toMatchObject({
        businessDate: '2026-08-14',
        sourceType: RevenueSourceType.ORDER,
        sourceId: 'order-1',
        net: 1000,
        entries: 2,
      });
      expect(documents.reduce((sum, doc) => sum + doc.net, 0)).toBe(totals.net);
    });

    it('ใบที่ถูกกลับรายการวันหลังโผล่สองแถว ผู้เรียกต้องนับ sourceId ที่ไม่ซ้ำเอง', async () => {
      const { service } = makeService([
        row({ amount: 1000, businessDate: utcMidnight('2026-08-14') }),
        row({ amount: -1000, businessDate: utcMidnight('2026-08-16') }),
      ]);

      const documents = await service.documents(SCOPE);

      expect(documents.map((doc) => doc.businessDate)).toEqual(['2026-08-14', '2026-08-16']);
      expect(new Set(documents.map((doc) => doc.sourceId)).size).toBe(1);
      expect(documents.reduce((sum, doc) => sum + doc.net, 0)).toBe(0);
    });
  });

  describe('totalsOfMany()', () => {
    it('ตอบทีละช่วงตามลำดับที่ถาม ช่วงที่ไม่ติดกันจึงเทียบกันได้', async () => {
      const { service, revenueEntry } = makeService([
        row({ amount: 1000, businessDate: utcMidnight('2026-08-14') }),
        row({ amount: 250, businessDate: utcMidnight('2026-08-16'), sourceId: 'order-2' }),
      ]);

      const [first, second] = await service.totalsOfMany([
        { tenantId: TENANT, from: '2026-08-14', to: '2026-08-14' },
        { tenantId: TENANT, from: '2026-08-16', to: '2026-08-16' },
      ]);

      expect(first.net).toBe(1000);
      expect(second.net).toBe(250);
      expect(revenueEntry.aggregate).toHaveBeenCalledTimes(2);
    });
  });

  describe('empty()', () => {
    it('คืนก้อนศูนย์ก้อนใหม่ทุกครั้ง ผู้เรียกแก้ค่าแล้วไม่กระทบคนอื่น', () => {
      const first = RevenueQueryService.empty();
      first.net = 999;

      expect(RevenueQueryService.empty().net).toBe(0);
    });
  });
});
