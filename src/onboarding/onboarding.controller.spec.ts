import { Test, TestingModule } from '@nestjs/testing';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';
import { CreateTenantDto } from '../tenants/dto/create-tenant.dto';

describe('OnboardingController', () => {
  let controller: OnboardingController;
  let service: OnboardingService;

  const mockOnboardingResult = {
    tenant: {
      id: 'tenant-1',
      name: 'Test Hotel',
      email: 'test@hotel.com',
      status: 'trial',
    },
    subscription: {
      id: 'sub-1',
      status: 'trial',
    },
    trialEndsAt: new Date('2024-03-15'),
    message: 'Hotel registered successfully. Trial period: 14 days.',
  };

  const mockOnboardingService = {
    registerHotel: jest.fn(),
    getTrialStatus: jest.fn(),
    getProgress: jest.fn(),
    updateStep: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [OnboardingController],
      providers: [
        {
          provide: OnboardingService,
          useValue: mockOnboardingService,
        },
      ],
    }).compile();

    controller = module.get<OnboardingController>(OnboardingController);
    service = module.get<OnboardingService>(OnboardingService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('registerHotel', () => {
    it('should register a new hotel with default trial days', async () => {
      const dto: CreateTenantDto = {
        name: 'Test Hotel',
      };

      mockOnboardingService.registerHotel.mockResolvedValue(mockOnboardingResult);

      const result = await controller.registerHotel(dto);

      expect(service.registerHotel).toHaveBeenCalledWith(dto, 14);
      expect(result).toEqual(mockOnboardingResult);
    });

    it('should register a new hotel with custom trial days', async () => {
      const dto: CreateTenantDto = {
        name: 'Test Hotel',
      };

      mockOnboardingService.registerHotel.mockResolvedValue(mockOnboardingResult);

      await controller.registerHotel(dto, 30);

      expect(service.registerHotel).toHaveBeenCalledWith(dto, 30);
    });
  });

  describe('getTrialStatus', () => {
    it('should return trial status for a tenant', async () => {
      const mockStatus = {
        isTrial: true,
        daysRemaining: 10,
        trialEndsAt: new Date('2024-03-15'),
        canAccessPMS: true,
      };

      mockOnboardingService.getTrialStatus.mockResolvedValue(mockStatus);

      const result = await controller.getTrialStatus('tenant-1');

      expect(service.getTrialStatus).toHaveBeenCalledWith('tenant-1');
      expect(result).toEqual(mockStatus);
    });
  });

  describe('getProgress', () => {
    it('should return onboarding progress for authenticated user', async () => {
      const mockUser = { id: 'user-1', tenantId: 'tenant-1' };
      const mockSteps = [
        { id: '1', stepKey: 'setup_profile', isCompleted: true },
        { id: '2', stepKey: 'create_room', isCompleted: false },
      ];

      mockOnboardingService.getProgress.mockResolvedValue(mockSteps);

      const result = await controller.getProgress(mockUser);

      expect(service.getProgress).toHaveBeenCalledWith('tenant-1');
      expect(result).toEqual(mockSteps);
    });
  });

  describe('updateStep', () => {
    it('should update onboarding step', async () => {
      const mockUser = { id: 'user-1', tenantId: 'tenant-1' };
      const mockUpdatedStep = {
        id: '1',
        stepKey: 'setup_profile',
        isCompleted: true,
        completedAt: new Date(),
      };

      mockOnboardingService.updateStep.mockResolvedValue(mockUpdatedStep);

      const result = await controller.updateStep('1', true, mockUser);

      expect(service.updateStep).toHaveBeenCalledWith('tenant-1', '1', true);
      expect(result).toEqual(mockUpdatedStep);
    });
  });
});
