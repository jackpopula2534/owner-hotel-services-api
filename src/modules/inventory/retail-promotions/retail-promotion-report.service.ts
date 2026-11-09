import { BadRequestException, Injectable } from '@nestjs/common';
import { RetailSaleStatus } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { round2 } from './promotion-engine';

/** ไม่ระบุช่วง = 30 วันล่าสุด */
const DEFAULT_RANGE_DAYS = 30;
/** กันรายงานช่วงยาวเกินจนกิน DB — ปีละครั้งพอสำหรับหน้าจอ */
const MAX_RANGE_DAYS = 366;

export interface PromoReportTotals {
  /** บิลที่ใช้โปรและยังไม่ถูกยกเลิก */
  bills: number;
  /** ยอดขายสุทธิของบิลเหล่านั้น (หลังส่วนลด รวม VAT) */
  salesTotal: number;
  discountTotal: number;
  giftCostTotal: number;
  /** ชิ้นของแถมที่แจกออกไป */
  giftQty: number;
  /** บิลที่ใช้โปรแล้วถูกยกเลิกภายหลัง (ไม่นับในยอดข้างบน) */
  voidedBills: number;
}

export interface PromoReportRow extends PromoReportTotals {
  promotionId: string;
  name: string;
  status: string;
  /** สมาชิกไม่ซ้ำที่ใช้โปรนี้ */
  members: number;
  codes: Array<PromoReportTotals & { code: string }>;
}

export interface PromoReport {
  from: Date;
  to: Date;
  totals: PromoReportTotals;
  promotions: PromoReportRow[];
}

const emptyTotals = (): PromoReportTotals => ({
  bills: 0,
  salesTotal: 0,
  discountTotal: 0,
  giftCostTotal: 0,
  giftQty: 0,
  voidedBills: 0,
});

/** แถวโค้ดของโปรอัตโนมัติ (ไม่มีโค้ด) */
export const AUTO_CODE_LABEL = '(อัตโนมัติ)';

/**
 * รายงานโปรโมชั่น ต่อโปร/ต่อโค้ด — อ่านจาก redemption (1 แถว/โปร/บิล ซึ่งเก็บส่วนลด+ต้นทุนของแถมของโปรนั้น)
 * คู่กับสถานะใบเสร็จ บิลที่ถูกยกเลิกหลุดออกจากยอดทันที
 * ยอดขาย (salesTotal) ของแต่ละโปร = ยอดบิลที่โปรนั้นร่วมอยู่ — บิลมีสองโปรนับในทั้งสองแถว ยอดรวมทั้งรายงานนับครั้งเดียว
 */
@Injectable()
export class RetailPromotionReportService {
  constructor(private readonly prisma: PrismaService) {}

  async report(tenantId: string, query: { from?: string; to?: string; promotionId?: string }): Promise<PromoReport> {
    const { from, to } = this.range(query.from, query.to);
    // 1 แถว = 1 โปรใน 1 บิล (บิลเดียวมีได้หลายโปร: โค้ด 1 + โปรอัตโนมัติ) — สร้างพร้อมใบเสร็จในทรานแซกชันเดียว
    const redemptions = await this.prisma.retailPromotionRedemption.findMany({
      where: {
        tenantId,
        ...(query.promotionId ? { promotionId: query.promotionId } : {}),
        createdAt: { gte: from, lte: to },
      },
      select: {
        saleId: true,
        promotionId: true,
        code: true,
        guestId: true,
        status: true,
        discountAmount: true,
        giftCost: true,
      },
    });
    const saleIds = [...new Set(redemptions.map((r) => r.saleId))];
    const [sales, gifts] = saleIds.length
      ? await Promise.all([
          this.prisma.retailSale.findMany({
            where: { tenantId, id: { in: saleIds } },
            select: { id: true, grandTotal: true, status: true },
          }),
          this.prisma.retailSaleItem.findMany({
            where: { isGift: true, saleId: { in: saleIds }, sale: { tenantId, status: RetailSaleStatus.COMPLETED } },
            select: { saleId: true, promotionId: true, quantity: true },
          }),
        ])
      : [[], []];
    const saleById = new Map(sales.map((s) => [s.id, s]));
    const isLive = (saleId: string) => saleById.get(saleId)?.status === RetailSaleStatus.COMPLETED;

    const codeKey = (promotionId: string, code: string | null) => `${promotionId}:${code ?? AUTO_CODE_LABEL}`;
    const codes = new Map<string, PromoReportTotals & { promotionId: string; code: string }>();
    const codeRow = (promotionId: string, code: string | null) => {
      const key = codeKey(promotionId, code);
      const existing = codes.get(key);
      if (existing) return existing;
      const created = { ...emptyTotals(), promotionId, code: code ?? AUTO_CODE_LABEL };
      codes.set(key, created);
      return created;
    };

    const codeOfSalePromo = new Map<string, string | null>();
    const memberSets = new Map<string, Set<string>>();
    const grand = emptyTotals();
    const liveSales = new Set<string>();
    const voidedSales = new Set<string>();
    for (const r of redemptions) {
      codeOfSalePromo.set(`${r.saleId}:${r.promotionId}`, r.code);
      const row = codeRow(r.promotionId, r.code);
      if (!isLive(r.saleId)) {
        row.voidedBills += 1;
        voidedSales.add(r.saleId);
        continue;
      }
      row.bills += 1;
      row.salesTotal += Number(saleById.get(r.saleId)?.grandTotal ?? 0);
      row.discountTotal += Number(r.discountAmount);
      row.giftCostTotal += Number(r.giftCost);
      grand.discountTotal += Number(r.discountAmount);
      grand.giftCostTotal += Number(r.giftCost);
      liveSales.add(r.saleId);
      if (r.guestId) {
        const set = memberSets.get(r.promotionId) ?? new Set<string>();
        set.add(r.guestId);
        memberSets.set(r.promotionId, set);
      }
    }
    for (const g of gifts) {
      // บรรทัดของแถมรุ่นก่อนเฟส 4 ไม่มี promotionId — บิลแบบนั้นมีโปรเดียว
      const promotionId = g.promotionId ?? redemptions.find((r) => r.saleId === g.saleId)?.promotionId;
      if (!promotionId || !codeOfSalePromo.has(`${g.saleId}:${promotionId}`)) continue;
      codeRow(promotionId, codeOfSalePromo.get(`${g.saleId}:${promotionId}`) ?? null).giftQty += g.quantity;
      grand.giftQty += g.quantity;
    }
    // ยอดรวมทั้งรายงานนับบิลละครั้ง — บิลที่มีสองโปรโผล่ในสองแถวของโปร แต่ยอดขายต้องไม่ถูกบวกซ้ำ
    grand.bills = liveSales.size;
    grand.salesTotal = [...liveSales].reduce((sum, id) => sum + Number(saleById.get(id)?.grandTotal ?? 0), 0);
    grand.voidedBills = voidedSales.size;

    const promotionIds = [...new Set(redemptions.map((r) => r.promotionId))];
    const promos = promotionIds.length
      ? await this.prisma.retailPromotion.findMany({
          where: { tenantId, id: { in: promotionIds } },
          select: { id: true, name: true, status: true },
        })
      : [];

    const promoMap = new Map(promos.map((p) => [p.id, p]));
    const rows: PromoReportRow[] = promotionIds.map((id) => {
      const codeRows = [...codes.values()]
        .filter((c) => c.promotionId === id)
        .map(({ promotionId: _omit, ...c }) => this.rounded(c))
        .sort((a, b) => b.bills - a.bills || a.code.localeCompare(b.code));
      return {
        promotionId: id,
        name: promoMap.get(id)?.name ?? '(โปรที่ถูกลบ)',
        status: promoMap.get(id)?.status ?? 'ARCHIVED',
        members: memberSets.get(id)?.size ?? 0,
        ...this.rounded(this.sum(codeRows)),
        codes: codeRows,
      };
    });
    rows.sort((a, b) => b.salesTotal - a.salesTotal || b.bills - a.bills);

    return { from, to, totals: this.rounded(grand), promotions: rows };
  }

  private range(fromRaw?: string, toRaw?: string): { from: Date; to: Date } {
    const to = toRaw ? new Date(toRaw) : new Date();
    const from = fromRaw ? new Date(fromRaw) : new Date(to.getTime() - DEFAULT_RANGE_DAYS * 86_400_000);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new BadRequestException({ code: 'INVALID_DATE_RANGE', message: 'รูปแบบวันที่ไม่ถูกต้อง' });
    }
    if (from > to) {
      throw new BadRequestException({ code: 'INVALID_DATE_RANGE', message: 'วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด' });
    }
    if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * 86_400_000) {
      throw new BadRequestException({ code: 'DATE_RANGE_TOO_LONG', message: `ดูรายงานได้ครั้งละไม่เกิน ${MAX_RANGE_DAYS} วัน` });
    }
    return { from, to };
  }

  private sum(rows: PromoReportTotals[]): PromoReportTotals {
    return rows.reduce(
      (acc, r) => ({
        bills: acc.bills + r.bills,
        salesTotal: acc.salesTotal + r.salesTotal,
        discountTotal: acc.discountTotal + r.discountTotal,
        giftCostTotal: acc.giftCostTotal + r.giftCostTotal,
        giftQty: acc.giftQty + r.giftQty,
        voidedBills: acc.voidedBills + r.voidedBills,
      }),
      emptyTotals(),
    );
  }

  private rounded<T extends PromoReportTotals>(t: T): T {
    return {
      ...t,
      salesTotal: round2(t.salesTotal),
      discountTotal: round2(t.discountTotal),
      giftCostTotal: round2(t.giftCostTotal),
    };
  }
}
