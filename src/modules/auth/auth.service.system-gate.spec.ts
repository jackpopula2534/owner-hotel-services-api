import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException, ConflictException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailEventsService } from '../../email/email-events.service';
import { OnboardingService } from '../../onboarding/onboarding.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';

// Mock bcrypt
jest.mock('bcrypt', () => ({
  hash: jest.fn(),
  compare: jest.fn(),
}));

import * as bcrypt from 'bcrypt';

describe('AuthService — system gate (Owner Console vs terminals)', () => {
  let service: AuthService;
  let prismaService: PrismaService;
  let jwtService: JwtService;
  let configService: ConfigService;

  const mockPrismaService = {
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    admin: {
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    refreshToken: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
    userTenant: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    property: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    user2FASettings: {
      // Default: no 2FA configured, so login proceeds to full token issuance.
      findUnique: jest.fn().mockResolvedValue(null),
    },
  };

  const mockJwtService = {
    sign: jest.fn(),
    verify: jest.fn(),
    decode: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'JWT_SECRET') return 'test-secret';
      if (key === 'JWT_EXPIRES_IN') return '15m';
      return null;
    }),
  };

  const mockEmailEventsService = {
    sendWelcomeEmail: jest.fn(),
    sendPasswordResetEmail: jest.fn(),
    onUserRegistered: jest.fn().mockResolvedValue(undefined),
    emit: jest.fn(),
  };

  const mockOnboardingService = {
    registerHotel: jest.fn(),
    getTrialStatus: jest.fn(),
    getProgress: jest.fn(),
    updateStep: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: JwtService,
          useValue: mockJwtService,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: EmailEventsService,
          useValue: mockEmailEventsService,
        },
        {
          provide: OnboardingService,
          useValue: mockOnboardingService,
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    prismaService = module.get<PrismaService>(PrismaService);
    jwtService = module.get<JwtService>(JwtService);
    configService = module.get<ConfigService>(ConfigService);

    jest.clearAllMocks();
  });

  // Regression 2026-11-09: a POS·waiter reached the Owner Console.
  const waiter = {
    id: 'w-1',
    email: 'waiter@hotel.test',
    password: 'hashed',
    role: 'waiter',
    tenantId: 'tenant-1',
    status: 'active',
    allowedSystems: '["pos"]',
  };

  beforeEach(() => {
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    mockJwtService.sign.mockReturnValue('access-token');
    mockPrismaService.refreshToken.create.mockResolvedValue({ id: 'rt', token: 'refresh-token' });
    mockPrismaService.user2FASettings.findUnique.mockResolvedValue(null);
  });

  it('refuses a POS-only account on /auth/login (main)', async () => {
    mockPrismaService.user.findUnique.mockResolvedValue(waiter);
    await expect(service.login({ email: waiter.email, password: 'x' }, undefined, 'main')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(mockJwtService.sign).not.toHaveBeenCalled();
  });

  it('still lets the same account into the POS', async () => {
    mockPrismaService.user.findUnique.mockResolvedValue(waiter);
    const res: any = await service.login({ email: waiter.email, password: 'x' }, undefined, 'pos');
    expect(res.accessToken).toBe('access-token');
  });

  it('refuses before checking the password (no oracle for the wrong system)', async () => {
    mockPrismaService.user.findUnique.mockResolvedValue(waiter);
    await expect(service.login({ email: waiter.email, password: 'x' }, undefined, 'main')).rejects.toThrow();
    expect(bcrypt.compare).not.toHaveBeenCalled();
  });

  it('refuses to complete a 2FA login into main for a POS-only account', async () => {
    mockPrismaService.user.findFirst.mockResolvedValue(waiter);
    await expect(service.completeLoginWith2FA(waiter.id, 'main')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(mockJwtService.sign).not.toHaveBeenCalled();
  });

  it('completes a 2FA login into the system the account is allowed', async () => {
    mockPrismaService.user.findFirst.mockResolvedValue(waiter);
    const res: any = await service.completeLoginWith2FA(waiter.id, 'pos');
    expect(res.accessToken).toBe('access-token');
  });

  it('refuses a hotel_manager on main even when stale data still lists "main"', async () => {
    mockPrismaService.user.findUnique.mockResolvedValue({
      ...waiter,
      role: 'hotel_manager',
      allowedSystems: '["main","hotel-terminal"]',
    });
    await expect(service.login({ email: waiter.email, password: 'x' }, undefined, 'main')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('lets the same hotel_manager into the Hotel Management Terminal', async () => {
    mockPrismaService.user.findUnique.mockResolvedValue({
      ...waiter,
      role: 'hotel_manager',
      allowedSystems: '["main","hotel-terminal"]',
    });
    const res: any = await service.login({ email: waiter.email, password: 'x' }, undefined, 'hotel-terminal');
    expect(res.accessToken).toBe('access-token');
  });

  it('keeps legacy dashboard "manager" accounts working (allowedSystems decides)', async () => {
    mockPrismaService.user.findUnique.mockResolvedValue({
      ...waiter,
      role: 'manager',
      allowedSystems: '["main"]',
    });
    const res: any = await service.login({ email: waiter.email, password: 'x' }, undefined, 'main');
    expect(res.accessToken).toBe('access-token');
  });

  it('lets an owner with main through', async () => {
    mockPrismaService.user.findUnique.mockResolvedValue({
      ...waiter,
      role: 'tenant_admin',
      allowedSystems: '["main","pos"]',
    });
    const res: any = await service.login({ email: waiter.email, password: 'x' }, undefined, 'main');
    expect(res.accessToken).toBe('access-token');
  });

  // H1.2 — Camp / Retail / CRM staff get a main session scoped to their terminals.
  describe('scoped main session for main-session terminals', () => {
    const signedPayloads = () => mockJwtService.sign.mock.calls.map((c: unknown[]) => c[0] as Record<string, unknown>);
    // generateTokens re-reads role + grants (findFirst) so refresh and 2FA mint the same scope.
    beforeEach(() => {
      mockPrismaService.user.findFirst.mockImplementation(() => mockPrismaService.user.findUnique());
    });
    afterEach(() => mockPrismaService.user.findFirst.mockReset());

    it('a crm_manager logs into main with a token scoped to crm', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({ ...waiter, role: 'crm_manager', allowedSystems: '["main","crm"]' });
      const res: any = await service.login({ email: waiter.email, password: 'x' }, undefined, 'main');
      expect(res.accessToken).toBe('access-token');
      expect(res.user.terminals).toEqual(['crm']);
      expect(signedPayloads().some((p) => JSON.stringify(p.terminals) === '["crm"]')).toBe(true);
    });

    it('a hotel_manager with an extra crm grant is let into main — scoped to crm only', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        ...waiter,
        role: 'hotel_manager',
        allowedSystems: '["main","hotel-terminal","crm"]',
      });
      const res: any = await service.login({ email: waiter.email, password: 'x' }, undefined, 'main');
      expect(res.user.terminals).toEqual(['crm']);
    });

    it('grants on several main-session terminals are unioned', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        ...waiter,
        role: 'crm_manager',
        allowedSystems: '["main","crm","retail"]',
      });
      const res: any = await service.login({ email: waiter.email, password: 'x' }, undefined, 'main');
      expect([...res.user.terminals].sort()).toEqual(['crm', 'retail']);
    });

    it('an owner gets an unscoped main token (no terminals claim)', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({ ...waiter, role: 'tenant_admin', allowedSystems: '["main","crm"]' });
      const res: any = await service.login({ email: waiter.email, password: 'x' }, undefined, 'main');
      expect(res.user.terminals ?? null).toBeNull();
      expect(signedPayloads().every((p) => !('terminals' in p))).toBe(true);
    });

    it('a waiter is still refused on main', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({ ...waiter });
      await expect(service.login({ email: waiter.email, password: 'x' }, undefined, 'main')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });
});
