import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  AdjustPointsDto,
  EarnPointsDto,
  InviteReferralDto,
  RedeemPointsDto,
} from './dto/loyalty.dto';

export type LoyaltyTier = 'standard' | 'silver' | 'gold' | 'platinum';

type LoyaltyTxnType = 'earn' | 'redeem' | 'expire' | 'adjust';

/** Tier thresholds on lifetime earned points. Standard 0-999 · Silver 1000+ · Gold 5000+ · Platinum 10000+ */
export function tierForLifetimePoints(lifetimePoints: number): LoyaltyTier {
  if (lifetimePoints >= 10000) return 'platinum';
  if (lifetimePoints >= 5000) return 'gold';
  if (lifetimePoints >= 1000) return 'silver';
  return 'standard';
}

/** แต้มที่ได้จากยอดเงิน — 1 แต้มต่อ 100 บาท (ห้องพักและร้านค้าใช้อัตราเดียวกัน) */
export function pointsForAmount(amount: number): number {
  return Math.max(Math.floor(amount / LOYALTY_POINTS_PER_THB_DIVISOR), 0);
}

export const LOYALTY_POINTS_PER_THB_DIVISOR = 100;
/** เหตุผลบนรายการแต้มของบิลร้านค้า */
export const RETAIL_SALE_EARN_REASON = 'retail_sale';
export const RETAIL_SALE_VOID_REASON = 'retail_sale_void';

export interface PointsResult {
  guestId: string;
  tenantId: string;
  pointsDelta: number;
  balance: number;
  lifetimePoints: number;
  tier: LoyaltyTier;
  transactionId?: string;
}

@Injectable()
export class LoyaltyService {
  private readonly logger = new Logger(LoyaltyService.name);

  /** เหตุผลบนรายการดึงแต้มคืน — ใช้เป็นตัวกันดึงซ้ำด้วย */
  private static readonly CHECKOUT_UNDO_REASON = 'checkout_undo';

  constructor(private readonly prisma: PrismaService) {}

  // ──────────────────────────────────────────────────────────
  // Public read APIs
  // ──────────────────────────────────────────────────────────

  async getPoints(tenantId: string) {
    if (!tenantId) {
      return {
        id: null,
        tenantId: null,
        points: 0,
        tier: 'standard' as LoyaltyTier,
        updatedAt: new Date(),
      };
    }

    let loyalty = await this.prisma.loyaltyPoint.findFirst({
      where: { tenantId, guestId: null },
    });

    if (!loyalty) {
      loyalty = await this.prisma.loyaltyPoint.create({
        data: { tenantId, points: 0, tier: 'standard' },
      });
    }

    return loyalty;
  }

  async getGuestBalance(tenantId: string, guestId: string) {
    if (!tenantId || !guestId) {
      throw new BadRequestException('tenantId and guestId are required');
    }

    const account = await this.prisma.loyaltyPoint.findFirst({
      where: { tenantId, guestId },
    });

    return (
      account ?? {
        id: null,
        tenantId,
        guestId,
        points: 0,
        lifetimePoints: 0,
        tier: 'standard' as LoyaltyTier,
        updatedAt: new Date(),
      }
    );
  }

  async getGuestHistory(tenantId: string, guestId: string, limit = 50) {
    if (!tenantId || !guestId) {
      throw new BadRequestException('tenantId and guestId are required');
    }

    return this.prisma.loyaltyTransaction.findMany({
      where: { tenantId, guestId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 200),
    });
  }

  async inviteReferral(userId: string, tenantId: string, data: InviteReferralDto) {
    return this.prisma.referral.create({
      data: {
        referrerId: userId,
        tenantId,
        email: data.email,
        status: 'pending',
        rewardPoints: 100,
      },
    });
  }

  // ──────────────────────────────────────────────────────────
  // Mutations — earn / redeem / adjust
  // ──────────────────────────────────────────────────────────

  /**
   * Add loyalty points for a stay. Used by checkout flow.
   * 1 point per 100 THB by default (configurable via POINTS_PER_THB_DIVISOR).
   *
   * Failures are swallowed (return null) so loyalty does not block checkout.
   */
  async addPointsForStay(
    guestId: string,
    tenantId: string,
    bookingAmount: number,
    options: { bookingId?: string; reason?: string } = {},
  ): Promise<PointsResult | null> {
    try {
      if (!guestId || !tenantId) {
        this.logger.warn(
          `Skip addPointsForStay: missing guestId (${guestId}) or tenantId (${tenantId})`,
        );
        return null;
      }

      const pointsEarned = pointsForAmount(bookingAmount);
      if (pointsEarned <= 0) {
        this.logger.debug(`Booking amount ${bookingAmount} too low to earn points`);
        return null;
      }

      return await this.applyPointsDelta(tenantId, guestId, pointsEarned, 'earn', {
        bookingId: options.bookingId,
        reason: options.reason ?? 'stay_award',
      });
    } catch (error) {
      this.logger.error(
        `Failed to add loyalty points for guest ${guestId}: ${(error as Error).message}`,
      );
      return null;
    }
  }

  /**
   * ดึงแต้มที่แจกตอนเช็คเอาต์กลับ เมื่อเช็คเอาต์นั้นถูกย้อนสถานะ
   *
   * แต้มโผล่ในแอปแขกทันทีที่แจก ถ้าเช็คเอาต์ผิดคนแล้วย้อนสถานะโดยไม่ดึงแต้มคืน
   * แขกจะได้แต้มฟรีทุกครั้งที่พนักงานกดผิด และยอดแต้มคงเหลือจะเดินหนีจากยอดขายจริง
   *
   * เรียกซ้ำได้ — ถ้าเคยดึงคืนไปแล้วจะไม่ทำอะไร (คืน null) เหมือน addPointsForStay
   * ความล้มเหลวไม่โยนออกไป เพราะห้ามให้เรื่องแต้มไปบล็อกการย้อนสถานะที่หน้าเคาน์เตอร์
   */
  async reverseStayAward(
    tenantId: string,
    guestId: string,
    bookingId: string,
  ): Promise<PointsResult | null> {
    try {
      if (!tenantId || !guestId || !bookingId) return null;

      const txns = await this.prisma.loyaltyTransaction.findMany({
        where: { tenantId, guestId, bookingId },
        select: { type: true, points: true, reason: true },
      });

      // เคยดึงคืนไปแล้ว — กันกดย้อนสถานะซ้ำแล้วแต้มติดลบ
      if (txns.some((t) => t.reason === LoyaltyService.CHECKOUT_UNDO_REASON)) {
        this.logger.debug(`Stay award for booking ${bookingId} already reversed`);
        return null;
      }

      const awarded = txns
        .filter((t) => t.type === 'earn')
        .reduce((sum, t) => sum + t.points, 0);
      if (awarded <= 0) return null;

      // ยอดคงเหลือน้อยกว่าที่จะดึงคืน (แขกใช้แต้มไปแล้ว) — ดึงเท่าที่เหลือ
      // ดีกว่าปล่อยให้ applyPointsDelta โยน 'Balance cannot go below zero'
      // แล้วแต้มค้างเต็มจำนวน
      const account = await this.prisma.loyaltyPoint.findFirst({
        where: { tenantId, guestId },
        select: { points: true },
      });
      const clawback = Math.min(awarded, account?.points ?? 0);
      if (clawback <= 0) {
        this.logger.warn(
          `Cannot reverse ${awarded} pts for booking ${bookingId}: guest balance is 0 (points already redeemed)`,
        );
        return null;
      }
      if (clawback < awarded) {
        this.logger.warn(
          `Partial loyalty clawback for booking ${bookingId}: ${clawback}/${awarded} pts (rest already redeemed)`,
        );
      }

      // แต้มสะสมตลอดชีพหักเต็มจำนวนที่เคยให้ แม้ยอดคงเหลือจะดึงคืนได้ไม่ครบ —
      // ไม่งั้นแขกได้ tier จากเช็คเอาต์ที่ถูกย้อนไปแล้ว
      return await this.applyPointsDelta(tenantId, guestId, -clawback, 'adjust', {
        bookingId,
        reason: LoyaltyService.CHECKOUT_UNDO_REASON,
        lifetimeDelta: -awarded,
      });
    } catch (error) {
      this.logger.error(
        `Failed to reverse loyalty points for booking ${bookingId}: ${(error as Error).message}`,
      );
      return null;
    }
  }

  async earnFromDto(tenantId: string, dto: EarnPointsDto): Promise<PointsResult> {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    const result = await this.addPointsForStay(dto.guestId, tenantId, dto.bookingAmount, {
      bookingId: dto.bookingId,
      reason: dto.reason ?? 'manual_earn',
    });

    if (!result) {
      throw new BadRequestException('Booking amount too low to earn points');
    }
    return result;
  }

  async redeem(tenantId: string, dto: RedeemPointsDto): Promise<PointsResult> {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    const account = await this.prisma.loyaltyPoint.findFirst({
      where: { tenantId, guestId: dto.guestId },
    });

    if (!account || account.points < dto.points) {
      throw new BadRequestException(
        `Insufficient balance: requested ${dto.points}, available ${account?.points ?? 0}`,
      );
    }

    return this.applyPointsDelta(tenantId, dto.guestId, -dto.points, 'redeem', {
      bookingId: dto.bookingId,
      reason: dto.reason ?? 'manual_redeem',
    });
  }

  async adjust(tenantId: string, dto: AdjustPointsDto): Promise<PointsResult> {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }
    if (dto.points === 0) {
      throw new BadRequestException('Adjustment of 0 has no effect');
    }

    const account = await this.prisma.loyaltyPoint.findFirst({
      where: { tenantId, guestId: dto.guestId },
    });

    if (dto.points < 0 && (!account || account.points + dto.points < 0)) {
      throw new BadRequestException(
        `Adjustment would result in negative balance (current: ${account?.points ?? 0})`,
      );
    }

    return this.applyPointsDelta(tenantId, dto.guestId, dto.points, 'adjust', {
      reason: dto.reason ?? 'manual_adjust',
    });
  }

  // ──────────────────────────────────────────────────────────
  // Internals
  // ──────────────────────────────────────────────────────────

  /**
   * แต้มจากบิลร้านค้า — 1 แต้ม/100฿ ของยอดที่ลูกค้าจ่ายจริงหลังหักส่วนลด
   *
   * รันใน transaction ของการขาย: บิลกับแต้มสำเร็จหรือล้มด้วยกัน ไม่มีบิลที่ "ขายแล้วแต่แต้มไม่เข้า"
   * คืน 0 เมื่อยอดไม่ถึง 100 บาท
   */
  async earnForRetailSaleWithin(
    tx: Prisma.TransactionClient,
    params: { tenantId: string; guestId: string; saleId: string; amount: number; contactId?: string | null },
  ): Promise<number> {
    const points = pointsForAmount(params.amount);
    if (points <= 0) return 0;
    await this.applyPointsDeltaWithin(tx, params.tenantId, params.guestId, points, 'earn', {
      retailSaleId: params.saleId,
      contactId: params.contactId,
      reason: RETAIL_SALE_EARN_REASON,
    });
    return points;
  }

  /**
   * บิลร้านค้าถูก void — ดึงแต้มที่บิลนั้นให้คืน (ดึงได้เท่าที่ยอดคงเหลือมี เหมือนย้อนเช็คเอาต์)
   * แต้มสะสมตลอดชีพหักเต็มจำนวน เรียกซ้ำได้ (เคยดึงแล้ว = 0)
   */
  async reverseRetailSaleWithin(
    tx: Prisma.TransactionClient,
    params: { tenantId: string; guestId: string; saleId: string },
  ): Promise<number> {
    const { tenantId, guestId, saleId } = params;
    const txns = await tx.loyaltyTransaction.findMany({
      where: { tenantId, guestId, retailSaleId: saleId },
      select: { type: true, points: true, reason: true },
    });
    if (txns.some((t) => t.reason === RETAIL_SALE_VOID_REASON)) return 0;
    const awarded = txns.filter((t) => t.type === 'earn').reduce((sum, t) => sum + t.points, 0);
    if (awarded <= 0) return 0;

    const account = await tx.loyaltyPoint.findFirst({ where: { tenantId, guestId }, select: { points: true } });
    const clawback = Math.min(awarded, account?.points ?? 0);
    if (clawback < awarded) {
      this.logger.warn(`Partial retail clawback for sale ${saleId}: ${clawback}/${awarded} pts (rest already redeemed)`);
    }
    await this.applyPointsDeltaWithin(tx, tenantId, guestId, -clawback, 'adjust', {
      retailSaleId: saleId,
      reason: RETAIL_SALE_VOID_REASON,
      lifetimeDelta: -awarded,
    });
    return clawback;
  }

  /**
   * หักแต้มเพื่อแลกของ (เช่นโค้ดโปรร้านค้า) ใน transaction ของผู้เรียก
   * ยอดไม่พอ = โยน INSUFFICIENT_POINTS แต้มสะสมตลอดชีพไม่ลด (tier ไม่ตก)
   */
  async redeemWithin(
    tx: Prisma.TransactionClient,
    params: { tenantId: string; guestId: string; points: number; reason: string; metadata?: Record<string, unknown> },
  ): Promise<PointsResult> {
    if (params.points <= 0) throw new BadRequestException('Points to redeem must be positive');
    return this.applyPointsDeltaWithin(tx, params.tenantId, params.guestId, -params.points, 'redeem', {
      reason: params.reason,
      metadata: params.metadata,
    });
  }

  /** {@link applyPointsDeltaWithin} in its own transaction. */
  private async applyPointsDelta(
    tenantId: string,
    guestId: string,
    pointsDelta: number,
    type: LoyaltyTxnType,
    extras: LoyaltyDeltaExtras,
  ): Promise<PointsResult> {
    return this.prisma.$transaction((tx) => this.applyPointsDeltaWithin(tx, tenantId, guestId, pointsDelta, type, extras));
  }

  /**
   * Update LoyaltyPoint balance + lifetime + tier and insert the LoyaltyTransaction row.
   *
   * ยอดคงเหลือหักแบบมีเงื่อนไข (`points >= ต้องหัก`) — สองเครื่องแลกแต้มพร้อมกันได้คนเดียว
   * แต้มสะสมตลอดชีพ: earn/adjust เปลี่ยนตาม delta (หรือ lifetimeDelta), redeem/expire ไม่เปลี่ยน
   */
  async applyPointsDeltaWithin(
    tx: Prisma.TransactionClient,
    tenantId: string,
    guestId: string,
    pointsDelta: number,
    type: LoyaltyTxnType,
    extras: LoyaltyDeltaExtras,
  ): Promise<PointsResult> {
    let account = await tx.loyaltyPoint.findFirst({ where: { tenantId, guestId } });
    if (!account) {
      account = await tx.loyaltyPoint.create({
        data: { tenantId, guestId, points: 0, lifetimePoints: 0, tier: 'standard' },
      });
    }

    const lifetimeDelta = extras.lifetimeDelta ?? (type === 'earn' || type === 'adjust' ? pointsDelta : 0);
    const moved = await tx.loyaltyPoint.updateMany({
      where: { id: account.id, tenantId, ...(pointsDelta < 0 ? { points: { gte: -pointsDelta } } : {}) },
      data: { points: { increment: pointsDelta }, lifetimePoints: { increment: lifetimeDelta } },
    });
    if (moved.count === 0) {
      throw new BadRequestException({
        code: 'INSUFFICIENT_POINTS',
        message: `แต้มไม่พอ: ต้องใช้ ${-pointsDelta} แต้ม มีอยู่ ${account.points} แต้ม`,
      });
    }

    const after = await tx.loyaltyPoint.findFirst({ where: { id: account.id, tenantId } });
    const balance = after?.points ?? account.points + pointsDelta;
    // lifetime ห้ามติดลบ (ข้อมูลเก่าก่อนมีคอลัมน์นี้) — ตรึงที่ 0 แล้วคิด tier
    const lifetimePoints = Math.max(after?.lifetimePoints ?? 0, 0);
    const tier = tierForLifetimePoints(lifetimePoints);
    await tx.loyaltyPoint.update({
      where: { id: account.id },
      data: { tier, ...(lifetimePoints !== after?.lifetimePoints ? { lifetimePoints } : {}) },
    });

    const transaction = await tx.loyaltyTransaction.create({
      data: {
        tenantId,
        guestId,
        contactId: extras.contactId ?? null,
        type,
        points: pointsDelta,
        bookingId: extras.bookingId ?? null,
        retailSaleId: extras.retailSaleId ?? null,
        reason: extras.reason ?? null,
        metadata: extras.metadata ? JSON.stringify(extras.metadata) : null,
        balanceAfter: balance,
        tierAfter: tier,
      },
    });

    this.logger.log(
      `${type.toUpperCase()} ${pointsDelta} pts · guest=${guestId} · balance=${balance} · lifetime=${lifetimePoints} · tier=${tier}`,
    );

    return { guestId, tenantId, pointsDelta, balance, lifetimePoints, tier, transactionId: transaction.id };
  }
}

interface LoyaltyDeltaExtras {
  bookingId?: string;
  retailSaleId?: string;
  contactId?: string | null;
  reason?: string;
  metadata?: Record<string, unknown>;
  /** ค่าที่จะบวกเข้าแต้มสะสมตลอดชีพ (ไม่ระบุ = ตามกฎของ type) */
  lifetimeDelta?: number;
}
