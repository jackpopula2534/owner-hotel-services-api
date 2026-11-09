/**
 * FIND-04 / FIND-05 — deep-link launch tokens.
 *
 *   - every launch token is typed (`type: 'launch'`) so JwtStrategy refuses it
 *     as a bearer token, and carries a one-time `jti`
 *   - the exchange spends the jti: a replay of the same URL gets 401
 *   - a token minted before this change (no type / jti) is refused
 *   - purchasing and warehouse links now carry the default property
 */
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthService } from './auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailEventsService } from '../../email/email-events.service';
import { OnboardingService } from '../../onboarding/onboarding.service';

jest.mock('bcrypt', () => ({ hash: jest.fn(), compare: jest.fn() }));

describe('AuthService — launch tokens are single-use', () => {
  let service: AuthService;

  const owner = {
    id: 'user-1',
    email: 'owner@hotel.test',
    role: 'tenant_admin',
    tenantId: 'tenant-1',
    status: 'active',
  };
  const caller = { userId: 'user-1', email: 'owner@hotel.test', role: 'tenant_admin', tenantId: 'tenant-1' };
  const property = { id: 'prop-1', name: 'StaySync Bangkok' };

  const mockPrisma = {
    user: { findFirst: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    refreshToken: { create: jest.fn() },
    userTenant: { findFirst: jest.fn() },
    property: { findFirst: jest.fn() },
    user2FASettings: { findUnique: jest.fn() },
    consumedLaunchToken: { create: jest.fn(), deleteMany: jest.fn() },
  };
  const mockJwt = { sign: jest.fn(), verify: jest.fn(), decode: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useValue: mockJwt },
        { provide: ConfigService, useValue: { get: jest.fn((k: string) => (k === 'JWT_EXPIRES_IN' ? '15m' : null)) } },
        { provide: EmailEventsService, useValue: { onUserRegistered: jest.fn(), emit: jest.fn() } },
        { provide: OnboardingService, useValue: { registerHotel: jest.fn() } },
      ],
    }).compile();
    service = module.get(AuthService);
    jest.clearAllMocks();
    mockJwt.sign.mockReturnValue('signed');
    mockJwt.decode.mockReturnValue({ exp: 1_800_000_000 });
    mockPrisma.user.findFirst.mockResolvedValue(owner);
    mockPrisma.refreshToken.create.mockResolvedValue({});
    mockPrisma.userTenant.findFirst.mockResolvedValue(null);
    mockPrisma.property.findFirst.mockResolvedValue(property);
    mockPrisma.user2FASettings.findUnique.mockResolvedValue(null);
    mockPrisma.consumedLaunchToken.create.mockResolvedValue({});
    mockPrisma.consumedLaunchToken.deleteMany.mockResolvedValue({ count: 0 });
  });

  const claims = {
    type: 'launch',
    jti: '6f1c2c1e-0000-4000-8000-000000000001',
    exp: 1_800_000_000,
    sub: 'user-1',
    tenantId: 'tenant-1',
    role: 'procurement_manager',
    purchasingLaunch: true,
    permissions: ['pr.create'],
  };

  it('signs launch tokens with type "launch" and a fresh jti', async () => {
    await service.generatePurchasingLaunchToken(caller);
    await service.generatePurchasingLaunchToken(caller);
    const [first, second] = mockJwt.sign.mock.calls.map((c) => c[0]);
    expect(first).toEqual(expect.objectContaining({ type: 'launch', jti: expect.any(String) }));
    expect(first.jti).not.toBe(second.jti);
    expect(mockJwt.sign.mock.calls[0][1]).toEqual({ expiresIn: '5m' });
  });

  it('records the jti on the first exchange', async () => {
    mockJwt.verify.mockReturnValue(claims);
    const session = await service.exchangePurchasingLaunchToken('launch-jwt');
    expect(session.accessToken).toBe('signed');
    expect(mockPrisma.consumedLaunchToken.create).toHaveBeenCalledWith({
      data: { jti: claims.jti, userId: 'user-1', expiresAt: new Date(1_800_000_000 * 1000) },
    });
  });

  it('refuses a replay of the same link and issues no session', async () => {
    mockJwt.verify.mockReturnValue(claims);
    mockPrisma.consumedLaunchToken.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }),
    );
    await expect(service.exchangePurchasingLaunchToken('launch-jwt')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(mockPrisma.refreshToken.create).not.toHaveBeenCalled();
  });

  it('refuses an untyped token (minted before the change, or an access token)', async () => {
    const { type: _type, jti: _jti, ...legacy } = claims;
    mockJwt.verify.mockReturnValue(legacy);
    await expect(service.exchangePurchasingLaunchToken('launch-jwt')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(mockPrisma.consumedLaunchToken.create).not.toHaveBeenCalled();
  });

  it('FIND-05: purchasing and warehouse links carry the default property', async () => {
    await service.generatePurchasingLaunchToken(caller);
    await service.generateWarehouseLaunchToken(caller);
    for (const [payload] of mockJwt.sign.mock.calls) {
      expect(payload).toEqual(expect.objectContaining({ propertyId: 'prop-1', propertyName: 'StaySync Bangkok' }));
    }
  });

  it('FIND-05: the purchasing and warehouse sessions return propertyId', async () => {
    mockJwt.verify.mockReturnValue(claims);
    const purchasing = await service.exchangePurchasingLaunchToken('launch-jwt');
    expect((purchasing.user as { propertyId?: string }).propertyId).toBe('prop-1');

    mockJwt.verify.mockReturnValue({ ...claims, purchasingLaunch: undefined, warehouseLaunch: true, jti: 'jti-2' });
    const warehouse = await service.exchangeWarehouseLaunchToken('launch-jwt');
    expect((warehouse.user as { propertyId?: string }).propertyId).toBe('prop-1');
  });
});
