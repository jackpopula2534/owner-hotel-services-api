import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { UserStatus } from './constants/user-status.enum';

/**
 * User Auto-Expiry Cron Job
 *
 * รันทุกชั่วโมง: ค้น user ที่ expiresAt < now() และ status = active
 * แล้ว set status = expired + revoke refresh tokens
 *
 * ใช้ @Cron decorator ของ @nestjs/schedule (ติดตั้งและใช้งานใน
 * SubscriptionExpiryService ใน path subscriptions/ อยู่แล้ว)
 */
@Injectable()
export class UserExpirationScheduler {
  private readonly logger = new Logger(UserExpirationScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handleExpiredUsers(): Promise<void> {
    await this.runOnce().catch((err) => {
      this.logger.error(
        'User expiration sweep failed',
        err instanceof Error ? err.stack : String(err),
      );
    });
  }

  /**
   * Public method — รันได้แบบ on-demand (เช่น admin trigger หรือ test)
   * Returns number of users marked expired.
   */
  async runOnce(): Promise<number> {
    const now = new Date();

    // ใช้ as unknown: Prisma client type อาจยังไม่ regenerate หลัง schema migration
    const candidates = (await this.prisma.user.findMany({
      where: {
        expiresAt: { lt: now },
        status: UserStatus.ACTIVE,
      } as any,
      select: { id: true, email: true, tenantId: true, expiresAt: true } as any,
    })) as unknown as Array<{
      id: string;
      email: string | null;
      tenantId: string | null;
      expiresAt: Date | null;
    }>;

    if (candidates.length === 0) {
      this.logger.debug('No users to auto-expire.');
      return 0;
    }

    const ids = candidates.map((u) => u.id);

    const [{ count }] = await this.prisma.$transaction([
      this.prisma.user.updateMany({
        where: { id: { in: ids } },
        data: { status: UserStatus.EXPIRED },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId: { in: ids }, revokedAt: null },
        data: { revokedAt: now },
      }),
    ]);

    this.logger.warn(
      `Auto-expired ${count} user(s): ${candidates
        .map((u) => `${u.email || u.id} (tenant: ${u.tenantId ?? '-'}, expiresAt: ${u.expiresAt?.toISOString()})`)
        .join(', ')}`,
    );

    // Audit log แบบเป็นกลุ่ม (best-effort)
    await Promise.all(
      candidates.map((u) =>
        this.auditLogService
          .logUserStatusChange(u.id, UserStatus.ACTIVE, UserStatus.EXPIRED, 'system', {
            reason: 'auto-expired by scheduler',
            tenantId: u.tenantId ?? undefined,
          })
          .catch((err) => {
            this.logger.warn(
              `Audit log failed for ${u.id}: ${err instanceof Error ? err.message : String(err)}`,
            );
          }),
      ),
    );

    return count;
  }
}
