/**
 * Password reset coverage for AuthService.
 *
 * Kept in a separate spec from auth.service.spec.ts to avoid bloating the
 * already-large existing file. Same mock pattern.
 *
 * Covers:
 *   - forgotPassword: existing user → token created + email triggered
 *   - forgotPassword: unknown email → silent success (no token leak)
 *   - resetPassword: valid token → password hashed, user updated, token deleted
 *   - resetPassword: expired token → BadRequestException
 *   - resetPassword: missing token → BadRequestException
 */
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailEventsService } from '../../email/email-events.service';
import { OnboardingService } from '../../onboarding/onboarding.service';

jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('hashed-pw'),
  compare: jest.fn(),
}));

import * as bcrypt from 'bcrypt';

describe('AuthService — password reset', () => {
  let service: AuthService;

  const mockPrisma = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    password_resets: {
      create: jest.fn(),
      findUnique: jest.fn(),
      delete: jest.fn(),
    },
    refreshToken: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn(), delete: jest.fn() },
    userTenant: { findFirst: jest.fn().mockResolvedValue(null) },
    admin: { findUnique: jest.fn() },
  };
  const mockEmail = {
    onUserRegistered: jest.fn().mockResolvedValue(undefined),
    onPasswordResetRequested: jest.fn().mockResolvedValue(undefined),
    sendWelcomeEmail: jest.fn(),
    sendPasswordResetEmail: jest.fn(),
    emit: jest.fn(),
  };
  const mockJwt = { sign: jest.fn(), verify: jest.fn(), decode: jest.fn() };
  const mockConfig = { get: jest.fn() };
  const mockOnboarding = { registerHotel: jest.fn() };

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useValue: mockJwt },
        { provide: ConfigService, useValue: mockConfig },
        { provide: EmailEventsService, useValue: mockEmail },
        { provide: OnboardingService, useValue: mockOnboarding },
      ],
    }).compile();
    service = moduleRef.get(AuthService);
    jest.clearAllMocks();
  });

  describe('forgotPassword', () => {
    it('returns generic message + creates reset record + triggers email when user exists', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'user@example.com',
        firstName: 'Alice',
      });
      mockPrisma.password_resets.create.mockResolvedValue({});

      const result = await service.forgotPassword('user@example.com');

      expect(result.message).toMatch(/reset link has been sent/i);
      expect(mockPrisma.password_resets.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: 'user@example.com',
            token: expect.any(String),
            expiresAt: expect.any(Date),
          }),
        }),
      );
      // Token should be a 64-char hex (randomBytes(32).toString('hex'))
      const callArgs = mockPrisma.password_resets.create.mock.calls[0][0];
      expect(callArgs.data.token).toMatch(/^[a-f0-9]{64}$/);
      // Expiry roughly 1 hour from now (within a few seconds tolerance).
      const expiresMs = callArgs.data.expiresAt.getTime() - Date.now();
      expect(expiresMs).toBeGreaterThan(59 * 60 * 1000);
      expect(expiresMs).toBeLessThan(61 * 60 * 1000);

      expect(mockEmail.onPasswordResetRequested).toHaveBeenCalledWith(
        'user@example.com',
        expect.any(String),
        'Alice',
      );
    });

    it('returns the same generic message for unknown email — no DB write, no email', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const result = await service.forgotPassword('ghost@example.com');

      expect(result.message).toMatch(/reset link has been sent/i);
      expect(mockPrisma.password_resets.create).not.toHaveBeenCalled();
      expect(mockEmail.onPasswordResetRequested).not.toHaveBeenCalled();
    });

    it('falls back to "User" if firstName is missing', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'a@b.com',
        firstName: null,
      });
      await service.forgotPassword('a@b.com');
      expect(mockEmail.onPasswordResetRequested).toHaveBeenCalledWith(
        'a@b.com',
        expect.any(String),
        'User',
      );
    });
  });

  describe('resetPassword', () => {
    it('hashes new password, updates the user, and deletes the used token', async () => {
      const future = new Date(Date.now() + 30 * 60 * 1000);
      mockPrisma.password_resets.findUnique.mockResolvedValue({
        id: 'reset-1',
        token: 'valid-token',
        email: 'user@example.com',
        expiresAt: future,
      });
      mockPrisma.user.update.mockResolvedValue({});
      mockPrisma.password_resets.delete.mockResolvedValue({});

      const result = await service.resetPassword('valid-token', 'NewSecret123!');

      expect(bcrypt.hash).toHaveBeenCalledWith('NewSecret123!', 10);
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { email: 'user@example.com' },
        data: { password: 'hashed-pw' },
      });
      expect(mockPrisma.password_resets.delete).toHaveBeenCalledWith({
        where: { id: 'reset-1' },
      });
      expect(result.message).toMatch(/reset successfully/i);
    });

    it('throws BadRequestException when the token does not exist', async () => {
      mockPrisma.password_resets.findUnique.mockResolvedValue(null);
      await expect(service.resetPassword('bogus', 'pw')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when the token has expired', async () => {
      mockPrisma.password_resets.findUnique.mockResolvedValue({
        id: 'reset-1',
        token: 'expired',
        email: 'user@example.com',
        expiresAt: new Date(Date.now() - 60_000),
      });
      await expect(service.resetPassword('expired', 'pw')).rejects.toThrow(
        /invalid or expired/i,
      );
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
      expect(mockPrisma.password_resets.delete).not.toHaveBeenCalled();
    });
  });
});
