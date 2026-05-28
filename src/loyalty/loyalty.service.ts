import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  AdjustPointsDto,
  EarnPointsDto,
  InviteReferralDto,
  RedeemPointsDto,
} from './dto/loyalty.dto';

export type LoyaltyTier = 'standard' | 'silver' | 'gold' | 'platinum';

export interface PointsResult {
  guestId: string;
  tenantId: string;
  pointsDelta: number;
  balance: number;
  tier: LoyaltyTier;
  transactionId?: string;
}

@Injectable()
export class LoyaltyService {
  private readonly logger = new Logger(LoyaltyService.name);

  // Points per THB (1 point per 100 THB by default)
  private static readonly POINTS_PER_THB_DIVISOR = 100;

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

      const pointsEarned = Math.floor(bookingAmount / LoyaltyService.POINTS_PER_THB_DIVISOR);
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
   * Atomically update LoyaltyPoint balance + insert LoyaltyTransaction row.
   * Returns the post-update snapshot.
   */
  private async applyPointsDelta(
    tenantId: string,
    guestId: string,
    pointsDelta: number,
    type: 'earn' | 'redeem' | 'expire' | 'adjust',
    extras: { bookingId?: string; reason?: string },
  ): Promise<PointsResult> {
    return this.prisma.$transaction(async (tx) => {
      let account = await tx.loyaltyPoint.findFirst({ where: { tenantId, guestId } });

      if (!account) {
        account = await tx.loyaltyPoint.create({
          data: { tenantId, guestId, points: 0, tier: 'standard' },
        });
      }

      const newBalance = account.points + pointsDelta;
      if (newBalance < 0) {
        throw new BadRequestException('Balance cannot go below zero');
      }
      const newTier = this.calculateTier(newBalance);

      const updated = await tx.loyaltyPoint.update({
        where: { id: account.id },
        data: { points: newBalance, tier: newTier },
      });

      const transaction = await tx.loyaltyTransaction.create({
        data: {
          tenantId,
          guestId,
          type,
          points: pointsDelta,
          bookingId: extras.bookingId ?? null,
          reason: extras.reason ?? null,
          balanceAfter: newBalance,
          tierAfter: newTier,
        },
      });

      this.logger.log(
        `${type.toUpperCase()} ${pointsDelta} pts · guest=${guestId} · balance=${newBalance} · tier=${newTier}`,
      );

      return {
        guestId,
        tenantId,
        pointsDelta,
        balance: updated.points,
        tier: newTier as LoyaltyTier,
        transactionId: transaction.id,
      };
    });
  }

  /**
   * Tier thresholds (lifetime balance based).
   * Standard: 0-999 · Silver: 1000-4999 · Gold: 5000-9999 · Platinum: 10000+
   */
  private calculateTier(points: number): LoyaltyTier {
    if (points >= 10000) return 'platinum';
    if (points >= 5000) return 'gold';
    if (points >= 1000) return 'silver';
    return 'standard';
  }
}
