import { Injectable } from '@nestjs/common';
import { Prisma, RetailPromotionRedemptionStatus, RetailPromotionStatus } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import {
  audienceError,
  isRestrictedPromotion,
  jsonStringList,
  PromoCartLine,
  promoError,
  resolveGiftGrant,
  round2,
  selectStackedPromotions,
} from './promotion-engine';
import {
  EvaluatedGift,
  EvaluatedPromotion,
  PromoMember,
  RetailPromotionsService,
} from './retail-promotions.service';
import { PreviewCheckoutDto } from './dto/retail-promotion.dto';

type Db = Prisma.TransactionClient;

/** โปรหนึ่งตัวที่ได้ในบิล — จากโค้ด (1 ตัว) หรือแจกอัตโนมัติ */
export interface AppliedPromotion {
  promotion: {
    id: string;
    name: string;
    usageLimit: number | null;
    perMemberLimit: number | null;
    giftWarehouseId: string | null;
    stackable: boolean;
  };
  /** null = โปรอัตโนมัติ */
  code: { id: string; code: string; maxUses: number | null } | null;
  autoApplied: boolean;
  discount: number;
  /** ของแถมทั้งหมดของโปร พร้อมจำนวนที่แจกได้ (หักที่โปรก่อนหน้าในบิลจองไปแล้ว) */
  gifts: EvaluatedGift[];
  grantedGifts: EvaluatedGift[];
  giftSkipped: boolean;
}

export type SkippedAutoReason =
  | 'MIN_SPEND'
  | 'NO_ELIGIBLE_ITEM'
  | 'MEMBER_REQUIRED'
  | 'NOT_ELIGIBLE'
  | 'GIFT_OUT'
  | 'CODE_NOT_STACKABLE'
  | 'NOT_STACKABLE';

/** โปรอัตโนมัติที่บิลนี้ยังไม่ได้ — POS ใช้บอกลูกค้า ("ซื้ออีก ฿120 รับของแถม") */
export interface SkippedAutoPromotion {
  promotionId: string;
  name: string;
  reason: SkippedAutoReason;
  message: string;
  /** MIN_SPEND: ขาดอีกกี่บาท */
  shortBy?: number;
}

export interface PricedBill {
  member: PromoMember | null;
  applied: AppliedPromotion[];
  skipped: SkippedAutoPromotion[];
  /** ของแถมของโค้ดไม่พอ (โปรอัตโนมัติไม่นับ — ไม่พอก็แค่ไม่ได้) */
  giftShortage: boolean;
  canAcceptWithoutGift: boolean;
}

const STACK_MESSAGES: Record<'CODE_NOT_STACKABLE' | 'NOT_STACKABLE', string> = {
  CODE_NOT_STACKABLE: 'โค้ดที่ใช้อยู่ใช้ร่วมกับโปรอื่นไม่ได้',
  NOT_STACKABLE: 'ใช้ร่วมกับโปรอื่นในบิลนี้ไม่ได้',
};

/**
 * โปรทั้งบิลที่ POS: โค้ด 1 ตัว + โปรของแถมอัตโนมัติ (แผนเฟส 4)
 *
 * คิดราคาใหม่ทุกครั้งบน snapshot ของผู้เรียก — preview ใช้ prisma, การขายใช้ tx ของบิล
 * ตัวนับทุกตัว (โควตาโปร/โค้ด/ต่อสมาชิก/งบของแถม) ใช้ conditional increment
 * สองเครื่องแย่งสิทธิ์สุดท้าย ฝั่งที่แพ้ทั้งบิลย้อนกลับ
 */
@Injectable()
export class RetailPromotionCheckoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly promotions: RetailPromotionsService,
  ) {}

  async preview(dto: PreviewCheckoutDto, tenantId: string) {
    const priced = await this.priceBill(this.prisma, tenantId, {
      code: dto.code,
      guestId: dto.memberGuestId,
      lines: dto.lines,
      mode: 'preview',
    });
    return {
      member: priced.member,
      promotions: priced.applied.map((a) => ({
        promotionId: a.promotion.id,
        name: a.promotion.name,
        code: a.code?.code ?? null,
        autoApplied: a.autoApplied,
        stackable: a.promotion.stackable,
        discount: a.discount,
        gifts: a.gifts,
        grantedGifts: a.grantedGifts,
      })),
      skippedAutoPromotions: priced.skipped,
      discountTotal: round2(priced.applied.reduce((sum, a) => sum + a.discount, 0)),
      giftShortage: priced.giftShortage,
      canAcceptWithoutGift: priced.canAcceptWithoutGift,
    };
  }

  /**
   * โปรที่บิลนี้ได้ตามกติกาใช้ร่วม
   *
   * mode 'sale': ของแถมของโค้ดไม่พอ = โยน PROMO_GIFT_SHORTAGE เว้นแต่ลูกค้ายอมรับเฉพาะส่วนลด
   * mode 'preview': ไม่โยน แต่ตั้งธง giftShortage / canAcceptWithoutGift ให้ POS ถามลูกค้า
   */
  async priceBill(
    db: Db,
    tenantId: string,
    input: {
      code?: string | null;
      guestId?: string | null;
      lines: PromoCartLine[];
      mode: 'preview' | 'sale';
      acceptWithoutGift?: boolean;
    },
  ): Promise<PricedBill> {
    const member = input.guestId ? await this.promotions.resolveMember(db, tenantId, input.guestId) : null;
    const reserved = new Map<string, number>();
    const applied: AppliedPromotion[] = [];
    let giftShortage = false;
    let canAcceptWithoutGift = false;

    let evaluated: EvaluatedPromotion | null = null;
    if (input.code?.trim()) {
      evaluated = await this.promotions.evaluate(db, tenantId, {
        code: input.code,
        guestId: input.guestId,
        lines: input.lines,
      });
      const short = evaluated.gifts.filter((g) => g.availableQty < g.quantity);
      giftShortage = short.length > 0;
      canAcceptWithoutGift =
        giftShortage && (evaluated.discount > 0 || evaluated.gifts.some((g) => g.availableQty >= g.quantity));
      const granted =
        input.mode === 'sale'
          ? resolveGiftGrant(evaluated.gifts, evaluated.discount, input.acceptWithoutGift ?? false).granted
          : evaluated.gifts.filter((g) => g.availableQty >= g.quantity);
      reserve(reserved, evaluated.promotion.giftWarehouseId, granted);
      applied.push({
        promotion: evaluated.promotion,
        code: evaluated.code,
        autoApplied: false,
        discount: evaluated.discount,
        gifts: evaluated.gifts,
        grantedGifts: granted,
        giftSkipped: granted.length < evaluated.gifts.length,
      });
    }

    const { qualified, skipped } = await this.qualifyAutoPromotions(db, tenantId, member, input.lines);
    const stacked = selectStackedPromotions(
      evaluated ? { id: evaluated.promotion.id, stackable: evaluated.promotion.stackable } : null,
      qualified,
    );
    for (const { promotion, reason } of stacked.blocked) {
      skipped.push({ promotionId: promotion.id, name: promotion.name, reason, message: STACK_MESSAGES[reason] });
    }

    for (const promo of stacked.selected) {
      const gifts = (await this.promotions.evaluateGifts(db, tenantId, promo)).map((g) => ({
        ...g,
        availableQty: Math.max(g.availableQty - (reserved.get(stockKey(promo.giftWarehouseId, g.itemId)) ?? 0), 0),
      }));
      const granted = gifts.filter((g) => g.availableQty >= g.quantity);
      if (!granted.length) {
        skipped.push({ promotionId: promo.id, name: promo.name, reason: 'GIFT_OUT', message: 'ของแถมหมด' });
        continue;
      }
      reserve(reserved, promo.giftWarehouseId, granted);
      applied.push({
        promotion: {
          id: promo.id,
          name: promo.name,
          usageLimit: promo.usageLimit,
          perMemberLimit: promo.perMemberLimit,
          giftWarehouseId: promo.giftWarehouseId,
          stackable: promo.stackable,
        },
        code: null,
        autoApplied: true,
        discount: 0,
        gifts,
        grantedGifts: granted,
        giftSkipped: granted.length < gifts.length,
      });
    }

    return { member, applied, skipped, giftShortage, canAcceptWithoutGift };
  }

  /**
   * กินสิทธิ์ทุกตัวนับของทุกโปรในบิล แล้วเขียน redemption ทีละโปร
   * `discount`/`giftCost` ของแต่ละโปรคือยอดที่บิลใช้จริง (หลังตัดเพดานยอดบิล)
   */
  async recordRedemptionsWithin(
    tx: Db,
    params: {
      tenantId: string;
      userId: string;
      saleId: string;
      member: PromoMember | null;
      contactId: string | null;
      applied: Array<AppliedPromotion & { giftCost: number }>;
    },
  ): Promise<void> {
    const { tenantId, member } = params;
    for (const a of params.applied) {
      const { promotion, code } = a;
      await consume(
        () =>
          tx.retailPromotion.updateMany({
            where: {
              id: promotion.id,
              tenantId,
              ...(promotion.usageLimit != null ? { usedCount: { lt: promotion.usageLimit } } : {}),
            },
            data: { usedCount: { increment: 1 } },
          }),
        'PROMO_SOLD_OUT',
        `โปรโมชั่น "${promotion.name}" ถูกใช้ครบโควตาแล้ว`,
      );
      if (code) {
        await consume(
          () =>
            tx.retailPromoCode.updateMany({
              where: {
                id: code.id,
                tenantId,
                isActive: true,
                ...(code.maxUses != null ? { usedCount: { lt: code.maxUses } } : {}),
              },
              data: { usedCount: { increment: 1 } },
            }),
          'PROMO_CODE_USED_UP',
          'โค้ดนี้ถูกใช้ครบจำนวนแล้ว',
        );
      }
      if (member) {
        await tx.retailPromotionMemberUsage.upsert({
          where: { promotionId_guestId: { promotionId: promotion.id, guestId: member.guestId } },
          create: { tenantId, promotionId: promotion.id, guestId: member.guestId, usedCount: 0 },
          update: {},
        });
        await consume(
          () =>
            tx.retailPromotionMemberUsage.updateMany({
              where: {
                tenantId,
                promotionId: promotion.id,
                guestId: member.guestId,
                ...(promotion.perMemberLimit != null ? { usedCount: { lt: promotion.perMemberLimit } } : {}),
              },
              data: { usedCount: { increment: 1 } },
            }),
          'PROMO_MEMBER_LIMIT',
          `สมาชิกท่านนี้ใช้โปร "${promotion.name}" ครบจำนวนแล้ว`,
        );
      }
      for (const gift of a.grantedGifts) {
        await consume(
          () =>
            tx.retailPromotionGift.updateMany({
              where: {
                id: gift.giftId,
                tenantId,
                ...(gift.budgetQty != null ? { issuedQty: { lte: gift.budgetQty - gift.quantity } } : {}),
              },
              data: { issuedQty: { increment: gift.quantity } },
            }),
          'PROMO_GIFT_SHORTAGE',
          `งบของแถม "${gift.name}" หมดแล้ว`,
        );
      }

      await tx.retailPromotionRedemption.create({
        data: {
          tenantId,
          promotionId: promotion.id,
          promoCodeId: code?.id ?? null,
          code: code?.code ?? null,
          saleId: params.saleId,
          guestId: member?.guestId ?? null,
          contactId: params.contactId,
          discountAmount: round2(a.discount),
          giftCost: round2(a.giftCost),
          giftSkipped: a.giftSkipped,
          redeemedBy: params.userId,
        },
      });
    }
  }

  /**
   * บิลถูก void — คืนสิทธิ์ทุกตัวนับของทุก redemption ที่ยัง APPLIED แล้วตีเป็น REVERSED
   *
   * งบของแถมคืนตามบรรทัดของแถมจริงบนใบเสร็จ (แยกตาม promotionId ของบรรทัด) ไม่ใช่ค่าตั้งโปรปัจจุบัน
   * ตัวนับลดแบบมีเงื่อนไข `> 0` ไม่ติดลบ คืน [] = บิลไม่ได้ใช้โปร / ถูกคืนไปแล้ว
   */
  async reverseRedemptionsWithin(
    tx: Db,
    params: {
      tenantId: string;
      saleId: string;
      giftLines: Array<{ itemId: string; quantity: number; promotionId: string | null }>;
    },
  ): Promise<Array<{ redemptionId: string; promotionId: string }>> {
    const { tenantId, saleId } = params;
    const redemptions = await tx.retailPromotionRedemption.findMany({
      where: { tenantId, saleId, status: RetailPromotionRedemptionStatus.APPLIED },
    });
    const reversed: Array<{ redemptionId: string; promotionId: string }> = [];
    for (const redemption of redemptions) {
      const flipped = await tx.retailPromotionRedemption.updateMany({
        where: { id: redemption.id, tenantId, status: RetailPromotionRedemptionStatus.APPLIED },
        data: { status: RetailPromotionRedemptionStatus.REVERSED, reversedAt: new Date() },
      });
      if (flipped.count === 0) continue;

      const { promotionId, promoCodeId, guestId } = redemption;
      await tx.retailPromotion.updateMany({
        where: { id: promotionId, tenantId, usedCount: { gt: 0 } },
        data: { usedCount: { decrement: 1 } },
      });
      if (promoCodeId) {
        await tx.retailPromoCode.updateMany({
          where: { id: promoCodeId, tenantId, usedCount: { gt: 0 } },
          data: { usedCount: { decrement: 1 } },
        });
      }
      if (guestId) {
        await tx.retailPromotionMemberUsage.updateMany({
          where: { tenantId, promotionId, guestId, usedCount: { gt: 0 } },
          data: { usedCount: { decrement: 1 } },
        });
      }

      const returnedByItem = new Map<string, number>();
      for (const line of params.giftLines) {
        // บรรทัดของแถมรุ่นก่อนเฟส 4 อาจไม่มี promotionId — บิลแบบนั้นมีโปรเดียว
        if (line.promotionId && line.promotionId !== promotionId) continue;
        returnedByItem.set(line.itemId, (returnedByItem.get(line.itemId) ?? 0) + line.quantity);
      }
      for (const [itemId, quantity] of returnedByItem) {
        await tx.retailPromotionGift.updateMany({
          where: { tenantId, promotionId, itemId, issuedQty: { gte: quantity } },
          data: { issuedQty: { decrement: quantity } },
        });
      }
      reversed.push({ redemptionId: redemption.id, promotionId });
    }
    return reversed;
  }

  /**
   * โปรอัตโนมัติที่เปิดอยู่ตอนนี้ แยกเป็น "บิลเข้าเงื่อนไข" กับ "ยังไม่ได้เพราะ…"
   * โปรที่ไม่จำกัดสิทธิ์ไม่ต้องมีสมาชิก; โปรที่จำกัด tier/segment/ต่อสมาชิก ต้องผูกสมาชิก
   */
  private async qualifyAutoPromotions(db: Db, tenantId: string, member: PromoMember | null, lines: PromoCartLine[]) {
    const now = new Date();
    const promos = await db.retailPromotion.findMany({
      where: {
        tenantId,
        autoApply: true,
        status: RetailPromotionStatus.ACTIVE,
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
        ],
      },
      include: { gifts: true },
      orderBy: { createdAt: 'asc' },
    });

    const qualified: typeof promos = [];
    const skipped: SkippedAutoPromotion[] = [];
    const skip = (p: { id: string; name: string }, reason: SkippedAutoReason, message: string, shortBy?: number) =>
      skipped.push({ promotionId: p.id, name: p.name, reason, message, ...(shortBy != null ? { shortBy } : {}) });

    for (const promo of promos) {
      if (promo.usageLimit != null && promo.usedCount >= promo.usageLimit) continue;

      const eligibleItemIds = jsonStringList(promo.eligibleItemIds);
      const netSubtotal = round2(
        lines.reduce((sum, l) => sum + Math.max(l.quantity * l.unitPrice - (l.lineDiscount ?? 0), 0), 0),
      );
      const minSpend = Number(promo.minSpend);
      if (netSubtotal < minSpend) {
        const shortBy = round2(minSpend - netSubtotal);
        skip(promo, 'MIN_SPEND', `ซื้ออีก ${shortBy.toLocaleString('th-TH')} บาท รับของแถม`, shortBy);
        continue;
      }
      if (eligibleItemIds.length && !lines.some((l) => eligibleItemIds.includes(l.itemId))) {
        skip(promo, 'NO_ELIGIBLE_ITEM', 'ยังไม่มีสินค้าที่ร่วมรายการในบิล');
        continue;
      }

      const rule = {
        eligibleTiers: jsonStringList(promo.eligibleTiers),
        eligibleSegments: jsonStringList(promo.eligibleSegments),
        perMemberLimit: promo.perMemberLimit,
      };
      if (isRestrictedPromotion(rule)) {
        if (!member) {
          skip(promo, 'MEMBER_REQUIRED', 'โปรนี้สำหรับสมาชิก — ผูกสมาชิกเพื่อรับของแถม');
          continue;
        }
        const used =
          rule.perMemberLimit != null
            ? await this.promotions.memberUsedCount(db, tenantId, promo.id, member.guestId)
            : 0;
        const err = audienceError(rule, member, used);
        if (err) {
          skip(promo, 'NOT_ELIGIBLE', (err.getResponse() as { message: string }).message);
          continue;
        }
      }
      qualified.push(promo);
    }
    return { qualified, skipped };
  }
}

function stockKey(warehouseId: string | null, itemId: string): string {
  return `${warehouseId ?? '-'}:${itemId}`;
}

/** จองของแถมในบิล — โปรถัดไปที่แจกของชิ้นเดียวกันจากคลังเดียวกันเห็นสต็อกที่เหลือจริง */
function reserve(reserved: Map<string, number>, warehouseId: string | null, gifts: EvaluatedGift[]): void {
  for (const g of gifts) {
    const key = stockKey(warehouseId, g.itemId);
    reserved.set(key, (reserved.get(key) ?? 0) + g.quantity);
  }
}

async function consume(run: () => Promise<{ count: number }>, code: string, message: string): Promise<void> {
  const { count } = await run();
  if (count === 0) throw promoError(code, message);
}
