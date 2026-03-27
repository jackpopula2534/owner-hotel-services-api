import { Test, TestingModule } from '@nestjs/testing';
import { OnboardingService } from './onboarding.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantsService } from '../tenants/tenants.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { PlansService } from '../plans/plans.service';
import { TenantStatus } from '../tenants/entities/tenant.entity';
import { SubscriptionStatus } from '../subscriptions/entities/subscription.entity';

describe('OnboardingService', () => {
  let service: OnboardingService;
  let prisma: PrismaService;
  let tenantsService: TenantsService;
  let subscriptionsService: SubscriptionsService;
  let plansService: PlansService;

  const mockPrismaService = {
    onboardingStep: {
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };

  const mockTenantsService = {
    create: jest.fn(),
    findOne: jest.fn(),
  };

  const mockSubscriptionsService = {
    create: jest.fn(),
  };

  const mockPlansService = {
    findByCode: jest.fn(),
  };

  const mockPrismaServiceForOnboarding = {
    onboardingStep: {
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    plans: {
      create: jest.fn(),
    },
    features: {
      findMany: jest.fn(),
    },
    subscription_features: {
      createMany: jest.fn(),
    },
    property: {
      create: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OnboardingService,
        {
          provide: PrismaService,
          useValue: mockPrismaServiceForOnboarding,
        },
        {
          provide: TenantsService,
          useValue: mockTenantsService,
        },
        {
          provide: SubscriptionsService,
          useValue: mockSubscriptionsService,
        },
        {
          provide: PlansService,
          useValue: mockPlansService,
        },
      ],
    }).compile();

    service = module.get<OnboardingService>(OnboardingService);
    prisma = module.get<PrismaService>(PrismaService);
    tenantsService = module.get<TenantsService>(TenantsService);
    subscriptionsService = module.get<SubscriptionsService>(SubscriptionsService);
    plansService = module.get<PlansService>(PlansService);

    // Setup default mocks for Prisma calls
    mockPrismaServiceForOnboarding.features.findMany.mockResolvedValue([]);
    mockPrismaServiceForOnboarding.subscription_features.createMany.mockResolvedValue({});
    mockPrismaServiceForOnboarding.property.create.mockResolvedValue({});
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('registerHotel', () => {
    it('should register a new hotel with trial subscription', async () => {
      const mockTenant = {
        id: 'tenant-1',
        name: 'Test Hotel',
        email: 'test@hotel.com',
        status: TenantStatus.TRIAL,
        trialEndsAt: new Date(),
      };

      const mockPlan = {
        id: 'plan-1',
        code: 'TRIAL',
        name: 'Free Trial (Full Access)',
      };

      const mockSubscription = {
        id: 'sub-1',
        tenantId: 'tenant-1',
        planId: 'plan-1',
        status: SubscriptionStatus.TRIAL,
      };

      const mockProperty = {
        id: 'prop-1',
        tenantId: 'tenant-1',
        name: 'Test Hotel',
        code: 'TST0001',
        isDefault: true,
      };

      mockTenantsService.create.mockResolvedValue(mockTenant);
      mockPlansService.findByCode.mockResolvedValue(mockPlan);
      mockSubscriptionsService.create.mockResolvedValue(mockSubscription);
      mockPrismaServiceForOnboarding.features.findMany.mockResolvedValue([]);
      mockPrismaServiceForOnboarding.property.create.mockResolvedValue(mockProperty);

      const result = await service.registerHotel(
        {
          name: 'Test Hotel',
        },
        14,
      );

      expect(result.tenant).toEqual(mockTenant);
      expect(result.subscription).toEqual(mockSubscription);
      expect(result.message).toContain('14 days');
      expect(tenantsService.create).toHaveBeenCalled();
      expect(plansService.findByCode).toHaveBeenCalledWith('TRIAL');
      expect(subscriptionsService.create).toHaveBeenCalled();
    });

    it('should create default trial plan if not found', async () => {
      const mockTenant = {
        id: 'tenant-1',
        name: 'Test Hotel',
        status: TenantStatus.TRIAL,
      };

      const mockCreatedPlan = {
        id: 'trial-plan-' + Date.now(),
        code: 'TRIAL',
        name: 'Free Trial (Full Access)',
      };

      const mockSubscription = {
        id: 'sub-1',
        tenantId: 'tenant-1',
        planId: mockCreatedPlan.id,
        status: SubscriptionStatus.TRIAL,
      };

      const mockProperty = {
        id: 'prop-1',
        tenantId: 'tenant-1',
        name: 'Test Hotel',
        code: 'TST0001',
        isDefault: true,
      };

      mockTenantsService.create.mockResolvedValue(mockTenant);
      mockPlansService.findByCode.mockResolvedValue(null);
      mockPrismaServiceForOnboarding.plans.create.mockResolvedValue(mockCreatedPlan);
      mockSubscriptionsService.create.mockResolvedValue(mockSubscription);
      mockPrismaServiceForOnboarding.features.findMany.mockResolvedValue([]);
      mockPrismaServiceForOnboarding.property.create.mockResolvedValue(mockProperty);

      const result = await service.registerHotel(
        {
          name: 'Test Hotel',
        },
        14,
      );

      expect(result.tenant).toEqual(mockTenant);
      expect(mockPrismaServiceForOnboarding.plans.create).toHaveBeenCalled();
      expect(subscriptionsService.create).toHaveBeenCalled();
    });
  });

  describe('getTrialStatus', () => {
    it('should return trial status with days remaining', async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 10);

      const mockTenant = {
        id: 'tenant-1',
        name: 'Test Hotel',
        status: TenantStatus.TRIAL,
        trial_ends_at: futureDate,
      };

      mockTenantsService.findOne.mockResolvedValue(mockTenant);

      const result = await service.getTrialStatus('tenant-1');

      expect(result.isTrial).toBe(true);
      expect(result.daysRemaining).toBeGreaterThan(0);
      expect(result.canAccessPMS).toBe(true);
    });

    it('should return expired trial status', async () => {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 5);

      const mockTenant = {
        id: 'tenant-1',
        name: 'Test Hotel',
        status: TenantStatus.TRIAL,
        trial_ends_at: pastDate,
      };

      mockTenantsService.findOne.mockResolvedValue(mockTenant);

      const result = await service.getTrialStatus('tenant-1');

      expect(result.isTrial).toBe(true);
      expect(result.daysRemaining).toBe(0);
      expect(result.canAccessPMS).toBe(false);
    });

    it('should throw error if tenant not found', async () => {
      mockTenantsService.findOne.mockResolvedValue(null);

      await expect(service.getTrialStatus('invalid-id')).rejects.toThrow('Tenant not found');
    });
  });

  describe('getProgress', () => {
    it('should return existing steps', async () => {
      const mockSteps = [
        { id: '1', tenantId: 'tenant-1', stepKey: 'setup_profile', isCompleted: true },
        { id: '2', tenantId: 'tenant-1', stepKey: 'create_room', isCompleted: false },
      ];

      mockPrismaServiceForOnboarding.onboardingStep.findMany.mockResolvedValue(mockSteps);

      const result = await service.getProgress('tenant-1');

      expect(result).toEqual(mockSteps);
      expect(mockPrismaServiceForOnboarding.onboardingStep.findMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1' },
        orderBy: { createdAt: 'asc' },
      });
    });

    it('should initialize default steps if none exist', async () => {
      mockPrismaServiceForOnboarding.onboardingStep.findMany.mockResolvedValue([]);
      mockPrismaServiceForOnboarding.onboardingStep.create.mockImplementation((data) =>
        Promise.resolve({ id: '1', ...data.data }),
      );

      const result = await service.getProgress('tenant-1');

      expect(result.length).toBe(4);
      expect(mockPrismaServiceForOnboarding.onboardingStep.create).toHaveBeenCalledTimes(4);
    });
  });

  describe('updateStep', () => {
    it('should update step to completed', async () => {
      const mockUpdatedStep = {
        id: '1',
        tenantId: 'tenant-1',
        stepKey: 'setup_profile',
        isCompleted: true,
        completedAt: new Date(),
      };

      mockPrismaServiceForOnboarding.onboardingStep.update.mockResolvedValue(mockUpdatedStep);

      const result = await service.updateStep('tenant-1', '1', true);

      expect(result.isCompleted).toBe(true);
      expect(result.completedAt).toBeDefined();
      expect(mockPrismaServiceForOnboarding.onboardingStep.update).toHaveBeenCalledWith({
        where: { id: '1' },
        data: {
          isCompleted: true,
          completedAt: expect.any(Date),
        },
      });
    });

    it('should update step to incomplete', async () => {
      const mockUpdatedStep = {
        id: '1',
        tenantId: 'tenant-1',
        stepKey: 'setup_profile',
        isCompleted: false,
        completedAt: null,
      };

      mockPrismaServiceForOnboarding.onboardingStep.update.mockResolvedValue(mockUpdatedStep);

      const result = await service.updateStep('tenant-1', '1', false);

      expect(result.isCompleted).toBe(false);
      expect(result.completedAt).toBeNull();
    });
  });
});
