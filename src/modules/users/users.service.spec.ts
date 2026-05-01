import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { UserStatus } from './constants/user-status.enum';

describe('UsersService — lifecycle management', () => {
  let service: UsersService;

  const baseUser = {
    id: 'user-1',
    email: 'alice@hotel.com',
    firstName: 'Alice',
    lastName: 'A',
    role: 'user',
    status: UserStatus.ACTIVE,
    expiresAt: null,
    suspendedAt: null,
    suspendedBy: null,
    suspendedReason: null,
    deactivatedAt: null,
    lastLoginAt: null,
    lastLoginIp: null,
    tenantId: 'tenant-1',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  const prismaMock = {
    user: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    refreshToken: {
      updateMany: jest.fn(),
    },
  };

  const auditMock = {
    logUserUpdate: jest.fn(),
    logUserStatusChange: jest.fn(),
    logUserExpirationSet: jest.fn(),
  };

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: AuditLogService, useValue: auditMock },
      ],
    }).compile();
    service = moduleRef.get(UsersService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('updateStatus', () => {
    it('suspends a user, revokes refresh tokens, and writes audit log', async () => {
      prismaMock.user.findFirst.mockResolvedValue(baseUser);
      prismaMock.user.update.mockResolvedValue({
        ...baseUser,
        status: UserStatus.SUSPENDED,
        suspendedAt: new Date(),
        suspendedBy: 'admin-1',
        suspendedReason: 'policy violation',
      });
      prismaMock.refreshToken.updateMany.mockResolvedValue({ count: 2 });

      const result = await service.updateStatus(
        'user-1',
        { status: UserStatus.SUSPENDED, reason: 'policy violation' },
        'tenant-1',
        { callerId: 'admin-1' },
      );

      expect(result.status).toBe(UserStatus.SUSPENDED);
      expect(prismaMock.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
          data: expect.objectContaining({
            status: UserStatus.SUSPENDED,
            suspendedBy: 'admin-1',
            suspendedReason: 'policy violation',
          }),
        }),
      );
      expect(prismaMock.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      expect(auditMock.logUserStatusChange).toHaveBeenCalledWith(
        'user-1',
        UserStatus.ACTIVE,
        UserStatus.SUSPENDED,
        'admin-1',
        expect.objectContaining({ reason: 'policy violation' }),
      );
    });

    it('refuses self-status-change', async () => {
      await expect(
        service.updateStatus(
          'user-1',
          { status: UserStatus.SUSPENDED },
          'tenant-1',
          { callerId: 'user-1' },
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    });

    it('is idempotent when status is unchanged', async () => {
      prismaMock.user.findFirst.mockResolvedValue(baseUser);
      const result = await service.updateStatus(
        'user-1',
        { status: UserStatus.ACTIVE },
        'tenant-1',
        { callerId: 'admin-1' },
      );
      expect(result.status).toBe(UserStatus.ACTIVE);
      expect(prismaMock.user.update).not.toHaveBeenCalled();
      expect(auditMock.logUserStatusChange).not.toHaveBeenCalled();
    });

    it('clears suspension fields when activating', async () => {
      prismaMock.user.findFirst.mockResolvedValue({
        ...baseUser,
        status: UserStatus.SUSPENDED,
        suspendedAt: new Date(),
        suspendedBy: 'admin-1',
        suspendedReason: 'old reason',
      });
      prismaMock.user.update.mockResolvedValue({ ...baseUser, status: UserStatus.ACTIVE });
      prismaMock.refreshToken.updateMany.mockResolvedValue({ count: 0 });

      await service.activate('user-1', 'tenant-1', { callerId: 'admin-1' });

      expect(prismaMock.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            status: UserStatus.ACTIVE,
            suspendedAt: null,
            suspendedBy: null,
            suspendedReason: null,
            deactivatedAt: null,
          },
        }),
      );
      // Activate ไม่ต้อง revoke tokens (status เป็น active)
      expect(prismaMock.refreshToken.updateMany).not.toHaveBeenCalled();
    });

    it('throws NotFound for unknown user', async () => {
      prismaMock.user.findFirst.mockResolvedValue(null);
      await expect(
        service.updateStatus(
          'ghost',
          { status: UserStatus.SUSPENDED },
          'tenant-1',
          { callerId: 'admin-1' },
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('setExpiration', () => {
    it('sets a future expiration date and keeps user active', async () => {
      prismaMock.user.findFirst.mockResolvedValue(baseUser);
      const future = new Date(Date.now() + 86_400_000).toISOString();
      prismaMock.user.update.mockResolvedValue({ ...baseUser, expiresAt: new Date(future) });

      const result = await service.setExpiration(
        'user-1',
        { expiresAt: future },
        'tenant-1',
        { callerId: 'admin-1' },
      );

      expect(result.expiresAt).toEqual(new Date(future));
      expect(prismaMock.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { expiresAt: new Date(future) },
        }),
      );
      expect(prismaMock.refreshToken.updateMany).not.toHaveBeenCalled();
      expect(auditMock.logUserExpirationSet).toHaveBeenCalled();
    });

    it('immediately expires user when expiration is in the past', async () => {
      prismaMock.user.findFirst.mockResolvedValue(baseUser);
      const past = new Date(Date.now() - 86_400_000).toISOString();
      prismaMock.user.update.mockResolvedValue({
        ...baseUser,
        status: UserStatus.EXPIRED,
        expiresAt: new Date(past),
      });
      prismaMock.refreshToken.updateMany.mockResolvedValue({ count: 1 });

      await service.setExpiration(
        'user-1',
        { expiresAt: past },
        'tenant-1',
        { callerId: 'admin-1' },
      );

      expect(prismaMock.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: UserStatus.EXPIRED,
            expiresAt: new Date(past),
          }),
        }),
      );
      expect(prismaMock.refreshToken.updateMany).toHaveBeenCalled();
    });

    it('reactivates an expired user when extending the date into the future', async () => {
      prismaMock.user.findFirst.mockResolvedValue({
        ...baseUser,
        status: UserStatus.EXPIRED,
        expiresAt: new Date(Date.now() - 1000),
      });
      const future = new Date(Date.now() + 86_400_000).toISOString();
      prismaMock.user.update.mockResolvedValue({
        ...baseUser,
        status: UserStatus.ACTIVE,
        expiresAt: new Date(future),
      });

      await service.setExpiration(
        'user-1',
        { expiresAt: future },
        'tenant-1',
        { callerId: 'admin-1' },
      );

      expect(prismaMock.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: UserStatus.ACTIVE,
            expiresAt: new Date(future),
          }),
        }),
      );
    });

    it('clears expiration when expiresAt = null', async () => {
      prismaMock.user.findFirst.mockResolvedValue({
        ...baseUser,
        expiresAt: new Date(Date.now() + 1000),
      });
      prismaMock.user.update.mockResolvedValue({ ...baseUser, expiresAt: null });

      await service.setExpiration(
        'user-1',
        { expiresAt: null },
        'tenant-1',
        { callerId: 'admin-1' },
      );

      expect(prismaMock.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { expiresAt: null },
        }),
      );
    });
  });

  describe('findAll', () => {
    it('platform admin can list cross-tenant', async () => {
      prismaMock.user.findMany.mockResolvedValue([baseUser]);
      prismaMock.user.count.mockResolvedValue(1);

      const result = await service.findAll({ page: 1, limit: 10 }, undefined);

      expect(result.total).toBe(1);
      expect(prismaMock.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
    });

    it('tenant admin is constrained to own tenant', async () => {
      prismaMock.user.findMany.mockResolvedValue([baseUser]);
      prismaMock.user.count.mockResolvedValue(1);

      await service.findAll({ page: 1, limit: 10 }, 'tenant-1');

      expect(prismaMock.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId: 'tenant-1' } }),
      );
    });

    it('passes through status & search filters', async () => {
      prismaMock.user.findMany.mockResolvedValue([]);
      prismaMock.user.count.mockResolvedValue(0);

      await service.findAll(
        { page: 1, limit: 10, status: UserStatus.SUSPENDED, search: 'alice' },
        'tenant-1',
      );

      expect(prismaMock.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: 'tenant-1',
            status: UserStatus.SUSPENDED,
            OR: expect.any(Array),
          }),
        }),
      );
    });
  });
});
