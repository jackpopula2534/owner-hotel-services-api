import { Test, TestingModule } from '@nestjs/testing';
import { AnalyticsService } from './analytics.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AnalyticsService', () => {
  let service: AnalyticsService;
  let prisma: PrismaService;

  const mockPrismaService = {
    analyticsEvent: {
      create: jest.fn(),
    },
    featureFlag: {
      findUnique: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<AnalyticsService>(AnalyticsService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('trackEvent', () => {
    it('should create analytics event', async () => {
      const mockEvent = {
        id: '1',
        userId: 'user-1',
        tenantId: 'tenant-1',
        eventName: 'page_view',
        metadata: { page: '/dashboard' },
        createdAt: new Date(),
      };

      mockPrismaService.analyticsEvent.create.mockResolvedValue(mockEvent);

      const result = await service.trackEvent('user-1', 'tenant-1', {
        eventName: 'page_view',
        metadata: { page: '/dashboard' },
      });

      expect(result).toEqual(mockEvent);
      expect(prisma.analyticsEvent.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          tenantId: 'tenant-1',
          eventName: 'page_view',
          metadata: { page: '/dashboard' },
        },
      });
    });

    it('should handle empty metadata', async () => {
      mockPrismaService.analyticsEvent.create.mockResolvedValue({});

      await service.trackEvent('user-1', 'tenant-1', {
        eventName: 'button_click',
      });

      expect(prisma.analyticsEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          metadata: {},
        }),
      });
    });
  });

  describe('getSummary', () => {
    it('should return analytics summary', async () => {
      const result = await service.getSummary('tenant-1');

      expect(result).toHaveProperty('timeSaved');
      expect(result).toHaveProperty('bookingsGrowth');
      expect(result).toHaveProperty('occupancyRate');
      expect(result).toHaveProperty('activeUsers');
      expect(result).toHaveProperty('popularChannels');
      expect(Array.isArray(result.popularChannels)).toBe(true);
    });
  });

  describe('getFeatureFlag', () => {
    it('should return active feature flag', async () => {
      const mockFlag = {
        id: '1',
        name: 'new_dashboard',
        isActive: true,
        rules: null,
      };

      mockPrismaService.featureFlag.findUnique.mockResolvedValue(mockFlag);

      const result = await service.getFeatureFlag('new_dashboard');

      expect(result.isActive).toBe(true);
      expect(prisma.featureFlag.findUnique).toHaveBeenCalledWith({
        where: { name: 'new_dashboard' },
      });
    });

    it('should return inactive if flag not found', async () => {
      mockPrismaService.featureFlag.findUnique.mockResolvedValue(null);

      const result = await service.getFeatureFlag('non_existent');

      expect(result.isActive).toBe(false);
    });

    it('should respect tenant-specific rules', async () => {
      const mockFlag = {
        id: '1',
        name: 'beta_feature',
        isActive: true,
        rules: { tenantIds: ['tenant-1', 'tenant-2'] },
      };

      mockPrismaService.featureFlag.findUnique.mockResolvedValue(mockFlag);

      const resultForAllowed = await service.getFeatureFlag('beta_feature', 'tenant-1');
      expect(resultForAllowed.isActive).toBe(true);

      const resultForDenied = await service.getFeatureFlag('beta_feature', 'tenant-3');
      expect(resultForDenied.isActive).toBe(false);
    });
  });
});
