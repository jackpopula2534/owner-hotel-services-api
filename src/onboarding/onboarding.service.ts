import { Injectable } from '@nestjs/common';
import { TenantsService } from '../tenants/tenants.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { PlansService } from '../plans/plans.service';
import { CreateTenantDto } from '../tenants/dto/create-tenant.dto';
import { TenantStatus } from '../tenants/entities/tenant.entity';
import { SubscriptionStatus } from '../subscriptions/entities/subscription.entity';

export interface OnboardingResult {
  tenant: any;
  subscription: any;
  trialEndsAt: Date;
  message: string;
}

@Injectable()
export class OnboardingService {
  constructor(
    private tenantsService: TenantsService,
    private subscriptionsService: SubscriptionsService,
    private plansService: PlansService,
  ) {}

  /**
   * 1️⃣ Owner สมัครใช้งาน (Onboarding)
   * Flow:
   * - Owner สมัคร Account
   * - สร้าง Hotel (tenant)
   * - ระบบสร้าง tenant_id, hotel schema/data
   * - สถานะ → trial
   */
  async registerHotel(
    createTenantDto: CreateTenantDto,
    trialDays: number = 14,
  ): Promise<OnboardingResult> {
    // 1. สร้าง Tenant (Hotel)
    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + trialDays);

    const tenant = await this.tenantsService.create({
      ...createTenantDto,
      status: TenantStatus.TRIAL,
      trialEndsAt,
    });

    // 2. หา Trial Plan (หรือ Plan ฟรี/เล็กสุด)
    // ในกรณีนี้เราจะใช้ Plan S เป็น default สำหรับ trial
    const trialPlan = await this.plansService.findByCode('S');
    if (!trialPlan) {
      throw new Error('Trial plan not found. Please create Plan S first.');
    }

    // 3. สร้าง Trial Subscription
    const today = new Date();
    const endDate = new Date(trialEndsAt);

    const subscription = await this.subscriptionsService.create({
      tenantId: tenant.id,
      planId: trialPlan.id,
      status: SubscriptionStatus.TRIAL,
      startDate: today,
      endDate: endDate,
      autoRenew: false,
    });

    return {
      tenant,
      subscription,
      trialEndsAt,
      message: `Hotel registered successfully. Trial period: ${trialDays} days.`,
    };
  }

  /**
   * ตรวจสอบ trial status และคำนวณวันเหลือ
   */
  async getTrialStatus(tenantId: string): Promise<{
    isTrial: boolean;
    daysRemaining: number;
    trialEndsAt: Date | null;
    canAccessPMS: boolean;
  }> {
    const tenant = await this.tenantsService.findOne(tenantId);
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    const isTrial = tenant.status === TenantStatus.TRIAL;
    const trialEndsAt = tenant.trialEndsAt;

    if (!trialEndsAt) {
      return {
        isTrial: false,
        daysRemaining: 0,
        trialEndsAt: null,
        canAccessPMS: false,
      };
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const endDate = new Date(trialEndsAt);
    endDate.setHours(0, 0, 0, 0);

    const daysRemaining = Math.max(
      0,
      Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)),
    );

    // Trial ยังเข้า PMS ได้ แต่โดนจำกัด
    const canAccessPMS = daysRemaining > 0;

    return {
      isTrial,
      daysRemaining,
      trialEndsAt,
      canAccessPMS,
    };
  }
}


