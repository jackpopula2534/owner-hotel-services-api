import { Test, TestingModule } from '@nestjs/testing';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { CreateAnalyticsEventDto } from './dto/analytics.dto';

describe('AnalyticsController', () => {
  let controller: AnalyticsController;
  let service: AnalyticsService;

  const mockAnalyticsService = {
    trackEvent: jest.fn(),
    getSummary: jest.fn(),
    getFeatureFlag: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AnalyticsController],
      providers: [
        {
          provide: AnalyticsService,
          useValue: mockAnalyticsService,
        },
      ],
    }).compile();

    controller = module.get<AnalyticsController>(AnalyticsController);
    service = module.get<AnalyticsService>(AnalyticsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('trackEvent', () => {
    it('should track analytics event', async () => {
      const mockUser = { userId: 'user-1', tenantId: 'tenant-1' };
      const dto: CreateAnalyticsEventDto = {
        eventName: 'page_view',
        metadata: { page: '/dashboard' },
      };
      const mockEvent = {
        id: '1',
        userId: 'user-1',
        tenantId: 'tenant-1',
        eventName: 'page_view',
        metadata: { page: '/dashboard' },
        createdAt: new Date(),
      };

      mockAnalyticsService.trackEvent.mockResolvedValue(mockEvent);

      const result = await controller.trackEvent(mockUser, dto);

      expect(service.trackEvent).toHaveBeenCalledWith('user-1', 'tenant-1', dto);
      expect(result).toEqual(mockEvent);
    });
  });

  describe('getSummary', () => {
    it('should return analytics summary', async () => {
      const mockUser = { userId: 'user-1', tenantId: 'tenant-1' };
      const mockSummary = {
        timeSaved: 120,
        bookingsGrowth: 15,
        occupancyRate: 78,
        activeUsers: 5,
        popularChannels: [
          { name: 'Direct', value: 45 },
          { name: 'Booking.com', value: 30 },
          { name: 'Agoda', value: 25 },
        ],
      };

      mockAnalyticsService.getSummary.mockResolvedValue(mockSummary);

      const result = await controller.getSummary(mockUser);

      expect(service.getSummary).toHaveBeenCalledWith('tenant-1');
      expect(result).toEqual(mockSummary);
    });
  });

  describe('getFeatureFlag', () => {
    it('should return feature flag status', async () => {
      const mockUser = { userId: 'user-1', tenantId: 'tenant-1' };
      const mockFlag = { isActive: true };

      mockAnalyticsService.getFeatureFlag.mockResolvedValue(mockFlag);

      const result = await controller.getFeatureFlag('new_dashboard', mockUser);

      expect(service.getFeatureFlag).toHaveBeenCalledWith('new_dashboard', 'tenant-1');
      expect(result).toEqual(mockFlag);
    });
  });
});
