import { Injectable } from '@nestjs/common';
import {
  Prisma,
  RevenueSegment,
  RevenueSourceModule,
  RevenueSourceType,
  RevenueType,
  SettlementType,
} from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { businessDateOf, round2 } from '@/common/utils/bangkok-day.util';

/**
 * ฝั่งอ่านของสมุดรายได้ — ทางเดียวที่หน้าจอจะได้ตัวเลข "รายได้"
 *
 * `RevenuePostingService` คุมทางเข้า ตัวนี้คุมทางออก ก่อนหน้านี้แต่ละหน้าจอไปนับเอง
 * จากตารางต้นทางที่มันรู้จัก คนละเงื่อนไขสถานะ คนละนิยามว่าวันเริ่มตรงไหน
 * หน้าภาพรวมจึงบอกยอดหนึ่ง รายงานรายได้บอกอีกยอด ทั้งที่ถามคำถามเดียวกัน
 *
 * ทุกเมธอดในนี้ยึดกติกาเดียวกันหมด:
 *
 * - **นับเฉพาะแถว `POSTED`** แถว `VOIDED` คือการขายที่ถือว่าไม่เคยเกิด
 * - **บวก `netAmount` เท่านั้น** (= gross − discount) ค่าบริการกับ VAT เป็น snapshot
 *   ไว้กระทบยอด ไม่ใช่รายได้ (VAT เป็นหนี้สินที่ต้องนำส่งสรรพากร)
 * - **แถว `REVERSAL` ติดลบและถูกนับด้วย** ยอดสุทธิของช่วงจึงหักบิลที่ยกเลิกข้ามวัน
 *   ให้เองโดยไม่ต้องมีใครจำ
 * - **ช่วงวันเป็นวันธุรกิจไทยแบบรวมปลาย** `[from, to]` เทียบกับคอลัมน์ `@db.Date`
 *   ที่เก็บเป็น UTC midnight ตรง ๆ — ห้ามเอาหน้าต่างเวลาไทย (17:00 ของวันก่อน)
 *   มาเทียบ ไม่งั้นวันเพี้ยนไปหนึ่งวันแบบเงียบ ๆ
 */

/** ตัวกรองที่ทุกเมธอดรับเหมือนกัน — ช่วงวันเป็น 'YYYY-MM-DD' ตามปฏิทินไทย รวมปลายทั้งสองข้าง */
export interface RevenueFilter {
  tenantId: string;
  /** วันเริ่ม (รวมวันนี้) */
  from: string;
  /** วันจบ (รวมวันนี้) */
  to: string;
  /** null/undefined = ทุก property รวมรายการที่ไม่ผูก property (ลาน/ร้านนอกโรงแรม) */
  propertyId?: string | null;
  sourceModule?: RevenueSourceModule | RevenueSourceModule[];
  segment?: RevenueSegment | RevenueSegment[];
  revenueType?: RevenueType | RevenueType[];
  outletId?: string | string[];
  settlement?: SettlementType | SettlementType[];
}

/** ยอดเงินทุกช่องของกลุ่มหนึ่ง — ชื่อช่องตรงกับคอลัมน์ในสมุดเพื่อไล่ย้อนได้ */
export interface RevenueTotals {
  /** ยอดขายก่อนหักส่วนลด */
  gross: number;
  discount: number;
  /** gross − discount — ตัวเดียวที่เรียกว่า "รายได้" ได้ */
  net: number;
  /** snapshot ค่าบริการหน้าบิล ไม่รวมใน net (ถูกลงเป็นบรรทัด SERVICE_CHARGE ของตัวเอง) */
  serviceCharge: number;
  /** VAT — หนี้สิน ไม่ใช่รายได้ */
  tax: number;
  /** net + serviceCharge + tax = ยอดที่ลูกค้าจ่ายจริง */
  total: number;
  /** จำนวนบรรทัดในสมุด ไม่ใช่จำนวนเอกสาร (ดูที่ {@link RevenueQueryService.countDocuments}) */
  entries: number;
}

/**
 * ยอดสุทธิของเอกสารต้นทางหนึ่งใบในหนึ่งวันธุรกิจ
 *
 * ใช้ตอนหน้าจอต้องแยกยอดตามมิติที่ "ไม่ได้อยู่ในสมุด" เช่นประเภทห้องหรือช่องทางจอง
 * — เอา `sourceId` ไปต่อกับตารางต้นทางเอง แล้วยอดที่แยกได้จะรวมกลับมาเท่ากับ
 * {@link RevenueQueryService.totals} เป๊ะ ๆ เพราะมาจากแถวเดียวกัน
 */
export interface RevenueDocument extends RevenueTotals {
  /** วันธุรกิจไทยรูปแบบ 'YYYY-MM-DD' */
  businessDate: string;
  sourceType: RevenueSourceType;
  sourceId: string;
}

/** ยอดของหนึ่งกลุ่ม เช่นหนึ่งวัน หนึ่งช่องทาง หนึ่งร้าน */
export interface RevenueGroup extends RevenueTotals {
  /** ค่าของมิติที่จัดกลุ่ม — วันเป็น 'YYYY-MM-DD', enum เป็นชื่อ enum, outlet เป็น id */
  key: string;
  /** ชื่อร้าน/ลาน ณ วันขาย (มีเฉพาะตอนจัดกลุ่มตาม outlet) */
  label?: string;
}

const ZERO: RevenueTotals = {
  gross: 0,
  discount: 0,
  net: 0,
  serviceCharge: 0,
  tax: 0,
  total: 0,
  entries: 0,
};

/** มิติที่จัดกลุ่มได้ — ตรงกับคอลัมน์จริงในสมุด ผู้เรียกจึงส่งชื่อมั่วไม่ได้ */
type GroupDimension =
  | 'businessDate'
  | 'sourceModule'
  | 'segment'
  | 'revenueType'
  | 'settlement'
  | 'outletId'
  | 'accountCode';

/** ผลรวมที่ Prisma คืนมาจาก `_sum` — ทุกช่องเป็น null ได้เมื่อไม่มีแถวเข้าเงื่อนไข */
type SumShape = {
  grossAmount: Prisma.Decimal | null;
  discount: Prisma.Decimal | null;
  netAmount: Prisma.Decimal | null;
  serviceCharge: Prisma.Decimal | null;
  taxAmount: Prisma.Decimal | null;
  totalAmount: Prisma.Decimal | null;
};

const SUM_SELECT = {
  grossAmount: true,
  discount: true,
  netAmount: true,
  serviceCharge: true,
  taxAmount: true,
  totalAmount: true,
} as const;

const num = (value: Prisma.Decimal | null | undefined): number => round2(Number(value ?? 0));

const totalsOf = (sum: SumShape | undefined, entries: number): RevenueTotals => ({
  gross: num(sum?.grossAmount),
  discount: num(sum?.discount),
  net: num(sum?.netAmount),
  serviceCharge: num(sum?.serviceCharge),
  tax: num(sum?.taxAmount),
  total: num(sum?.totalAmount),
  entries,
});

/** ค่าเดียวหรือหลายค่าก็ได้ → เงื่อนไข Prisma ที่ถูกต้อง (undefined = ไม่กรอง) */
const oneOrMany = <T>(value: T | T[] | undefined): T | { in: T[] } | undefined => {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? { in: value } : value;
};

@Injectable()
export class RevenueQueryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * เงื่อนไข `where` ที่ทุกคำถามใช้ร่วมกัน
   *
   * เป็น public เพราะบางหน้าจอต้องนับเอกสารด้วยเงื่อนไขเดียวกันเป๊ะ ๆ แต่ไปนับจาก
   * มุมอื่น การให้ประกอบ where เองแปลว่าจะมีคนลืมกรอง `status: POSTED` สักวัน
   */
  where(filter: RevenueFilter): Prisma.RevenueEntryWhereInput {
    const where: Prisma.RevenueEntryWhereInput = {
      tenantId: filter.tenantId,
      status: 'POSTED',
      businessDate: {
        gte: businessDateOf(filter.from),
        lte: businessDateOf(filter.to),
      },
    };

    // ระบุ property = ดูเฉพาะโรงแรมหลังนั้น รายการที่ไม่ผูก property (ลานกางเต็นท์
    // ร้านนอกโรงแรม) จึงหลุดออกไปโดยตั้งใจ — ไม่มีทางรู้ว่ามันอยู่หลังไหน
    if (filter.propertyId) where.propertyId = filter.propertyId;

    const sourceModule = oneOrMany(filter.sourceModule);
    if (sourceModule !== undefined) where.sourceModule = sourceModule;

    const segment = oneOrMany(filter.segment);
    if (segment !== undefined) where.segment = segment;

    const revenueType = oneOrMany(filter.revenueType);
    if (revenueType !== undefined) where.revenueType = revenueType;

    const outletId = oneOrMany(filter.outletId);
    if (outletId !== undefined) where.outletId = outletId;

    const settlement = oneOrMany(filter.settlement);
    if (settlement !== undefined) where.settlement = settlement;

    return where;
  }

  /** ยอดรวมของช่วง — คำถามพื้นฐานที่สุด "ช่วงนี้ได้เงินเท่าไหร่" */
  async totals(filter: RevenueFilter): Promise<RevenueTotals> {
    const result = await this.prisma.revenueEntry.aggregate({
      where: this.where(filter),
      _sum: SUM_SELECT,
      _count: { _all: true },
    });
    return totalsOf(result._sum, result._count._all);
  }

  /** ยอดรายวัน เรียงตามวัน — เฉพาะวันที่มีรายการ ผู้เรียกเติมวันว่างเองตามรูปแบบกราฟ */
  async byDay(filter: RevenueFilter): Promise<RevenueGroup[]> {
    return this.group('businessDate', filter);
  }

  /** ยอดแยกตามช่องทางธุรกิจ (โรงแรม / ร้านอาหาร / ร้านค้า / ลานกางเต็นท์) */
  async byModule(filter: RevenueFilter): Promise<RevenueGroup[]> {
    return this.group('sourceModule', filter);
  }

  /** ยอดแยกตามแผนก USALI (ROOMS / FOOD_BEVERAGE / OTHER_OPERATED) */
  async bySegment(filter: RevenueFilter): Promise<RevenueGroup[]> {
    return this.group('segment', filter);
  }

  /** ยอดแยกตามชนิดรายได้ — ละเอียดกว่าแผนก ใช้แยกอาหาร/เครื่องดื่มเพื่อคิดต้นทุน */
  async byRevenueType(filter: RevenueFilter): Promise<RevenueGroup[]> {
    return this.group('revenueType', filter);
  }

  /** ยอดแยกตามช่องทางรับชำระ — ใช้กระทบยอดกับลิ้นชักและบัญชีธนาคาร */
  async bySettlement(filter: RevenueFilter): Promise<RevenueGroup[]> {
    return this.group('settlement', filter);
  }

  /** ยอดแยกตามหน้าร้าน (ร้านอาหาร/คลัง/ลาน) พร้อมชื่อ ณ วันขาย */
  async byOutlet(filter: RevenueFilter): Promise<RevenueGroup[]> {
    const rows = await this.prisma.revenueEntry.groupBy({
      by: ['outletId', 'outletName'],
      where: this.where(filter),
      _sum: SUM_SELECT,
      _count: { _all: true },
    });

    // ร้านเดียวกันอาจมีหลายชื่อถ้าเคยเปลี่ยนชื่อกลางช่วง — รวมเป็นแถวเดียว
    // แล้วใช้ชื่อที่ทำยอดได้มากที่สุดเป็นตัวแทน ไม่ใช่ชื่อที่ groupBy คืนมาก่อน
    const merged = new Map<string, RevenueGroup & { labelNet: number }>();
    for (const row of rows) {
      const key = row.outletId ?? '';
      const totals = totalsOf(row._sum, row._count._all);
      const current = merged.get(key);
      if (!current) {
        merged.set(key, {
          key,
          label: row.outletName ?? undefined,
          ...totals,
          labelNet: totals.net,
        });
        continue;
      }
      merged.set(key, {
        key,
        label: totals.net > current.labelNet ? (row.outletName ?? current.label) : current.label,
        labelNet: Math.max(totals.net, current.labelNet),
        gross: round2(current.gross + totals.gross),
        discount: round2(current.discount + totals.discount),
        net: round2(current.net + totals.net),
        serviceCharge: round2(current.serviceCharge + totals.serviceCharge),
        tax: round2(current.tax + totals.tax),
        total: round2(current.total + totals.total),
        entries: current.entries + totals.entries,
      });
    }

    return [...merged.values()]
      .map(({ labelNet: _labelNet, ...group }) => group)
      .sort((a, b) => b.net - a.net);
  }

  /**
   * จำนวนเอกสารต้นทางในช่วง (บิล/ใบเสร็จ/การเข้าพัก) ไม่ใช่จำนวนบรรทัด
   *
   * บิลใบเดียวลงสมุดหลายบรรทัด (อาหาร + เครื่องดื่ม + ค่าบริการ) การเอาจำนวนบรรทัด
   * ไปหารเป็นยอดเฉลี่ยต่อบิลจึงได้ตัวเลขต่ำกว่าความจริงเสมอ
   */
  async countDocuments(filter: RevenueFilter): Promise<number> {
    const rows = await this.prisma.revenueEntry.groupBy({
      by: ['sourceType', 'sourceId'],
      where: this.where(filter),
    });
    return rows.length;
  }

  /**
   * รายเอกสารในช่วง พร้อมวันธุรกิจและยอดสุทธิ — สะพานไปยังมิติที่สมุดไม่ได้เก็บ
   *
   * รายงานที่ต้องแยกยอดตามประเภทห้องหรือช่องทางจองไม่มีทางถามสมุดตรง ๆ ได้ เพราะ
   * สมุดไม่เก็บสองมิตินั้น (และไม่ควรเก็บ — มันเป็นเรื่องของเอกสารต้นทาง) ทางที่ถูก
   * คือหยิบ `sourceId` จากที่นี่ไปอ่านตารางต้นทาง แล้วเทยอดลงถัง วิธีนี้ยอดแยกยัง
   * รวมกลับได้เท่ายอดรวมเสมอ ต่างจากการไปบวกเองจากตารางต้นทางซึ่งจะได้คนละก้อน
   * (คนละเงื่อนไขสถานะ คนละวันรับรู้)
   *
   * เอกสารใบเดียวโผล่ได้หลายแถวถ้ามันมีรายการข้ามวัน (เช่นบิลที่ถูกกลับรายการวันหลัง
   * จะมีทั้งแถวบวกวันขายและแถวลบวันยกเลิก) ผู้เรียกที่ต้องการ "จำนวนใบ" จึงต้องนับ
   * `sourceId` ที่ไม่ซ้ำ ไม่ใช่นับความยาวอาร์เรย์
   */
  async documents(filter: RevenueFilter): Promise<RevenueDocument[]> {
    const rows = await this.prisma.revenueEntry.groupBy({
      by: ['businessDate', 'sourceType', 'sourceId'],
      where: this.where(filter),
      _sum: SUM_SELECT,
      _count: { _all: true },
    });

    return rows
      .map((row) => ({
        businessDate: this.keyOf('businessDate', row.businessDate),
        sourceType: row.sourceType,
        sourceId: row.sourceId,
        ...totalsOf(row._sum, row._count._all),
      }))
      .sort((a, b) => a.businessDate.localeCompare(b.businessDate));
  }

  /**
   * ยอดของหลายช่วงในคำถามเดียว — ใช้ตอนต้องเทียบ "วันนี้ vs เมื่อวาน"
   *
   * ยิงทีละช่วงแบบขนาน ไม่ใช่ดึงทั้งสองช่วงมารวมแล้วแยกในหน่วยความจำ เพราะช่วง
   * เปรียบเทียบมักไม่ติดกัน (เดือนนี้ vs เดือนเดียวกันปีก่อน)
   */
  async totalsOfMany(filters: RevenueFilter[]): Promise<RevenueTotals[]> {
    return Promise.all(filters.map((filter) => this.totals(filter)));
  }

  /** ยอดรวมของกลุ่มที่ไม่มีแถวเลย — ไว้ให้ผู้เรียกใช้แทนการเขียนศูนย์เองทุกที่ */
  static empty(): RevenueTotals {
    return { ...ZERO };
  }

  // ─── internals ──────────────────────────────────────────────────────────────

  private async group(dimension: GroupDimension, filter: RevenueFilter): Promise<RevenueGroup[]> {
    const rows = await this.prisma.revenueEntry.groupBy({
      by: [dimension],
      where: this.where(filter),
      _sum: SUM_SELECT,
      _count: { _all: true },
    });

    return rows
      .map((row) => ({
        key: this.keyOf(dimension, (row as Record<string, unknown>)[dimension]),
        ...totalsOf(row._sum, row._count._all),
      }))
      .sort((a, b) => (dimension === 'businessDate' ? a.key.localeCompare(b.key) : b.net - a.net));
  }

  /**
   * ทำค่าของมิติให้เป็น string ที่หน้าจออ่านได้
   *
   * วันธุรกิจเป็นคอลัมน์ `@db.Date` ที่ไดรเวอร์อ่านกลับมาเป็น UTC midnight อยู่แล้ว
   * จึงตัดเอา 10 ตัวแรกได้ตรง ๆ ห้ามแปลงผ่าน `toBangkokDate` ซ้ำ เพราะจะบวก 7 ชั่วโมง
   * ทับของที่แปลงมาแล้ว วันจะเลื่อนไปข้างหน้าหนึ่งวัน
   */
  private keyOf(dimension: GroupDimension, value: unknown): string {
    if (dimension === 'businessDate') {
      return value instanceof Date ? value.toISOString().slice(0, 10) : String(value ?? '');
    }
    return value === null || value === undefined ? '' : String(value);
  }
}
