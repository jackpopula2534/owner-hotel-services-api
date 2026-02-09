import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { InviteReferralDto } from './dto/loyalty.dto';

@Injectable()
export class LoyaltyService {
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

    let loyalty = await this.prisma.loyaltyPoint.findUnique({
      where: { tenantId },
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
}
