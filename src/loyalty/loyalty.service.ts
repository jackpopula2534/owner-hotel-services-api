import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { InviteReferralDto } from './dto/loyalty.dto';

@Injectable()
export class LoyaltyService {
  private readonly logger = new Logger(LoyaltyService.name);

  constructor(private prisma: PrismaService) {}

  async getPoints(tenantId: string) {
    // If no tenantId, return default loyalty info
    if (!tenantId) {
      return {
        id: null,
        tenantId: null,
        points: 0,
        tier: 'standard',
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

  async inviteReferral(userId: string, tenantId: string, data: InviteReferralDto) {
    return this.prisma.referral.create({
      data: {
        referrerId: userId,
        tenantId,
        email: data.email,
        status: 'pending',
        rewardPoints: 100, // Reward both with 100 points
      },
    });
  }

  /**
   * Add loyalty points for a stay
   * Calculates points based on booking amount: 1 point per 100 THB
   * Updates tier if point threshold reached
   */
  async addPointsForStay(
    guestId: string,
    tenantId: string,
    bookingAmount: number,
  ): Promise<any> {
    try {
      if (!guestId || !tenantId) {
        this.logger.warn(
          `Cannot add loyalty points: missing guestId (${guestId}) or tenantId (${tenantId})`
        );
        return null;
      }

      // Calculate points: 1 point per 100 THB (configurable)
      const pointsPerHundred = 1;
      const pointsEarned = Math.floor(bookingAmount / 100) * pointsPerHundred;

      if (pointsEarned === 0) {
        this.logger.debug(`Booking amount ${bookingAmount} too low to earn points`);
        return null;
      }

      // Get or create loyalty record for guest
      let loyalty = await this.prisma.loyaltyPoint.findFirst({
        where: { guestId, tenantId },
      });

      if (!loyalty) {
        loyalty = await this.prisma.loyaltyPoint.create({
          data: {
            guestId,
            tenantId,
            points: 0,
            tier: 'standard',
          },
        });
      }

      // Calculate new tier based on total points
      const newPoints = loyalty.points + pointsEarned;
      const newTier = this.calculateTier(newPoints);

      // Update loyalty points and tier
      const updated = await this.prisma.loyaltyPoint.update({
        where: { id: loyalty.id },
        data: {
          points: newPoints,
          tier: newTier,
        },
      });

      this.logger.log(
        `Added ${pointsEarned} loyalty points to guest ${guestId}. ` +
        `Total: ${newPoints} (Tier: ${newTier})`
      );

      return updated;
    } catch (error) {
      this.logger.error(
        `Failed to add loyalty points for guest ${guestId}: ${error.message}`
      );
      // Don't throw - loyalty points shouldn't block checkout
      return null;
    }
  }

  /**
   * Calculate tier based on total loyalty points
   * Standard: 0-999 points
   * Silver: 1000-4999 points
   * Gold: 5000-9999 points
   * Platinum: 10000+ points
   */
  private calculateTier(points: number): string {
    if (points >= 10000) return 'platinum';
    if (points >= 5000) return 'gold';
    if (points >= 1000) return 'silver';
    return 'standard';
  }
}
