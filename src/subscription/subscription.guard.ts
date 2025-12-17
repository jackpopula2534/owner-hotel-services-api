import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { FeatureAccessService } from '../feature-access/feature-access.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { SubscriptionStatus } from '../subscriptions/entities/subscription.entity';

export enum AccessMode {
  READ_ONLY = 'read_only',
  FULL_ACCESS = 'full_access',
  BLOCKED = 'blocked',
}

@Injectable()
export class SubscriptionGuard implements CanActivate {
  constructor(
    private featureAccessService: FeatureAccessService,
    private subscriptionsService: SubscriptionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const tenantId = request.headers['x-tenant-id'] || request.user?.tenantId;

    if (!tenantId) {
      throw new ForbiddenException('Tenant ID is required');
    }

    // ตรวจสอบ subscription status
    const accessMode = await this.checkSubscriptionAccess(tenantId);

    // เก็บ access mode ใน request สำหรับใช้ใน controller
    request.subscriptionAccessMode = accessMode;

    // ถ้า blocked ให้ throw error
    if (accessMode === AccessMode.BLOCKED) {
      throw new ForbiddenException({
        message: 'Subscription has expired. Please renew your subscription.',
        accessMode: AccessMode.BLOCKED,
      });
    }

    // ถ้า read-only หรือ full-access ให้ผ่าน แต่ต้องเช็ก feature ใน controller
    return true;
  }

  /**
   * 7️⃣ Subscription Runtime Check
   * ทุก request เข้า PMS ต้องผ่าน middleware
   * เช็ก: subscription active? + today <= end_date? + feature enabled?
   */
  private async checkSubscriptionAccess(
    tenantId: string,
  ): Promise<AccessMode> {
    const subscription = await this.subscriptionsService.findByTenantId(
      tenantId,
    );

    if (!subscription) {
      return AccessMode.BLOCKED;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const endDate = new Date(subscription.endDate);
    endDate.setHours(0, 0, 0, 0);

    // ถ้าหมดอายุ
    if (endDate < today) {
      // ❌ อย่าล็อกทันทีแบบโหด
      // ✔️ ให้ดูข้อมูลได้ แต่ทำอะไรไม่ได้ (Read-only)
      return AccessMode.READ_ONLY;
    }

    // ถ้า subscription ไม่ active
    if (subscription.status !== SubscriptionStatus.ACTIVE) {
      // Trial ยังเข้าได้ แต่จำกัด
      if (subscription.status === SubscriptionStatus.TRIAL) {
        return AccessMode.READ_ONLY;
      }
      return AccessMode.BLOCKED;
    }

    return AccessMode.FULL_ACCESS;
  }
}


