import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, RetailSaleStatus } from '@prisma/client';
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

/**
 * รายงานโปรโมชั่น ต่อโปร/ต่อโค้ด — อ่านจากใบเสร็จ (retail_sales) ซึ่งเก็บโปร/โค้ด/ส่วนลด/ต้นทุนของแถม
 * ของบิลนั้นไว้แล้ว ตัวเลขจึงตรงกับใบเสร็จทุกใบ และบิลที่ถูกยกเลิกหลุดออกจากยอดทันที
 */
@Injectable()
export class RetailPromotionReportService {
  constructor(private readonly prisma: PrismaService) {}

  async report(tenantId: string, query: { from?: string; to?: string; promotionId?: string }): Promise<PromoReport> {
    const { from, to } = this.range(query.from, query.to);
    const base: Prisma.RetailSaleWhereInput = {
      tenantId,
      promotionId: query.promotionId ? query.promotionId : { not: null },
      soldAt: { gte: from, lte: to },
    };
    const completed = { ...base, status: RetailSaleStatus.COMPLETED };

    const [byCode, voided, gifts, members] = await Promise.all([
      this.prisma.retailSale.groupBy({
        by: ['promotionId', 'promoCode'],
        where: completed,
        _count: { _all: true },
        _sum: { grandTotal: true, promoDiscount: true, promoGiftCost: true },
      }),
      this.prisma.retailSale.groupBy({
        by: ['promotionId', 'promoCode'],
        where: { ...base, status: RetailSaleStatus.VOIDED },
        _count: { _all: true },
      }),
      this.prisma.retailSaleItem.findMany({
        where: { isGift: true, sale: completed },
        select: { quantity: true, sale: { select: { promotionId: true, promoCode: true } } },
      }),
      this.prisma.retailSale.groupBy({
        by: ['promotionId', 'memberGuestId'],
        where: { ...completed, memberGuestId: { not: null } },
      }),
    ]);

    const promotionIds = [
      ...new Set([...byCode, ...voided].map((r) => r.promotionId).filter((id): id is string => !!id)),
    ];
    const promos = promotionIds.length
      ? await this.prisma.retailPromotion.findMany({
          where: { tenantId, id: { in: promotionIds } },
          select: { id: true, name: true, status: true },
        })
      : [];

    const codeKey = (promotionId: string | null, code: string | null) => `${promotionId}:${code ?? '—'}`;
    const codes = new Map<string, PromoReportTotals & { promotionId: string; code: string }>();
    const codeRow = (promotionId: string, code: string | null) => {
      const key = codeKey(promotionId, code);
      const existing = codes.get(key);
      if (existing) return existing;
      const created = { ...emptyTotals(), promotionId, code: code ?? '—' };
      codes.set(key, created);
      return created;
    };

    for (const r of byCode) {
      if (!r.promotionId) continue;
      const row = codeRow(r.promotionId, r.promoCode);
      row.bills += r._count._all;
      row.salesTotal += Number(r._sum.grandTotal ?? 0);
      row.discountTotal += Number(r._sum.promoDiscount ?? 0);
      row.giftCostTotal += Number(r._sum.promoGiftCost ?? 0);
    }
    for (const r of voided) {
      if (r.promotionId) codeRow(r.promotionId, r.promoCode).voidedBills += r._count._all;
    }
    for (const g of gifts) {
      if (g.sale.promotionId) codeRow(g.sale.promotionId, g.sale.promoCode).giftQty += g.quantity;
    }

    const memberCount = new Map<string, number>();
    for (const m of members) {
      if (m.promotionId) memberCount.set(m.promotionId, (memberCount.get(m.promotionId) ?? 0) + 1);
    }

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
        members: memberCount.get(id) ?? 0,
        ...this.rounded(this.sum(codeRows)),
        codes: codeRows,
      };
    });
    rows.sort((a, b) => b.salesTotal - a.salesTotal || b.bills - a.bills);

    return { from, to, totals: this.rounded(this.sum(rows)), promotions: rows };
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
