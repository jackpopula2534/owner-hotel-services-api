import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ApplyCouponDto } from './dto/promotions.dto';

@Injectable()
export class PromotionsService {
  constructor(private prisma: PrismaService) {}

  async getActivePromotions(segment?: string) {
    const where: any = { isActive: true };
    if (segment) {
      where.OR = [
        { targetSegment: segment },
        { targetSegment: null },
      ];
    }

    return this.prisma.promotion.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  async applyCoupon(code: string) {
    const coupon = await this.prisma.coupon.findUnique({
      where: { code },
    });

    if (!coupon || !coupon.isActive) {
      throw new BadRequestException('Invalid or inactive coupon code');
    }

    if (coupon.expiresAt && new Date() > coupon.expiresAt) {
      throw new BadRequestException('Coupon code has expired');
    }

    return coupon;
  }
}
