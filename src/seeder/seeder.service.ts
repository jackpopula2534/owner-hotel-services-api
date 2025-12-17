import { Injectable, Logger } from '@nestjs/common';
import { PlansService } from '../plans/plans.service';
import { FeaturesService } from '../features/features.service';
import { PlanFeaturesService } from '../plan-features/plan-features.service';
import { AdminsService } from '../admins/admins.service';
import { TenantsService } from '../tenants/tenants.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { FeatureType } from '../features/entities/feature.entity';
import { AdminRole } from '../admins/entities/admin.entity';
import { TenantStatus } from '../tenants/entities/tenant.entity';
import { SubscriptionStatus } from '../subscriptions/entities/subscription.entity';

@Injectable()
export class SeederService {
  private readonly logger = new Logger(SeederService.name);

  constructor(
    private plansService: PlansService,
    private featuresService: FeaturesService,
    private planFeaturesService: PlanFeaturesService,
    private adminsService: AdminsService,
    private tenantsService: TenantsService,
    private subscriptionsService: SubscriptionsService,
  ) {}

  /**
   * รัน seeder ทั้งหมด
   */
  async seed(): Promise<void> {
    this.logger.log('🌱 Starting database seeding...');

    try {
      await this.seedPlans();
      await this.seedFeatures();
      await this.seedPlanFeatures();
      await this.seedAdmins();
      await this.seedSampleData();

      this.logger.log('✅ Database seeding completed successfully!');
    } catch (error) {
      this.logger.error('❌ Error seeding database:', error);
      throw error;
    }
  }

  /**
   * 1️⃣ Seed Plans (S, M, L)
   */
  private async seedPlans(): Promise<void> {
    this.logger.log('📦 Seeding Plans...');

    const plans = [
      {
        code: 'S',
        name: 'Starter Plan',
        priceMonthly: 990,
        maxRooms: 20,
        maxUsers: 3,
        isActive: true,
      },
      {
        code: 'M',
        name: 'Medium Plan',
        priceMonthly: 1990,
        maxRooms: 50,
        maxUsers: 5,
        isActive: true,
      },
      {
        code: 'L',
        name: 'Large Plan',
        priceMonthly: 3990,
        maxRooms: 100,
        maxUsers: 10,
        isActive: true,
      },
    ];

    for (const planData of plans) {
      const existing = await this.plansService.findByCode(planData.code);
      if (!existing) {
        await this.plansService.create(planData);
        this.logger.log(`  ✓ Created plan: ${planData.code} - ${planData.name}`);
      } else {
        this.logger.log(`  ⊙ Plan already exists: ${planData.code}`);
      }
    }
  }

  /**
   * 2️⃣ Seed Features
   */
  private async seedFeatures(): Promise<void> {
    this.logger.log('⚙️ Seeding Features...');

    const features = [
      {
        code: 'ota_booking',
        name: 'OTA Booking Integration',
        description: 'เชื่อมต่อกับ Booking.com, Agoda, และ OTA อื่นๆ',
        type: FeatureType.MODULE,
        priceMonthly: 500,
        isActive: true,
      },
      {
        code: 'automation',
        name: 'Automation System',
        description: 'ระบบอัตโนมัติสำหรับจัดการ booking และ workflow',
        type: FeatureType.MODULE,
        priceMonthly: 300,
        isActive: true,
      },
      {
        code: 'tax_invoice',
        name: 'Tax Invoice',
        description: 'ระบบออกใบกำกับภาษีอัตโนมัติ',
        type: FeatureType.TOGGLE,
        priceMonthly: 200,
        isActive: true,
      },
      {
        code: 'extra_user',
        name: 'Extra User',
        description: 'เพิ่มจำนวน user ที่ใช้งานได้',
        type: FeatureType.LIMIT,
        priceMonthly: 100,
        isActive: true,
      },
      {
        code: 'api_access',
        name: 'API Access',
        description: 'เข้าถึง API สำหรับ integration กับระบบอื่น',
        type: FeatureType.MODULE,
        priceMonthly: 400,
        isActive: true,
      },
      {
        code: 'advanced_report',
        name: 'Advanced Report',
        description: 'รายงานขั้นสูงและ analytics',
        type: FeatureType.MODULE,
        priceMonthly: 250,
        isActive: true,
      },
      {
        code: 'housekeeping',
        name: 'Housekeeping Management',
        description: 'ระบบจัดการงานทำความสะอาด',
        type: FeatureType.TOGGLE,
        priceMonthly: 150,
        isActive: true,
      },
      {
        code: 'basic_report',
        name: 'Basic Report',
        description: 'รายงานพื้นฐาน',
        type: FeatureType.TOGGLE,
        priceMonthly: 0,
        isActive: true,
      },
    ];

    for (const featureData of features) {
      const existing = await this.featuresService.findByCode(featureData.code);
      if (!existing) {
        await this.featuresService.create(featureData);
        this.logger.log(`  ✓ Created feature: ${featureData.code} - ${featureData.name}`);
      } else {
        this.logger.log(`  ⊙ Feature already exists: ${featureData.code}`);
      }
    }
  }

  /**
   * 3️⃣ Seed Plan Features (ฟีเจอร์ที่แถมมากับ plan)
   */
  private async seedPlanFeatures(): Promise<void> {
    this.logger.log('🔗 Seeding Plan Features...');

    const planS = await this.plansService.findByCode('S');
    const planM = await this.plansService.findByCode('M');
    const planL = await this.plansService.findByCode('L');

    const basicReport = await this.featuresService.findByCode('basic_report');
    const housekeeping = await this.featuresService.findByCode('housekeeping');

    // Plan S - แถม Basic Report
    if (planS && basicReport) {
      const existing = await this.planFeaturesService.findByPlanId(planS.id);
      if (existing.length === 0) {
        await this.planFeaturesService.create({
          planId: planS.id,
          featureId: basicReport.id,
        });
        this.logger.log(`  ✓ Added basic_report to Plan S`);
      }
    }

    // Plan M - แถม Basic Report + Housekeeping
    if (planM && basicReport && housekeeping) {
      const existing = await this.planFeaturesService.findByPlanId(planM.id);
      if (existing.length === 0) {
        await this.planFeaturesService.create({
          planId: planM.id,
          featureId: basicReport.id,
        });
        await this.planFeaturesService.create({
          planId: planM.id,
          featureId: housekeeping.id,
        });
        this.logger.log(`  ✓ Added basic_report + housekeeping to Plan M`);
      }
    }

    // Plan L - แถม Basic Report + Housekeeping + Advanced Report
    if (planL && basicReport && housekeeping) {
      const existing = await this.planFeaturesService.findByPlanId(planL.id);
      if (existing.length === 0) {
        const advancedReport = await this.featuresService.findByCode('advanced_report');
        
        await this.planFeaturesService.create({
          planId: planL.id,
          featureId: basicReport.id,
        });
        await this.planFeaturesService.create({
          planId: planL.id,
          featureId: housekeeping.id,
        });
        if (advancedReport) {
          await this.planFeaturesService.create({
            planId: planL.id,
            featureId: advancedReport.id,
          });
        }
        this.logger.log(`  ✓ Added basic_report + housekeeping + advanced_report to Plan L`);
      }
    }
  }

  /**
   * 4️⃣ Seed Admin Users
   */
  private async seedAdmins(): Promise<void> {
    this.logger.log('👤 Seeding Admins...');

    const admins = [
      {
        name: 'Super Admin',
        email: 'admin@hotelservices.com',
        role: AdminRole.SUPER,
      },
      {
        name: 'Finance Admin',
        email: 'finance@hotelservices.com',
        role: AdminRole.FINANCE,
      },
      {
        name: 'Support Admin',
        email: 'support@hotelservices.com',
        role: AdminRole.SUPPORT,
      },
    ];

    for (const adminData of admins) {
      const existing = await this.adminsService.findByEmail(adminData.email);
      if (!existing) {
        await this.adminsService.create(adminData);
        this.logger.log(`  ✓ Created admin: ${adminData.email} (${adminData.role})`);
      } else {
        this.logger.log(`  ⊙ Admin already exists: ${adminData.email}`);
      }
    }
  }

  /**
   * 5️⃣ Seed Sample Data (Optional - สำหรับทดสอบ)
   */
  private async seedSampleData(): Promise<void> {
    this.logger.log('🏨 Seeding Sample Data...');

    // สร้าง sample tenant (โรงแรมตัวอย่าง)
    const existingTenant = await this.tenantsService.findOne(
      '00000000-0000-0000-0000-000000000001',
    );

    if (!existingTenant) {
      const planS = await this.plansService.findByCode('S');
      if (!planS) {
        this.logger.warn('  ⚠️ Plan S not found, skipping sample data');
        return;
      }

      // สร้าง tenant
      const trialEndsAt = new Date();
      trialEndsAt.setDate(trialEndsAt.getDate() + 14);

      const tenant = await this.tenantsService.create({
        name: 'โรงแรมตัวอย่าง (Sample Hotel)',
        roomCount: 25,
        status: TenantStatus.TRIAL,
        trialEndsAt,
      });

      // สร้าง trial subscription
      const today = new Date();
      const endDate = new Date(trialEndsAt);

      await this.subscriptionsService.create({
        tenantId: tenant.id,
        planId: planS.id,
        status: SubscriptionStatus.TRIAL,
        startDate: today,
        endDate: endDate,
        autoRenew: false,
      });

      this.logger.log(`  ✓ Created sample tenant: ${tenant.name}`);
    } else {
      this.logger.log(`  ⊙ Sample tenant already exists`);
    }
  }

  /**
   * Clear all data (ระวัง! ใช้สำหรับ development เท่านั้น)
   */
  async clear(): Promise<void> {
    this.logger.warn('🗑️ Clearing all data...');
    // ระวัง: ฟังก์ชันนี้ควรใช้เฉพาะ development
    // ใน production ควรใช้ migration revert แทน
    this.logger.warn('⚠️ Clear function not implemented. Use migration revert instead.');
  }
}


