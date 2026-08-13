/**
 * Purchasing and Hotel Terminal deep-link launch coverage for AuthService.
 *
 * Both terminals used to keep the 5-minute launch token *as* their session.
 * A launch token carries no refresh token, so a few minutes in every poll
 * started to 401 and the staff were thrown back to the login screen — the same
 * failure the POS had. exchange*LaunchToken turns the hand-off into a real,
 * renewable session instead.
 *
 * Covers, per system:
 *   - valid launch token → session tagged with the right systemContext + refresh token
 *   - the role and permission set the link granted survive onto the user object
 *     (the terminal shells gate their menus on exactly those two fields)
 *   - the account's own permissions are used when the token carries none
 *   - a launch token for a *different* system is refused
 *   - an expired / tampered token, and an account suspended since the link was
 *     made, are refused
 *
 * The POS half lives in auth.service.pos-launch.spec.ts.
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

describe('AuthService — sub-system launch exchange', () => {
  let service: AuthService;

  // A hotel owner opening a terminal from the dashboard: tenant_admin in the
  // database, elevated to the terminal's manager role by the launch token.
  const owner = {
    id: 'user-1',
    email: 'owner@hotel.test',
    firstName: 'Somchai',
    lastName: 'Owner',
    role: 'tenant_admin',
    tenantId: 'tenant-1',
    status: 'active',
  };

  const purchasingClaims = {
    sub: 'user-1',
    email: 'owner@hotel.test',
    role: 'procurement_manager',
    tenantId: 'tenant-1',
    purchasingLaunch: true,
    permissions: ['pr.create', 'po.approve', 'user.manage'],
  };

  const hotelTerminalClaims = {
    sub: 'user-1',
    email: 'owner@hotel.test',
    role: 'hotel_manager',
    tenantId: 'tenant-1',
    hotelTerminalLaunch: true,
    permissions: ['frontdesk.manage', 'housekeeping.manage'],
    propertyId: 'prop-1',
    propertyName: 'StaySync Bangkok',
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
    // generateTokens reads `exp` off the signed token to tell the terminal when to refresh
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
    mockPrisma.userTenant.findFirst.mockResolvedValue(null);
    mockPrisma.property.findFirst.mockResolvedValue(null);
  });

  describe('purchasing', () => {
    it('trades a launch token for a procurement session the terminal can renew', async () => {
      mockJwt.verify.mockReturnValue(purchasingClaims);
      mockPrisma.user.findFirst.mockResolvedValue(owner);

      const result = await service.exchangePurchasingLaunchToken('launch-jwt', {
        ipAddress: '10.0.0.5',
        userAgent: 'Purchasing terminal',
      });

      expect(result.accessToken).toBe('new-access-token');
      // The whole point — the 5-minute launch token had no way back.
      expect(result.refreshToken).toEqual(expect.any(String));
      expect(result.refreshToken.length).toBeGreaterThan(0);

      // Tagged procurement, so guards and /auth/refresh keep it on purchasing.
      expect(mockJwt.sign).toHaveBeenCalledWith(
        expect.objectContaining({ sub: 'user-1', systemContext: 'procurement' }),
        expect.objectContaining({ expiresIn: '15m' }),
      );
      expect(mockPrisma.refreshToken.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: 'user-1', systemContext: 'procurement' }),
        }),
      );
    });

    it('keeps the manager role and permissions the deep link granted', async () => {
      mockJwt.verify.mockReturnValue(purchasingClaims);
      mockPrisma.user.findFirst.mockResolvedValue(owner);

      const result = await service.exchangePurchasingLaunchToken('launch-jwt');

      // The purchasing shell hides every menu item without these two fields.
      expect(result.user.role).toBe('procurement_manager');
      expect(result.user.permissions).toEqual(['pr.create', 'po.approve', 'user.manage']);
    });

    it('signs the access token with the account real role, not the granted one', async () => {
      mockJwt.verify.mockReturnValue(purchasingClaims);
      mockPrisma.user.findFirst.mockResolvedValue(owner);

      await service.exchangePurchasingLaunchToken('launch-jwt');

      // /auth/refresh rebuilds tokens from the database, so a forged role would
      // vanish at the first renewal anyway — better it was never in there.
      expect(mockJwt.sign).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'tenant_admin' }),
        expect.anything(),
      );
    });

    it("falls back to the account own procurement permissions when the link carries none", async () => {
      mockJwt.verify.mockReturnValue({ ...purchasingClaims, permissions: [] });
      mockPrisma.user.findFirst.mockResolvedValue({
        ...owner,
        procurementPermissions: JSON.stringify(['pr.view']),
      });

      const result = await service.exchangePurchasingLaunchToken('launch-jwt');

      expect(result.user.permissions).toEqual(['pr.view']);
    });

    it('refuses a POS launch token — one link cannot open another system', async () => {
      mockJwt.verify.mockReturnValue({ sub: 'user-1', posLaunch: true });

      await expect(service.exchangePurchasingLaunchToken('pos-jwt')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockPrisma.user.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.refreshToken.create).not.toHaveBeenCalled();
    });

    it('refuses an expired or tampered link', async () => {
      mockJwt.verify.mockImplementation(() => {
        throw new Error('jwt expired');
      });

      await expect(service.exchangePurchasingLaunchToken('stale-jwt')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockPrisma.user.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('hotel terminal', () => {
    it('trades a launch token for a hotel-terminal session the terminal can renew', async () => {
      mockJwt.verify.mockReturnValue(hotelTerminalClaims);
      mockPrisma.user.findFirst.mockResolvedValue(owner);

      const result = await service.exchangeHotelTerminalLaunchToken('launch-jwt', {
        ipAddress: '10.0.0.7',
        userAgent: 'Hotel terminal',
      });

      expect(result.accessToken).toBe('new-access-token');
      expect(result.refreshToken.length).toBeGreaterThan(0);
      expect(mockJwt.sign).toHaveBeenCalledWith(
        expect.objectContaining({ sub: 'user-1', systemContext: 'hotel-terminal' }),
        expect.objectContaining({ expiresIn: '15m' }),
      );
      expect(mockPrisma.refreshToken.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: 'user-1', systemContext: 'hotel-terminal' }),
        }),
      );
    });

    it('keeps the manager role and permissions the deep link granted', async () => {
      mockJwt.verify.mockReturnValue(hotelTerminalClaims);
      mockPrisma.user.findFirst.mockResolvedValue(owner);

      const result = await service.exchangeHotelTerminalLaunchToken('launch-jwt');

      expect(result.user.role).toBe('hotel_manager');
      expect(result.user.permissions).toEqual(['frontdesk.manage', 'housekeeping.manage']);
    });

    it('prefers the property resolved now over the one baked into the link', async () => {
      mockJwt.verify.mockReturnValue(hotelTerminalClaims);
      mockPrisma.user.findFirst.mockResolvedValue(owner);
      mockPrisma.property.findFirst.mockResolvedValue({
        id: 'prop-2',
        name: 'StaySync Chiang Mai',
        code: 'CNX',
      });

      const result = await service.exchangeHotelTerminalLaunchToken('launch-jwt');

      expect(result.user.propertyId).toBe('prop-2');
      expect(result.user.propertyName).toBe('StaySync Chiang Mai');
    });

    it('falls back to the property the link resolved when the tenant has none now', async () => {
      mockJwt.verify.mockReturnValue(hotelTerminalClaims);
      mockPrisma.user.findFirst.mockResolvedValue(owner);

      const result = await service.exchangeHotelTerminalLaunchToken('launch-jwt');

      expect(result.user.propertyId).toBe('prop-1');
      expect(result.user.propertyName).toBe('StaySync Bangkok');
    });

    it('refuses a purchasing launch token', async () => {
      mockJwt.verify.mockReturnValue(purchasingClaims);

      await expect(service.exchangeHotelTerminalLaunchToken('purchasing-jwt')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockPrisma.refreshToken.create).not.toHaveBeenCalled();
    });

    it('refuses an account suspended since the link was made', async () => {
      mockJwt.verify.mockReturnValue(hotelTerminalClaims);
      mockPrisma.user.findFirst.mockResolvedValue({ ...owner, status: 'suspended' });

      await expect(service.exchangeHotelTerminalLaunchToken('launch-jwt')).rejects.toThrow();
      expect(mockPrisma.refreshToken.create).not.toHaveBeenCalled();
    });
  });
});
