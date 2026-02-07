import { Test, TestingModule } from '@nestjs/testing';
import { LoyaltyService } from './loyalty.service';
import { PrismaService } from '../prisma/prisma.service';

describe('LoyaltyService', () => {
  let service: LoyaltyService;
  let prisma: PrismaService;

  const mockPrismaService = {
    loyaltyPoint: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    referral: {
      create: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LoyaltyService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<LoyaltyService>(LoyaltyService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getPoints', () => {
    it('should return existing loyalty points', async () => {
      const mockPoints = {
        tenantId: 'tenant-1',
        points: 500,
        tier: 'gold',
      };

      mockPrismaService.loyaltyPoint.findUnique.mockResolvedValue(mockPoints);

      const result = await service.getPoints('tenant-1');

      expect(result).toEqual(mockPoints);
      expect(prisma.loyaltyPoint.findUnique).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1' },
      });
    });

    it('should create new loyalty points if not exists', async () => {
      const newPoints = {
        tenantId: 'tenant-1',
        points: 0,
        tier: 'standard',
      };

      mockPrismaService.loyaltyPoint.findUnique.mockResolvedValue(null);
      mockPrismaService.loyaltyPoint.create.mockResolvedValue(newPoints);

      const result = await service.getPoints('tenant-1');

      expect(result).toEqual(newPoints);
      expect(prisma.loyaltyPoint.create).toHaveBeenCalledWith({
        data: { tenantId: 'tenant-1', points: 0, tier: 'standard' },
      });
    });
  });

  describe('inviteReferral', () => {
    it('should create referral invitation', async () => {
      const mockReferral = {
        id: '1',
        referrerId: 'user-1',
        tenantId: 'tenant-1',
        email: 'friend@example.com',
        status: 'pending',
        rewardPoints: 100,
      };

      mockPrismaService.referral.create.mockResolvedValue(mockReferral);

      const result = await service.inviteReferral('user-1', 'tenant-1', {
        email: 'friend@example.com',
      });

      expect(result).toEqual(mockReferral);
      expect(prisma.referral.create).toHaveBeenCalledWith({
        data: {
          referrerId: 'user-1',
          tenantId: 'tenant-1',
          email: 'friend@example.com',
          status: 'pending',
          rewardPoints: 100,
        },
      });
    });
  });
});
