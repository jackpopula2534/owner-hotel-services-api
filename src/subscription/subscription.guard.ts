import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FeatureAccessService } from '../feature-access/feature-access.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { SubscriptionStatus } from '../subscriptions/entities/subscription.entity';
import { SKIP_SUBSCRIPTION_CHECK_KEY } from '../common/decorators/skip-subscription-check.decorator';

export enum AccessMode {
  READ_ONLY = 'read_only',
  FULL_ACCESS = 'full_access',
  BLOCKED = 'blocked',
}

@Injectable()
export class SubscriptionGuard implements CanActivate {
  private readonly logger = new Logger(SubscriptionGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly featureAccessService: FeatureAccessService,
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Check for @SkipSubscriptionCheck() decorator on handler or class
    const skipCheck = this.reflector.getAllAndOverride<boolean>(SKIP_SUBSCRIPTION_CHECK_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (skipCheck) {
      return true;
    }

    const request = context.switchToHttp().getRequest();

    // Skip if no user attached (unauthenticated/public routes handled by auth guard)
    if (!request.user) {
      return true;
    }

    const tenantId = request.headers['x-tenant-id'] || request.user?.tenantId;

    // Skip if no tenantId (platform admin, onboarding, etc.)
    if (!tenantId) {
      return true;
    }

    // ตรวจสอบ subscription status
    const accessMode = await this.checkSubscriptionAccess(tenantId);

    // เก็บ access mode ใน request สำหรับใช้ใน controller
    request.subscriptionAccessMode = accessMode;

    // ถ้า blocked ให้ throw error
    if (accessMode === AccessMode.BLOCKED) {
      this.logger.warn(`Blocked access for tenant ${tenantId} — no active subscription`);
      throw new ForbiddenException({
        success: false,
        error: {
          code: 'SUBSCRIPTION_BLOCKED',
          message: 'Subscription has expired or is inactive. Please renew your subscription.',
        },
      });
    }

    // ถ้า read-only → block write operations (POST, PUT, PATCH, DELETE)
    if (accessMode === AccessMode.READ_ONLY) {
      const method = request.method?.toUpperCase();
      const writeMethods = ['POST', 'PUT', 'PATCH', 'DELETE'];

      if (writeMethods.includes(method)) {
        this.logger.warn(
          `Blocked write (${method}) for tenant ${tenantId} — subscription expired (read-only mode)`,
        );
        throw new ForbiddenException({
          success: false,
          error: {
            code: 'SUBSCRIPTION_READ_ONLY',
            message:
              'Your subscription has expired. You can view data but cannot make changes. Please renew your subscription.',
          },
        });
      }
    }

    return true;
  }

  /**
   * Subscription Runtime Check
   * เช็ก: subscription active? + today <= end_date? + feature enabled?
   */
  private async checkSubscriptionAccess(tenantId: string): Promise<AccessMode> {
    try {
      const subscription = await this.subscriptionsService.findByTenantId(tenantId);

      if (!subscription) {
        return AccessMode.BLOCKED;
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const endDate = new Date(subscription.end_date);
      endDate.setHours(0, 0, 0, 0);

      // ถ้าหมดอายุ — ให้ดูข้อมูลได้แต่แก้ไขไม่ได้ (Read-only)
      if (endDate < today) {
        return AccessMode.READ_ONLY;
      }

      // ถ้า subscription ไม่ active
      if (subscription.status !== SubscriptionStatus.ACTIVE) {
        // Trial ยังเข้าได้แต่จำกัด
        if (subscription.status === SubscriptionStatus.TRIAL) {
          return AccessMode.FULL_ACCESS;
        }
        return AccessMode.BLOCKED;
      }

      return AccessMode.FULL_ACCESS;
    } catch (error) {
      // If subscription check fails, don't block — log and allow (fail-open for non-critical)
      this.logger.error(`Failed to check subscription for tenant ${tenantId}: ${error}`);
      return AccessMode.FULL_ACCESS;
    }
  }
}
