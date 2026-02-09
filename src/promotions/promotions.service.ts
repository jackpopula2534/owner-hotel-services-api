import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ApplyCouponDto } from './dto/promotions.dto';
import { Prisma } from '@prisma/client';

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

    try {
      return this.prisma.promotion.findMany({
        where,
        orderBy: { createdAt: 'desc' },
      });
    } catch (error) {
      // ถ้า table promotions ยังไม่มีในฐานข้อมูล ให้ส่ง empty array สำหรับผู้ใช้ใหม่
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2021' || error.code === 'P2022') {
          return [];
        }
      }
      throw error;
    }
  }

  async applyCoupon(code: string) {
    try {
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
    } catch (error) {
      // ถ้า table coupons ยังไม่มีในฐานข้อมูล
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2021' || error.code === 'P2022') {
          throw new BadRequestException('Coupon system is not available yet');
        }
      }
      throw error;
    }
  }
}
