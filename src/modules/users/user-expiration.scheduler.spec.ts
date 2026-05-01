import { Test, TestingModule } from '@nestjs/testing';
import { UserExpirationScheduler } from './user-expiration.scheduler';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { UserStatus } from './constants/user-status.enum';

describe('UserExpirationScheduler', () => {
  let scheduler: UserExpirationScheduler;

  const prismaMock = {
    user: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    refreshToken: {
      updateMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const auditMock = {
    logUserStatusChange: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        UserExpirationScheduler,
        { provide: PrismaService, useValue: prismaMock },
        { provide: AuditLogService, useValue: auditMock },
      ],
    }).compile();
    scheduler = moduleRef.get(UserExpirationScheduler);
  });

  afterEach(() => jest.clearAllMocks());

  it('returns 0 when no expired users', async () => {
    prismaMock.user.findMany.mockResolvedValue([]);
    const count = await scheduler.runOnce();
    expect(count).toBe(0);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('marks expired users and revokes their refresh tokens', async () => {
    const expiredUsers = [
      { id: 'u1', email: 'a@x.com', tenantId: 't1', expiresAt: new Date(Date.now() - 1000) },
      { id: 'u2', email: 'b@x.com', tenantId: 't1', expiresAt: new Date(Date.now() - 2000) },
    ];
    prismaMock.user.findMany.mockResolvedValue(expiredUsers);
    prismaMock.$transaction.mockResolvedValue([{ count: 2 }, { count: 3 }]);

    const count = await scheduler.runOnce();

    expect(count).toBe(2);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(auditMock.logUserStatusChange).toHaveBeenCalledTimes(2);
    expect(auditMock.logUserStatusChange).toHaveBeenCalledWith(
      'u1',
      UserStatus.ACTIVE,
      UserStatus.EXPIRED,
      'system',
      expect.objectContaining({ reason: 'auto-expired by scheduler' }),
    );
  });
});
