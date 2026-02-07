import { Test, TestingModule } from '@nestjs/testing';
import { PromotionsService } from './promotions.service';
import { PrismaService } from '../prisma/prisma.service';
import { BadRequestException } from '@nestjs/common';

describe('PromotionsService', () => {
  let service: PromotionsService;
  let prisma: PrismaService;

  const mockPrismaService = {
    promotion: {
      findMany: jest.fn(),
    },
    coupon: {
      findUnique: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PromotionsService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<PromotionsService>(PromotionsService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getActivePromotions', () => {
    it('should return active promotions for specific segment', async () => {
      const mockPromotions = [
        {
          id: '1',
          title: '30% Off for New Users',
          targetSegment: 'new_user',
          isActive: true,
        },
      ];

      mockPrismaService.promotion.findMany.mockResolvedValue(mockPromotions);

      const result = await service.getActivePromotions('new_user');

      expect(result).toEqual(mockPromotions);
      expect(prisma.promotion.findMany).toHaveBeenCalledWith({
        where: {
          isActive: true,
          OR: [
            { targetSegment: 'new_user' },
            { targetSegment: null },
          ],
        },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should return all active promotions without segment filter', async () => {
      const mockPromotions = [
        { id: '1', title: 'General Promo', isActive: true },
      ];

      mockPrismaService.promotion.findMany.mockResolvedValue(mockPromotions);

      await service.getActivePromotions();

      expect(prisma.promotion.findMany).toHaveBeenCalledWith({
        where: {
          isActive: true,
        },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('applyCoupon', () => {
    it('should apply valid coupon', async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 30);

      const mockCoupon = {
        id: '1',
        code: 'SAVE20',
        discountPercent: 20,
        isActive: true,
        expiresAt: futureDate,
      };

      mockPrismaService.coupon.findUnique.mockResolvedValue(mockCoupon);

      const result = await service.applyCoupon('SAVE20');

      expect(result).toEqual(mockCoupon);
      expect(prisma.coupon.findUnique).toHaveBeenCalledWith({
        where: { code: 'SAVE20' },
      });
    });

    it('should throw error for invalid coupon', async () => {
      mockPrismaService.coupon.findUnique.mockResolvedValue(null);

      await expect(service.applyCoupon('INVALID')).rejects.toThrow(BadRequestException);
    });

    it('should throw error for inactive coupon', async () => {
      const mockCoupon = {
        id: '1',
        code: 'EXPIRED',
        isActive: false,
      };

      mockPrismaService.coupon.findUnique.mockResolvedValue(mockCoupon);

      await expect(service.applyCoupon('EXPIRED')).rejects.toThrow(BadRequestException);
    });

    it('should throw error for expired coupon', async () => {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 1);

      const mockCoupon = {
        id: '1',
        code: 'OLDCODE',
        isActive: true,
        expiresAt: pastDate,
      };

      mockPrismaService.coupon.findUnique.mockResolvedValue(mockCoupon);

      await expect(service.applyCoupon('OLDCODE')).rejects.toThrow(
        new BadRequestException('Coupon code has expired'),
      );
    });
  });
});
