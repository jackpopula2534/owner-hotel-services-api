import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { JwtStrategy } from './jwt.strategy';

/**
 * Coverage target: jwt.strategy.ts — security-critical.
 *
 * Tests cover:
 *   - validate() with no payload → UnauthorizedException
 *   - platform admin bypass (no DB call)
 *   - active user → returns claims
 *   - suspended / expired / inactive user → UnauthorizedException with proper message
 *   - expiresAt in the past → UnauthorizedException
 *   - user not found → UnauthorizedException
 *   - DB error → token still passes (graceful degradation, logger.warn)
 */
describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  const userFindUnique = jest.fn();

  const configService = {
    getOrThrow: jest.fn((key: string) => {
      if (key === 'JWT_SECRET') return 'test-secret-key';
      throw new Error(`unexpected config key: ${key}`);
    }),
  } as unknown as ConfigService;

  const prisma = {
    user: { findUnique: userFindUnique },
  } as unknown as PrismaService;

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        JwtStrategy,
        { provide: ConfigService, useValue: configService },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    strategy = moduleRef.get(JwtStrategy);
    userFindUnique.mockReset();
  });

  it('should be defined', () => {
    expect(strategy).toBeDefined();
  });

  describe('validate', () => {
    it('throws UnauthorizedException when payload is empty', async () => {
      await expect(strategy.validate(null)).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(strategy.validate(undefined)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('returns claims for platform admin without hitting DB', async () => {
      const payload = {
        sub: 'platform-1',
        email: 'admin@example.com',
        role: 'platform_admin',
        isPlatformAdmin: true,
      };
      const result = await strategy.validate(payload);

      expect(userFindUnique).not.toHaveBeenCalled();
      expect(result).toEqual({
        id: 'platform-1',
        userId: 'platform-1',
        email: 'admin@example.com',
        role: 'platform_admin',
        tenantId: undefined,
        isPlatformAdmin: true,
      });
    });

    it('returns claims for an active user', async () => {
      userFindUnique.mockResolvedValue({
        id: 'user-1',
        status: 'active',
        expiresAt: null,
      });
      const payload = {
        sub: 'user-1',
        email: 'staff@example.com',
        role: 'manager',
        tenantId: 'tenant-1',
      };

      const result = await strategy.validate(payload);

      expect(userFindUnique).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        select: expect.objectContaining({ id: true, status: true, expiresAt: true }),
      });
      expect(result).toEqual({
        id: 'user-1',
        userId: 'user-1',
        email: 'staff@example.com',
        role: 'manager',
        tenantId: 'tenant-1',
        isPlatformAdmin: false,
      });
    });

    it('throws when user is not found in DB', async () => {
      userFindUnique.mockResolvedValue(null);
      await expect(
        strategy.validate({ sub: 'ghost-user' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it.each([
      ['suspended', 'บัญชีของคุณถูกระงับการใช้งาน'],
      ['expired', 'บัญชีของคุณหมดอายุการใช้งาน'],
      ['inactive', 'บัญชีของคุณถูกปิดการใช้งาน'],
      ['locked', 'บัญชีของคุณไม่อยู่ในสถานะใช้งาน'],
    ])('throws specific message for status=%s', async (status, expectedMsg) => {
      userFindUnique.mockResolvedValue({ id: 'user-1', status, expiresAt: null });
      await expect(strategy.validate({ sub: 'user-1' })).rejects.toThrow(expectedMsg);
    });

    it('throws when expiresAt is in the past', async () => {
      userFindUnique.mockResolvedValue({
        id: 'user-1',
        status: 'active',
        expiresAt: new Date(Date.now() - 60_000),
      });
      await expect(strategy.validate({ sub: 'user-1' })).rejects.toThrow(
        'บัญชีของคุณหมดอายุการใช้งาน',
      );
    });

    it('lets the token pass when DB query throws (graceful degradation)', async () => {
      userFindUnique.mockRejectedValue(new Error('DB unreachable'));
      const result = await strategy.validate({
        sub: 'user-1',
        email: 'a@b.com',
        role: 'manager',
        tenantId: 't-1',
      });
      // Strategy should NOT throw — returns claims so the rest of the request can run.
      expect(result.id).toBe('user-1');
      expect(result.email).toBe('a@b.com');
    });
  });
});
