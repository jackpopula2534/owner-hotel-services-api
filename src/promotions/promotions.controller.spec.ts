import { Test, TestingModule } from '@nestjs/testing';
import { PromotionsController } from './promotions.controller';
import { PromotionsService } from './promotions.service';
import { ApplyCouponDto } from './dto/promotions.dto';

describe('PromotionsController', () => {
  let controller: PromotionsController;
  let service: PromotionsService;

  const mockPromotionsService = {
    getActivePromotions: jest.fn(),
    applyCoupon: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PromotionsController],
      providers: [
        {
          provide: PromotionsService,
          useValue: mockPromotionsService,
        },
      ],
    }).compile();

    controller = module.get<PromotionsController>(PromotionsController);
    service = module.get<PromotionsService>(PromotionsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getActivePromotions', () => {
    it('should return active promotions for user segment', async () => {
      const mockUser = { id: 'user-1', tenantId: 'tenant-1', segment: 'new_user' };
      const mockPromotions = [
        {
          id: '1',
          title: '30% Off for New Users',
          code: 'NEW30',
          discountPercent: 30,
          targetSegment: 'new_user',
          isActive: true,
        },
      ];

      mockPromotionsService.getActivePromotions.mockResolvedValue(mockPromotions);

      const result = await controller.getActivePromotions(mockUser);

      expect(service.getActivePromotions).toHaveBeenCalledWith('new_user');
      expect(result).toEqual(mockPromotions);
    });

    it('should use segment from query parameter', async () => {
      const mockUser = { id: 'user-1', tenantId: 'tenant-1', segment: 'standard' };
      const mockPromotions = [];

      mockPromotionsService.getActivePromotions.mockResolvedValue(mockPromotions);

      await controller.getActivePromotions(mockUser, 'vip');

      expect(service.getActivePromotions).toHaveBeenCalledWith('vip');
    });
  });

  describe('applyCoupon', () => {
    it('should apply valid coupon code', async () => {
      const dto: ApplyCouponDto = {
        code: 'SAVE20',
      };
      const mockCoupon = {
        id: '1',
        code: 'SAVE20',
        discountPercent: 20,
        isActive: true,
        expiresAt: new Date('2024-12-31'),
      };

      mockPromotionsService.applyCoupon.mockResolvedValue(mockCoupon);

      const result = await controller.applyCoupon(dto);

      expect(service.applyCoupon).toHaveBeenCalledWith('SAVE20');
      expect(result).toEqual(mockCoupon);
    });
  });
});
