import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
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
    private prisma: PrismaService,
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
      canAccessPMS: canAccessPMS,
    };
  }

  async getProgress(tenantId: string) {
    // If no tenantId, return default steps without saving to database
    if (!tenantId) {
      return [
        { id: null, stepKey: 'setup_profile', title: 'ตั้งค่าข้อมูลโรงแรม', isCompleted: false },
        { id: null, stepKey: 'create_room', title: 'สร้างห้องพักห้องแรก', isCompleted: false },
        { id: null, stepKey: 'first_booking', title: 'เปิดการจองครั้งแรก', isCompleted: false },
        { id: null, stepKey: 'setup_payment', title: 'ตั้งค่าการชำระเงิน', isCompleted: false },
      ];
    }

    const steps = await this.prisma.onboardingStep.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
    });

    // If no steps, initialize them
    if (steps.length === 0) {
      const defaultSteps = [
        { stepKey: 'setup_profile', title: 'ตั้งค่าข้อมูลโรงแรม' },
        { stepKey: 'create_room', title: 'สร้างห้องพักห้องแรก' },
        { stepKey: 'first_booking', title: 'เปิดการจองครั้งแรก' },
        { stepKey: 'setup_payment', title: 'ตั้งค่าการชำระเงิน' },
      ];

      const createdSteps = await Promise.all(
        defaultSteps.map((s) =>
          this.prisma.onboardingStep.create({
            data: {
              tenantId,
              stepKey: s.stepKey,
            },
          }),
        ),
      );
      return createdSteps;
    }

    return steps;
  }

  async updateStep(tenantId: string, id: string, isCompleted: boolean) {
    return this.prisma.onboardingStep.update({
      where: { id },
      data: {
        isCompleted,
        completedAt: isCompleted ? new Date() : null,
      },
    });
  }
}


