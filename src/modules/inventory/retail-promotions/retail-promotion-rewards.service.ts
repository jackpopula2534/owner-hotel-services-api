import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, RetailPromoCodeKind, RetailPromotionStatus } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { LoyaltyService } from '@/loyalty/loyalty.service';
import { audienceError, isRestrictedPromotion, jsonStringList, promoError, randomPromoCode } from './promotion-engine';
import { RetailPromotionsService } from './retail-promotions.service';

type Db = Prisma.TransactionClient;

/** โค้ดที่ได้จากการแลกแต้มใช้ได้ไม่เกิน 30 วัน (หรือถึงวันจบโปร ถ้าเร็วกว่า) */
export const POINTS_CODE_VALID_DAYS = 30;
const POINTS_CODE_PREFIX = 'PT-';
const POINTS_REDEEM_REASON = 'retail_promo_code';
const MAX_CODE_ATTEMPTS = 5;

/**
 * แลกแต้มสะสมเป็นโค้ดโปรร้านค้า (แผนเฟส 4)
 *
 * โปรที่ตั้ง `pointsCost` = ของรางวัล สมาชิกแลกได้ที่ POS → ได้โค้ด UNIQUE ใช้ครั้งเดียว ผูกกับตัวเอง
 * หักแต้มกับออกโค้ดอยู่ใน transaction เดียว — แต้มไม่พอ (หรือแลกพร้อมกันสองเครื่อง) ไม่มีโค้ดค้าง
 * แต้มสะสมตลอดชีพไม่ลดตอนแลก → tier ไม่ตก
 */
@Injectable()
export class RetailPromotionRewardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly promotions: RetailPromotionsService,
    private readonly loyalty: LoyaltyService,
  ) {}

  /** แต้มของสมาชิก + ของรางวัลที่แลกได้ตอนนี้ + โค้ดจากแต้มที่ยังไม่ได้ใช้ */
  async listRewards(tenantId: string, guestId: string) {
    const member = await this.promotions.resolveMember(this.prisma, tenantId, guestId);
    const now = new Date();
    const [account, promos, codes] = await Promise.all([
      this.prisma.loyaltyPoint.findFirst({ where: { tenantId, guestId } }),
      this.prisma.retailPromotion.findMany({
        where: { tenantId, ...activeWindow(now), pointsCost: { not: null }, autoApply: false },
        orderBy: { pointsCost: 'asc' },
      }),
      this.prisma.retailPromoCode.findMany({
        where: {
          tenantId,
          issuedToGuestId: guestId,
          pointsSpent: { not: null },
          isActive: true,
          usedCount: 0,
          OR: [{ expiresAt: null }, { expiresAt: { gte: now } }],
        },
        include: { promotion: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    const points = account?.points ?? 0;

    const rewards = [];
    for (const p of promos) {
      if (p.usageLimit != null && p.usedCount >= p.usageLimit) continue;
      const rule = {
        eligibleTiers: jsonStringList(p.eligibleTiers),
        eligibleSegments: jsonStringList(p.eligibleSegments),
        perMemberLimit: p.perMemberLimit,
      };
      const used = isRestrictedPromotion(rule)
        ? await this.promotions.memberUsedCount(this.prisma, tenantId, p.id, guestId)
        : 0;
      if (audienceError(rule, member, used)) continue;
      rewards.push({
        promotionId: p.id,
        name: p.name,
        description: p.description,
        discountType: p.discountType,
        discountValue: Number(p.discountValue),
        maxDiscount: p.maxDiscount != null ? Number(p.maxDiscount) : null,
        minSpend: Number(p.minSpend),
        pointsCost: p.pointsCost as number,
        affordable: points >= (p.pointsCost as number),
        endsAt: p.endsAt,
      });
    }

    return {
      member,
      points,
      lifetimePoints: account?.lifetimePoints ?? 0,
      tier: account?.tier ?? 'standard',
      rewards,
      codes: codes.map((c) => ({
        id: c.id,
        code: c.code,
        promotionId: c.promotionId,
        promotionName: c.promotion.name,
        pointsSpent: c.pointsSpent,
        expiresAt: c.expiresAt,
        issuedAt: c.createdAt,
      })),
    };
  }

  /** หักแต้ม → ออกโค้ด UNIQUE ให้สมาชิก (ใช้ในบิลนี้ได้ทันที) */
  async redeemPoints(tenantId: string, userId: string, promotionId: string, guestId: string) {
    return this.prisma.$transaction(async (tx) => {
      const member = await this.promotions.resolveMember(tx, tenantId, guestId);
      const now = new Date();
      const promo = await tx.retailPromotion.findFirst({ where: { id: promotionId, tenantId } });
      if (!promo) throw new NotFoundException('ไม่พบโปรโมชั่น');
      if (promo.pointsCost == null || promo.autoApply) {
        throw promoError('PROMO_NOT_REWARD', `โปรโมชั่น "${promo.name}" แลกด้วยแต้มไม่ได้`);
      }
      if (
        promo.status !== RetailPromotionStatus.ACTIVE ||
        (promo.startsAt && promo.startsAt > now) ||
        (promo.endsAt && promo.endsAt < now)
      ) {
        throw promoError('PROMO_NOT_ACTIVE', `โปรโมชั่น "${promo.name}" ไม่ได้เปิดให้แลกตอนนี้`);
      }
      if (promo.usageLimit != null && promo.usedCount >= promo.usageLimit) {
        throw promoError('PROMO_SOLD_OUT', `โปรโมชั่น "${promo.name}" ถูกใช้ครบโควตาแล้ว`);
      }
      const rule = {
        eligibleTiers: jsonStringList(promo.eligibleTiers),
        eligibleSegments: jsonStringList(promo.eligibleSegments),
        perMemberLimit: promo.perMemberLimit,
      };
      const err = audienceError(rule, member, await this.promotions.memberUsedCount(tx, tenantId, promo.id, guestId));
      if (err) throw err;

      const validUntil = new Date(now.getTime() + POINTS_CODE_VALID_DAYS * 86_400_000);
      const expiresAt = promo.endsAt && promo.endsAt < validUntil ? promo.endsAt : validUntil;
      const code = await tx.retailPromoCode.create({
        data: {
          tenantId,
          promotionId: promo.id,
          code: await this.freshCode(tx, tenantId),
          kind: RetailPromoCodeKind.UNIQUE,
          maxUses: 1,
          issuedToGuestId: guestId,
          expiresAt,
          pointsSpent: promo.pointsCost,
        },
      });
      const balance = await this.loyalty.redeemWithin(tx, {
        tenantId,
        guestId,
        points: promo.pointsCost,
        reason: POINTS_REDEEM_REASON,
        metadata: { promotionId: promo.id, promoCodeId: code.id, code: code.code, redeemedBy: userId },
      });

      return {
        code: {
          id: code.id,
          code: code.code,
          promotionId: promo.id,
          promotionName: promo.name,
          pointsSpent: promo.pointsCost,
          expiresAt: code.expiresAt,
        },
        points: balance.balance,
        lifetimePoints: balance.lifetimePoints,
        tier: balance.tier,
      };
    });
  }

  private async freshCode(tx: Db, tenantId: string): Promise<string> {
    for (let i = 0; i < MAX_CODE_ATTEMPTS; i += 1) {
      const code = `${POINTS_CODE_PREFIX}${randomPromoCode(8)}`;
      const taken = await tx.retailPromoCode.findFirst({ where: { tenantId, code }, select: { id: true } });
      if (!taken) return code;
    }
    throw promoError('PROMO_CODE_GENERATION_FAILED', 'สร้างโค้ดไม่สำเร็จ ลองใหม่อีกครั้ง');
  }
}

function activeWindow(now: Date): Prisma.RetailPromotionWhereInput {
  return {
    status: RetailPromotionStatus.ACTIVE,
    AND: [
      { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
      { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
    ],
  };
}
