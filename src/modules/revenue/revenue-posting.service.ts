import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  Prisma,
  RevenueEntryKind,
  RevenueSegment,
  RevenueSourceModule,
  RevenueSourceType,
  RevenueType,
  SettlementType,
} from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { round2, toBangkokDate, toBusinessDate } from '@/common/utils/bangkok-day.util';

/**
 * แผนกตามผังบัญชีโรงแรม (USALI) ของรายได้แต่ละชนิด
 *
 * เป็นฟังก์ชัน ไม่ใช่ค่าที่ผู้เรียกส่งมา — ถ้าปล่อยให้ 4 ช่องทางกรอก segment เอง
 * สักวันจะมีที่หนึ่งส่ง FOOD คู่กับ OTHER_OPERATED แล้วยอด F&B หายไปจากรายงาน
 * โดยไม่มีอะไรฟ้อง ที่นี่คือที่เดียวที่ตัดสินว่า "รายได้ก้อนนี้เป็นของแผนกไหน"
 */
export const segmentOf = (
  revenueType: RevenueType,
  sourceModule: RevenueSourceModule,
): RevenueSegment => {
  switch (revenueType) {
    case RevenueType.ROOM:
      return RevenueSegment.ROOMS;
    case RevenueType.FOOD:
    case RevenueType.BEVERAGE:
      return RevenueSegment.FOOD_BEVERAGE;
    case RevenueType.RETAIL_GOODS:
      return RevenueSegment.OTHER_OPERATED;
    // ค่าบริการเกาะไปกับแผนกที่ให้บริการ — 10% ของบิลอาหารเป็นรายได้ของครัว
    // ไม่ใช่ของแผนกเบ็ดเตล็ด ไม่งั้นตัวหารของ Food Cost% จะเล็กกว่าความจริง
    case RevenueType.SERVICE_CHARGE:
      return sourceModule === RevenueSourceModule.RESTAURANT
        ? RevenueSegment.FOOD_BEVERAGE
        : sourceModule === RevenueSourceModule.HOTEL
          ? RevenueSegment.ROOMS
          : RevenueSegment.OTHER_OPERATED;
    default:
      return RevenueSegment.OTHER_OPERATED;
  }
};

/**
 * รหัสบัญชีตั้งต้นของรายได้แต่ละชนิด ใช้ตอน mirror เข้า GL (Phase 4)
 *
 * ผู้เรียกส่ง accountCode มาทับได้ เพราะบางรายการละเอียดกว่านี้ (add-on ของการจอง
 * แยก 4301–4304 ตามชนิดบริการ) ค่าตรงนี้เป็นแค่ค่าที่ถูกต้องเมื่อไม่มีใครระบุ
 */
const DEFAULT_ACCOUNT_CODE: Readonly<Record<RevenueType, string>> = Object.freeze({
  [RevenueType.ROOM]: '4101',
  [RevenueType.FOOD]: '4201',
  [RevenueType.BEVERAGE]: '4202',
  [RevenueType.RETAIL_GOODS]: '4306',
  [RevenueType.SERVICE_CHARGE]: '4305',
  [RevenueType.OTHER]: '4301',
});

/** หนึ่งชนิดรายได้บนเอกสารใบเดียว — ผู้เรียกส่งซ้ำชนิดเดิมได้ ระบบรวมยอดให้เอง */
export interface RevenueLineInput {
  revenueType: RevenueType;
  /** ยอดขายก่อนหักส่วนลด */
  grossAmount: number;
  discount?: number;
  /** snapshot หน้าบิลไว้กระทบยอด ไม่ถูกบวกเข้า netAmount */
  serviceCharge?: number;
  /** VAT เป็นหนี้สิน ไม่ใช่รายได้ — ไม่ถูกบวกเข้า netAmount */
  taxAmount?: number;
  accountCode?: string | null;
  costCenterId?: string | null;
}

export interface PostRevenueInput {
  tenantId: string;
  /** null ได้ — ลานกางเต็นท์/ร้านนอกโรงแรมไม่ผูก property */
  propertyId?: string | null;
  sourceModule: RevenueSourceModule;
  sourceType: RevenueSourceType;
  /** id ของเอกสารต้นทาง คู่กับ sourceType คือกุญแจกันโพสต์ซ้ำ */
  sourceId: string;
  documentNo?: string | null;
  /** เวลาที่ปิดบิลจริง — วันธุรกิจคำนวณจากตัวนี้ตามเวลาไทย */
  occurredAt: Date;
  outletId?: string | null;
  outletName?: string | null;
  settlement: SettlementType;
  folioChargeId?: string | null;
  lines: RevenueLineInput[];
}

export interface PostedRevenue {
  entryIds: string[];
  /** วันธุรกิจที่รายได้ก้อนนี้ไปตก ('YYYY-MM-DD') */
  businessDate: string;
  /** ผลรวม netAmount ที่รายงานจะเห็น */
  netAmount: number;
  created: number;
  /** แถวเดิมที่ยอดเปลี่ยน จึงถูกเขียนทับ (เอกสารต้นทางถูกแก้แล้วโพสต์ใหม่) */
  updated: number;
  /** แถวเดิมที่ยอดเท่าเดิม — ยิงซ้ำแล้วไม่มีอะไรเปลี่ยน */
  unchanged: number;
}

export interface VoidRevenueResult {
  /** ยกเลิกในวันเดียวกับที่ขาย — ตีตกแถวเดิมทิ้ง */
  voided: number;
  /** ยกเลิกข้ามวัน — ออกแถวกลับรายการลงวันที่ยกเลิก */
  reversed: number;
  /** ยกเลิกไปแล้วก่อนหน้านี้ */
  unchanged: number;
}

/**
 * เอกสารใบนี้มีเงินให้บันทึกไหม — เรียกก่อน {@link RevenuePostingService.post} เสมอ
 *
 * `post()` จงใจโยน error เมื่อทุกบรรทัดเป็นศูนย์ เพราะเอกสารเปล่าที่หลุดเข้าสมุดคือ
 * สัญญาณว่าผู้เรียกคำนวณยอดผิด แต่เอกสารที่ยอดเป็นศูนย์ "โดยชอบ" ก็มีจริง —
 * การจองคอมพลิเมนต์ บิลที่ยกเลิกรายการหมดก่อนปิด — ตรงนั้นต้องข้ามเงียบ ๆ ไม่ใช่
 * ทำให้กดเช็คเอาต์ไม่ได้ทั้งใบ ตัวนี้คือเส้นแบ่งระหว่างสองกรณีที่ผู้เรียกทุกที่ใช้ร่วมกัน
 */
export const hasPostableRevenue = (input: PostRevenueInput): boolean =>
  (input.lines ?? []).some(
    (line) =>
      round2(line.grossAmount ?? 0) !== 0 ||
      round2(line.discount ?? 0) !== 0 ||
      round2(line.serviceCharge ?? 0) !== 0 ||
      round2(line.taxAmount ?? 0) !== 0,
  );

/** ยอดเงินทุกช่องของหนึ่งบรรทัด หลังรวมและปัดแล้ว */
interface NormalizedLine {
  revenueType: RevenueType;
  segment: RevenueSegment;
  grossAmount: number;
  discount: number;
  netAmount: number;
  serviceCharge: number;
  taxAmount: number;
  totalAmount: number;
  accountCode: string;
  costCenterId: string | null;
}

/**
 * สมุดรายได้กลาง — ทางเดียวที่รายได้จะถูกบันทึกเข้าระบบ
 *
 * ก่อนหน้านี้ไม่มีที่แบบนี้ แต่ละหน้าจอไปนับรายได้เอาเองจากตารางต้นทางที่มันรู้จัก
 * (orders / retail_sales / bookings / camp_reservations) คนละเงื่อนไขสถานะ คนละ
 * นิยามว่าวันเริ่มตรงไหน รายงาน F&B จึงขึ้น ฿2,129.40 ขณะที่ Analytics ขึ้น ฿0
 * ของเดือนเดียวกัน ตัวเลขจะตรงกันได้ก็ต่อเมื่อทุกหน้าอ่านจากแถวชุดเดียวกัน
 *
 * ตั้งใจไม่พึ่งอะไรนอกจาก Prisma เหมือน FolioPostingService — โมดูลร้านอาหาร
 * คลังสินค้า และการจอง ต้อง import ตัวนี้ได้โดยไม่ลาก add-on บัญชีมาทั้งกราฟ
 * (ผังบัญชีต้อง seed เอง และบัญชีเป็น add-on เสียเงิน ถ้าผูกกันรายได้ของ tenant
 * ที่ไม่ได้ซื้อบัญชีจะไม่ถูกบันทึกเลย)
 */
@Injectable()
export class RevenuePostingService {
  private readonly logger = new Logger(RevenuePostingService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * บันทึกรายได้ของเอกสารหนึ่งใบ — idempotent ตาม (sourceType, sourceId, revenueType)
   *
   * ยิงซ้ำกี่ครั้งก็ได้แถวเดิม ทั้ง retry ของ POS และ backfill จึงปลอดภัย
   */
  async post(input: PostRevenueInput): Promise<PostedRevenue> {
    return this.prisma.$transaction((tx) => this.postWithin(tx, input));
  }

  /**
   * เหมือน {@link post} แต่ร่วม transaction ที่ผู้เรียกเปิดไว้แล้ว
   *
   * ใช้ตัวนี้เสมอเวลาบันทึกพร้อมกับเอกสารต้นทาง — บิลปิดสำเร็จแต่รายได้ไม่ถูกบันทึก
   * คือรูเงินหายแบบเดียวกับที่ Phase 0 เพิ่งปิดไป ต้องสำเร็จหรือล้มไปด้วยกัน
   */
  async postWithin(
    tx: Prisma.TransactionClient,
    input: PostRevenueInput,
  ): Promise<PostedRevenue> {
    const { tenantId, sourceType, sourceId } = input;
    if (!tenantId) throw new BadRequestException('บันทึกรายได้ไม่ได้: ไม่มี tenantId');
    if (!sourceId) throw new BadRequestException('บันทึกรายได้ไม่ได้: ไม่มี sourceId');

    const businessDate = toBusinessDate(input.occurredAt);
    const lines = this.normalize(input);

    const result: PostedRevenue = {
      entryIds: [],
      businessDate: toBangkokDate(input.occurredAt),
      netAmount: round2(lines.reduce((sum, line) => sum + line.netAmount, 0)),
      created: 0,
      updated: 0,
      unchanged: 0,
    };

    for (const line of lines) {
      const key = {
        tenantId,
        sourceType,
        sourceId,
        revenueType: line.revenueType,
      };

      // เอกสารที่เคยกลับรายการข้ามวันไปแล้ว มีแถวติดลบคาไว้ในสมุด ถ้าปล่อยให้เขียน
      // ทับแถวเดิมได้ ยอดสุทธิจะกลายเป็นศูนย์ทั้งที่หน้าจอบอกว่าบันทึกสำเร็จ
      //
      // findFirst ไม่ใช่ findUnique ทั้งที่กุญแจนี้ unique — tenant-scope middleware
      // ห้าม findUnique บน model ที่มี tenantId เพราะมันแทรกตัวกรอง tenant ไม่ได้
      const reversal = await tx.revenueEntry.findFirst({
        where: { ...key, entryKind: RevenueEntryKind.REVERSAL },
        select: { id: true },
      });
      if (reversal) {
        throw new BadRequestException(
          `เอกสาร ${input.documentNo ?? sourceId} ถูกกลับรายการไปแล้ว จึงบันทึกรายได้ซ้ำไม่ได้ กรุณาออกเอกสารใหม่`,
        );
      }

      const existing = await tx.revenueEntry.findFirst({
        where: { ...key, entryKind: RevenueEntryKind.ORIGINAL },
      });

      const data = {
        propertyId: input.propertyId ?? null,
        businessDate,
        occurredAt: input.occurredAt,
        sourceModule: input.sourceModule,
        segment: line.segment,
        outletId: input.outletId ?? null,
        outletName: input.outletName ?? null,
        costCenterId: line.costCenterId,
        documentNo: input.documentNo ?? null,
        grossAmount: line.grossAmount,
        discount: line.discount,
        netAmount: line.netAmount,
        serviceCharge: line.serviceCharge,
        taxAmount: line.taxAmount,
        totalAmount: line.totalAmount,
        settlement: input.settlement,
        folioChargeId: input.folioChargeId ?? null,
        accountCode: line.accountCode,
      };

      if (!existing) {
        const created = await tx.revenueEntry.create({
          data: { ...key, ...data, entryKind: RevenueEntryKind.ORIGINAL },
        });
        result.entryIds.push(created.id);
        result.created += 1;
        continue;
      }

      result.entryIds.push(existing.id);

      // ยิงซ้ำที่ไม่มีอะไรเปลี่ยน (retry ของ POS) — อย่าไปแตะ updatedAt ให้เปลืองเปล่า
      const unchanged =
        existing.status === 'POSTED' &&
        Number(existing.netAmount) === line.netAmount &&
        Number(existing.totalAmount) === line.totalAmount &&
        existing.businessDate.getTime() === businessDate.getTime();
      if (unchanged) {
        result.unchanged += 1;
        continue;
      }

      if (existing.status === 'VOIDED') {
        // บิลที่เคยยกเลิกในวันเดียวกันแล้วเปิดเก็บเงินใหม่ — เป็นเรื่องปกติที่หน้าเคาน์เตอร์
        // แต่ต้องมีร่องรอยว่าแถวนี้เคยตาย เผื่อวันหนึ่งยอดไม่ตรงแล้วต้องไล่ย้อน
        this.logger.warn(
          `Revenue ${sourceType}:${sourceId}/${line.revenueType} was VOIDED and is being re-posted`,
        );
      } else if (Number(existing.netAmount) !== line.netAmount) {
        this.logger.warn(
          `Revenue ${sourceType}:${sourceId}/${line.revenueType} net changed ` +
            `${Number(existing.netAmount)} → ${line.netAmount}`,
        );
      }

      await tx.revenueEntry.update({
        where: { id: existing.id },
        data: {
          ...data,
          status: 'POSTED',
          voidedAt: null,
          voidedBy: null,
          voidReason: null,
        },
      });
      result.updated += 1;
    }

    if (result.created > 0 || result.updated > 0) {
      this.logger.log(
        `Posted ${result.netAmount} revenue for ${sourceType}:${sourceId} on ${result.businessDate} ` +
          `(${result.created} new, ${result.updated} updated, ${result.unchanged} unchanged)`,
      );
    }
    return result;
  }

  /**
   * ยกเลิกรายได้ของเอกสารหนึ่งใบ (บิลถูก void / การจองถูกยกเลิก)
   *
   * ไม่ลบแถวทิ้ง และแยกสองกรณีตามวันธุรกิจ:
   *
   * - **ยกเลิกวันเดียวกับที่ขาย** ตีสถานะแถวเดิมเป็น VOIDED — วันนั้นยังไม่ปิด
   *   ยอดยังไม่เคยถูกอ่านออกไป ถือว่าการขายไม่เคยเกิดขึ้น
   * - **ยกเลิกข้ามวัน** แถวเดิมคงสถานะ POSTED ไว้ แล้วออกแถวติดลบลงวันที่ยกเลิก
   *   เพราะยอดของเมื่อวานถูกปิดวันและถูกพิมพ์รายงานไปแล้ว ถ้าไปตีตกย้อนหลัง
   *   รายงานใบเดิมจะให้ตัวเลขคนละค่าเมื่อพิมพ์ซ้ำ — บั๊ก "ตัวเลขไม่ตรงกัน" แบบเดียว
   *   กับที่ทั้งงานนี้กำลังตามแก้
   *
   * เรียกซ้ำได้ ไม่มีอะไรให้ยกเลิกก็คืน 0 ทุกช่อง ผู้เรียกจึงเรียกดื้อ ๆ ได้เลย
   */
  async void(params: {
    tenantId: string;
    sourceType: RevenueSourceType;
    sourceId: string;
    voidedBy: string;
    reason?: string;
    /** เวลาที่ยกเลิก (ค่าเริ่มต้น = ตอนนี้) — ตัวกำหนดว่าเป็นการยกเลิกข้ามวันหรือไม่ */
    at?: Date;
  }): Promise<VoidRevenueResult> {
    return this.prisma.$transaction((tx) => this.voidWithin(tx, params));
  }

  /** เหมือน {@link void} แต่ร่วม transaction ที่ผู้เรียกเปิดไว้แล้ว */
  async voidWithin(
    tx: Prisma.TransactionClient,
    params: {
      tenantId: string;
      sourceType: RevenueSourceType;
      sourceId: string;
      voidedBy: string;
      reason?: string;
      at?: Date;
    },
  ): Promise<VoidRevenueResult> {
    const { tenantId, sourceType, sourceId, voidedBy } = params;
    const at = params.at ?? new Date();
    const voidDate = toBusinessDate(at);
    const result: VoidRevenueResult = { voided: 0, reversed: 0, unchanged: 0 };

    const originals = await tx.revenueEntry.findMany({
      where: { tenantId, sourceType, sourceId, entryKind: RevenueEntryKind.ORIGINAL },
    });

    for (const entry of originals) {
      if (entry.status === 'VOIDED') {
        result.unchanged += 1;
        continue;
      }

      if (entry.businessDate.getTime() === voidDate.getTime()) {
        await tx.revenueEntry.update({
          where: { id: entry.id },
          data: {
            status: 'VOIDED',
            voidedAt: at,
            voidedBy,
            voidReason: params.reason ?? null,
          },
        });
        result.voided += 1;
        continue;
      }

      const existingReversal = await tx.revenueEntry.findFirst({
        where: {
          tenantId,
          sourceType,
          sourceId,
          revenueType: entry.revenueType,
          entryKind: RevenueEntryKind.REVERSAL,
        },
        select: { id: true },
      });
      if (existingReversal) {
        result.unchanged += 1;
        continue;
      }

      await tx.revenueEntry.create({
        data: {
          tenantId,
          propertyId: entry.propertyId,
          businessDate: voidDate,
          occurredAt: at,
          sourceModule: entry.sourceModule,
          segment: entry.segment,
          revenueType: entry.revenueType,
          outletId: entry.outletId,
          outletName: entry.outletName,
          costCenterId: entry.costCenterId,
          sourceType,
          sourceId,
          documentNo: entry.documentNo,
          grossAmount: entry.grossAmount.negated(),
          discount: entry.discount.negated(),
          netAmount: entry.netAmount.negated(),
          serviceCharge: entry.serviceCharge.negated(),
          taxAmount: entry.taxAmount.negated(),
          totalAmount: entry.totalAmount.negated(),
          settlement: entry.settlement,
          accountCode: entry.accountCode,
          entryKind: RevenueEntryKind.REVERSAL,
          status: 'POSTED',
          reversalOfId: entry.id,
          voidedBy,
          voidReason: params.reason ?? null,
        },
      });
      result.reversed += 1;
    }

    if (result.voided > 0 || result.reversed > 0) {
      this.logger.log(
        `Voided revenue for ${sourceType}:${sourceId} ` +
          `(${result.voided} same-day, ${result.reversed} reversed)`,
      );
    }
    return result;
  }

  // ─── internals ──────────────────────────────────────────────────────────────

  /**
   * รวมบรรทัดชนิดเดียวกันเข้าด้วยกัน ปัดเศษ แล้วตรวจว่ายอดสมเหตุสมผล
   *
   * ยอมให้ผู้เรียกส่งบรรทัดซ้ำชนิดได้ เพราะฝั่ง POS จะ map จากรายการอาหารทีละจาน
   * ถ้าบังคับให้รวมมาก่อนก็แค่ย้ายโอกาสรวมผิดไปไว้ที่ผู้เรียกทั้ง 4 ที่แทน
   */
  private normalize(input: PostRevenueInput): NormalizedLine[] {
    if (!input.lines?.length) {
      throw new BadRequestException('บันทึกรายได้ไม่ได้: ไม่มีรายการรายได้');
    }

    const merged = new Map<RevenueType, NormalizedLine>();

    for (const line of input.lines) {
      const gross = round2(line.grossAmount ?? 0);
      const discount = round2(line.discount ?? 0);
      const serviceCharge = round2(line.serviceCharge ?? 0);
      const taxAmount = round2(line.taxAmount ?? 0);

      // ยอดติดลบต้องเข้าทาง void() เท่านั้น ปล่อยให้โพสต์ติดลบตรง ๆ ได้เมื่อไหร่
      // สมุดจะกลายเป็นที่ที่ใครก็ลบยอดออกได้โดยไม่มีเอกสารกลับรายการอ้างอิง
      if (gross < 0 || discount < 0 || serviceCharge < 0 || taxAmount < 0) {
        throw new BadRequestException(
          `บันทึกรายได้ไม่ได้: ยอด ${line.revenueType} ติดลบ (ยกเลิกรายการต้องใช้การกลับรายการ)`,
        );
      }
      if (discount > gross) {
        throw new BadRequestException(
          `บันทึกรายได้ไม่ได้: ส่วนลด ${discount} มากกว่ายอดขาย ${gross} ของ ${line.revenueType}`,
        );
      }

      // ไม่มีเงินขยับเลยก็ไม่ต้องมีแถว — แต่ส่วนลดเต็มจำนวน (net = 0) ยังต้องบันทึก
      // เพราะเป็นการขายที่เกิดขึ้นจริงและมีต้นทุนออกไปแล้ว
      if (gross === 0 && discount === 0 && serviceCharge === 0 && taxAmount === 0) continue;

      const existing = merged.get(line.revenueType);
      const accountCode =
        line.accountCode ?? existing?.accountCode ?? DEFAULT_ACCOUNT_CODE[line.revenueType];
      const costCenterId = line.costCenterId ?? existing?.costCenterId ?? null;

      const grossAmount = round2((existing?.grossAmount ?? 0) + gross);
      const totalDiscount = round2((existing?.discount ?? 0) + discount);
      const netAmount = round2(grossAmount - totalDiscount);
      const totalServiceCharge = round2((existing?.serviceCharge ?? 0) + serviceCharge);
      const totalTax = round2((existing?.taxAmount ?? 0) + taxAmount);

      merged.set(line.revenueType, {
        revenueType: line.revenueType,
        segment: segmentOf(line.revenueType, input.sourceModule),
        grossAmount,
        discount: totalDiscount,
        netAmount,
        serviceCharge: totalServiceCharge,
        taxAmount: totalTax,
        totalAmount: round2(netAmount + totalServiceCharge + totalTax),
        accountCode,
        costCenterId,
      });
    }

    if (merged.size === 0) {
      throw new BadRequestException('บันทึกรายได้ไม่ได้: ทุกรายการเป็นศูนย์');
    }
    return [...merged.values()];
  }
}
