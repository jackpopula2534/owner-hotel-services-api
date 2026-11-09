import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ImpersonationService } from './impersonation.service';
import { PrismaService } from '../prisma/prisma.service';

describe('ImpersonationService', () => {
  let service: ImpersonationService;
  let mockSessionFindUnique: jest.Mock;
  let mockSessionCreate: jest.Mock;
  let mockSessionUpdate: jest.Mock;
  let mockSessionFindMany: jest.Mock;
  let mockTenantFindUnique: jest.Mock;
  let mockJwtSign: jest.Mock;

  beforeEach(async () => {
    mockSessionFindUnique = jest.fn();
    mockSessionCreate = jest
      .fn()
      .mockImplementation(async ({ data }) => ({ id: 'sess-1', ...data }));
    mockSessionUpdate = jest.fn().mockResolvedValue({});
    mockSessionFindMany = jest.fn().mockResolvedValue([]);
    mockTenantFindUnique = jest.fn();
    mockJwtSign = jest.fn().mockReturnValue('signed-jwt');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ImpersonationService,
        {
          provide: PrismaService,
          useValue: {
            impersonation_sessions: {
              findUnique: mockSessionFindUnique,
              create: mockSessionCreate,
              update: mockSessionUpdate,
              findMany: mockSessionFindMany,
            },
            tenants: { findUnique: mockTenantFindUnique },
          },
        },
        { provide: JwtService, useValue: { sign: mockJwtSign } },
      ],
    }).compile();

    service = module.get(ImpersonationService);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe('start', () => {
    it('issues a token and creates a session', async () => {
      mockTenantFindUnique.mockResolvedValue({ id: 't1', name: 'X', status: 'active' });

      const r = await service.start({
        adminId: 'admin-1',
        tenantId: 't1',
        reason: 'Customer ticket #42',
      });

      expect(r.token).toBe('signed-jwt');
      expect(r.sessionId).toBe('sess-1');
      expect(r.scope).toBe('read_only');
      expect(mockSessionCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            admin_id: 'admin-1',
            target_tenant_id: 't1',
            scope: 'read_only',
          }),
        }),
      );
    });

    it('rejects without a reason', async () => {
      mockTenantFindUnique.mockResolvedValue({ id: 't1' });
      await expect(service.start({ adminId: 'a', tenantId: 't1', reason: '' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws NotFound when tenant missing', async () => {
      mockTenantFindUnique.mockResolvedValue(null);
      await expect(
        service.start({ adminId: 'a', tenantId: 'missing', reason: 'r' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('caps TTL to 60 minutes', async () => {
      mockTenantFindUnique.mockResolvedValue({ id: 't1' });
      await service.start({
        adminId: 'a',
        tenantId: 't1',
        reason: 'r',
        ttlMinutes: 999,
      });
      // jwt.sign called with expiresIn = '60m' (capped)
      expect(mockJwtSign).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ expiresIn: '60m' }),
      );
    });
  });

  describe('end', () => {
    it('marks an active session as ended', async () => {
      mockSessionFindUnique.mockResolvedValue({
        id: 'sess-1',
        admin_id: 'admin-1',
        status: 'active',
      });
      await service.end('sess-1', 'admin-1');
      expect(mockSessionUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'ended' }),
        }),
      );
    });

    it('rejects when a different admin tries to end', async () => {
      mockSessionFindUnique.mockResolvedValue({
        id: 'sess-1',
        admin_id: 'admin-1',
        status: 'active',
      });
      await expect(service.end('sess-1', 'admin-2')).rejects.toThrow(ForbiddenException);
    });

    it('is idempotent for already-ended session', async () => {
      mockSessionFindUnique.mockResolvedValue({
        id: 'sess-1',
        admin_id: 'admin-1',
        status: 'ended',
      });
      await service.end('sess-1', 'admin-1');
      expect(mockSessionUpdate).not.toHaveBeenCalled();
    });
  });

  describe('assertActive', () => {
    it('returns scope when session is active and not expired', async () => {
      const future = new Date(Date.now() + 10 * 60 * 1000);
      mockSessionFindUnique.mockResolvedValue({
        id: 'sess-1',
        status: 'active',
        scope: 'read_only',
        target_tenant_id: 't1',
        expires_at: future,
      });
      const r = await service.assertActive('sess-1');
      expect(r).toEqual({ scope: 'read_only', tenantId: 't1' });
    });

    it('auto-expires and rejects when past expires_at', async () => {
      const past = new Date(Date.now() - 60_000);
      mockSessionFindUnique.mockResolvedValue({
        id: 'sess-1',
        status: 'active',
        scope: 'read_only',
        target_tenant_id: 't1',
        expires_at: past,
      });
      await expect(service.assertActive('sess-1')).rejects.toThrow(ForbiddenException);
      expect(mockSessionUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'expired' }),
        }),
      );
    });

    it('rejects unknown session', async () => {
      mockSessionFindUnique.mockResolvedValue(null);
      await expect(service.assertActive('sess-x')).rejects.toThrow(ForbiddenException);
    });

    it('rejects ended session', async () => {
      mockSessionFindUnique.mockResolvedValue({
        id: 'sess-1',
        status: 'ended',
        expires_at: new Date(Date.now() + 10_000),
      });
      await expect(service.assertActive('sess-1')).rejects.toThrow(ForbiddenException);
    });
  });
});
