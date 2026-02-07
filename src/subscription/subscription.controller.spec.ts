import { Test, TestingModule } from '@nestjs/testing';
import { SubscriptionController } from './subscription.controller';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';

describe('SubscriptionController', () => {
  let controller: SubscriptionController;
  let service: SubscriptionsService;

  const mockSubscriptionsService = {
    findByTenantId: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SubscriptionController],
      providers: [
        {
          provide: SubscriptionsService,
          useValue: mockSubscriptionsService,
        },
      ],
    }).compile();

    controller = module.get<SubscriptionController>(SubscriptionController);
    service = module.get<SubscriptionsService>(SubscriptionsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getRenewalStatus', () => {
    it('should return renewal status with subscription details', async () => {
      const mockUser = { id: 'user-1', tenantId: 'tenant-1' };
      const mockSubscription = {
        id: 'sub-1',
        tenantId: 'tenant-1',
        status: 'active',
        endDate: new Date('2024-12-31'),
        autoRenew: true,
      };

      mockSubscriptionsService.findByTenantId.mockResolvedValue(mockSubscription);

      const result = await controller.getRenewalStatus(mockUser);

      expect(service.findByTenantId).toHaveBeenCalledWith('tenant-1');
      expect(result).toEqual({
        status: 'active',
        endDate: mockSubscription.endDate,
        autoRenew: true,
        paymentHistory: [],
      });
    });

    it('should return inactive status when no subscription', async () => {
      const mockUser = { id: 'user-1', tenantId: 'tenant-1' };

      mockSubscriptionsService.findByTenantId.mockResolvedValue(null);

      const result = await controller.getRenewalStatus(mockUser);

      expect(result).toEqual({
        status: 'inactive',
        endDate: null,
        autoRenew: false,
        paymentHistory: [],
      });
    });
  });
});
