import { Test, TestingModule } from '@nestjs/testing';
import { LoyaltyController } from './loyalty.controller';
import { LoyaltyService } from './loyalty.service';
import { InviteReferralDto } from './dto/loyalty.dto';

describe('LoyaltyController', () => {
  let controller: LoyaltyController;
  let service: LoyaltyService;

  const mockLoyaltyService = {
    getPoints: jest.fn(),
    inviteReferral: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [LoyaltyController],
      providers: [
        {
          provide: LoyaltyService,
          useValue: mockLoyaltyService,
        },
      ],
    }).compile();

    controller = module.get<LoyaltyController>(LoyaltyController);
    service = module.get<LoyaltyService>(LoyaltyService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getPoints', () => {
    it('should return loyalty points', async () => {
      const mockUser = { id: 'user-1', tenantId: 'tenant-1' };
      const mockPoints = {
        tenantId: 'tenant-1',
        points: 500,
        tier: 'gold',
      };

      mockLoyaltyService.getPoints.mockResolvedValue(mockPoints);

      const result = await controller.getPoints(mockUser);

      expect(service.getPoints).toHaveBeenCalledWith('tenant-1');
      expect(result).toEqual(mockPoints);
    });
  });

  describe('inviteReferral', () => {
    it('should create referral invitation', async () => {
      const mockUser = { id: 'user-1', tenantId: 'tenant-1' };
      const dto: InviteReferralDto = {
        email: 'friend@example.com',
      };
      const mockReferral = {
        id: '1',
        referrerId: 'user-1',
        tenantId: 'tenant-1',
        email: 'friend@example.com',
        status: 'pending',
        rewardPoints: 100,
      };

      mockLoyaltyService.inviteReferral.mockResolvedValue(mockReferral);

      const result = await controller.inviteReferral(mockUser, dto);

      expect(service.inviteReferral).toHaveBeenCalledWith('user-1', 'tenant-1', dto);
      expect(result).toEqual(mockReferral);
    });
  });
});
