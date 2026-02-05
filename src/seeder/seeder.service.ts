import { Injectable, Logger } from '@nestjs/common';
import { PlansService } from '../plans/plans.service';
import { FeaturesService } from '../features/features.service';
import { PlanFeaturesService } from '../plan-features/plan-features.service';
import { AdminsService } from '../admins/admins.service';
import { TenantsService } from '../tenants/tenants.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { InvoicesService } from '../invoices/invoices.service';
import { PaymentsService } from '../payments/payments.service';
import { SubscriptionFeaturesService } from '../subscription-features/subscription-features.service';
import { FeatureType } from '../features/entities/feature.entity';
import { TenantStatus } from '../tenants/entities/tenant.entity';
import { SubscriptionStatus } from '../subscriptions/entities/subscription.entity';
import { InvoiceStatus } from '../invoices/entities/invoice.entity';
import { PaymentMethod, PaymentStatus } from '../payments/entities/payment.entity';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';

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
    private invoicesService: InvoicesService,
    private paymentsService: PaymentsService,
    private subscriptionFeaturesService: SubscriptionFeaturesService,
    private prisma: PrismaService,
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
      await this.seedUsers();
      await this.seedAdminPanelTestData();
      await this.seedHotelStaff();

      this.logger.log('✅ Database seeding completed successfully!');
    } catch (error) {
      this.logger.error('❌ Error seeding database:', error);
      throw error;
    }
  }

  /**
   * 1️⃣ Seed Plans (Starter, Professional, Enterprise)
   * ราคาและข้อมูลตาม UI Sales Page
   */
  private async seedPlans(): Promise<void> {
    this.logger.log('📦 Seeding Plans for Sales Page...');

    const plans = [
      {
        code: 'S',
        name: 'Starter',
        priceMonthly: 1990,
        yearlyDiscountPercent: 10, // ส่วนลด 10%
        // priceYearly จะถูกคำนวณอัตโนมัติ: 1990 * 12 * 0.9 = 21,492
        maxRooms: 20,
        maxUsers: 3,
        isActive: true,
        // Sales Page fields
        description: 'เริ่มต้นใช้งานได้ทันที พร้อมทดลองใช้ฟรี 14 วัน',
        displayOrder: 1,
        isPopular: false,
        badge: null,
        highlightColor: null,
        features: JSON.stringify([
          'รองรับ 20 ห้อง',
          'ผู้ใช้งาน 3 คน',
          'ระบบจองครบครัน',
        ]),
        buttonText: 'เริ่มใช้งาน',
      },
      {
        code: 'M',
        name: 'Professional',
        priceMonthly: 4990,
        yearlyDiscountPercent: 15, // ส่วนลด 15% (ยอดนิยม)
        // priceYearly จะถูกคำนวณอัตโนมัติ: 4990 * 12 * 0.85 = 50,898
        maxRooms: 50,
        maxUsers: 10,
        isActive: true,
        // Sales Page fields
        description: 'เหมาะสำหรับโรงแรมขนาดกลาง พร้อมฟีเจอร์ครบครัน',
        displayOrder: 2,
        isPopular: true,
        badge: 'ยอดนิยม',
        highlightColor: '#8B5CF6',
        features: JSON.stringify([
          'รองรับ 50 ห้อง',
          'ผู้ใช้งาน 10 คน',
          'ระบบจองครบครัน',
        ]),
        buttonText: 'เริ่มใช้งาน',
      },
      {
        code: 'L',
        name: 'Enterprise',
        priceMonthly: 9990,
        yearlyDiscountPercent: 20, // ส่วนลด 20% (สูงสุด)
        // priceYearly จะถูกคำนวณอัตโนมัติ: 9990 * 12 * 0.8 = 95,904
        maxRooms: 200,
        maxUsers: 50,
        isActive: true,
        // Sales Page fields
        description: 'สำหรับองค์กรขนาดใหญ่ พร้อม dedicated support',
        displayOrder: 3,
        isPopular: false,
        badge: null,
        highlightColor: null,
        features: JSON.stringify([
          'รองรับ 200 ห้อง',
          'ผู้ใช้งาน 50 คน',
          'ระบบจองครบครัน',
        ]),
        buttonText: 'เริ่มใช้งาน',
      },
    ];

    for (const planData of plans) {
      const existing = await this.plansService.findByCode(planData.code);
      if (!existing) {
        await this.plansService.create(planData);
        this.logger.log(`  ✓ Created plan: ${planData.code} - ${planData.name} (฿${planData.priceMonthly}/mo)`);
      } else {
        // Update existing plan with Sales Page data
        await this.plansService.update(existing.id, planData);
        this.logger.log(`  ⊙ Updated plan: ${planData.code} - ${planData.name}`);
      }
    }
  }

  /**
   * 2️⃣ Seed Features (Add-ons)
   */
  private async seedFeatures(): Promise<void> {
    this.logger.log('⚙️ Seeding Features...');

    const features = [
      {
        code: 'ota_booking',
        name: 'OTA Booking Integration',
        description: 'เชื่อมต่อกับ Booking.com, Agoda, และ OTA อื่นๆ',
        type: FeatureType.MODULE,
        priceMonthly: 990,
        isActive: true,
      },
      {
        code: 'extra_analytics',
        name: 'Extra Analytics',
        description: 'รายงานและ Analytics ขั้นสูง',
        type: FeatureType.MODULE,
        priceMonthly: 990,
        isActive: true,
      },
      {
        code: 'custom_branding',
        name: 'Custom Branding',
        description: 'กำหนด branding และ logo ของโรงแรม',
        type: FeatureType.MODULE,
        priceMonthly: 1490,
        isActive: true,
      },
      {
        code: 'automation',
        name: 'Automation System',
        description: 'ระบบอัตโนมัติสำหรับจัดการ booking และ workflow',
        type: FeatureType.MODULE,
        priceMonthly: 990,
        isActive: true,
      },
      {
        code: 'tax_invoice',
        name: 'Tax Invoice',
        description: 'ระบบออกใบกำกับภาษีอัตโนมัติ',
        type: FeatureType.TOGGLE,
        priceMonthly: 500,
        isActive: true,
      },
      {
        code: 'extra_user',
        name: 'Extra User',
        description: 'เพิ่มจำนวน user ที่ใช้งานได้',
        type: FeatureType.LIMIT,
        priceMonthly: 200,
        isActive: true,
      },
      {
        code: 'api_access',
        name: 'API Access',
        description: 'เข้าถึง API สำหรับ integration กับระบบอื่น',
        type: FeatureType.MODULE,
        priceMonthly: 1500,
        isActive: true,
      },
      {
        code: 'advanced_report',
        name: 'Advanced Report',
        description: 'รายงานขั้นสูงและ analytics',
        type: FeatureType.MODULE,
        priceMonthly: 500,
        isActive: true,
      },
      {
        code: 'housekeeping',
        name: 'Housekeeping Management',
        description: 'ระบบจัดการงานทำความสะอาด',
        type: FeatureType.TOGGLE,
        priceMonthly: 500,
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
        this.logger.log(`  ✓ Created feature: ${featureData.code} (฿${featureData.priceMonthly}/mo)`);
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
   * 4️⃣ Seed Admin Users (Legacy Admin table)
   */
  private async seedAdmins(): Promise<void> {
    this.logger.log('👤 Seeding Admins...');

    const admins = [
      {
        id: uuidv4(),
        firstName: 'Super',
        lastName: 'Admin',
        email: 'admin@hotelservices.com',
        role: 'platform_admin',
        password: 'Admin@123',
      },
      {
        id: uuidv4(),
        firstName: 'Finance',
        lastName: 'Admin',
        email: 'finance@hotelservices.com',
        role: 'platform_admin',
        password: 'Finance@123',
      },
      {
        id: uuidv4(),
        firstName: 'Support',
        lastName: 'Admin',
        email: 'support@hotelservices.com',
        role: 'platform_admin',
        password: 'Support@123',
      },
    ];

    for (const adminData of admins) {
      const existing = await this.adminsService.findByEmail(adminData.email);
      if (!existing) {
        const hashedPassword = await bcrypt.hash(adminData.password, 10);
        await this.adminsService.create({
          ...adminData,
          password: hashedPassword,
        });
        this.logger.log(`  ✓ Created admin: ${adminData.email} (${adminData.role})`);
      } else {
        this.logger.log(`  ⊙ Admin already exists: ${adminData.email}`);
      }
    }
  }

  /**
   * 5️⃣ Seed Test Users (User table → login ผ่าน /login)
   * - Platform admins ที่ใช้งานผ่าน dashboard
   * - Hotel staff ต่างๆ ของแต่ละโรงแรม
   */
  private async seedUsers(): Promise<void> {
    this.logger.log('👥 Seeding Test Users (User table)...');

    // Platform admins → User table (login ผ่าน /login เท่านั้น)
    const platformAdmins = [
      {
        email: 'platform.admin@staysync.io',
        password: 'admin123',
        firstName: 'Platform',
        lastName: 'Admin',
        role: 'platform_admin',
      },
      {
        email: 'platform.admin@test.co',
        password: 'Admin@123',
        firstName: 'Platform',
        lastName: 'Admin',
        role: 'platform_admin',
      },
    ];

    for (const userData of platformAdmins) {
      try {
        const existing = await this.prisma.user.findUnique({
          where: { email: userData.email },
        });

        if (!existing) {
          const hashedPassword = await bcrypt.hash(userData.password, 10);
          await this.prisma.user.create({
            data: {
              email: userData.email,
              password: hashedPassword,
              firstName: userData.firstName,
              lastName: userData.lastName,
              role: userData.role,
              status: 'active',
            },
          });
          this.logger.log(`  ✓ Created platform admin (User table): ${userData.email}`);
        } else {
          this.logger.log(`  ⊙ Platform admin already exists: ${userData.email}`);
        }
      } catch (error) {
        this.logger.warn(`  ⚠️  Could not create user ${userData.email}:`, error.message);
      }
    }
  }

  /**
   * 6️⃣ Seed Admin Panel Test Data
   * สร้างข้อมูลตาม UI ที่แสดง
   */
  private async seedAdminPanelTestData(): Promise<void> {
    this.logger.log('🏨 Seeding Admin Panel Test Data (matching UI)...');

    const planS = await this.plansService.findByCode('S');
    const planM = await this.plansService.findByCode('M');
    const planL = await this.plansService.findByCode('L');

    if (!planS || !planM || !planL) {
      this.logger.warn('  ⚠️ Plans not found, skipping Admin Panel test data');
      return;
    }

    // Get features for add-ons
    const extraAnalytics = await this.featuresService.findByCode('extra_analytics');
    const customBranding = await this.featuresService.findByCode('custom_branding');
    const otaBooking = await this.featuresService.findByCode('ota_booking');
    const automation = await this.featuresService.findByCode('automation');
    const apiAccess = await this.featuresService.findByCode('api_access');

    // ข้อมูลโรงแรมตาม UI Screenshot
    const hotels = [
      {
        // SUB-001: โรงแรมสุขใจ - Professional (upgrade จาก Starter) + 2 add-ons = ฿7,470
        code: 'SUB-001',
        name: 'โรงแรมสุขใจ',
        roomCount: 45,
        status: TenantStatus.ACTIVE,
        plan: planM, // Professional ฿4,990
        previousPlan: planS, // จาก Starter (upgrade)
        subscriptionStatus: SubscriptionStatus.ACTIVE,
        startDate: '2024-01-01',
        endDate: '2024-02-01',
        owner: {
          email: 'somchai@email.com',
          firstName: 'สมชาย',
          lastName: 'ใจดี',
        },
        addons: [
          { feature: extraAnalytics, price: 990 },    // Extra Analytics ฿990
          { feature: customBranding, price: 1490 },   // Custom Branding ฿1,490
        ],
        // Total: 4,990 + 990 + 1,490 = ฿7,470
        invoices: [
          { amount: 7470, status: InvoiceStatus.PAID, daysAgo: 0 },
        ],
      },
      {
        // SUB-002: Mountain View Resort - Enterprise + 3 add-ons = ฿13,960
        code: 'SUB-002',
        name: 'Mountain View Resort',
        roomCount: 80,
        status: TenantStatus.ACTIVE,
        plan: planL, // Enterprise ฿9,990
        previousPlan: null, // ไม่ได้ย้ายแพ็กเกจ
        subscriptionStatus: SubscriptionStatus.ACTIVE,
        startDate: '2024-01-05',
        endDate: '2024-02-05',
        owner: {
          email: 'mountain@email.com',
          firstName: 'John',
          lastName: 'Mountain',
        },
        addons: [
          { feature: otaBooking, price: 990 },       // OTA Booking ฿990
          { feature: automation, price: 990 },       // Automation ฿990
          { feature: apiAccess, price: 1990 },       // API Access ฿1,990
        ],
        // Total: 9,990 + 990 + 990 + 1,990 = ฿13,960
        invoices: [
          { amount: 13960, status: InvoiceStatus.PAID, daysAgo: 0 },
        ],
      },
      {
        // SUB-003: บ้านพักริมทะเล - Starter (Trial) ฿0
        code: 'SUB-003',
        name: 'บ้านพักริมทะเล',
        roomCount: 15,
        status: TenantStatus.TRIAL,
        plan: planS, // Starter ฿0
        previousPlan: null,
        subscriptionStatus: SubscriptionStatus.TRIAL,
        startDate: '2024-01-06',
        endDate: '2024-01-20',
        owner: {
          email: 'seaside@email.com',
          firstName: 'สมหญิง',
          lastName: 'ริมทะเล',
        },
        addons: [],
        invoices: [],
      },
      {
        // SUB-004: Garden Resort & Spa - Professional (downgrade จาก Enterprise) ฿4,990
        code: 'SUB-004',
        name: 'Garden Resort & Spa',
        roomCount: 60,
        status: TenantStatus.ACTIVE,
        plan: planM, // Professional ฿4,990
        previousPlan: planL, // จาก Enterprise (downgrade)
        subscriptionStatus: SubscriptionStatus.PENDING,
        startDate: '2024-01-10',
        endDate: '2024-02-10',
        owner: {
          email: 'garden@email.com',
          firstName: 'วิภา',
          lastName: 'สวนสวย',
        },
        addons: [],
        // Total: ฿4,990
        invoices: [
          { amount: 4990, status: InvoiceStatus.PENDING, daysAgo: 0 },
        ],
      },
      {
        // SUB-005: โรงแรมวิวภูเขา - Professional + 1 add-on (Expired)
        code: 'SUB-005',
        name: 'โรงแรมวิวภูเขา',
        roomCount: 35,
        status: TenantStatus.EXPIRED,
        plan: planM,
        previousPlan: null,
        subscriptionStatus: SubscriptionStatus.EXPIRED,
        startDate: '2023-12-01',
        endDate: '2024-01-01',
        owner: {
          email: 'mountain.view@email.com',
          firstName: 'ประสิทธิ์',
          lastName: 'ภูเขางาม',
        },
        addons: [
          { feature: otaBooking, price: 990 },
        ],
        invoices: [
          { amount: 5980, status: InvoiceStatus.PAID, daysAgo: 30 },
        ],
      },
      {
        // SUB-006: Sunset Beach Hotel - Enterprise (Suspended)
        code: 'SUB-006',
        name: 'Sunset Beach Hotel',
        roomCount: 100,
        status: TenantStatus.SUSPENDED,
        plan: planL,
        previousPlan: null,
        subscriptionStatus: SubscriptionStatus.EXPIRED,
        startDate: '2023-11-15',
        endDate: '2023-12-15',
        owner: {
          email: 'sunset@email.com',
          firstName: 'Sunset',
          lastName: 'Beach',
        },
        addons: [
          { feature: apiAccess, price: 1990 },
        ],
        invoices: [
          { amount: 11980, status: InvoiceStatus.REJECTED, daysAgo: 45 },
        ],
      },
    ];

    let invoiceCounter = 1;

    for (const hotelData of hotels) {
      try {
        // ตรวจสอบว่ามี tenant อยู่แล้วหรือไม่
        const allTenants = await this.tenantsService.findAll();
        const existingTenant = allTenants.find(t => t.name === hotelData.name);

        if (existingTenant) {
          this.logger.log(`  ⊙ Hotel already exists: ${hotelData.name}`);
          continue;
        }

        // สร้าง tenant
        const trialEndsAt = new Date();
        if (hotelData.status === TenantStatus.TRIAL) {
          trialEndsAt.setDate(trialEndsAt.getDate() + 14);
        } else {
          trialEndsAt.setDate(trialEndsAt.getDate() - 30);
        }

        const tenant = await this.tenantsService.create({
          name: hotelData.name,
          roomCount: hotelData.roomCount,
          status: hotelData.status,
          trialEndsAt,
        });

        this.logger.log(`  ✓ Created hotel: ${hotelData.code} - ${hotelData.name} (${hotelData.status})`);

        // สร้าง subscription with code and previousPlan
        const subscription = await this.subscriptionsService.create({
          subscriptionCode: hotelData.code,
          tenantId: tenant.id,
          planId: hotelData.plan.id,
          previousPlanId: hotelData.previousPlan?.id || null,
          status: hotelData.subscriptionStatus,
          startDate: new Date(hotelData.startDate),
          endDate: new Date(hotelData.endDate),
          autoRenew: hotelData.status === TenantStatus.ACTIVE,
        });

        const planPrice = Number(hotelData.plan.priceMonthly);
        const addonTotal = hotelData.addons.reduce((sum, a) => sum + a.price, 0);
        this.logger.log(`    ✓ Subscription: ${hotelData.plan.name} (฿${planPrice}) + Add-ons (฿${addonTotal})`);

        if (hotelData.previousPlan) {
          const direction = Number(hotelData.plan.priceMonthly) > Number(hotelData.previousPlan.priceMonthly) ? '↗ Upgrade' : '↘ Downgrade';
          this.logger.log(`      ${direction} จาก ${hotelData.previousPlan.name}`);
        }

        // สร้าง owner user
        const ownerData = hotelData.owner;
        const hashedPassword = await bcrypt.hash('password123', 10);
        
        try {
          const existingOwner = await this.prisma.$queryRaw`
            SELECT id FROM users WHERE email = ${ownerData.email} LIMIT 1
          `;

          if (Array.isArray(existingOwner) && existingOwner.length === 0) {
            await this.prisma.$executeRaw`
              INSERT INTO users (id, email, password, firstName, lastName, role, status, tenantId, createdAt, updatedAt)
              VALUES (
                UUID(),
                ${ownerData.email},
                ${hashedPassword},
                ${ownerData.firstName},
                ${ownerData.lastName},
                'tenant_admin',
                'active',
                ${tenant.id},
                NOW(),
                NOW()
              )
            `;
            this.logger.log(`    ✓ Created owner: ${ownerData.firstName} ${ownerData.lastName}`);
          }
        } catch (error) {
          this.logger.warn(`    ⚠️  Could not create owner: ${error.message}`);
        }

        // สร้าง add-ons (subscription features)
        for (const addon of hotelData.addons) {
          if (addon.feature) {
            try {
              await this.subscriptionFeaturesService.create({
                subscriptionId: subscription.id,
                featureId: addon.feature.id,
                price: addon.price,
              });
              this.logger.log(`    ✓ Added add-on: ${addon.feature.name} (฿${addon.price})`);
            } catch {
              // ignore if already exists
            }
          }
        }

        // สร้าง invoices
        for (const invoiceData of hotelData.invoices) {
          const invoiceNo = `INV-2024-${String(invoiceCounter++).padStart(3, '0')}`;
          const createdDate = new Date();
          createdDate.setDate(createdDate.getDate() - invoiceData.daysAgo);
          const dueDate = new Date(createdDate);
          dueDate.setDate(dueDate.getDate() + 15);

          const invoice = await this.invoicesService.create({
            tenantId: tenant.id,
            subscriptionId: subscription.id,
            invoiceNo,
            amount: invoiceData.amount,
            status: invoiceData.status,
            dueDate,
          });

          this.logger.log(`    ✓ Created invoice: ${invoiceNo} (฿${invoiceData.amount}) - ${invoiceData.status}`);

          // สร้าง payment
          if (invoiceData.status !== InvoiceStatus.REJECTED) {
            const paymentStatus = 
              invoiceData.status === InvoiceStatus.PAID ? PaymentStatus.APPROVED :
              PaymentStatus.PENDING;

            await this.paymentsService.create({
              invoiceId: invoice.id,
              method: PaymentMethod.TRANSFER,
              slipUrl: `https://cdn.staysync.io/payments/${invoiceNo.toLowerCase()}.png`,
              status: paymentStatus,
            });
          }
        }

      } catch (error) {
        this.logger.error(`  ❌ Error creating hotel ${hotelData.name}:`, error.message);
      }
    }

    this.logger.log('');
    this.logger.log('📊 Admin Panel Test Data Summary:');
    this.logger.log(`  - Hotels: ${hotels.length}`);
    this.logger.log(`    • Active: ${hotels.filter(h => h.subscriptionStatus === SubscriptionStatus.ACTIVE).length}`);
    this.logger.log(`    • Trial: ${hotels.filter(h => h.subscriptionStatus === SubscriptionStatus.TRIAL).length}`);
    this.logger.log(`    • Pending: ${hotels.filter(h => h.subscriptionStatus === SubscriptionStatus.PENDING).length}`);
    this.logger.log(`    • Expired: ${hotels.filter(h => h.subscriptionStatus === SubscriptionStatus.EXPIRED).length}`);
    this.logger.log(`  - Upgrades: 1 (โรงแรมสุขใจ: Starter → Professional)`);
    this.logger.log(`  - Downgrades: 1 (Garden Resort: Enterprise → Professional)`);
    
    // Calculate MRR
    const activeHotels = hotels.filter(h => h.subscriptionStatus === SubscriptionStatus.ACTIVE);
    const mrr = activeHotels.reduce((sum, h) => {
      const planPrice = Number(h.plan.priceMonthly);
      const addonTotal = h.addons.reduce((s, a) => s + a.price, 0);
      return sum + planPrice + addonTotal;
    }, 0);
    this.logger.log(`  - MRR: ฿${mrr.toLocaleString()}`);
    
    this.logger.log('');
  }

  /**
   * 7️⃣ Seed Hotel Staff (User table → login ผ่าน /login)
   * สร้างพนักงานตำแหน่งต่างๆ ให้แต่ละโรงแรม
   */
  private async seedHotelStaff(): Promise<void> {
    this.logger.log('👷 Seeding Hotel Staff (User table)...');

    // ดึง tenant ทั้งหมดที่มีอยู่
    const allTenants = await this.tenantsService.findAll();

    if (allTenants.length === 0) {
      this.logger.warn('  ⚠️ No tenants found, skipping hotel staff seeding');
      return;
    }

    // Staff templates สำหรับแต่ละโรงแรม
    const staffTemplates = [
      { role: 'manager', position: 'General Manager', department: 'Management', firstNameTh: 'วิชัย', lastNameTh: 'บริหารดี', firstNameEn: 'Michael', lastNameEn: 'Manager' },
      { role: 'receptionist', position: 'Front Desk Agent', department: 'Front Office', firstNameTh: 'สุนิสา', lastNameTh: 'ต้อนรับดี', firstNameEn: 'Sarah', lastNameEn: 'Reception' },
      { role: 'receptionist', position: 'Night Auditor', department: 'Front Office', firstNameTh: 'ปรีชา', lastNameTh: 'กลางคืน', firstNameEn: 'Paul', lastNameEn: 'Night' },
      { role: 'housekeeper', position: 'Head Housekeeper', department: 'Housekeeping', firstNameTh: 'มาลี', lastNameTh: 'สะอาดใส', firstNameEn: 'Maria', lastNameEn: 'Clean' },
      { role: 'housekeeper', position: 'Room Attendant', department: 'Housekeeping', firstNameTh: 'สมศรี', lastNameTh: 'ห้องสวย', firstNameEn: 'Linda', lastNameEn: 'Room' },
      { role: 'chef', position: 'Head Chef', department: 'Kitchen', firstNameTh: 'ธนกฤต', lastNameTh: 'ครัวอร่อย', firstNameEn: 'Gordon', lastNameEn: 'Kitchen' },
      { role: 'waiter', position: 'F&B Server', department: 'Restaurant', firstNameTh: 'นภาพร', lastNameTh: 'เสิร์ฟดี', firstNameEn: 'Anna', lastNameEn: 'Service' },
      { role: 'maintenance', position: 'Chief Engineer', department: 'Engineering', firstNameTh: 'ช่างชัย', lastNameTh: 'ซ่อมเก่ง', firstNameEn: 'John', lastNameEn: 'Fix' },
      { role: 'accountant', position: 'Hotel Accountant', department: 'Finance', firstNameTh: 'กัลยา', lastNameTh: 'บัญชีดี', firstNameEn: 'Karen', lastNameEn: 'Finance' },
      { role: 'security', position: 'Security Officer', department: 'Security', firstNameTh: 'สมชาย', lastNameTh: 'ปลอดภัย', firstNameEn: 'David', lastNameEn: 'Guard' },
    ];

    const defaultPassword = 'Staff@123';
    const hashedPassword = await bcrypt.hash(defaultPassword, 10);
    let staffCount = 0;

    for (const tenant of allTenants) {
      const tenantSlug = tenant.name
        .toLowerCase()
        .replace(/[^a-z0-9ก-๙]/g, '')
        .substring(0, 10);

      this.logger.log(`  🏨 ${tenant.name}:`);

      for (let i = 0; i < staffTemplates.length; i++) {
        const tpl = staffTemplates[i];
        const isThaiHotel = /[ก-๙]/.test(tenant.name);
        const firstName = isThaiHotel ? tpl.firstNameTh : tpl.firstNameEn;
        const lastName = isThaiHotel ? tpl.lastNameTh : tpl.lastNameEn;
        const emailPrefix = `${tpl.role}${i > 0 ? i : ''}`;
        const email = `${emailPrefix}.${tenantSlug}@hotel.test`;

        try {
          const existingUser = await this.prisma.$queryRaw`
            SELECT id FROM users WHERE email = ${email} LIMIT 1
          `;

          if (Array.isArray(existingUser) && existingUser.length === 0) {
            const userId = uuidv4();
            await this.prisma.$executeRaw`
              INSERT INTO users (id, email, password, firstName, lastName, role, status, tenantId, createdAt, updatedAt)
              VALUES (
                ${userId},
                ${email},
                ${hashedPassword},
                ${firstName},
                ${lastName},
                ${tpl.role},
                'active',
                ${tenant.id},
                NOW(),
                NOW()
              )
            `;

            // สร้าง Employee record ด้วย
            try {
              const empCode = `EMP-${String(staffCount + 1).padStart(4, '0')}`;
              await this.prisma.$executeRaw`
                INSERT INTO employees (id, tenantId, firstName, lastName, email, employeeCode, department, position, startDate, createdAt, updatedAt)
                VALUES (
                  UUID(),
                  ${tenant.id},
                  ${firstName},
                  ${lastName},
                  ${email},
                  ${empCode},
                  ${tpl.department},
                  ${tpl.position},
                  '2024-01-01',
                  NOW(),
                  NOW()
                )
              `;
            } catch {
              // employee อาจมีอยู่แล้ว
            }

            staffCount++;
          }
        } catch (error) {
          this.logger.warn(`    ⚠️  Could not create staff ${email}: ${error.message}`);
        }
      }

      this.logger.log(`    ✓ Staff created for ${tenant.name}`);
    }

    this.logger.log('');
    this.logger.log(`  Total staff created: ${staffCount}`);
    this.logger.log('');
    this.logger.log('══════════════════════════════════════════════════════');
    this.logger.log('🔑 Test Login Credentials:');
    this.logger.log('──────────────────────────────────────────────────────');
    this.logger.log('');
    this.logger.log('  📌 Admin Login → POST /api/v1/auth/admin/login');
    this.logger.log('  ─────────────────────────────────────────────');
    this.logger.log('  admin@hotelservices.com    / Admin@123     (Super Admin)');
    this.logger.log('  finance@hotelservices.com  / Finance@123   (Finance)');
    this.logger.log('  support@hotelservices.com  / Support@123   (Support)');
    this.logger.log('');
    this.logger.log('  📌 User Login → POST /api/v1/auth/login');
    this.logger.log('  ─────────────────────────────────────────────');
    this.logger.log('  platform.admin@staysync.io / admin123      (Platform Admin)');
    this.logger.log('  platform.admin@test.co     / Admin@123     (Platform Admin)');
    this.logger.log('  somchai@email.com          / password123   (Hotel Owner - โรงแรมสุขใจ)');
    this.logger.log('  mountain@email.com         / password123   (Hotel Owner - Mountain View)');
    this.logger.log('  seaside@email.com          / password123   (Hotel Owner - บ้านพักริมทะเล)');
    this.logger.log('  garden@email.com           / password123   (Hotel Owner - Garden Resort)');
    this.logger.log(`  manager*.hotel.test        / Staff@123     (Hotel Manager)`);
    this.logger.log(`  receptionist*.hotel.test   / Staff@123     (Front Desk)`);
    this.logger.log(`  housekeeper*.hotel.test    / Staff@123     (Housekeeping)`);
    this.logger.log(`  chef*.hotel.test           / Staff@123     (Chef)`);
    this.logger.log(`  waiter*.hotel.test         / Staff@123     (F&B)`);
    this.logger.log(`  maintenance*.hotel.test    / Staff@123     (Engineering)`);
    this.logger.log(`  accountant*.hotel.test     / Staff@123     (Finance)`);
    this.logger.log(`  security*.hotel.test       / Staff@123     (Security)`);
    this.logger.log('');
    this.logger.log('══════════════════════════════════════════════════════');
  }

  /**
   * Clear all data (ระวัง! ใช้สำหรับ development เท่านั้น)
   */
  async clear(): Promise<void> {
    this.logger.warn('🗑️ Clearing all data...');
    this.logger.warn('⚠️ Clear function not implemented. Use migration revert instead.');
  }
}
