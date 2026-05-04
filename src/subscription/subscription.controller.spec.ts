import { Test, TestingModule } from '@nestjs/testing';
import { SubscriptionController } from './subscription.controller';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { SelfServicePlanService } from './self-service-plan.service';
import { mockSelfServicePlanService } from '../common/test/mock-providers';

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
        {
          provide: SelfServicePlanService,
          useValue: mockSelfServicePlanService(),
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
      const mockUser = { userId: 'user-1', tenant_id: 'tenant-1' };
      const mockSubscription = {
        id: 'sub-1',
        tenant_id: 'tenant-1',
        status: 'active',
        end_date: new Date('2024-12-31'),
        auto_renew: true,
      };

      mockSubscriptionsService.findByTenantId.mockResolvedValue(mockSubscription);

      const result = await controller.getRenewalStatus(mockUser);

      expect(service.findByTenantId).toHaveBeenCalledWith('tenant-1');
      expect(result).toEqual({
        status: 'active',
        endDate: mockSubscription.end_date,
        autoRenew: true,
        paymentHistory: [],
      });
    });

    it('should return inactive status when no subscription', async () => {
      const mockUser = { userId: 'user-1', tenant_id: 'tenant-1' };

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
