import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from '../../../src/modules/auth/auth.service';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { EmailEventsService } from '../../../src/email/email-events.service';
import { OnboardingService } from '../../../src/onboarding/onboarding.service';
import { ConflictException } from '@nestjs/common';

describe('AuthService - Registration with UserTenant', () => {
  let service: AuthService;
  let prisma: PrismaService;

  const mockRegisterDto = {
    email: 'newuser@example.com',
    password: 'password123',
    firstName: 'John',
    lastName: 'Doe',
    hotelName: 'Hotel Paradise',
    hotelAddress: '123 Main St',
    hotelPhone: '+66812345678',
  };

  const mockOnboardingResult = {
    tenant: {
      id: 'tenant-1',
      name: 'Hotel Paradise',
      status: 'trial',
    },
    subscription: {
      id: 'sub-1',
      status: 'trial',
    },
    trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    message: 'Trial subscription created',
    property: {
      id: 'prop-1',
      name: 'Default Property',
      code: 'DEFAULT',
    },
  };

  const mockCreatedUser = {
    id: 'user-1',
    email: 'newuser@example.com',
    firstName: 'John',
    lastName: 'Doe',
    role: 'tenant_admin',
    tenantId: null,
    createdAt: new Date(),
  };

  const mockUpdatedUser = {
    ...mockCreatedUser,
    tenantId: 'tenant-1',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: PrismaService,
          useValue: {
            user: {
              findUnique: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
            },
            userTenant: {
              create: jest.fn(),
            },
            refreshToken: {
              create: jest.fn(),
            },
          },
        },
        {
          provide: JwtService,
          useValue: {
            sign: jest.fn().mockReturnValue('mock-token'),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('15m'),
          },
        },
        {
          provide: EmailEventsService,
          useValue: {
            onUserRegistered: jest.fn().mockResolvedValue({}),
          },
        },
        {
          provide: OnboardingService,
          useValue: {
            registerHotel: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  describe('register', () => {
    it('should create user with tenant and UserTenant record', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.user.create as jest.Mock).mockResolvedValue(mockCreatedUser);
      (prisma.user.update as jest.Mock).mockResolvedValue(mockUpdatedUser);
      (prisma.refreshToken.create as jest.Mock).mockResolvedValue({});

      // Mock OnboardingService
      const onboardingService = Test.get(service as any, 'onboardingService');
      jest.spyOn(onboardingService, 'registerHotel').mockResolvedValue(mockOnboardingResult);

      const result = await service.register(mockRegisterDto);

      // Verify user was created
      expect(prisma.user.create).toHaveBeenCalled();

      // Verify user was updated with tenantId
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { tenantId: 'tenant-1' },
        select: expect.objectContaining({
          id: true,
          email: true,
          tenantId: true,
        }),
      });

      // Verify UserTenant record was created
      expect(prisma.userTenant.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          tenantId: 'tenant-1',
          role: 'owner',
          isDefault: true,
        },
      });

      // Verify response contains onboarding info
      expect(result.onboarding).toBeDefined();
      expect(result.onboarding.tenantId).toBe('tenant-1');
      expect(result.onboarding.subscriptionId).toBe('sub-1');
    });

    it('should throw ConflictException if user already exists', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'existing-user',
        email: 'newuser@example.com',
      });

      await expect(service.register(mockRegisterDto)).rejects.toThrow(
        ConflictException
      );

      // Verify no user creation was attempted
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('should handle onboarding failure gracefully', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.user.create as jest.Mock).mockResolvedValue(mockCreatedUser);
      (prisma.user.update as jest.Mock).mockResolvedValue(mockCreatedUser); // Update fails silently
      (prisma.refreshToken.create as jest.Mock).mockResolvedValue({});

      // Mock OnboardingService to throw
      const onboardingService = Test.get(service as any, 'onboardingService');
      jest.spyOn(onboardingService, 'registerHotel').mockRejectedValue(
        new Error('Onboarding failed')
      );

      const result = await service.register(mockRegisterDto);

      // User should still be created
      expect(result.user).toBeDefined();
      expect(result.user.email).toBe('newuser@example.com');

      // Onboarding should be undefined
      expect(result.onboarding).toBeUndefined();
    });

    it('should create refresh token with user ID', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.user.create as jest.Mock).mockResolvedValue(mockCreatedUser);
      (prisma.user.update as jest.Mock).mockResolvedValue(mockUpdatedUser);
      (prisma.refreshToken.create as jest.Mock).mockResolvedValue({});

      const onboardingService = Test.get(service as any, 'onboardingService');
      jest.spyOn(onboardingService, 'registerHotel').mockResolvedValue(mockOnboardingResult);

      await service.register(mockRegisterDto);

      expect(prisma.refreshToken.create).toHaveBeenCalledWith({
        data: {
          token: expect.any(String),
          userId: 'user-1',
          adminId: null,
          expiresAt: expect.any(Date),
        },
      });
    });
  });
});
