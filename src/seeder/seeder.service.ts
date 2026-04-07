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
      await this.seedDemoGuests();
      await this.seedDemoBookings();
      await this.seedDemoReviews();
      await this.seedHotelStaff();
      await this.seedHrMasterData();
      await this.seedPremiumHrData();

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
        code: 'FREE',
        name: 'ทดลองฟรี',
        priceMonthly: 0,
        yearlyDiscountPercent: 0,
        maxRooms: 5,
        maxUsers: 2,
        maxProperties: 2,
        isActive: true,
        description: 'ลองใช้ทุกฟีเจอร์ได้เต็มที่ 14 วัน ไม่ต้องผูกบัตรเครดิต',
        subtitle: 'เริ่มต้นใน 2 นาที ไม่มีค่าใช้จ่าย',
        targetAudience: 'สำหรับทุกโรงแรมที่อยากลองก่อนตัดสินใจ',
        pricePerRoom: null,
        displayOrder: 0,
        isPopular: false,
        badge: 'ฟรี 14 วัน',
        highlightColor: null,
        features: JSON.stringify([
          'ฟีเจอร์ครบทุกระบบ ไม่มีกั๊ก',
          'จัดการจอง + เช็คอิน/เอาท์',
          'ระบบ Housekeeping อัตโนมัติ',
          'รายงานรายได้แบบเรียลไทม์',
          'ไม่ต้องผูกบัตรเครดิต',
          'ยกเลิกได้ตลอดเวลา',
        ]),
        buttonText: 'เริ่มทดลองฟรี — ไม่มีค่าใช้จ่าย',
      },
      {
        code: 'S',
        name: 'Starter',
        priceMonthly: 1990,
        yearlyDiscountPercent: 10,
        maxRooms: 20,
        maxUsers: 3,
        maxProperties: 1,
        isActive: true,
        description: 'ลดงานซ้ำซ้อน จัดการจองและห้องพักได้จากที่เดียว',
        subtitle: 'เปลี่ยนจากสมุดจดมาเป็นระบบมืออาชีพ',
        targetAudience: 'โรงแรมขนาดเล็ก · เกสต์เฮาส์ · โฮสเทล 1-20 ห้อง',
        pricePerRoom: '~฿100/ห้อง/เดือน',
        displayOrder: 1,
        isPopular: false,
        badge: null,
        highlightColor: null,
        features: JSON.stringify([
          'จัดการจองออนไลน์ ลด no-show',
          'Front Desk ดิจิทัล เช็คอิน/เอาท์ง่าย',
          'มอบหมายงาน Housekeeping อัตโนมัติ',
          'รายงานรายได้ + ยอดจองรายวัน',
          'แจ้งเตือนอีเมลอัตโนมัติ',
          'Email Support ตอบภายใน 24 ชม.',
        ]),
        buttonText: 'เริ่มใช้งาน Starter',
      },
      {
        code: 'M',
        name: 'Professional',
        priceMonthly: 4990,
        yearlyDiscountPercent: 15,
        maxRooms: 50,
        maxUsers: 10,
        maxProperties: 3,
        isActive: true,
        description: 'ระบบจัดการครบวงจร เพิ่มรายได้ ลดต้นทุน วิเคราะห์ข้อมูลเชิงลึก',
        subtitle: 'ฟีเจอร์ครบ คุ้มที่สุด สำหรับโรงแรมที่พร้อมเติบโต',
        targetAudience: 'โรงแรม · รีสอร์ท · บูทีค 21-50 ห้อง',
        pricePerRoom: '~฿100/ห้อง/เดือน',
        displayOrder: 2,
        isPopular: true,
        badge: 'คุ้มค่าที่สุด',
        highlightColor: '#8B5CF6',
        features: JSON.stringify([
          'ทุกฟีเจอร์ของ Starter +',
          'ระบบ HR จัดการพนักงาน เวร ลางาน',
          'ระบบร้านอาหาร (F&B) ลิงก์กับ Folio แขก',
          'รายงานเชิงลึก + Revenue Analytics',
          'Channel Manager เชื่อม OTA อัตโนมัติ',
          'ส่งรีวิวรีเควสต์หลังเช็คเอาท์',
          'Loyalty Program สะสมแต้มแขกประจำ',
          'Priority Support ตอบภายใน 4 ชม.',
        ]),
        buttonText: 'เริ่มใช้งาน Professional',
      },
      {
        code: 'L',
        name: 'Enterprise',
        priceMonthly: 9990,
        yearlyDiscountPercent: 20,
        maxRooms: 200,
        maxUsers: 50,
        maxProperties: 5,
        isActive: true,
        description: 'สำหรับเชนโรงแรมและกลุ่มธุรกิจ บริหารหลาย property จากที่เดียว',
        subtitle: 'ควบคุมทุกสาขาจาก Dashboard เดียว',
        targetAudience: 'เชนโรงแรม · กลุ่มธุรกิจ 51-200+ ห้อง · หลาย property',
        pricePerRoom: '~฿50/ห้อง/เดือน',
        displayOrder: 3,
        isPopular: false,
        badge: 'ประหยัดสุด/ห้อง',
        highlightColor: null,
        features: JSON.stringify([
          'ทุกฟีเจอร์ของ Professional +',
          'Multi-property Dashboard รวมศูนย์',
          'API Access เชื่อมระบบภายนอก',
          'Custom Integration ตามธุรกิจ',
          'Dedicated Account Manager ดูแลเฉพาะ',
          'PromptPay QR Payment ในระบบ',
          'Audit Log + Security ระดับองค์กร',
          '24/7 Premium Support โทร + แชท',
        ]),
        buttonText: 'ติดต่อทีมขาย',
      },
    ];

    for (const planData of plans) {
      const existing = await this.plansService.findByCode(planData.code);
      if (!existing) {
        await this.plansService.create(planData);
        this.logger.log(
          `  ✓ Created plan: ${planData.code} - ${planData.name} (฿${planData.priceMonthly}/mo)`,
        );
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
      {
        // HR Add-on: paid module add-on — sold separately
        code: 'HR_MODULE',
        name: 'HR Module',
        description:
          'ระบบ HR ครบวงจร: จัดการพนักงาน เงินเดือน การลา และเชื่อมข้อมูลกับทีมแม่บ้าน/ช่าง',
        type: FeatureType.MODULE,
        priceMonthly: 1200,
        isActive: true,
      },
    ];

    for (const featureData of features) {
      const existing = await this.featuresService.findByCode(featureData.code);
      if (!existing) {
        await this.featuresService.create(featureData);
        this.logger.log(
          `  ✓ Created feature: ${featureData.code} (฿${featureData.priceMonthly}/mo)`,
        );
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
   * ⚠️ User table ใช้สำหรับ subscription customers เท่านั้น
   * Platform Admin ต้อง login ผ่าน /auth/admin/login (Admin table)
   */
  private async seedUsers(): Promise<void> {
    this.logger.log('👥 Seeding Test Users (User table)...');
    this.logger.log('  ℹ️  User table สำหรับ subscription customers เท่านั้น');
    this.logger.log('  ℹ️  Platform Admin ใช้ Admin table → /auth/admin/login');
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
    const taxInvoice = await this.featuresService.findByCode('tax_invoice');
    const extraUser = await this.featuresService.findByCode('extra_user');
    const advancedReport = await this.featuresService.findByCode('advanced_report');
    const housekeeping = await this.featuresService.findByCode('housekeeping');
    const hrModule = await this.featuresService.findByCode('HR_MODULE');

    // ข้อมูลโรงแรมตาม UI Screenshot
    const allFeatures = [
      { feature: extraAnalytics, price: 990 },
      { feature: customBranding, price: 1490 },
      { feature: otaBooking, price: 990 },
      { feature: automation, price: 990 },
      { feature: apiAccess, price: 1990 },
      { feature: taxInvoice, price: 500 },
      { feature: extraUser, price: 200 },
      { feature: advancedReport, price: 500 },
      { feature: housekeeping, price: 500 },
      { feature: hrModule, price: 1200 },
    ];

    // Dynamic dates based on current date — subscriptions always valid when seeding
    const now = new Date();

    // ACTIVE: started 1 month ago, renews 1 month from now (monthly billing)
    const activeStart = new Date(now);
    activeStart.setMonth(activeStart.getMonth() - 1);
    const activeEnd = new Date(now);
    activeEnd.setMonth(activeEnd.getMonth() + 1);

    // TRIAL: started today, expires in 14 days
    const trialStart = new Date(now);
    const trialEnd = new Date(now);
    trialEnd.setDate(trialEnd.getDate() + 14);

    // PENDING: starts today, cycle ends in 1 month
    const pendingStart = new Date(now);
    const pendingEnd = new Date(now);
    pendingEnd.setMonth(pendingEnd.getMonth() + 1);

    // ข้อมูลโรงแรมตาม UI Screenshot - Reduced to 4 hotels
    const hotels = [
      {
        // SUB-001: โรงแรมสุขใจ - Professional
        code: 'SUB-001',
        slug: 'sukjai',
        name: 'โรงแรมสุขใจ (Sukjai Hotel)',
        nameEn: 'Sukjai Hotel',
        customerName: 'Sukjai Hotel Co., Ltd.',
        roomCount: 45,
        status: TenantStatus.ACTIVE,
        plan: planM,
        previousPlan: planS,
        subscriptionStatus: SubscriptionStatus.ACTIVE,
        startDate: activeStart.toISOString().split('T')[0],
        endDate: activeEnd.toISOString().split('T')[0],
        email: 'info.sukjai@hotel.test',
        phone: '02-123-4567',
        address: '123 Sukhumvit Rd, Bangkok',
        owner: {
          email: 'somchai@email.com',
          firstName: 'Somchai',
          lastName: 'Jaidee',
        },
        addons: [
          { feature: extraAnalytics, price: 990 },
          { feature: customBranding, price: 1490 },
        ],
        invoices: [{ amount: 7470, status: InvoiceStatus.PAID, daysAgo: 0 }],
      },
      {
        // SUB-002: Mountain View Resort - Enterprise + ALL add-ons
        code: 'SUB-002',
        slug: 'mountain',
        name: 'Mountain View Resort (Premium Test)',
        nameEn: 'Mountain View Resort',
        customerName: 'Mountain View Development Co., Ltd.',
        roomCount: 80,
        status: TenantStatus.ACTIVE,
        plan: planL,
        previousPlan: null,
        subscriptionStatus: SubscriptionStatus.ACTIVE,
        startDate: activeStart.toISOString().split('T')[0],
        endDate: activeEnd.toISOString().split('T')[0],
        email: 'info.mountain@hotel.test',
        phone: '053-123-456',
        address: '456 Mountain Rd, Chiang Mai',
        owner: {
          email: 'premium.test@email.com',
          firstName: 'Premium',
          lastName: 'Tester',
        },
        addons: [
          { feature: otaBooking, price: 990 },
          { feature: automation, price: 990 },
          { feature: apiAccess, price: 1990 },
          { feature: extraAnalytics, price: 990 },
          { feature: customBranding, price: 1490 },
          { feature: extraUser, price: 200 },
          { feature: taxInvoice, price: 500 },
          { feature: advancedReport, price: 500 },
          { feature: housekeeping, price: 500 },
          { feature: hrModule, price: 1200 },
        ],
        invoices: [{ amount: 17940, status: InvoiceStatus.PAID, daysAgo: 0 }],
      },
      {
        // SUB-003: บ้านพักริมทะเล - Starter (Trial)
        code: 'SUB-003',
        slug: 'seaside',
        name: 'บ้านพักริมทะเล (Seaside Stay)',
        nameEn: 'Seaside Stay',
        customerName: 'Seaside Hospitality Group',
        roomCount: 15,
        status: TenantStatus.TRIAL,
        plan: planS,
        previousPlan: null,
        subscriptionStatus: SubscriptionStatus.TRIAL,
        startDate: trialStart.toISOString().split('T')[0],
        endDate: trialEnd.toISOString().split('T')[0],
        email: 'info.seaside@hotel.test',
        phone: '076-123-456',
        address: '789 Beach Rd, Phuket',
        owner: {
          email: 'seaside@email.com',
          firstName: 'Somying',
          lastName: 'Seaside',
        },
        addons: [],
        invoices: [],
      },
      {
        // SUB-004: Garden Resort & Spa - Professional
        code: 'SUB-004',
        slug: 'garden',
        name: 'Garden Resort & Spa',
        nameEn: 'Garden Resort & Spa',
        customerName: 'Garden Resort Co., Ltd.',
        roomCount: 60,
        status: TenantStatus.ACTIVE,
        plan: planM,
        previousPlan: planL,
        subscriptionStatus: SubscriptionStatus.PENDING,
        startDate: pendingStart.toISOString().split('T')[0],
        endDate: pendingEnd.toISOString().split('T')[0],
        email: 'info.garden@hotel.test',
        phone: '038-123-456',
        address: '101 Garden St, Pattaya',
        owner: {
          email: 'garden@email.com',
          firstName: 'Wipa',
          lastName: 'Garden',
        },
        addons: [],
        invoices: [{ amount: 4990, status: InvoiceStatus.PENDING, daysAgo: 0 }],
      },
    ];

    let invoiceCounter = 1;

    for (const hotelData of hotels) {
      try {
        // ตรวจสอบว่ามี tenant อยู่แล้วหรือไม่
        const allTenants = await this.tenantsService.findAll();
        const existingTenant = allTenants.find((t) => t.name === hotelData.name);

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
          nameEn: hotelData.nameEn,
          customerName: hotelData.customerName,
          email: hotelData.email,
          phone: hotelData.phone,
          address: hotelData.address,
          roomCount: hotelData.roomCount,
          status: hotelData.status,
          trialEndsAt,
        });

        this.logger.log(
          `  ✓ Created hotel: ${hotelData.code} - ${hotelData.name} (${hotelData.status})`,
        );

        //สร้าง Property record สอดรับกับ Prisma Schema
        const property = await this.prisma.property.create({
          data: {
            tenantId: tenant.id,
            name: hotelData.name,
            code: hotelData.code.replace('-', ''),
            email: hotelData.email,
            phone: hotelData.phone,
            location: hotelData.address,
            status: 'active',
            isDefault: true,
          },
        });
        this.logger.log(`    ✓ Created Property: ${property.id}`);

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

        // ... (owner creation script remains same)
        const ownerData = hotelData.owner;
        const hashedPassword = await bcrypt.hash('password123', 10);

        try {
          const existingOwner = await this.prisma.user.findUnique({
            where: { email: ownerData.email },
          });

          if (!existingOwner) {
            const newOwner = await this.prisma.user.create({
              data: {
                id: uuidv4(),
                email: ownerData.email,
                password: hashedPassword,
                firstName: ownerData.firstName,
                lastName: ownerData.lastName,
                role: 'tenant_admin',
                status: 'active',
                tenantId: tenant.id,
              },
            });

            // Create UserTenant junction record so fetchMyCompanies() works correctly
            await this.prisma.userTenant.create({
              data: {
                userId: newOwner.id,
                tenantId: tenant.id,
                role: 'owner',
                isDefault: true,
              },
            });

            this.logger.log(`    ✓ Created owner: ${ownerData.firstName} ${ownerData.lastName}`);
          } else {
            // CRITICAL FIX: Update user.tenantId so JWT always carries the correct tenantId
            // after a re-seed (prevents 403 on /tenants/hotels/:id after db:refresh)
            await this.prisma.user.update({
              where: { id: existingOwner.id },
              data: {
                tenantId: tenant.id,
                password: hashedPassword, // refresh password in case it changed
              },
            });

            // Reset all existing default flags for this user, then mark the new tenant as default
            await this.prisma.userTenant.updateMany({
              where: { userId: existingOwner.id, isDefault: true },
              data: { isDefault: false },
            });

            // Upsert UserTenant junction record — ensure this tenant is marked as default
            const existingUserTenant = await this.prisma.userTenant.findUnique({
              where: { userId_tenantId: { userId: existingOwner.id, tenantId: tenant.id } },
            });
            if (!existingUserTenant) {
              await this.prisma.userTenant.create({
                data: {
                  userId: existingOwner.id,
                  tenantId: tenant.id,
                  role: 'owner',
                  isDefault: true,
                },
              });
            } else {
              await this.prisma.userTenant.update({
                where: { userId_tenantId: { userId: existingOwner.id, tenantId: tenant.id } },
                data: { isDefault: true },
              });
            }
            this.logger.log(
              `    ✓ Updated existing owner: ${ownerData.email} → tenantId synced to ${tenant.id}`,
            );
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
          const invoiceNo = `INV-${now.getFullYear()}-${String(invoiceCounter++).padStart(3, '0')}`;
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

          this.logger.log(
            `    ✓ Created invoice: ${invoiceNo} (฿${invoiceData.amount}) - ${invoiceData.status}`,
          );

          // สร้าง payment
          if (invoiceData.status !== InvoiceStatus.REJECTED) {
            const paymentStatus =
              invoiceData.status === InvoiceStatus.PAID
                ? PaymentStatus.APPROVED
                : PaymentStatus.PENDING;

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
    this.logger.log(
      `    • Active: ${hotels.filter((h) => h.subscriptionStatus === SubscriptionStatus.ACTIVE).length}`,
    );
    this.logger.log(
      `    • Trial: ${hotels.filter((h) => h.subscriptionStatus === SubscriptionStatus.TRIAL).length}`,
    );
    this.logger.log(
      `    • Pending: ${hotels.filter((h) => h.subscriptionStatus === SubscriptionStatus.PENDING).length}`,
    );
    this.logger.log(
      `    • Expired: ${hotels.filter((h) => h.subscriptionStatus === SubscriptionStatus.EXPIRED).length}`,
    );
    this.logger.log(`  - Upgrades: 1 (โรงแรมสุขใจ: Starter → Professional)`);
    this.logger.log(`  - Downgrades: 1 (Garden Resort: Enterprise → Professional)`);

    // Calculate MRR
    const activeHotels = hotels.filter((h) => h.subscriptionStatus === SubscriptionStatus.ACTIVE);
    const mrr = activeHotels.reduce((sum, h) => {
      const planPrice = Number(h.plan.price_monthly);
      const addonTotal = h.addons.reduce((s, a) => s + a.price, 0);
      return sum + planPrice + addonTotal;
    }, 0);
    this.logger.log(`  - MRR: ฿${mrr.toLocaleString()}`);

    this.logger.log('');
  }

  /**
   * 7️⃣ Seed Demo Guests
   * สร้างแขกตัวอย่าง (Thai + International names)
   */
  private async seedDemoGuests(): Promise<void> {
    this.logger.log('👥 Seeding Demo Guests...');

    // Get all tenants to assign guests per tenant
    const allTenants = await this.tenantsService.findAll();
    const defaultTenantId = allTenants.length > 0 ? allTenants[0].id : null;

    // รายชื่อแขกตัวอย่าง (Thai + International)
    const demoGuests = [
      {
        firstName: 'สมชาย',
        lastName: 'ใจดี',
        email: 'somchai.jaidia@example.com',
        phone: '+66-8-1111-1111',
        nationality: 'Thailand',
      },
      {
        firstName: 'สมหญิง',
        lastName: 'สวยงาม',
        email: 'somying.suyyam@example.com',
        phone: '+66-8-2222-2222',
        nationality: 'Thailand',
      },
      {
        firstName: 'วิชัย',
        lastName: 'ประสพ',
        email: 'vichai.prasop@example.com',
        phone: '+66-8-3333-3333',
        nationality: 'Thailand',
      },
      {
        firstName: 'นัฐญา',
        lastName: 'บัวบาน',
        email: 'nattaya.buaban@example.com',
        phone: '+66-8-4444-4444',
        nationality: 'Thailand',
      },
      {
        firstName: 'ประเทศ',
        lastName: 'อยู่สุข',
        email: 'prashet.yousuk@example.com',
        phone: '+66-8-5555-5555',
        nationality: 'Thailand',
      },
      {
        firstName: 'Michael',
        lastName: 'Johnson',
        email: 'michael.johnson@example.com',
        phone: '+1-213-555-1234',
        nationality: 'United States',
      },
      {
        firstName: 'Emma',
        lastName: 'Smith',
        email: 'emma.smith@example.com',
        phone: '+44-20-7123-4567',
        nationality: 'United Kingdom',
      },
      {
        firstName: 'Jean',
        lastName: 'Dubois',
        email: 'jean.dubois@example.com',
        phone: '+33-1-42-86-82-00',
        nationality: 'France',
      },
      {
        firstName: 'Marco',
        lastName: 'Rossi',
        email: 'marco.rossi@example.com',
        phone: '+39-06-1234-5678',
        nationality: 'Italy',
      },
      {
        firstName: 'Liu',
        lastName: 'Wei',
        email: 'liu.wei@example.com',
        phone: '+86-10-1234-5678',
        nationality: 'China',
      },
    ];

    let guestCount = 0;
    for (const guestData of demoGuests) {
      try {
        const existingGuest = await this.prisma.$queryRaw`
          SELECT id FROM guests WHERE email = ${guestData.email} LIMIT 1
        `;

        if (Array.isArray(existingGuest) && existingGuest.length === 0) {
          await this.prisma.$executeRaw`
            INSERT INTO guests (id, tenantId, firstName, lastName, email, phone, nationality, createdAt, updatedAt)
            VALUES (
              UUID(),
              ${defaultTenantId},
              ${guestData.firstName},
              ${guestData.lastName},
              ${guestData.email},
              ${guestData.phone},
              ${guestData.nationality},
              NOW(),
              NOW()
            )
          `;
          guestCount++;
        }
      } catch (error) {
        this.logger.warn(`    ⚠️  Could not create guest ${guestData.email}: ${error.message}`);
      }
    }

    this.logger.log(`  ✓ Created ${guestCount} demo guests`);
  }

  /**
   * 8️⃣ Seed Demo Bookings
   * สร้างการจองตัวอย่าง (confirmed, checked-in, completed - past 30 days)
   */
  private async seedDemoBookings(): Promise<void> {
    this.logger.log('📅 Seeding Demo Bookings...');

    try {
      // ดึง tenant ทั้งหมด
      const allTenants = await this.tenantsService.findAll();
      if (allTenants.length === 0) {
        this.logger.warn('  ⚠️ No tenants found, skipping demo bookings');
        return;
      }

      // ดึงแขกทั้งหมด
      const allGuests: any[] = await this.prisma
        .$queryRaw`SELECT id, firstName, lastName FROM guests LIMIT 50`;
      if (!Array.isArray(allGuests) || allGuests.length === 0) {
        this.logger.warn('  ⚠️ No guests found, skipping demo bookings');
        return;
      }

      let bookingCount = 0;
      const today = new Date();

      // สร้างการจองสำหรับแต่ละโรงแรม
      for (const tenant of allTenants) {
        // ดึง property สำหรับ tenant นี้ (Prisma)
        const property = await this.prisma.property.findFirst({
          where: { tenantId: tenant.id },
        });

        if (!property) {
          this.logger.warn(`  ⚠️ No property found for tenant ${tenant.name}, skipping bookings`);
          continue;
        }

        // ดึงห้องของโรงแรมนี้ โดยใช้ property.id ที่แท้จริง (ไม่ใช่ tenant.id)
        const rooms: any[] = await this.prisma.room.findMany({
          where: { propertyId: property.id },
          take: 10,
        });

        if (rooms.length === 0) {
          // สร้างห้องตัวอย่างถ้าไม่มี
          const roomTypes = ['Standard', 'Deluxe', 'Suite', 'Presidential'];
          const newRooms = [];
          for (let i = 1; i <= 4; i++) {
            const roomType = roomTypes[i - 1];
            const basePrice = 1000 + i * 500;

            const r = await this.prisma.room.create({
              data: {
                id: uuidv4(),
                propertyId: property.id,
                tenantId: property.tenantId,
                number: String(100 + i),
                type: roomType,
                floor: 1,
                price: basePrice,
                status: 'available',
                description: `${roomType} room created by seeder`,
              },
            });
            newRooms.push(r);
            bookingCount++;
          }
          rooms.push(...newRooms);
        }

        // สร้าง 3-5 การจองต่อโรงแรม
        const bookingsPerHotel = Math.floor(Math.random() * 3) + 3; // 3-5 bookings
        for (let b = 0; b < bookingsPerHotel && rooms.length > 0; b++) {
          const room = rooms[Math.floor(Math.random() * rooms.length)];
          const guest = allGuests[Math.floor(Math.random() * allGuests.length)];

          // สร้างวันที่จองหลาก ๆ (อดีต, ปัจจุบัน, อนาคต)
          const daysOffset = Math.floor(Math.random() * 60) - 30; // -30 to +30 days
          const checkInDate = new Date(today);
          checkInDate.setDate(checkInDate.getDate() + daysOffset);

          const checkOutDate = new Date(checkInDate);
          checkOutDate.setDate(checkOutDate.getDate() + (Math.floor(Math.random() * 4) + 1)); // 1-4 nights

          // กำหนด status ตามวันที่
          let status = 'confirmed';
          if (daysOffset < -2)
            status = 'completed'; // อดีตมากกว่า 2 วัน = completed
          else if (daysOffset <= 1)
            status = 'checked_in'; // ใน 1 วัน = checked_in
          else status = 'confirmed'; // อนาคต = confirmed

          const nights = Math.max(
            1,
            Math.ceil((checkOutDate.getTime() - checkInDate.getTime()) / (1000 * 60 * 60 * 24)),
          );
          const totalPrice = Number(room.price) * nights;

          try {
            const createdBooking = await this.prisma.booking.create({
              data: {
                id: uuidv4(),
                tenantId: tenant.id,
                property: { connect: { id: property.id } },
                room: { connect: { id: room.id } },
                guest: { connect: { id: guest.id } },
                guestFirstName: guest.firstName,
                guestLastName: guest.lastName,
                guestEmail: guest.email || 'guest@example.com',
                guestPhone: guest.phone || '+66-8-0000-0000',
                checkIn: checkInDate,
                checkOut: checkOutDate,
                status: status,
                totalPrice: totalPrice,
                notes: 'Demo booking created by seeder',
              },
            });
            bookingCount++;

            // Create Audit Log for Activity Feed (WOW moment for dashboard)
            await this.prisma.auditLog.create({
              data: {
                tenantId: tenant.id,
                action: 'BOOKING_CREATE',
                resource: 'BOOKING',
                resourceId: createdBooking.id,
                description: `สร้างการจองใหม่สำหรับคุณ ${guest.firstName} ${guest.lastName}`,
                createdAt: new Date(new Date().getTime() - Math.random() * 86400000 * 2), // Last 48 hours
              }
            }).catch(() => {});
          } catch (error) {
            this.logger.warn(`    ⚠️  Could not create booking: ${error.message}`);
          }
        }
      }

      this.logger.log(`  ✓ Created ${bookingCount} demo bookings`);
    } catch (error) {
      this.logger.warn(`  ⚠️ Error seeding demo bookings: ${error.message}`);
    }
  }

  /**
   * 9️⃣ Seed Demo Reviews
   * สร้างรีวิวตัวอย่าง (3-5 reviews with ratings)
   */
  private async seedDemoReviews(): Promise<void> {
    this.logger.log('⭐ Seeding Demo Reviews...');

    try {
      // ดึง booking ที่เป็น completed
      const completedBookings: any[] = await this.prisma.$queryRaw`
        SELECT b.id, b.tenantId
        FROM bookings b
        LEFT JOIN reviews r ON r.bookingId = b.id
        WHERE b.status = 'completed' AND r.id IS NULL
        LIMIT 50
      `;

      if (!Array.isArray(completedBookings) || completedBookings.length === 0) {
        this.logger.warn('  ⚠️ No completed bookings found, skipping reviews');
        return;
      }

      const reviewTexts = [
        'Excellent service and cleanliness. The staff was very helpful and friendly.',
        'Great location with modern facilities. Will definitely come back.',
        'The room was spacious and comfortable. Breakfast was delicious.',
        'Outstanding hospitality. The team made our stay memorable.',
        'Perfect place for a weekend getaway. Highly recommended!',
        'Beautiful property with attention to detail. Loved the decor.',
        'Professional staff and great amenities. Value for money.',
        'Wonderful experience from check-in to check-out.',
        'The views from the room were breathtaking.',
        'Impeccable cleanliness and excellent customer service.',
      ];

      const ratings = [5, 5, 4, 5, 5, 4, 5, 5, 5, 4];

      let reviewCount = 0;
      for (let i = 0; i < Math.min(5, completedBookings.length); i++) {
        const booking = completedBookings[i];
        try {
          await this.prisma.$executeRaw`
            INSERT INTO reviews (
              id, tenantId, bookingId, rating, comment, createdAt, updatedAt
            )
            VALUES (
              UUID(),
              ${booking.tenantId},
              ${booking.id},
              ${ratings[i % ratings.length]},
              ${reviewTexts[i % reviewTexts.length]},
              NOW(),
              NOW()
            )
          `;
          reviewCount++;
        } catch (error) {
          this.logger.warn(`    ⚠️  Could not create review: ${error.message}`);
        }
      }

      this.logger.log(`  ✓ Created ${reviewCount} demo reviews`);
    } catch (error) {
      this.logger.warn(`  ⚠️ Error seeding demo reviews: ${error.message}`);
    }
  }

  /**
   * 🔟 Seed Hotel Staff (User table → login ผ่าน /login)
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

    // Staff templates สำหรับแต่ละโรงแรม - Reduced to only core roles
    const staffTemplates = [
      {
        role: 'manager',
        position: 'General Manager',
        department: 'Management',
        firstName: 'Michael',
        lastName: 'Manager',
      },
      {
        role: 'receptionist',
        position: 'Front Desk Agent',
        department: 'Front Office',
        firstName: 'Sarah',
        lastName: 'Reception',
      },
    ];

    const defaultPassword = 'Staff@123';
    const hashedPassword = await bcrypt.hash(defaultPassword, 10);
    let staffCount = 0;

    // Only seed staff for the first 2 tenants to keep user count low
    const tenantsToSeedStaff = allTenants.slice(0, 2);

    for (const tenant of tenantsToSeedStaff) {
      // Extract English name from parentheses if exists, or just use first 10 chars of name
      const match = tenant.name.match(/\(([^)]+)\)/);
      const engName = match ? match[1] : tenant.name;
      const tenantSlug = engName
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .substring(0, 10);

      this.logger.log(`  🏨 ${tenant.name}:`);

      for (let i = 0; i < staffTemplates.length; i++) {
        const tpl = staffTemplates[i];
        const firstName = tpl.firstName;
        const lastName = tpl.lastName;
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
    this.logger.log('  📌 Platform Admin Login → POST /api/v1/auth/admin/login');
    this.logger.log('  ─────────────────────────────────────────────────');
    this.logger.log('  admin@hotelservices.com    / Admin@123     (Super Admin)');
    this.logger.log('  finance@hotelservices.com  / Finance@123   (Finance Admin)');
    this.logger.log('  support@hotelservices.com  / Support@123   (Support Admin)');
    this.logger.log('  ⚠️  Admin ต้อง login ผ่าน /auth/admin/login เท่านั้น!');
    this.logger.log('');
    this.logger.log('  📌 Hotel Owner/Staff Login → POST /api/v1/auth/login');
    this.logger.log('  ─────────────────────────────────────────────────');
    this.logger.log('  ⚠️  เฉพาะ subscription customers เท่านั้น (ห้าม admin roles)');
    this.logger.log('');
    this.logger.log('  🏨 Demo Hotel Owners:');
    this.logger.log('  premium.test@email.com      / password123   (Mountain View - Premium)');
    this.logger.log('  somchai@email.com           / password123   (Sukjai Hotel)');
    this.logger.log('  seaside@email.com           / password123   (Seaside Stay)');
    this.logger.log('  garden@email.com            / password123   (Garden Resort)');
    this.logger.log('');
    this.logger.log('  👷 Hotel Staff:');
    this.logger.log(`  manager*.hotel.test        / Staff@123     (General Manager)`);
    this.logger.log(`  receptionist*.hotel.test   / Staff@123     (Front Desk Agent)`);
    this.logger.log('');
    this.logger.log('  👥 Demo Guests (for booking tests):');
    this.logger.log('  somchai.jaidia@example.com (Somchai Jaidee - Thailand)');
    this.logger.log('  somying.suyyam@example.com (Somying Suyyam - Thailand)');
    this.logger.log('  michael.johnson@example.com (Michael Johnson - United States)');
    this.logger.log('');
    this.logger.log('  📊 Demo Data Summary:');
    this.logger.log('  - Subscription Plans: 3 (Starter, Professional, Enterprise)');
    this.logger.log('  - Features/Add-ons: 11 available modules');
    this.logger.log('  - Sample Hotels: 4 with various statuses');
    this.logger.log('  - Premium User: 1 (Mountain View - all add-ons)');
    this.logger.log('  - Demo Guests: 10 (Thai + International names)');
    this.logger.log('  - Sample Bookings: 10-20 (mix of statuses)');
    this.logger.log('  - Hotel Staff: 4 total (manager & receptionist for top 2 hotels)');
    this.logger.log('');
    this.logger.log('══════════════════════════════════════════════════════');
  }

  /**
   * 🏢 Seed HR Master Data สำหรับ Demo Tenants
   * - แผนก (Departments)
   * - ตำแหน่งงาน (Positions)
   * - ประเภทการลา (Leave Types)
   * - กะการทำงาน (Shift Types)
   * - ประเภทเบี้ยเลี้ยง (Allowance Types)
   * - ประเภทการหักเงิน (Deduction Types)
   */
  private async seedHrMasterData(): Promise<void> {
    this.logger.log('👥 Seeding HR Master Data...');

    const allTenants = await this.tenantsService.findAll();
    if (allTenants.length === 0) {
      this.logger.warn('  ⚠️ No tenants found, skipping HR master data seeding');
      return;
    }

    // ─── ข้อมูลแผนก (Hotel Department Master Data) ─────────────────────────
    const departmentTemplates = [
      { name: 'ฝ่ายต้อนรับ', nameEn: 'Front Office', code: 'FO', color: '#8B5CF6', sortOrder: 1, description: 'บริการต้อนรับแขก เช็คอิน/เช็คเอาท์ คอนเซียจ' },
      { name: 'ฝ่ายแม่บ้าน', nameEn: 'Housekeeping', code: 'HK', color: '#10B981', sortOrder: 2, description: 'ทำความสะอาดห้องพัก พื้นที่ส่วนกลาง ซักรีด' },
      { name: 'ฝ่ายอาหารและเครื่องดื่ม', nameEn: 'Food & Beverage', code: 'FB', color: '#F59E0B', sortOrder: 3, description: 'ร้านอาหาร บาร์ รูมเซอร์วิส จัดเลี้ยง' },
      { name: 'ฝ่ายวิศวกรรม', nameEn: 'Engineering', code: 'ENG', color: '#EF4444', sortOrder: 4, description: 'บำรุงรักษา ระบบไฟฟ้า ประปา HVAC ไอที' },
      { name: 'ฝ่ายทรัพยากรบุคคล', nameEn: 'Human Resources', code: 'HR', color: '#EC4899', sortOrder: 5, description: 'สรรหา ฝึกอบรม เงินเดือน สวัสดิการ' },
      { name: 'ฝ่ายการเงินและบัญชี', nameEn: 'Finance & Accounting', code: 'FIN', color: '#06B6D4', sortOrder: 6, description: 'บัญชี การเงิน จัดซื้อ คลังสินค้า' },
      { name: 'ฝ่ายขายและการตลาด', nameEn: 'Sales & Marketing', code: 'SM', color: '#F97316', sortOrder: 7, description: 'ขาย การตลาด ประชาสัมพันธ์ OTA จัดการ' },
      { name: 'ฝ่ายรักษาความปลอดภัย', nameEn: 'Security', code: 'SEC', color: '#6B7280', sortOrder: 8, description: 'รักษาความปลอดภัย ควบคุมการเข้าออก' },
      { name: 'ฝ่ายสปาและนันทนาการ', nameEn: 'Spa & Recreation', code: 'SPA', color: '#A78BFA', sortOrder: 9, description: 'สปา ฟิตเนส สระว่ายน้ำ กิจกรรมแขก' },
      { name: 'ฝ่ายบริหาร', nameEn: 'Management', code: 'MGT', color: '#1D4ED8', sortOrder: 10, description: 'ผู้บริหารระดับสูง ผู้จัดการทั่วไป' },
    ];

    // ─── ข้อมูลตำแหน่งงานตามแผนก ────────────────────────────────────────────
    const positionTemplates: Record<string, Array<{ name: string; nameEn: string; level: number; sortOrder: number }>> = {
      FO: [
        { name: 'ผู้จัดการฝ่ายต้อนรับ', nameEn: 'Front Office Manager', level: 8, sortOrder: 1 },
        { name: 'ผู้จัดการเวร', nameEn: 'Duty Manager', level: 7, sortOrder: 2 },
        { name: 'พนักงานต้อนรับ (กะกลางวัน)', nameEn: 'Front Desk Agent (Day Shift)', level: 4, sortOrder: 3 },
        { name: 'พนักงานต้อนรับ (กะกลางคืน)', nameEn: 'Night Auditor', level: 4, sortOrder: 4 },
        { name: 'คอนเซียจ', nameEn: 'Concierge', level: 5, sortOrder: 5 },
        { name: 'หัวหน้าพนักงานยกกระเป๋า', nameEn: 'Bell Captain', level: 5, sortOrder: 6 },
        { name: 'พนักงานยกกระเป๋า', nameEn: 'Bellman', level: 3, sortOrder: 7 },
        { name: 'เจ้าหน้าที่ Reception', nameEn: 'Reservation Agent', level: 4, sortOrder: 8 },
        { name: 'เจ้าหน้าที่ Guest Relations', nameEn: 'Guest Relations Officer', level: 5, sortOrder: 9 },
      ],
      HK: [
        { name: 'หัวหน้าแม่บ้าน', nameEn: 'Executive Housekeeper', level: 8, sortOrder: 1 },
        { name: 'ผู้ช่วยหัวหน้าแม่บ้าน', nameEn: 'Assistant Housekeeper', level: 7, sortOrder: 2 },
        { name: 'หัวหน้าชั้น', nameEn: 'Floor Supervisor', level: 6, sortOrder: 3 },
        { name: 'แม่บ้านห้องพัก', nameEn: 'Room Attendant', level: 3, sortOrder: 4 },
        { name: 'พนักงานซักรีด', nameEn: 'Laundry Attendant', level: 3, sortOrder: 5 },
        { name: 'พนักงานทำความสะอาดพื้นที่ส่วนกลาง', nameEn: 'Public Area Cleaner', level: 2, sortOrder: 6 },
        { name: 'แม่บ้านหัวหน้าโซน', nameEn: 'Zone Housekeeper', level: 5, sortOrder: 7 },
      ],
      FB: [
        { name: 'ผู้จัดการอาหารและเครื่องดื่ม', nameEn: 'F&B Manager', level: 8, sortOrder: 1 },
        { name: 'ผู้จัดการร้านอาหาร', nameEn: 'Restaurant Manager', level: 7, sortOrder: 2 },
        { name: 'พ่อครัวใหญ่', nameEn: 'Head Chef', level: 8, sortOrder: 3 },
        { name: 'พ่อครัวแต่ละส่วน', nameEn: 'Chef de Partie', level: 6, sortOrder: 4 },
        { name: 'พ่อครัวผู้ช่วย', nameEn: 'Commis Chef', level: 4, sortOrder: 5 },
        { name: 'บาริสต้า', nameEn: 'Barista', level: 4, sortOrder: 6 },
        { name: 'บาร์เทนเดอร์', nameEn: 'Bartender', level: 4, sortOrder: 7 },
        { name: 'พนักงานเสิร์ฟ', nameEn: 'Waiter / Waitress', level: 3, sortOrder: 8 },
        { name: 'แคชเชียร์ร้านอาหาร', nameEn: 'F&B Cashier', level: 3, sortOrder: 9 },
        { name: 'พนักงานรูมเซอร์วิส', nameEn: 'Room Service Attendant', level: 3, sortOrder: 10 },
      ],
      ENG: [
        { name: 'หัวหน้าวิศวกร', nameEn: 'Chief Engineer', level: 8, sortOrder: 1 },
        { name: 'ผู้ช่วยวิศวกร', nameEn: 'Assistant Engineer', level: 7, sortOrder: 2 },
        { name: 'ช่างไฟฟ้า', nameEn: 'Electrician', level: 5, sortOrder: 3 },
        { name: 'ช่างประปา', nameEn: 'Plumber', level: 5, sortOrder: 4 },
        { name: 'ช่างปรับอากาศ (HVAC)', nameEn: 'HVAC Technician', level: 5, sortOrder: 5 },
        { name: 'ช่างเทคนิคไอที', nameEn: 'IT Technician', level: 6, sortOrder: 6 },
        { name: 'ช่างทั่วไป', nameEn: 'General Maintenance', level: 3, sortOrder: 7 },
      ],
      HR: [
        { name: 'ผู้จัดการฝ่าย HR', nameEn: 'HR Manager', level: 8, sortOrder: 1 },
        { name: 'เจ้าหน้าที่ HR', nameEn: 'HR Officer', level: 5, sortOrder: 2 },
        { name: 'เจ้าหน้าที่ฝึกอบรม', nameEn: 'Training Coordinator', level: 5, sortOrder: 3 },
        { name: 'เจ้าหน้าที่เงินเดือน', nameEn: 'Payroll Officer', level: 5, sortOrder: 4 },
        { name: 'เจ้าหน้าที่สรรหาบุคลากร', nameEn: 'Recruitment Officer', level: 5, sortOrder: 5 },
      ],
      FIN: [
        { name: 'ผู้ควบคุมการเงิน', nameEn: 'Financial Controller', level: 9, sortOrder: 1 },
        { name: 'หัวหน้าบัญชี', nameEn: 'Chief Accountant', level: 8, sortOrder: 2 },
        { name: 'นักบัญชี', nameEn: 'Accountant', level: 6, sortOrder: 3 },
        { name: 'เจ้าหน้าที่จัดซื้อ', nameEn: 'Purchasing Officer', level: 5, sortOrder: 4 },
        { name: 'เจ้าหน้าที่คลังสินค้า', nameEn: 'Store Keeper', level: 4, sortOrder: 5 },
      ],
      SM: [
        { name: 'ผู้จัดการฝ่ายขาย', nameEn: 'Sales Manager', level: 8, sortOrder: 1 },
        { name: 'เจ้าหน้าที่ขาย', nameEn: 'Sales Executive', level: 6, sortOrder: 2 },
        { name: 'เจ้าหน้าที่การตลาด', nameEn: 'Marketing Executive', level: 6, sortOrder: 3 },
        { name: 'เจ้าหน้าที่ประชาสัมพันธ์', nameEn: 'PR Coordinator', level: 5, sortOrder: 4 },
        { name: 'เจ้าหน้าที่ Revenue Management', nameEn: 'Revenue Manager', level: 7, sortOrder: 5 },
      ],
      SEC: [
        { name: 'ผู้จัดการรักษาความปลอดภัย', nameEn: 'Security Manager', level: 7, sortOrder: 1 },
        { name: 'หัวหน้าเวรรักษาความปลอดภัย', nameEn: 'Security Supervisor', level: 6, sortOrder: 2 },
        { name: 'พนักงานรักษาความปลอดภัย', nameEn: 'Security Officer', level: 3, sortOrder: 3 },
        { name: 'พนักงานควบคุม CCTV', nameEn: 'CCTV Operator', level: 4, sortOrder: 4 },
      ],
      SPA: [
        { name: 'ผู้จัดการสปา', nameEn: 'Spa Manager', level: 7, sortOrder: 1 },
        { name: 'นักบำบัด/นวดบำบัด', nameEn: 'Therapist', level: 5, sortOrder: 2 },
        { name: 'ผู้ฝึกสอนฟิตเนส', nameEn: 'Fitness Instructor', level: 5, sortOrder: 3 },
        { name: 'พนักงานต้อนรับสปา', nameEn: 'Spa Receptionist', level: 3, sortOrder: 4 },
        { name: 'พนักงานดูแลสระว่ายน้ำ', nameEn: 'Pool Attendant', level: 3, sortOrder: 5 },
      ],
      MGT: [
        { name: 'ผู้จัดการทั่วไป', nameEn: 'General Manager', level: 10, sortOrder: 1 },
        { name: 'ผู้จัดการโรงแรม (Resident)', nameEn: 'Resident Manager', level: 9, sortOrder: 2 },
        { name: 'ผู้อำนวยการฝ่าย', nameEn: 'Director of Operations', level: 9, sortOrder: 3 },
        { name: 'ผู้ช่วยผู้จัดการทั่วไป', nameEn: 'Assistant General Manager', level: 8, sortOrder: 4 },
      ],
    };

    // ─── ประเภทการลา ─────────────────────────────────────────────────────────
    const leaveTypeTemplates = [
      { name: 'ลาพักร้อน', nameEn: 'Annual Leave', code: 'ANNUAL', maxDaysPerYear: 15, isPaid: true, requiresDoc: false, color: '#10B981', sortOrder: 1, description: 'ลาพักร้อนประจำปี' },
      { name: 'ลาป่วย', nameEn: 'Sick Leave', code: 'SICK', maxDaysPerYear: 30, isPaid: true, requiresDoc: false, color: '#EF4444', sortOrder: 2, description: 'ลาเนื่องจากเจ็บป่วย' },
      { name: 'ลากิจ', nameEn: 'Personal Leave', code: 'PERSONAL', maxDaysPerYear: 3, isPaid: true, requiresDoc: false, color: '#F59E0B', sortOrder: 3, description: 'ลากิจส่วนตัว' },
      { name: 'ลาคลอด', nameEn: 'Maternity Leave', code: 'MATERNITY', maxDaysPerYear: 90, isPaid: true, requiresDoc: true, color: '#EC4899', sortOrder: 4, description: 'ลาคลอดบุตร (ตามกฎหมายแรงงาน)' },
      { name: 'ลาเพื่อดูแลภรรยาคลอด', nameEn: 'Paternity Leave', code: 'PATERNITY', maxDaysPerYear: 15, isPaid: true, requiresDoc: true, color: '#3B82F6', sortOrder: 5, description: 'ลาเพื่อดูแลภรรยาคลอด' },
      { name: 'ลาแต่งงาน', nameEn: 'Marriage Leave', code: 'MARRIAGE', maxDaysPerYear: 3, isPaid: true, requiresDoc: true, color: '#A78BFA', sortOrder: 6, description: 'ลาแต่งงาน' },
      { name: 'ลาไว้ทุกข์', nameEn: 'Bereavement Leave', code: 'BEREAVEMENT', maxDaysPerYear: 3, isPaid: true, requiresDoc: false, color: '#6B7280', sortOrder: 7, description: 'ลาไว้ทุกข์บุคคลในครอบครัว' },
      { name: 'ลาอบรม/สัมมนา', nameEn: 'Training Leave', code: 'TRAINING', maxDaysPerYear: null, isPaid: true, requiresDoc: false, color: '#06B6D4', sortOrder: 8, description: 'ลาเพื่อเข้ารับการอบรมหรือสัมมนา' },
      { name: 'ลาราชการทหาร', nameEn: 'Military Leave', code: 'MILITARY', maxDaysPerYear: 60, isPaid: true, requiresDoc: true, color: '#78716C', sortOrder: 9, description: 'ลาราชการทหาร (ตามกฎหมาย)' },
      { name: 'ลาไม่รับเงินเดือน', nameEn: 'Unpaid Leave', code: 'UNPAID', maxDaysPerYear: null, isPaid: false, requiresDoc: false, color: '#D1D5DB', sortOrder: 10, description: 'ลาโดยไม่รับเงินเดือน' },
    ];

    // ─── กะการทำงาน ──────────────────────────────────────────────────────────
    const shiftTypeTemplates = [
      { name: 'กะเช้า', nameEn: 'Morning Shift', code: 'MORNING', startTime: '07:00', endTime: '15:00', breakMinutes: 60, color: '#F59E0B', sortOrder: 1, description: 'กะทำงานช่วงเช้า 07:00-15:00 น.' },
      { name: 'กะบ่าย', nameEn: 'Afternoon Shift', code: 'AFTERNOON', startTime: '15:00', endTime: '23:00', breakMinutes: 60, color: '#8B5CF6', sortOrder: 2, description: 'กะทำงานช่วงบ่าย 15:00-23:00 น.' },
      { name: 'กะดึก', nameEn: 'Night Shift', code: 'NIGHT', startTime: '23:00', endTime: '07:00', breakMinutes: 60, color: '#1E40AF', sortOrder: 3, description: 'กะทำงานช่วงดึก 23:00-07:00 น.' },
      { name: 'เวลาทำการปกติ', nameEn: 'Office Hours', code: 'OFFICE', startTime: '09:00', endTime: '18:00', breakMinutes: 60, color: '#10B981', sortOrder: 4, description: 'เวลาทำการสำนักงาน 09:00-18:00 น.' },
      { name: 'กะแยก (Split Shift)', nameEn: 'Split Shift', code: 'SPLIT', startTime: '06:00', endTime: '22:00', breakMinutes: 240, color: '#EF4444', sortOrder: 5, description: 'ทำงานช่วงเช้า 06:00-10:00 และช่วงเย็น 18:00-22:00' },
      { name: 'ยืดหยุ่น', nameEn: 'Flexible Hours', code: 'FLEXIBLE', startTime: '08:00', endTime: '17:00', breakMinutes: 60, color: '#6B7280', sortOrder: 6, description: 'เวลาทำงานยืดหยุ่นตามตกลง' },
    ];

    // ─── ประเภทเบี้ยเลี้ยง ────────────────────────────────────────────────────
    const allowanceTypeTemplates = [
      { name: 'เซอร์วิสชาร์จ', nameEn: 'Service Charge', code: 'SERVICE_CHARGE', isTaxable: true, sortOrder: 1, description: 'ค่าบริการแบ่งให้พนักงาน' },
      { name: 'ค่าอาหาร', nameEn: 'Meal Allowance', code: 'MEAL', isTaxable: false, sortOrder: 2, description: 'เบี้ยเลี้ยงค่าอาหาร' },
      { name: 'ค่าเดินทาง', nameEn: 'Transportation Allowance', code: 'TRANSPORT', isTaxable: false, sortOrder: 3, description: 'ค่าใช้จ่ายการเดินทาง' },
      { name: 'ค่าที่พัก', nameEn: 'Housing Allowance', code: 'HOUSING', isTaxable: true, sortOrder: 4, description: 'เบี้ยเลี้ยงที่พักอาศัย' },
      { name: 'ค่าโทรศัพท์', nameEn: 'Phone Allowance', code: 'PHONE', isTaxable: false, sortOrder: 5, description: 'ค่าใช้จ่ายโทรศัพท์' },
      { name: 'ค่าล่วงเวลา', nameEn: 'Overtime Pay', code: 'OVERTIME', isTaxable: true, sortOrder: 6, description: 'ค่าจ้างการทำงานล่วงเวลา' },
      { name: 'เบี้ยกะ', nameEn: 'Shift Allowance', code: 'SHIFT', isTaxable: false, sortOrder: 7, description: 'เบี้ยเลี้ยงสำหรับการทำงานกะ' },
      { name: 'โบนัสประจำปี', nameEn: 'Annual Bonus', code: 'BONUS', isTaxable: true, sortOrder: 8, description: 'โบนัสประจำปีตามผลประกอบการ' },
      { name: 'ค่าคอมมิชชั่น', nameEn: 'Commission', code: 'COMMISSION', isTaxable: true, sortOrder: 9, description: 'ค่าคอมมิชชั่นจากการขาย' },
    ];

    // ─── ประเภทการหักเงิน ─────────────────────────────────────────────────────
    const deductionTypeTemplates = [
      { name: 'ภาษีเงินได้บุคคลธรรมดา', nameEn: 'Personal Income Tax', code: 'INCOME_TAX', isRequired: true, sortOrder: 1, description: 'ภาษีเงินได้หัก ณ ที่จ่าย (ตามกฎหมาย)' },
      { name: 'ประกันสังคม', nameEn: 'Social Security', code: 'SOCIAL_SECURITY', isRequired: true, sortOrder: 2, description: 'เงินสมทบกองทุนประกันสังคม 5% (สูงสุด 750 บาท/เดือน)' },
      { name: 'กองทุนสำรองเลี้ยงชีพ', nameEn: 'Provident Fund', code: 'PROVIDENT_FUND', isRequired: false, sortOrder: 3, description: 'เงินสะสมกองทุนสำรองเลี้ยงชีพ' },
      { name: 'เงินกู้พนักงาน', nameEn: 'Employee Loan', code: 'EMPLOYEE_LOAN', isRequired: false, sortOrder: 4, description: 'หักคืนเงินกู้จากโรงแรม' },
      { name: 'หักขาดงาน', nameEn: 'Absence Deduction', code: 'ABSENCE', isRequired: false, sortOrder: 5, description: 'หักเงินกรณีขาดงานโดยไม่มีเหตุ' },
      { name: 'หักมาสาย', nameEn: 'Late Deduction', code: 'LATE', isRequired: false, sortOrder: 6, description: 'หักเงินกรณีมาทำงานสาย' },
      { name: 'สหกรณ์ออมทรัพย์', nameEn: 'Cooperative Savings', code: 'COOPERATIVE', isRequired: false, sortOrder: 7, description: 'เงินสะสมสหกรณ์ออมทรัพย์พนักงาน' },
    ];

    // ─── Seed สำหรับแต่ละ Tenant ─────────────────────────────────────────────
    for (const tenant of allTenants) {
      this.logger.log(`  🏨 Seeding HR Master Data for: ${tenant.name}`);

      // Seed Departments & Positions
      const departmentMap: Record<string, string> = {};

      for (const deptTemplate of departmentTemplates) {
        try {
          const dept = await this.prisma.hrDepartment.upsert({
            where: { tenantId_code: { tenantId: tenant.id, code: deptTemplate.code } },
            update: {},
            create: {
              tenantId: tenant.id,
              name: deptTemplate.name,
              nameEn: deptTemplate.nameEn,
              code: deptTemplate.code,
              color: deptTemplate.color,
              description: deptTemplate.description,
              isActive: true,
              sortOrder: deptTemplate.sortOrder,
            },
          });
          departmentMap[deptTemplate.code] = dept.id;

          // Seed Positions for this department
          const positionList = positionTemplates[deptTemplate.code] ?? [];
          for (const posTemplate of positionList) {
            await this.prisma.hrPosition.upsert({
              where: {
                id: `${dept.id}-${posTemplate.nameEn.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
              },
              update: {},
              create: {
                id: `${dept.id}-${posTemplate.nameEn.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
                tenantId: tenant.id,
                departmentId: dept.id,
                name: posTemplate.name,
                nameEn: posTemplate.nameEn,
                level: posTemplate.level,
                isActive: true,
                sortOrder: posTemplate.sortOrder,
              },
            });
          }
        } catch {
          // Skip if already exists
        }
      }

      // Seed Leave Types
      for (const lt of leaveTypeTemplates) {
        await this.prisma.hrLeaveType.upsert({
          where: { tenantId_code: { tenantId: tenant.id, code: lt.code } },
          update: {},
          create: { tenantId: tenant.id, ...lt },
        });
      }

      // Seed Shift Types
      for (const st of shiftTypeTemplates) {
        await this.prisma.hrShiftType.upsert({
          where: { tenantId_code: { tenantId: tenant.id, code: st.code } },
          update: {},
          create: { tenantId: tenant.id, ...st },
        });
      }

      // Seed Allowance Types
      for (const at of allowanceTypeTemplates) {
        await this.prisma.hrAllowanceType.upsert({
          where: { tenantId_code: { tenantId: tenant.id, code: at.code } },
          update: {},
          create: { tenantId: tenant.id, ...at, isActive: true },
        });
      }

      // Seed Deduction Types
      for (const dt of deductionTypeTemplates) {
        await this.prisma.hrDeductionType.upsert({
          where: { tenantId_code: { tenantId: tenant.id, code: dt.code } },
          update: {},
          create: { tenantId: tenant.id, ...dt, isActive: true },
        });
      }

      this.logger.log(`    ✓ ${departmentTemplates.length} departments, ${leaveTypeTemplates.length} leave types, ${shiftTypeTemplates.length} shifts, ${allowanceTypeTemplates.length} allowances, ${deductionTypeTemplates.length} deductions`);
    }

    this.logger.log('✅ HR Master Data seeded successfully!');
  }

  // ─── HR Seed Data for Mountain View Resort (SUB-002 Premium Account) ─────────

  /**
   * Seed complete HR data for premium.test@email.com (Mountain View Resort).
   * Creates employees with realistic Thai hotel data, attendance records for the
   * current month, and leave requests with mixed statuses — enabling full HR demo
   * without additional manual setup.
   */
  private async seedPremiumHrData(): Promise<void> {
    this.logger.log('👥 Seeding Premium HR Data (Mountain View Resort)...');

    // Find Mountain View Resort by owner email
    const ownerUser = await this.prisma.user.findUnique({
      where: { email: 'premium.test@email.com' },
    });
    if (!ownerUser?.tenantId) {
      this.logger.warn('  ⚠️  premium.test@email.com not found, skipping premium HR seed');
      return;
    }
    const tenantId = ownerUser.tenantId;

    // ─── Look up HR master data for this tenant ───────────────────────────────
    const [deptFO, deptHK, deptFB, deptHR, deptENG, deptMGT] = await Promise.all([
      this.prisma.hrDepartment.findUnique({ where: { tenantId_code: { tenantId, code: 'FO' } } }),
      this.prisma.hrDepartment.findUnique({ where: { tenantId_code: { tenantId, code: 'HK' } } }),
      this.prisma.hrDepartment.findUnique({ where: { tenantId_code: { tenantId, code: 'FB' } } }),
      this.prisma.hrDepartment.findUnique({ where: { tenantId_code: { tenantId, code: 'HR' } } }),
      this.prisma.hrDepartment.findUnique({ where: { tenantId_code: { tenantId, code: 'ENG' } } }),
      this.prisma.hrDepartment.findUnique({ where: { tenantId_code: { tenantId, code: 'MGT' } } }),
    ]);

    if (!deptFO || !deptHK || !deptFB || !deptHR) {
      this.logger.warn('  ⚠️  HR departments not found. Run seedHrMasterData first.');
      return;
    }

    // Helper to find position by nameEn in a department
    const findPosition = async (departmentId: string, nameEn: string) =>
      this.prisma.hrPosition.findFirst({ where: { tenantId, departmentId, nameEn } });

    const [posFOM, posFDA, posEHK, posRA, posHRM, posFBM, posChef, posGM, posChiefEng] =
      await Promise.all([
        findPosition(deptFO!.id, 'Front Office Manager'),
        findPosition(deptFO!.id, 'Front Desk Agent (Day Shift)'),
        findPosition(deptHK!.id, 'Executive Housekeeper'),
        findPosition(deptHK!.id, 'Room Attendant'),
        findPosition(deptHR!.id, 'HR Manager'),
        findPosition(deptFB!.id, 'F&B Manager'),
        findPosition(deptFB!.id, "Chef de Partie"),
        deptMGT ? findPosition(deptMGT.id, 'General Manager') : Promise.resolve(null),
        deptENG ? findPosition(deptENG.id, 'Chief Engineer') : Promise.resolve(null),
      ]);

    // ─── Employee template data ──────────────────────────────────────────────
    const employeeTemplates = [
      {
        code: 'PM-0001', firstName: 'วิชัย', lastName: 'มณีรัตน์', nickname: 'ชัย',
        email: 'wichai.manee@mountain.hotel', phone: '081-234-5001',
        department: 'ฝ่ายบริหาร', departmentId: deptMGT?.id ?? deptFO!.id,
        position: 'ผู้จัดการทั่วไป', positionId: posGM?.id ?? null,
        baseSalary: 85000, bankAccount: '123-4-56789-0', bankName: 'KBANK',
        gender: 'MALE', dateOfBirth: new Date('1975-03-15'), employmentType: 'FULLTIME',
        nationalId: '1100500123456',
      },
      {
        code: 'PM-0002', firstName: 'นภาพร', lastName: 'ศรีสมบูรณ์', nickname: 'พร',
        email: 'napaporn.sri@mountain.hotel', phone: '081-234-5002',
        department: 'ฝ่ายต้อนรับ', departmentId: deptFO!.id,
        position: 'ผู้จัดการฝ่ายต้อนรับ', positionId: posFOM?.id ?? null,
        baseSalary: 45000, bankAccount: '123-4-56789-1', bankName: 'SCB',
        gender: 'FEMALE', dateOfBirth: new Date('1985-07-22'), employmentType: 'FULLTIME',
        nationalId: '1100500234567',
      },
      {
        code: 'PM-0003', firstName: 'สมชาย', lastName: 'ใจดี', nickname: 'ชาย',
        email: 'somchai.jaidee@mountain.hotel', phone: '081-234-5003',
        department: 'ฝ่ายต้อนรับ', departmentId: deptFO!.id,
        position: 'พนักงานต้อนรับ (กะกลางวัน)', positionId: posFDA?.id ?? null,
        baseSalary: 18000, bankAccount: '123-4-56789-2', bankName: 'BBL',
        gender: 'MALE', dateOfBirth: new Date('1995-01-10'), employmentType: 'FULLTIME',
        nationalId: '1100500345678',
      },
      {
        code: 'PM-0004', firstName: 'มาลี', lastName: 'รักษ์ดี', nickname: 'ลี',
        email: 'malee.rakdee@mountain.hotel', phone: '081-234-5004',
        department: 'ฝ่ายต้อนรับ', departmentId: deptFO!.id,
        position: 'พนักงานต้อนรับ (กะกลางวัน)', positionId: posFDA?.id ?? null,
        baseSalary: 17500, bankAccount: '123-4-56789-3', bankName: 'KTB',
        gender: 'FEMALE', dateOfBirth: new Date('1997-11-05'), employmentType: 'FULLTIME',
        nationalId: '1100500456789',
      },
      {
        code: 'PM-0005', firstName: 'รัตนา', lastName: 'แม่บ้านดี', nickname: 'นา',
        email: 'rattana.maebaan@mountain.hotel', phone: '081-234-5005',
        department: 'ฝ่ายแม่บ้าน', departmentId: deptHK!.id,
        position: 'หัวหน้าแม่บ้าน', positionId: posEHK?.id ?? null,
        baseSalary: 32000, bankAccount: '123-4-56789-4', bankName: 'KBANK',
        gender: 'FEMALE', dateOfBirth: new Date('1980-06-18'), employmentType: 'FULLTIME',
        nationalId: '1100500567890',
      },
      {
        code: 'PM-0006', firstName: 'สุนันท์', lastName: 'ทำความสะอาด', nickname: 'นัน',
        email: 'sunun.tam@mountain.hotel', phone: '081-234-5006',
        department: 'ฝ่ายแม่บ้าน', departmentId: deptHK!.id,
        position: 'แม่บ้านห้องพัก', positionId: posRA?.id ?? null,
        baseSalary: 13500, bankAccount: '123-4-56789-5', bankName: 'GSB',
        gender: 'FEMALE', dateOfBirth: new Date('1992-09-28'), employmentType: 'FULLTIME',
        nationalId: '1100500678901',
      },
      {
        code: 'PM-0007', firstName: 'ประภา', lastName: 'บุคลากรดี', nickname: 'ภา',
        email: 'prapa.hr@mountain.hotel', phone: '081-234-5007',
        department: 'ฝ่ายทรัพยากรบุคคล', departmentId: deptHR!.id,
        position: 'ผู้จัดการฝ่าย HR', positionId: posHRM?.id ?? null,
        baseSalary: 38000, bankAccount: '123-4-56789-6', bankName: 'SCB',
        gender: 'FEMALE', dateOfBirth: new Date('1988-04-12'), employmentType: 'FULLTIME',
        nationalId: '1100500789012',
      },
      {
        code: 'PM-0008', firstName: 'อนุชา', lastName: 'อาหารดี', nickname: 'ชา',
        email: 'anucha.fb@mountain.hotel', phone: '081-234-5008',
        department: 'ฝ่ายอาหารและเครื่องดื่ม', departmentId: deptFB!.id,
        position: 'ผู้จัดการอาหารและเครื่องดื่ม', positionId: posFBM?.id ?? null,
        baseSalary: 40000, bankAccount: '123-4-56789-7', bankName: 'BAY',
        gender: 'MALE', dateOfBirth: new Date('1983-12-01'), employmentType: 'FULLTIME',
        nationalId: '1100500890123',
      },
      {
        code: 'PM-0009', firstName: 'ไพศาล', lastName: 'ครัวเก่ง', nickname: 'ศาล',
        email: 'paisal.chef@mountain.hotel', phone: '081-234-5009',
        department: 'ฝ่ายอาหารและเครื่องดื่ม', departmentId: deptFB!.id,
        position: 'พ่อครัวแต่ละส่วน', positionId: posChef?.id ?? null,
        baseSalary: 22000, bankAccount: '123-4-56789-8', bankName: 'KBANK',
        gender: 'MALE', dateOfBirth: new Date('1990-08-20'), employmentType: 'FULLTIME',
        nationalId: '1100500901234',
      },
      {
        code: 'PM-0010', firstName: 'ธนกร', lastName: 'ช่างดี', nickname: 'กร',
        email: 'thanakorn.eng@mountain.hotel', phone: '081-234-5010',
        department: 'ฝ่ายวิศวกรรม', departmentId: deptENG?.id ?? deptFO!.id,
        position: 'หัวหน้าวิศวกร', positionId: posChiefEng?.id ?? null,
        baseSalary: 35000, bankAccount: '123-4-56789-9', bankName: 'TMBThanachart',
        gender: 'MALE', dateOfBirth: new Date('1987-02-14'), employmentType: 'FULLTIME',
        nationalId: '1100501012345',
      },
    ];

    // ─── Create employees (upsert by email) ───────────────────────────────────
    const createdEmployees: any[] = [];
    for (const emp of employeeTemplates) {
      const existing = await this.prisma.employee.findUnique({ where: { email: emp.email } });
      if (existing) {
        const updated = await (this.prisma.employee as any).update({
          where: { id: existing.id },
          data: {
            tenantId, firstName: emp.firstName, lastName: emp.lastName,
            nickname: emp.nickname, phone: emp.phone,
            department: emp.department, position: emp.position,
            departmentId: emp.departmentId, positionId: emp.positionId,
            baseSalary: emp.baseSalary, bankAccount: emp.bankAccount,
            bankName: emp.bankName, gender: emp.gender,
            dateOfBirth: emp.dateOfBirth, employmentType: emp.employmentType,
            nationalId: emp.nationalId,
            status: 'active', employeeCode: emp.code,
          },
        });
        createdEmployees.push(updated);
      } else {
        const created = await (this.prisma.employee as any).create({
          data: {
            tenantId, email: emp.email, firstName: emp.firstName, lastName: emp.lastName,
            nickname: emp.nickname, phone: emp.phone, employeeCode: emp.code,
            department: emp.department, position: emp.position,
            departmentId: emp.departmentId, positionId: emp.positionId,
            baseSalary: emp.baseSalary, bankAccount: emp.bankAccount,
            bankName: emp.bankName, gender: emp.gender,
            dateOfBirth: emp.dateOfBirth, employmentType: emp.employmentType,
            nationalId: emp.nationalId,
            status: 'active', startDate: new Date('2024-01-01'),
          },
        });
        createdEmployees.push(created);
      }
    }
    this.logger.log(`  ✓ ${createdEmployees.length} employees upserted`);

    // ─── Create attendance records for current month ──────────────────────────
    const today = new Date();
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    let attendanceCount = 0;

    for (const emp of createdEmployees) {
      const cursor = new Date(monthStart);
      while (cursor <= today) {
        const dow = cursor.getDay();
        if (dow !== 0 && dow !== 6) { // skip weekends
          const dateOnly = new Date(cursor);
          dateOnly.setUTCHours(0, 0, 0, 0);

          const existing = await (this.prisma as any).hrAttendance.findUnique({
            where: { employeeId_date: { employeeId: emp.id, date: dateOnly } },
          });
          if (!existing) {
            // Vary: 80% present, 10% late, 5% absent, 5% on_leave
            const rand = Math.random();
            let status = 'present';
            let checkIn: Date | null = null;
            let checkOut: Date | null = null;
            let workMinutes: number | null = null;
            let overtimeMinutes: number | null = null;

            if (rand < 0.80) {
              status = 'present';
              checkIn = new Date(dateOnly); checkIn.setUTCHours(8, Math.floor(Math.random() * 30), 0);
              checkOut = new Date(dateOnly); checkOut.setUTCHours(17, Math.floor(Math.random() * 30), 0);
              workMinutes = 480;
              overtimeMinutes = Math.random() < 0.3 ? Math.floor(Math.random() * 90 + 30) : 0;
            } else if (rand < 0.90) {
              status = 'late';
              checkIn = new Date(dateOnly); checkIn.setUTCHours(9, Math.floor(Math.random() * 30 + 15), 0);
              checkOut = new Date(dateOnly); checkOut.setUTCHours(18, 30, 0);
              workMinutes = 450;
              overtimeMinutes = 0;
            } else if (rand < 0.95) {
              status = 'absent';
            } else {
              status = 'on_leave';
            }

            await (this.prisma as any).hrAttendance.create({
              data: { tenantId, employeeId: emp.id, date: dateOnly, status, checkIn, checkOut, workMinutes, overtimeMinutes },
            });
            attendanceCount++;
          }
        }
        cursor.setDate(cursor.getDate() + 1);
      }
    }
    this.logger.log(`  ✓ ${attendanceCount} attendance records created`);

    // ─── Create sample leave requests ─────────────────────────────────────────
    const annualLeaveType = await (this.prisma as any).hrLeaveType.findFirst({
      where: { tenantId, code: 'ANNUAL' },
    });
    const sickLeaveType = await (this.prisma as any).hrLeaveType.findFirst({
      where: { tenantId, code: 'SICK' },
    });

    if (annualLeaveType && sickLeaveType && createdEmployees.length >= 3) {
      const leaveRequests = [
        {
          employeeId: createdEmployees[2].id, // สมชาย
          leaveTypeId: annualLeaveType.id,
          startDate: new Date(today.getFullYear(), today.getMonth(), 15),
          endDate:   new Date(today.getFullYear(), today.getMonth(), 17),
          totalDays: 3, reason: 'พักผ่อนประจำปี ท่องเที่ยวกับครอบครัว', status: 'approved',
          approvedBy: ownerUser.id, approvedAt: new Date(),
        },
        {
          employeeId: createdEmployees[5].id, // สุนันท์
          leaveTypeId: sickLeaveType.id,
          startDate: new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1),
          endDate:   new Date(today.getFullYear(), today.getMonth(), today.getDate() + 2),
          totalDays: 2, reason: 'ไม่สบาย มีไข้', status: 'pending',
        },
        {
          employeeId: createdEmployees[3].id, // มาลี
          leaveTypeId: annualLeaveType.id,
          startDate: new Date(today.getFullYear(), today.getMonth(), 5),
          endDate:   new Date(today.getFullYear(), today.getMonth(), 5),
          totalDays: 1, reason: 'ธุระส่วนตัว', status: 'rejected',
          rejectedBy: ownerUser.id, rejectedAt: new Date(), rejectReason: 'ช่วงนั้นพนักงานน้อย ขอให้เลื่อนออกไป',
        },
      ];

      let leaveCount = 0;
      for (const lr of leaveRequests) {
        const existing = await (this.prisma as any).hrLeaveRequest.findFirst({
          where: { tenantId, employeeId: lr.employeeId, startDate: lr.startDate },
        });
        if (!existing) {
          await (this.prisma as any).hrLeaveRequest.create({ data: { tenantId, ...lr } });
          leaveCount++;
        }
      }
      this.logger.log(`  ✓ ${leaveCount} leave requests created`);
    }

    this.logger.log('✅ Premium HR Data seeded successfully!');
  }

  /**
   * Clear all data (ระวัง! ใช้สำหรับ development เท่านั้น)
   */
  async clear(): Promise<void> {
    this.logger.warn('🗑️ Clearing all data...');
    this.logger.warn('⚠️ Clear function not implemented. Use migration revert instead.');
  }
}
