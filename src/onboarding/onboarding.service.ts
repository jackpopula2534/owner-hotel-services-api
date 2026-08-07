import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantsService } from '../tenants/tenants.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { PlansService } from '../plans/plans.service';
import { CreateTenantDto } from '../tenants/dto/create-tenant.dto';
import { TenantStatus } from '../tenants/entities/tenant.entity';
import { SubscriptionStatus } from '../subscriptions/entities/subscription.entity';
import { AcceptDpaDto } from './dto/accept-dpa.dto';

export type OnboardingSystem = 'HOTEL' | 'CAMP';

/** Free-trial plan for each product line. Both are seeded by `seedPlans()`. */
const TRIAL_PLAN_CODE: Record<OnboardingSystem, string> = {
  HOTEL: 'FREE',
  CAMP: 'CAMP_FREE',
};

/** Stored on `tenants.property_type` so the tenant remembers which line it signed up for. */
const PROPERTY_TYPE: Record<OnboardingSystem, string> = {
  HOTEL: 'hotel',
  CAMP: 'campground',
};

export interface OnboardingResult {
  tenant: any;
  subscription: any;
  trialEndsAt: Date;
  message: string;
  property: any;
  system: OnboardingSystem;
  plan: { id: string; code: string; name: string };
}

export interface DpaStatusResult {
  accepted: boolean;
  version: string | null;
  acceptedAt: Date | null;
}

@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

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
    system: OnboardingSystem = 'HOTEL',
  ): Promise<OnboardingResult> {
    // 1. สร้าง Tenant (Hotel / ลานกางเต็นท์)
    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + trialDays);

    const tenant = await this.tenantsService.create({
      ...createTenantDto,
      // Remember the product line, unless the caller named a more specific type.
      propertyType: createTenantDto.propertyType || PROPERTY_TYPE[system],
      status: TenantStatus.TRIAL,
      trialEndsAt,
    });

    // 2. ใช้ Free Trial Plan ของ product line ที่เลือก (FREE / CAMP_FREE)
    const planCode = TRIAL_PLAN_CODE[system] ?? TRIAL_PLAN_CODE.HOTEL;
    const trialPlan = await this.plansService.findByCode(planCode);
    if (!trialPlan) {
      throw new Error(
        `Free Trial plan (code: ${planCode}) not found. Please run the database seeder first.`,
      );
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

    // 4. Auto-create default property from tenant data
    const propertyCode =
      (createTenantDto.name || 'PROP')
        .substring(0, 3)
        .toUpperCase()
        .replace(/[^A-Z]/g, 'X') + Date.now().toString().slice(-4);

    const defaultProperty = await this.prisma.property.create({
      data: {
        tenantId: tenant.id,
        name: createTenantDto.name || (system === 'CAMP' ? 'ลานกางเต็นท์หลัก' : 'โรงแรมหลัก'),
        code: propertyCode,
        location: createTenantDto.address || null,
        phone: createTenantDto.phone || null,
        email: createTenantDto.email || null,
        isDefault: true,
        status: 'active',
      },
    });

    return {
      tenant,
      subscription,
      trialEndsAt,
      message: `Hotel registered successfully. Trial period: ${trialDays} days.`,
      property: defaultProperty,
      system,
      plan: { id: trialPlan.id, code: trialPlan.code, name: trialPlan.name },
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
    const trialEndsAt = tenant.trial_ends_at;

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

  async getDpaStatus(tenantId?: string): Promise<DpaStatusResult> {
    if (!tenantId) {
      return {
        accepted: false,
        version: null,
        acceptedAt: null,
      };
    }

    const acceptance = await this.prisma.dpaAcceptance.findFirst({
      where: { tenantId },
      orderBy: { acceptedAt: 'desc' },
    });

    return {
      accepted: Boolean(acceptance),
      version: acceptance?.version ?? null,
      acceptedAt: acceptance?.acceptedAt ?? null,
    };
  }

  async acceptDpa(
    tenantId: string | undefined,
    userId: string | undefined,
    dto: AcceptDpaDto,
    audit?: { ipAddress?: string; userAgent?: string },
  ) {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required to accept the DPA');
    }
    if (!userId) {
      throw new BadRequestException('User ID is required to accept the DPA');
    }
    if (!dto.accepted) {
      throw new BadRequestException('DPA must be accepted before continuing onboarding');
    }

    return this.prisma.dpaAcceptance.upsert({
      where: {
        tenantId_version: {
          tenantId,
          version: dto.version,
        },
      },
      create: {
        tenantId,
        userId,
        version: dto.version,
        title: dto.title ?? 'StaySync Data Processing Agreement',
        ipAddress: audit?.ipAddress,
        userAgent: audit?.userAgent,
        acceptedAt: new Date(),
      },
      update: {
        userId,
        title: dto.title ?? 'StaySync Data Processing Agreement',
        ipAddress: audit?.ipAddress,
        userAgent: audit?.userAgent,
        acceptedAt: new Date(),
      },
    });
  }
}
