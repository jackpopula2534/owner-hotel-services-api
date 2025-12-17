import { Injectable, ForbiddenException } from '@nestjs/common';
import { TenantsService } from '../tenants/tenants.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { FeaturesService } from '../features/features.service';
import { SubscriptionStatus } from '../subscriptions/entities/subscription.entity';
import { TenantStatus } from '../tenants/entities/tenant.entity';

export interface FeatureAccessResult {
  hasAccess: boolean;
  reason?: string;
  subscription?: any;
  feature?: any;
}

@Injectable()
export class FeatureAccessService {
  constructor(
    private tenantsService: TenantsService,
    private subscriptionsService: SubscriptionsService,
    private featuresService: FeaturesService,
  ) {}

  /**
   * ตรวจสอบว่า tenant มีสิทธิ์ใช้ feature นี้หรือไม่
   * ตาม logic: subscription active? + today <= end_date? + feature enabled?
   */
  async checkFeatureAccess(
    tenantId: string,
    featureCode: string,
  ): Promise<FeatureAccessResult> {
    // 1. ตรวจสอบ tenant
    const tenant = await this.tenantsService.findOne(tenantId);
    if (!tenant) {
      return {
        hasAccess: false,
        reason: 'Tenant not found',
      };
    }

    // 2. ตรวจสอบ tenant status (ไม่ผูกกับ subscription ตรง ๆ)
    if (tenant.status === TenantStatus.SUSPENDED) {
      return {
        hasAccess: false,
        reason: 'Tenant is suspended',
        subscription: null,
      };
    }

    if (tenant.status === TenantStatus.EXPIRED) {
      return {
        hasAccess: false,
        reason: 'Tenant is expired',
        subscription: null,
      };
    }

    // 3. ตรวจสอบ subscription
    const subscription = await this.subscriptionsService.findByTenantId(tenantId);
    if (!subscription) {
      return {
        hasAccess: false,
        reason: 'No active subscription found',
        subscription: null,
      };
    }

    // 4. ตรวจสอบ subscription status
    // Trial ยังเข้าได้ แต่จำกัด features
    if (
      subscription.status !== SubscriptionStatus.ACTIVE &&
      subscription.status !== SubscriptionStatus.TRIAL
    ) {
      return {
        hasAccess: false,
        reason: `Subscription status is ${subscription.status}`,
        subscription,
      };
    }

    // 2️⃣ Trial System - จำกัด features บางตัว
    if (subscription.status === SubscriptionStatus.TRIAL) {
      // Trial จำกัด: OTA ไม่เปิด, Report บางส่วน
      const restrictedFeatures = ['ota_booking', 'advanced_report'];
      if (restrictedFeatures.includes(featureCode)) {
        return {
          hasAccess: false,
          reason: 'This feature is not available during trial period',
          subscription,
          feature: await this.featuresService.findByCode(featureCode),
        };
      }
    }

    // 5. ตรวจสอบวันที่ (today <= end_date)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const endDate = new Date(subscription.endDate);
    endDate.setHours(0, 0, 0, 0);

    if (endDate < today) {
      return {
        hasAccess: false,
        reason: 'Subscription has expired',
        subscription,
      };
    }

    // 6. ตรวจสอบ feature
    const feature = await this.featuresService.findByCode(featureCode);
    if (!feature) {
      return {
        hasAccess: false,
        reason: 'Feature not found',
        subscription,
      };
    }

    if (!feature.isActive) {
      return {
        hasAccess: false,
        reason: 'Feature is not active',
        subscription,
        feature,
      };
    }

    // 7. ตรวจสอบว่า feature อยู่ใน plan หรือ subscription หรือไม่
    const hasFeature = await this.hasFeatureAccess(subscription, featureCode);
    if (!hasFeature) {
      return {
        hasAccess: false,
        reason: `Feature ${featureCode} is not enabled for this subscription`,
        subscription,
        feature,
      };
    }

    return {
      hasAccess: true,
      subscription,
      feature,
    };
  }

  /**
   * ตรวจสอบว่า subscription มี feature นี้หรือไม่
   * ตรวจทั้ง plan features และ subscription features
   */
  private async hasFeatureAccess(
    subscription: any,
    featureCode: string,
  ): Promise<boolean> {
    // ตรวจสอบ plan features (ฟีเจอร์ที่แถมมากับ plan)
    if (subscription.plan?.planFeatures) {
      const planFeature = subscription.plan.planFeatures.find(
        (pf: any) => pf.feature?.code === featureCode,
      );
      if (planFeature) {
        return true;
      }
    }

    // ตรวจสอบ subscription features (ฟีเจอร์ที่ซื้อเพิ่ม)
    if (subscription.subscriptionFeatures) {
      const subscriptionFeature = subscription.subscriptionFeatures.find(
        (sf: any) => sf.feature?.code === featureCode,
      );
      if (subscriptionFeature) {
        return true;
      }
    }

    return false;
  }

  /**
   * ตรวจสอบและ throw exception ถ้าไม่มีสิทธิ์
   * ใช้ใน guards หรือ interceptors
   */
  async requireFeatureAccess(
    tenantId: string,
    featureCode: string,
  ): Promise<void> {
    const result = await this.checkFeatureAccess(tenantId, featureCode);
    if (!result.hasAccess) {
      throw new ForbiddenException({
        message: result.reason || 'Feature access denied',
        featureCode,
        tenantId,
      });
    }
  }

  /**
   * ดึงข้อมูล subscription และ features ทั้งหมดที่ tenant มีสิทธิ์ใช้
   */
  async getTenantFeatures(tenantId: string): Promise<{
    subscription: any;
    planFeatures: any[];
    subscriptionFeatures: any[];
    allFeatures: any[];
  }> {
    const tenant = await this.tenantsService.findOne(tenantId);
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    const subscription = await this.subscriptionsService.findByTenantId(tenantId);
    if (!subscription) {
      return {
        subscription: null,
        planFeatures: [],
        subscriptionFeatures: [],
        allFeatures: [],
      };
    }

    const planFeatures =
      subscription.plan?.planFeatures?.map((pf: any) => pf.feature) || [];
    const subscriptionFeatures =
      subscription.subscriptionFeatures?.map((sf: any) => sf.feature) || [];

    // รวม features ทั้งหมด (ไม่ซ้ำ)
    const allFeaturesMap = new Map();
    [...planFeatures, ...subscriptionFeatures].forEach((feature) => {
      if (feature) {
        allFeaturesMap.set(feature.id, feature);
      }
    });

    return {
      subscription,
      planFeatures,
      subscriptionFeatures,
      allFeatures: Array.from(allFeaturesMap.values()),
    };
  }

  /**
   * ตรวจสอบ subscription status และ validity
   */
  async getSubscriptionStatus(tenantId: string): Promise<{
    hasSubscription: boolean;
    isActive: boolean;
    message?: string;
    subscription?: any;
    tenant?: any;
  }> {
    const tenant = await this.tenantsService.findOne(tenantId);
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    const subscription = await this.subscriptionsService.findByTenantId(tenantId);
    if (!subscription) {
      return {
        hasSubscription: false,
        isActive: false,
        message: 'No subscription found',
      };
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const endDate = new Date(subscription.endDate);
    endDate.setHours(0, 0, 0, 0);

    const isActive =
      subscription.status === SubscriptionStatus.ACTIVE && endDate >= today;

    return {
      hasSubscription: true,
      isActive,
      subscription: {
        id: subscription.id,
        status: subscription.status,
        startDate: subscription.startDate,
        endDate: subscription.endDate,
        plan: subscription.plan,
      },
      tenant: {
        id: tenant.id,
        status: tenant.status,
      },
    };
  }
}

