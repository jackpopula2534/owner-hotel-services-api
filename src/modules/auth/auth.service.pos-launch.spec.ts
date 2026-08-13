/**
 * POS deep-link launch coverage for AuthService.
 *
 * The launch token is a 5-minute hand-off with no refresh token. A POS that
 * kept it *as* its session went dead mid-shift — every poll started to 401 and
 * the terminal bounced staff back to the login screen. exchangePosLaunchToken
 * turns that hand-off into a real POS session instead.
 *
 * Covers:
 *   - valid launch token → session tagged systemContext="pos", with a refresh token
 *   - the restaurant/table the link pointed at come back with the session
 *   - a normal access token (no posLaunch claim) is refused
 *   - an expired / tampered token is refused
 *   - an account suspended since the link was made is refused
 *
 * Kept in its own spec from auth.service.spec.ts, which is already large.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailEventsService } from '../../email/email-events.service';
import { OnboardingService } from '../../onboarding/onboarding.service';

jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('hashed-pw'),
  compare: jest.fn(),
}));

describe('AuthService — POS launch exchange', () => {
  let service: AuthService;

  const activeManager = {
    id: 'user-1',
    email: 'manager@hotel.test',
    firstName: 'Nong',
    lastName: 'Manager',
    role: 'manager',
    tenantId: 'tenant-1',
    status: 'active',
  };

  const launchClaims = {
    sub: 'user-1',
    email: 'manager@hotel.test',
    role: 'manager',
    tenantId: 'tenant-1',
    posLaunch: true,
    restaurantId: 'rest-1',
    tableId: 'table-9',
  };

  const mockPrisma = {
    user: { findFirst: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    refreshToken: { create: jest.fn().mockResolvedValue({}) },
    userTenant: { findFirst: jest.fn().mockResolvedValue(null) },
    property: { findFirst: jest.fn().mockResolvedValue(null) },
    user2FASettings: { findUnique: jest.fn().mockResolvedValue(null) },
  };
  const mockJwt = {
    sign: jest.fn().mockReturnValue('new-access-token'),
    verify: jest.fn(),
    // generateTokens reads `exp` off the signed token to tell the POS when to refresh
    decode: jest.fn().mockReturnValue({ exp: 1_800_000_000 }),
  };
  const mockConfig = {
    get: jest.fn((key: string) => (key === 'JWT_EXPIRES_IN' ? '15m' : null)),
  };
  const mockEmail = { onUserRegistered: jest.fn(), emit: jest.fn() };
  const mockOnboarding = { registerHotel: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useValue: mockJwt },
        { provide: ConfigService, useValue: mockConfig },
        { provide: EmailEventsService, useValue: mockEmail },
        { provide: OnboardingService, useValue: mockOnboarding },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jest.clearAllMocks();
    mockJwt.sign.mockReturnValue('new-access-token');
    mockJwt.decode.mockReturnValue({ exp: 1_800_000_000 });
    mockPrisma.refreshToken.create.mockResolvedValue({});
  });

  it('trades a launch token for a POS session the terminal can renew', async () => {
    mockJwt.verify.mockReturnValue(launchClaims);
    mockPrisma.user.findFirst.mockResolvedValue(activeManager);

    const result = await service.exchangePosLaunchToken('launch-jwt', {
      ipAddress: '10.0.0.5',
      userAgent: 'POS terminal',
    });

    expect(result.accessToken).toBe('new-access-token');
    // The whole point of the exchange — the 5-minute token had none of this.
    expect(result.refreshToken).toEqual(expect.any(String));
    expect(result.refreshToken.length).toBeGreaterThan(0);
    expect(result.user).toEqual(expect.objectContaining({ id: 'user-1', role: 'manager' }));

    // The session is a POS session, so guards and /auth/refresh keep it on POS.
    expect(mockJwt.sign).toHaveBeenCalledWith(
      expect.objectContaining({ sub: 'user-1', systemContext: 'pos' }),
      expect.objectContaining({ expiresIn: '15m' }),
    );
    expect(mockPrisma.refreshToken.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: 'user-1', systemContext: 'pos' }),
      }),
    );
  });

  it('hands back the restaurant and table the link pointed at', async () => {
    mockJwt.verify.mockReturnValue(launchClaims);
    mockPrisma.user.findFirst.mockResolvedValue(activeManager);

    const result = await service.exchangePosLaunchToken('launch-jwt');

    expect(result.restaurantId).toBe('rest-1');
    expect(result.tableId).toBe('table-9');
  });

  it('refuses an ordinary access token — only a posLaunch hand-off qualifies', async () => {
    mockJwt.verify.mockReturnValue({ sub: 'user-1', systemContext: 'main' });

    await expect(service.exchangePosLaunchToken('some-session-token')).rejects.toThrow(
      UnauthorizedException,
    );
    expect(mockPrisma.refreshToken.create).not.toHaveBeenCalled();
  });

  it('refuses an expired or tampered link', async () => {
    mockJwt.verify.mockImplementation(() => {
      throw new Error('jwt expired');
    });

    await expect(service.exchangePosLaunchToken('stale-jwt')).rejects.toThrow(
      UnauthorizedException,
    );
    expect(mockPrisma.user.findFirst).not.toHaveBeenCalled();
  });

  it('refuses an account suspended since the link was made', async () => {
    mockJwt.verify.mockReturnValue(launchClaims);
    mockPrisma.user.findFirst.mockResolvedValue({ ...activeManager, status: 'suspended' });

    await expect(service.exchangePosLaunchToken('launch-jwt')).rejects.toThrow();
    expect(mockPrisma.refreshToken.create).not.toHaveBeenCalled();
  });
});
