import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
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
    subscriptions: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  };

  const auditMock = {
    log: jest.fn(),
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

  describe('self-service (/users/me)', () => {
    it('getMyProfile looks the user up by id AND tenant', async () => {
      prismaMock.user.findFirst.mockResolvedValue({ ...baseUser, phone: '0812345678' });

      const result = await service.getMyProfile('user-1', 'tenant-1');

      expect(prismaMock.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'user-1', tenantId: 'tenant-1' } }),
      );
      expect(result.phone).toBe('0812345678');
    });

    it('getMyProfile throws when the account is not in the caller tenant', async () => {
      prismaMock.user.findFirst.mockResolvedValue(null);
      await expect(service.getMyProfile('user-1', 'other-tenant')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('updateMyProfile writes only name and phone, trimmed, and audits', async () => {
      prismaMock.user.findFirst.mockResolvedValue(baseUser);
      prismaMock.user.update.mockResolvedValue({ ...baseUser, firstName: 'Bob' });

      await service.updateMyProfile(
        'user-1',
        { firstName: '  Bob ', lastName: ' ', phone: ' 081 234 5678 ', role: 'admin' } as never,
        'tenant-1',
      );

      expect(prismaMock.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
          data: { firstName: 'Bob', lastName: null, phone: '081 234 5678' },
        }),
      );
      expect(auditMock.logUserUpdate).toHaveBeenCalled();
    });

    it('updateMyProfile rejects a blank first name', async () => {
      prismaMock.user.findFirst.mockResolvedValue(baseUser);
      await expect(
        service.updateMyProfile('user-1', { firstName: '   ' }, 'tenant-1'),
      ).rejects.toThrow(BadRequestException);
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    });

    it('changeMyPassword rejects a wrong current password', async () => {
      prismaMock.user.findFirst.mockResolvedValue({
        id: 'user-1',
        password: await bcrypt.hash('right-password', 4),
      });

      await expect(
        service.changeMyPassword(
          'user-1',
          { currentPassword: 'wrong', newPassword: 'new-password-1' },
          'tenant-1',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    });

    it('changeMyPassword rejects reusing the same password', async () => {
      prismaMock.user.findFirst.mockResolvedValue({
        id: 'user-1',
        password: await bcrypt.hash('same-password', 4),
      });

      await expect(
        service.changeMyPassword(
          'user-1',
          { currentPassword: 'same-password', newPassword: 'same-password' },
          'tenant-1',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    });

    it('changeMyPassword stores a bcrypt hash, revokes refresh tokens and audits', async () => {
      prismaMock.user.findFirst.mockResolvedValue({
        id: 'user-1',
        password: await bcrypt.hash('old-password', 4),
      });
      prismaMock.user.update.mockResolvedValue({});
      prismaMock.refreshToken.updateMany.mockResolvedValue({ count: 2 });

      await service.changeMyPassword(
        'user-1',
        { currentPassword: 'old-password', newPassword: 'new-password-1' },
        'tenant-1',
      );

      const stored = prismaMock.user.update.mock.calls[0][0].data.password;
      expect(stored).not.toBe('new-password-1');
      expect(await bcrypt.compare('new-password-1', stored)).toBe(true);
      expect(prismaMock.refreshToken.updateMany).toHaveBeenCalled();
      expect(auditMock.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'password_change', resourceId: 'user-1' }),
      );
    });
  });

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
        service.updateStatus('user-1', { status: UserStatus.SUSPENDED }, 'tenant-1', {
          callerId: 'user-1',
        }),
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
        service.updateStatus('ghost', { status: UserStatus.SUSPENDED }, 'tenant-1', {
          callerId: 'admin-1',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('setExpiration', () => {
    it('sets a future expiration date and keeps user active', async () => {
      prismaMock.user.findFirst.mockResolvedValue(baseUser);
      const future = new Date(Date.now() + 86_400_000).toISOString();
      prismaMock.user.update.mockResolvedValue({ ...baseUser, expiresAt: new Date(future) });

      const result = await service.setExpiration('user-1', { expiresAt: future }, 'tenant-1', {
        callerId: 'admin-1',
      });

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

      await service.setExpiration('user-1', { expiresAt: past }, 'tenant-1', {
        callerId: 'admin-1',
      });

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

      await service.setExpiration('user-1', { expiresAt: future }, 'tenant-1', {
        callerId: 'admin-1',
      });

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

      await service.setExpiration('user-1', { expiresAt: null }, 'tenant-1', {
        callerId: 'admin-1',
      });

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
      expect(prismaMock.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
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

  /**
   * `user.expiresAt` is a per-account override an admin sets by hand, so it is
   * null for nearly every account — the console's "วันหมดอายุ" column was empty
   * platform-wide. What actually ends someone's access is their hotel's
   * subscription, so the list carries that date alongside.
   */
  describe('findAll — tenant expiry', () => {
    it('attaches the tenant subscription end date and status to every row', async () => {
      prismaMock.user.findMany.mockResolvedValue([
        baseUser,
        { ...baseUser, id: 'user-2', tenantId: 'tenant-2' },
      ]);
      prismaMock.user.count.mockResolvedValue(2);
      prismaMock.subscriptions.findMany.mockResolvedValue([
        { tenant_id: 'tenant-1', end_date: new Date('2027-08-11'), status: 'active' },
        { tenant_id: 'tenant-2', end_date: new Date('2026-08-27'), status: 'trial' },
      ]);

      const result = await service.findAll({ page: 1, limit: 10 }, undefined);

      expect(prismaMock.subscriptions.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenant_id: { in: ['tenant-1', 'tenant-2'] } },
          orderBy: { end_date: 'desc' },
        }),
      );
      expect(result.data[0]).toMatchObject({
        id: 'user-1',
        tenantExpiresAt: new Date('2027-08-11'),
        tenantSubscriptionStatus: 'active',
      });
      expect(result.data[1]).toMatchObject({
        id: 'user-2',
        tenantExpiresAt: new Date('2026-08-27'),
        tenantSubscriptionStatus: 'trial',
      });
    });

    it('takes the furthest-reaching subscription when a tenant has several', async () => {
      // A tenant that renewed early keeps the old row; access runs to the later
      // end date, and the query is ordered so that row arrives first.
      prismaMock.user.findMany.mockResolvedValue([baseUser]);
      prismaMock.user.count.mockResolvedValue(1);
      prismaMock.subscriptions.findMany.mockResolvedValue([
        { tenant_id: 'tenant-1', end_date: new Date('2028-01-01'), status: 'active' },
        { tenant_id: 'tenant-1', end_date: new Date('2027-01-01'), status: 'expired' },
      ]);

      const result = await service.findAll({ page: 1, limit: 10 }, 'tenant-1');

      expect(result.data[0]).toMatchObject({
        tenantExpiresAt: new Date('2028-01-01'),
        tenantSubscriptionStatus: 'active',
      });
    });

    it('reports null for a platform account with no tenant, without querying', async () => {
      prismaMock.user.findMany.mockResolvedValue([{ ...baseUser, tenantId: null }]);
      prismaMock.user.count.mockResolvedValue(1);

      const result = await service.findAll({ page: 1, limit: 10 }, undefined);

      expect(prismaMock.subscriptions.findMany).not.toHaveBeenCalled();
      expect(result.data[0]).toMatchObject({
        tenantExpiresAt: null,
        tenantSubscriptionStatus: null,
      });
    });

    it('still returns the users when the subscriptions lookup fails', async () => {
      // A bookkeeping column must never be the reason the admin console is empty.
      prismaMock.user.findMany.mockResolvedValue([baseUser]);
      prismaMock.user.count.mockResolvedValue(1);
      prismaMock.subscriptions.findMany.mockRejectedValue(new Error('table missing'));

      const result = await service.findAll({ page: 1, limit: 10 }, 'tenant-1');

      expect(result.total).toBe(1);
      expect(result.data[0]).toMatchObject({ id: 'user-1', tenantExpiresAt: null });
    });

    it('findOneDetailed carries the same expiry as the list row', async () => {
      prismaMock.user.findFirst.mockResolvedValue(baseUser);
      prismaMock.subscriptions.findMany.mockResolvedValue([
        { tenant_id: 'tenant-1', end_date: new Date('2027-08-11'), status: 'active' },
      ]);

      const result = await service.findOneDetailed('user-1', 'tenant-1');

      expect(result).toMatchObject({
        id: 'user-1',
        tenantExpiresAt: new Date('2027-08-11'),
        tenantSubscriptionStatus: 'active',
      });
    });
  });
});
