import { Injectable, Logger } from '@nestjs/common';
import { PlansService } from '../plans/plans.service';
import { FeaturesService } from '../features/features.service';
import { PlanFeaturesService } from '../plan-features/plan-features.service';
import { AddonService } from '../modules/addons/addon.service';
import { AddonBillingCycle } from '../modules/addons/dto/create-addon.dto';
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
import { CostCenterType, CostCategory, WarehouseType, PurchaseRequisitionStatus, PurchaseOrderStatus, SupplierQuoteStatus } from '@prisma/client';
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
    private addonService: AddonService,
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
      await this.seedAddOns();
      await this.seedPlanFeatures();
      await this.seedAdmins();
      await this.seedUsers();
      await this.seedAdminPanelTestData();
      await this.seedDemoGuests();
      await this.seedDemoBookings();
      await this.seedDemoReviews();
      await this.seedHrMasterData();
      await this.seedEmployeesForAllTenants();
      await this.seedKpiTemplates();
      await this.seedHotelStaff();
      await this.seedPremiumHrData();
      await this.seedHrPerformanceData();
      await this.seedRestaurantData();
      await this.seedInventoryData();
      await this.seedProcurementUsersAndFlows();
      await this.seedPurchaseRequisitionData();
      await this.seedCostAccountingData();

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
   * 2️⃣ Seed Features (Master catalog)
   *
   * Each feature now carries a `category` and `icon` so the admin UI can group
   * the catalog instead of showing a flat list of N/A cells. Categories follow
   * the StaySync taxonomy: CORE / PMS / RESTAURANT / HR / HOUSEKEEPING /
   * MAINTENANCE / REPORTING / INTEGRATION / ADVANCED.
   *
   * The seeder upserts by code so re-running keeps the catalog in sync with
   * the latest definitions (renaming a feature, retagging a category, etc.).
   */
  private async seedFeatures(): Promise<void> {
    this.logger.log('⚙️ Seeding Features (master catalog)...');

    const features = [
      // ─── CORE ─────────────────────────────────────────────
      {
        code: 'basic_report',
        name: 'Basic Report',
        description: 'รายงานพื้นฐานสำหรับการดำเนินงานประจำวัน',
        type: FeatureType.TOGGLE,
        category: 'CORE',
        icon: 'FileText',
        displayOrder: 10,
        priceMonthly: 0,
        isActive: true,
      },
      {
        code: 'extra_user',
        name: 'Extra User',
        description: 'เพิ่มจำนวน user ที่ใช้งานได้',
        type: FeatureType.LIMIT,
        category: 'CORE',
        icon: 'Users',
        displayOrder: 20,
        priceMonthly: 200,
        isActive: true,
      },

      // ─── PMS ──────────────────────────────────────────────
      {
        code: 'tax_invoice',
        name: 'Tax Invoice',
        description: 'ระบบออกใบกำกับภาษีอัตโนมัติ พร้อม e-Tax',
        type: FeatureType.TOGGLE,
        category: 'PMS',
        icon: 'Receipt',
        displayOrder: 10,
        priceMonthly: 500,
        isActive: true,
      },

      // ─── RESTAURANT ───────────────────────────────────────
      {
        code: 'RESTAURANT_MODULE',
        name: 'Restaurant & F&B Module',
        description: 'ระบบจัดการร้านอาหาร F&B: เมนู หมวดหมู่ จองโต๊ะ และเชื่อม Folio แขก',
        type: FeatureType.MODULE,
        category: 'RESTAURANT',
        icon: 'UtensilsCrossed',
        displayOrder: 10,
        priceMonthly: 990,
        isActive: true,
      },
      {
        code: 'POS_MODULE',
        name: 'POS System',
        description: 'ระบบ POS ครบวงจร: รับออเดอร์ ส่งครัว (KDS) ชำระเงิน และจัดการ User POS',
        type: FeatureType.MODULE,
        category: 'RESTAURANT',
        icon: 'ShoppingCart',
        displayOrder: 20,
        priceMonthly: 790,
        isActive: true,
      },

      // ─── HR ───────────────────────────────────────────────
      {
        code: 'HR_MODULE',
        name: 'HR Module',
        description:
          'ระบบ HR ครบวงจร: จัดการพนักงาน เงินเดือน การลา และเชื่อมข้อมูลกับทีมแม่บ้าน/ช่าง',
        type: FeatureType.MODULE,
        category: 'HR',
        icon: 'Briefcase',
        displayOrder: 10,
        priceMonthly: 1200,
        isActive: true,
      },

      // ─── HOUSEKEEPING ─────────────────────────────────────
      {
        code: 'housekeeping',
        name: 'Housekeeping Management',
        description: 'ระบบจัดการงานทำความสะอาดและสถานะห้องพัก real-time',
        type: FeatureType.TOGGLE,
        category: 'HOUSEKEEPING',
        icon: 'Sparkles',
        displayOrder: 10,
        priceMonthly: 500,
        isActive: true,
      },

      // ─── REPORTING ────────────────────────────────────────
      {
        code: 'advanced_report',
        name: 'Advanced Report',
        description: 'รายงานขั้นสูงและ analytics สำหรับผู้บริหาร',
        type: FeatureType.MODULE,
        category: 'REPORTING',
        icon: 'BarChart3',
        displayOrder: 10,
        priceMonthly: 500,
        isActive: true,
      },
      {
        code: 'extra_analytics',
        name: 'Extra Analytics',
        description: 'Dashboard และ Analytics เชิงลึก พร้อม custom metrics',
        type: FeatureType.MODULE,
        category: 'REPORTING',
        icon: 'TrendingUp',
        displayOrder: 20,
        priceMonthly: 990,
        isActive: true,
      },

      // ─── INTEGRATION ──────────────────────────────────────
      {
        code: 'ota_booking',
        name: 'OTA Booking Integration',
        description: 'เชื่อมต่อกับ Booking.com, Agoda, และ OTA อื่นๆ',
        type: FeatureType.MODULE,
        category: 'INTEGRATION',
        icon: 'Globe',
        displayOrder: 10,
        priceMonthly: 990,
        isActive: true,
      },
      {
        code: 'CHANNEL_MANAGER',
        name: 'Channel Manager',
        description: 'เชื่อมต่อกับ OTA อัตโนมัติ sync ราคาและห้องพักแบบ real-time',
        type: FeatureType.MODULE,
        category: 'INTEGRATION',
        icon: 'Network',
        displayOrder: 20,
        priceMonthly: 1490,
        isActive: true,
      },
      {
        code: 'api_access',
        name: 'API Access',
        description: 'เข้าถึง API สำหรับ integration กับระบบอื่น',
        type: FeatureType.MODULE,
        category: 'INTEGRATION',
        icon: 'Plug',
        displayOrder: 30,
        priceMonthly: 1500,
        isActive: true,
      },

      // ─── ADVANCED ─────────────────────────────────────────
      {
        code: 'automation',
        name: 'Automation System',
        description: 'ระบบอัตโนมัติสำหรับจัดการ booking และ workflow',
        type: FeatureType.MODULE,
        category: 'ADVANCED',
        icon: 'Zap',
        displayOrder: 10,
        priceMonthly: 990,
        isActive: true,
      },
      {
        code: 'custom_branding',
        name: 'Custom Branding',
        description: 'กำหนด branding และ logo ของโรงแรมในทุก touchpoint',
        type: FeatureType.MODULE,
        category: 'ADVANCED',
        icon: 'Palette',
        displayOrder: 20,
        priceMonthly: 1490,
        isActive: true,
      },
      {
        code: 'LOYALTY_MODULE',
        name: 'Loyalty & Rewards',
        description: 'โปรแกรมสะสมแต้มแขกประจำ ส่วนลด และ reward tiers',
        type: FeatureType.MODULE,
        category: 'ADVANCED',
        icon: 'Gift',
        displayOrder: 30,
        priceMonthly: 590,
        isActive: true,
      },
      {
        code: 'INVENTORY_MODULE',
        name: 'Inventory Management',
        description:
          'ระบบคลังสินค้าครบวงจร: คุมสต็อก เบิก-รับสินค้า สั่งซื้อ นับสต็อก และแจ้งเตือนสต็อกต่ำ',
        type: FeatureType.MODULE,
        category: 'ADVANCED',
        icon: 'Package',
        displayOrder: 40,
        priceMonthly: 990,
        isActive: true,
      },
      {
        code: 'COST_ACCOUNTING_MODULE',
        name: 'Cost Accounting',
        description:
          'ระบบบัญชีต้นทุน USALI: ติดตามต้นทุนรายแผนก P&L ปิดงวดรายเดือน วิเคราะห์ food cost และ dashboard KPI โรงแรม',
        type: FeatureType.MODULE,
        category: 'ADVANCED',
        icon: 'Calculator',
        displayOrder: 50,
        priceMonthly: 1490,
        isActive: true,
      },
    ];

    for (const featureData of features) {
      await this.featuresService.upsertByCode(featureData);
      this.logger.log(
        `  ✓ Upserted feature: ${featureData.code} [${featureData.category}] (฿${featureData.priceMonthly}/mo)`,
      );
    }

    this.logger.log(`  ✅ Seeded ${features.length} features across 9 categories`);
  }

  /**
   * 2️⃣B Seed Add-ons (Master catalog for the SaaS billing/upsell flows)
   *
   * Add-ons are billable items attached to a tenant's subscription. They live
   * in their own `add_ons` table (separate from `features`) so the billing
   * system can price/quote them independently.
   *
   * Catalog sources:
   *   • 8 paid module add-ons (HR/POS/RESTAURANT/HOUSEKEEPING/CHANNEL_MANAGER/
   *     LOYALTY/INVENTORY/COST_ACCOUNTING) — these mirror the feature codes
   *     used by the AddonGate UI.
   *   • 5 platform add-ons (OTA Booking, Automation, API Access, Extra
   *     Analytics, Custom Branding) — these match what tenants see in the
   *     subscription detail modal (see Mountain View Resort example).
   */
  private async seedAddOns(): Promise<void> {
    this.logger.log('🔌 Seeding Add-ons (master catalog)...');

    const addons = [
      // ─── PAID MODULE ADD-ONS (uppercase codes match AddonGate) ───
      {
        code: 'HR_MODULE',
        name: 'HR Module',
        description: 'ระบบ HR ครบวงจร: จัดการพนักงาน เงินเดือน การลา และเชื่อมข้อมูลทีมแม่บ้าน/ช่าง',
        price: 1200,
        billingCycle: AddonBillingCycle.MONTHLY,
        category: 'HR',
        icon: 'Briefcase',
        displayOrder: 10,
        minQuantity: 1,
        maxQuantity: 1,
        isActive: true,
      },
      {
        code: 'RESTAURANT_MODULE',
        name: 'Restaurant & F&B Module',
        description: 'ระบบจัดการร้านอาหาร F&B: เมนู หมวดหมู่ จองโต๊ะ และเชื่อม Folio แขก',
        price: 990,
        billingCycle: AddonBillingCycle.MONTHLY,
        category: 'RESTAURANT',
        icon: 'UtensilsCrossed',
        displayOrder: 20,
        minQuantity: 1,
        maxQuantity: 1,
        isActive: true,
      },
      {
        code: 'POS_MODULE',
        name: 'POS System',
        description: 'ระบบ POS ครบวงจร: รับออเดอร์ ส่งครัว (KDS) ชำระเงิน และจัดการ User POS',
        price: 790,
        billingCycle: AddonBillingCycle.MONTHLY,
        category: 'RESTAURANT',
        icon: 'ShoppingCart',
        displayOrder: 30,
        minQuantity: 1,
        maxQuantity: 1,
        isActive: true,
      },
      {
        code: 'HOUSEKEEPING_MODULE',
        name: 'Housekeeping Module',
        description: 'ระบบจัดการแม่บ้าน: มอบหมายงาน, ตรวจห้อง, รายงานสภาพห้องแบบ real-time',
        price: 590,
        billingCycle: AddonBillingCycle.MONTHLY,
        category: 'HOUSEKEEPING',
        icon: 'Sparkles',
        displayOrder: 40,
        minQuantity: 1,
        maxQuantity: 1,
        isActive: true,
      },
      {
        code: 'CHANNEL_MANAGER',
        name: 'Channel Manager',
        description: 'เชื่อมต่อกับ OTA อัตโนมัติ sync ราคาและห้องพักแบบ real-time',
        price: 1490,
        billingCycle: AddonBillingCycle.MONTHLY,
        category: 'INTEGRATION',
        icon: 'Network',
        displayOrder: 50,
        minQuantity: 1,
        maxQuantity: 1,
        isActive: true,
      },
      {
        code: 'LOYALTY_MODULE',
        name: 'Loyalty & Rewards',
        description: 'โปรแกรมสะสมแต้มแขกประจำ ส่วนลด และ reward tiers',
        price: 590,
        billingCycle: AddonBillingCycle.MONTHLY,
        category: 'ADVANCED',
        icon: 'Gift',
        displayOrder: 60,
        minQuantity: 1,
        maxQuantity: 1,
        isActive: true,
      },
      {
        code: 'INVENTORY_MODULE',
        name: 'Inventory Management',
        description:
          'ระบบคลังสินค้าครบวงจร: คุมสต็อก เบิก-รับสินค้า สั่งซื้อ นับสต็อก และแจ้งเตือนสต็อกต่ำ',
        price: 990,
        billingCycle: AddonBillingCycle.MONTHLY,
        category: 'ADVANCED',
        icon: 'Package',
        displayOrder: 70,
        minQuantity: 1,
        maxQuantity: 1,
        isActive: true,
      },
      {
        code: 'COST_ACCOUNTING_MODULE',
        name: 'Cost Accounting (USALI)',
        description:
          'ระบบบัญชีต้นทุน USALI: ติดตามต้นทุนรายแผนก P&L ปิดงวดรายเดือน วิเคราะห์ food cost และ dashboard KPI',
        price: 1490,
        billingCycle: AddonBillingCycle.MONTHLY,
        category: 'ADVANCED',
        icon: 'Calculator',
        displayOrder: 80,
        minQuantity: 1,
        maxQuantity: 1,
        isActive: true,
      },

      // ─── PLATFORM ADD-ONS (lowercase codes — match subscription detail UI) ───
      {
        code: 'ota_booking',
        name: 'OTA Booking Integration',
        description: 'เชื่อมต่อกับ Booking.com, Agoda, และ OTA อื่นๆ',
        price: 990,
        billingCycle: AddonBillingCycle.MONTHLY,
        category: 'INTEGRATION',
        icon: 'Globe',
        displayOrder: 90,
        minQuantity: 1,
        maxQuantity: 1,
        isActive: true,
      },
      {
        code: 'automation',
        name: 'Automation System',
        description: 'ระบบอัตโนมัติสำหรับจัดการ booking และ workflow',
        price: 990,
        billingCycle: AddonBillingCycle.MONTHLY,
        category: 'ADVANCED',
        icon: 'Zap',
        displayOrder: 100,
        minQuantity: 1,
        maxQuantity: 1,
        isActive: true,
      },
      {
        code: 'api_access',
        name: 'API Access',
        description: 'เข้าถึง API สำหรับ integration กับระบบอื่น',
        price: 1990,
        billingCycle: AddonBillingCycle.MONTHLY,
        category: 'INTEGRATION',
        icon: 'Plug',
        displayOrder: 110,
        minQuantity: 1,
        maxQuantity: 1,
        isActive: true,
      },
      {
        code: 'extra_analytics',
        name: 'Extra Analytics',
        description: 'รายงานและ Analytics ขั้นสูง พร้อม custom dashboards',
        price: 990,
        billingCycle: AddonBillingCycle.MONTHLY,
        category: 'REPORTING',
        icon: 'TrendingUp',
        displayOrder: 120,
        minQuantity: 1,
        maxQuantity: 1,
        isActive: true,
      },
      {
        code: 'custom_branding',
        name: 'Custom Branding',
        description: 'กำหนด branding และ logo ของโรงแรมในทุก touchpoint',
        price: 1490,
        billingCycle: AddonBillingCycle.MONTHLY,
        category: 'ADVANCED',
        icon: 'Palette',
        displayOrder: 130,
        minQuantity: 1,
        maxQuantity: 1,
        isActive: true,
      },
    ];

    for (const addonData of addons) {
      await this.addonService.upsertByCode(addonData);
      this.logger.log(
        `  ✓ Upserted add-on: ${addonData.code} [${addonData.category}] (฿${addonData.price}/${addonData.billingCycle})`,
      );
    }

    this.logger.log(`  ✅ Seeded ${addons.length} add-ons across 6 categories`);
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
    const restaurantModule = await this.featuresService.findByCode('RESTAURANT_MODULE');
    const posModule = await this.featuresService.findByCode('POS_MODULE');
    const inventoryModule = await this.featuresService.findByCode('INVENTORY_MODULE');
    const costAccountingModule = await this.featuresService.findByCode('COST_ACCOUNTING_MODULE');

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
          { feature: restaurantModule, price: 990 },
          { feature: posModule, price: 790 },
          { feature: inventoryModule, price: 990 },
          { feature: costAccountingModule, price: 1490 },
        ],
        invoices: [{ amount: 23200, status: InvoiceStatus.PAID, daysAgo: 0 }],
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
            await this.prisma.auditLog
              .create({
                data: {
                  tenantId: tenant.id,
                  action: 'BOOKING_CREATE',
                  resource: 'BOOKING',
                  resourceId: createdBooking.id,
                  description: `สร้างการจองใหม่สำหรับคุณ ${guest.firstName} ${guest.lastName}`,
                  createdAt: new Date(new Date().getTime() - Math.random() * 86400000 * 2), // Last 48 hours
                },
              })
              .catch(() => {});
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
        positionNameEn: 'General Manager',
        departmentCode: 'MGT',
        firstName: 'Michael',
        lastName: 'Manager',
      },
      {
        role: 'receptionist',
        positionNameEn: 'Front Desk Agent (Day Shift)',
        departmentCode: 'FO',
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

      const defaultProperty = await this.prisma.property.findFirst({
        where: { tenantId: tenant.id },
      });

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

              // Fetch department and position properly from HR master data
              let deptId = null;
              let posId = null;

              const dept = await (this.prisma.hrDepartment as any).findFirst({
                where: { tenantId: tenant.id, code: tpl.departmentCode },
              });
              if (dept) {
                deptId = dept.id;
                const pos = await (this.prisma.hrPosition as any).findFirst({
                  where: { tenantId: tenant.id, departmentId: deptId, nameEn: tpl.positionNameEn },
                });
                if (pos) {
                  posId = pos.id;
                }
              }

              await this.prisma.$executeRaw`
                INSERT INTO employees (id, tenantId, propertyId, firstName, lastName, email, employeeCode, department, position, departmentId, positionId, startDate, createdAt, updatedAt)
                VALUES (
                  UUID(),
                  ${tenant.id},
                  ${defaultProperty?.id || null},
                  ${firstName},
                  ${lastName},
                  ${email},
                  ${empCode},
                  ${dept ? dept.name : tpl.departmentCode},
                  ${posId ? tpl.positionNameEn : tpl.positionNameEn},
                  ${deptId},
                  ${posId},
                  '2024-01-01',
                  NOW(),
                  NOW()
                )
              `;
            } catch (err: any) {
              this.logger.warn(
                `    ⚠️  Could not create employee for staff (${email}): ${err.message}`,
              );
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
      {
        name: 'ฝ่ายต้อนรับ',
        nameEn: 'Front Office',
        code: 'FO',
        color: '#8B5CF6',
        sortOrder: 1,
        description: 'บริการต้อนรับแขก เช็คอิน/เช็คเอาท์ คอนเซียจ',
      },
      {
        name: 'ฝ่ายซ่อมบำรุง / ทำความสะอาด',
        nameEn: 'Housekeeping & Maintenance',
        code: 'HK',
        color: '#10B981',
        sortOrder: 2,
        description: 'ทำความสะอาดห้องพัก พื้นที่ส่วนกลาง ซักรีด และซ่อมบำรุงทั่วไป',
      },
      {
        name: 'ฝ่ายอาหารและเครื่องดื่ม',
        nameEn: 'Food & Beverage',
        code: 'FB',
        color: '#F59E0B',
        sortOrder: 3,
        description: 'ร้านอาหาร บาร์ รูมเซอร์วิส จัดเลี้ยง',
      },
      {
        name: 'ฝ่ายวิศวกรรม',
        nameEn: 'Engineering',
        code: 'ENG',
        color: '#EF4444',
        sortOrder: 4,
        description: 'บำรุงรักษา ระบบไฟฟ้า ประปา HVAC ไอที',
      },
      {
        name: 'ฝ่ายทรัพยากรบุคคล',
        nameEn: 'Human Resources',
        code: 'HR',
        color: '#EC4899',
        sortOrder: 5,
        description: 'สรรหา ฝึกอบรม เงินเดือน สวัสดิการ',
      },
      {
        name: 'ฝ่ายการเงินและบัญชี',
        nameEn: 'Finance & Accounting',
        code: 'FIN',
        color: '#06B6D4',
        sortOrder: 6,
        description: 'บัญชี การเงิน จัดซื้อ คลังสินค้า',
      },
      {
        name: 'ฝ่ายขายและการตลาด',
        nameEn: 'Sales & Marketing',
        code: 'SM',
        color: '#F97316',
        sortOrder: 7,
        description: 'ขาย การตลาด ประชาสัมพันธ์ OTA จัดการ',
      },
      {
        name: 'ฝ่ายรักษาความปลอดภัย',
        nameEn: 'Security',
        code: 'SEC',
        color: '#6B7280',
        sortOrder: 8,
        description: 'รักษาความปลอดภัย ควบคุมการเข้าออก',
      },
      {
        name: 'ฝ่ายสปาและนันทนาการ',
        nameEn: 'Spa & Recreation',
        code: 'SPA',
        color: '#A78BFA',
        sortOrder: 9,
        description: 'สปา ฟิตเนส สระว่ายน้ำ กิจกรรมแขก',
      },
      {
        name: 'ฝ่ายบริหาร',
        nameEn: 'Management',
        code: 'MGT',
        color: '#1D4ED8',
        sortOrder: 10,
        description: 'ผู้บริหารระดับสูง ผู้จัดการทั่วไป',
      },
    ];

    // ─── ข้อมูลตำแหน่งงานตามแผนก ────────────────────────────────────────────
    const positionTemplates: Record<
      string,
      Array<{ name: string; nameEn: string; level: number; sortOrder: number }>
    > = {
      FO: [
        { name: 'ผู้จัดการฝ่ายต้อนรับ', nameEn: 'Front Office Manager', level: 8, sortOrder: 1 },
        { name: 'ผู้จัดการเวร', nameEn: 'Duty Manager', level: 7, sortOrder: 2 },
        {
          name: 'พนักงานต้อนรับ (กะกลางวัน)',
          nameEn: 'Front Desk Agent (Day Shift)',
          level: 4,
          sortOrder: 3,
        },
        { name: 'พนักงานต้อนรับ (กะกลางคืน)', nameEn: 'Night Auditor', level: 4, sortOrder: 4 },
        { name: 'คอนเซียจ', nameEn: 'Concierge', level: 5, sortOrder: 5 },
        { name: 'หัวหน้าพนักงานยกกระเป๋า', nameEn: 'Bell Captain', level: 5, sortOrder: 6 },
        { name: 'พนักงานยกกระเป๋า', nameEn: 'Bellman', level: 3, sortOrder: 7 },
        { name: 'เจ้าหน้าที่ Reception', nameEn: 'Reservation Agent', level: 4, sortOrder: 8 },
        {
          name: 'เจ้าหน้าที่ Guest Relations',
          nameEn: 'Guest Relations Officer',
          level: 5,
          sortOrder: 9,
        },
      ],
      HK: [
        { name: 'หัวหน้าแม่บ้าน', nameEn: 'Executive Housekeeper', level: 8, sortOrder: 1 },
        { name: 'ผู้ช่วยหัวหน้าแม่บ้าน', nameEn: 'Assistant Housekeeper', level: 7, sortOrder: 2 },
        { name: 'หัวหน้าชั้น', nameEn: 'Floor Supervisor', level: 6, sortOrder: 3 },
        { name: 'แม่บ้านห้องพัก', nameEn: 'Room Attendant', level: 3, sortOrder: 4 },
        { name: 'พนักงานซักรีด', nameEn: 'Laundry Attendant', level: 3, sortOrder: 5 },
        {
          name: 'พนักงานทำความสะอาดพื้นที่ส่วนกลาง',
          nameEn: 'Public Area Cleaner',
          level: 2,
          sortOrder: 6,
        },
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
        {
          name: 'เจ้าหน้าที่ Revenue Management',
          nameEn: 'Revenue Manager',
          level: 7,
          sortOrder: 5,
        },
      ],
      SEC: [
        { name: 'ผู้จัดการรักษาความปลอดภัย', nameEn: 'Security Manager', level: 7, sortOrder: 1 },
        {
          name: 'หัวหน้าเวรรักษาความปลอดภัย',
          nameEn: 'Security Supervisor',
          level: 6,
          sortOrder: 2,
        },
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
        {
          name: 'ผู้ช่วยผู้จัดการทั่วไป',
          nameEn: 'Assistant General Manager',
          level: 8,
          sortOrder: 4,
        },
      ],
    };

    // ─── ประเภทการลา ─────────────────────────────────────────────────────────
    const leaveTypeTemplates = [
      {
        name: 'ลาพักร้อน',
        nameEn: 'Annual Leave',
        code: 'ANNUAL',
        maxDaysPerYear: 15,
        isPaid: true,
        requiresDoc: false,
        color: '#10B981',
        sortOrder: 1,
        description: 'ลาพักร้อนประจำปี',
      },
      {
        name: 'ลาป่วย',
        nameEn: 'Sick Leave',
        code: 'SICK',
        maxDaysPerYear: 30,
        isPaid: true,
        requiresDoc: false,
        color: '#EF4444',
        sortOrder: 2,
        description: 'ลาเนื่องจากเจ็บป่วย',
      },
      {
        name: 'ลากิจ',
        nameEn: 'Personal Leave',
        code: 'PERSONAL',
        maxDaysPerYear: 3,
        isPaid: true,
        requiresDoc: false,
        color: '#F59E0B',
        sortOrder: 3,
        description: 'ลากิจส่วนตัว',
      },
      {
        name: 'ลาคลอด',
        nameEn: 'Maternity Leave',
        code: 'MATERNITY',
        maxDaysPerYear: 90,
        isPaid: true,
        requiresDoc: true,
        color: '#EC4899',
        sortOrder: 4,
        description: 'ลาคลอดบุตร (ตามกฎหมายแรงงาน)',
      },
      {
        name: 'ลาเพื่อดูแลภรรยาคลอด',
        nameEn: 'Paternity Leave',
        code: 'PATERNITY',
        maxDaysPerYear: 15,
        isPaid: true,
        requiresDoc: true,
        color: '#3B82F6',
        sortOrder: 5,
        description: 'ลาเพื่อดูแลภรรยาคลอด',
      },
      {
        name: 'ลาแต่งงาน',
        nameEn: 'Marriage Leave',
        code: 'MARRIAGE',
        maxDaysPerYear: 3,
        isPaid: true,
        requiresDoc: true,
        color: '#A78BFA',
        sortOrder: 6,
        description: 'ลาแต่งงาน',
      },
      {
        name: 'ลาไว้ทุกข์',
        nameEn: 'Bereavement Leave',
        code: 'BEREAVEMENT',
        maxDaysPerYear: 3,
        isPaid: true,
        requiresDoc: false,
        color: '#6B7280',
        sortOrder: 7,
        description: 'ลาไว้ทุกข์บุคคลในครอบครัว',
      },
      {
        name: 'ลาอบรม/สัมมนา',
        nameEn: 'Training Leave',
        code: 'TRAINING',
        maxDaysPerYear: null,
        isPaid: true,
        requiresDoc: false,
        color: '#06B6D4',
        sortOrder: 8,
        description: 'ลาเพื่อเข้ารับการอบรมหรือสัมมนา',
      },
      {
        name: 'ลาราชการทหาร',
        nameEn: 'Military Leave',
        code: 'MILITARY',
        maxDaysPerYear: 60,
        isPaid: true,
        requiresDoc: true,
        color: '#78716C',
        sortOrder: 9,
        description: 'ลาราชการทหาร (ตามกฎหมาย)',
      },
      {
        name: 'ลาไม่รับเงินเดือน',
        nameEn: 'Unpaid Leave',
        code: 'UNPAID',
        maxDaysPerYear: null,
        isPaid: false,
        requiresDoc: false,
        color: '#D1D5DB',
        sortOrder: 10,
        description: 'ลาโดยไม่รับเงินเดือน',
      },
    ];

    // ─── กะการทำงาน ──────────────────────────────────────────────────────────
    const shiftTypeTemplates = [
      {
        name: 'กะเช้า',
        nameEn: 'Morning Shift',
        code: 'MORNING',
        startTime: '07:00',
        endTime: '15:00',
        breakMinutes: 60,
        color: '#F59E0B',
        sortOrder: 1,
        description: 'กะทำงานช่วงเช้า 07:00-15:00 น.',
      },
      {
        name: 'กะบ่าย',
        nameEn: 'Afternoon Shift',
        code: 'AFTERNOON',
        startTime: '15:00',
        endTime: '23:00',
        breakMinutes: 60,
        color: '#8B5CF6',
        sortOrder: 2,
        description: 'กะทำงานช่วงบ่าย 15:00-23:00 น.',
      },
      {
        name: 'กะดึก',
        nameEn: 'Night Shift',
        code: 'NIGHT',
        startTime: '23:00',
        endTime: '07:00',
        breakMinutes: 60,
        color: '#1E40AF',
        sortOrder: 3,
        description: 'กะทำงานช่วงดึก 23:00-07:00 น.',
      },
      {
        name: 'เวลาทำการปกติ',
        nameEn: 'Office Hours',
        code: 'OFFICE',
        startTime: '09:00',
        endTime: '18:00',
        breakMinutes: 60,
        color: '#10B981',
        sortOrder: 4,
        description: 'เวลาทำการสำนักงาน 09:00-18:00 น.',
      },
      {
        name: 'กะแยก (Split Shift)',
        nameEn: 'Split Shift',
        code: 'SPLIT',
        startTime: '06:00',
        endTime: '22:00',
        breakMinutes: 240,
        color: '#EF4444',
        sortOrder: 5,
        description: 'ทำงานช่วงเช้า 06:00-10:00 และช่วงเย็น 18:00-22:00',
      },
      {
        name: 'ยืดหยุ่น',
        nameEn: 'Flexible Hours',
        code: 'FLEXIBLE',
        startTime: '08:00',
        endTime: '17:00',
        breakMinutes: 60,
        color: '#6B7280',
        sortOrder: 6,
        description: 'เวลาทำงานยืดหยุ่นตามตกลง',
      },
    ];

    // ─── ประเภทเบี้ยเลี้ยง ────────────────────────────────────────────────────
    const allowanceTypeTemplates = [
      {
        name: 'เซอร์วิสชาร์จ',
        nameEn: 'Service Charge',
        code: 'SERVICE_CHARGE',
        isTaxable: true,
        sortOrder: 1,
        description: 'ค่าบริการแบ่งให้พนักงาน',
      },
      {
        name: 'ค่าอาหาร',
        nameEn: 'Meal Allowance',
        code: 'MEAL',
        isTaxable: false,
        sortOrder: 2,
        description: 'เบี้ยเลี้ยงค่าอาหาร',
      },
      {
        name: 'ค่าเดินทาง',
        nameEn: 'Transportation Allowance',
        code: 'TRANSPORT',
        isTaxable: false,
        sortOrder: 3,
        description: 'ค่าใช้จ่ายการเดินทาง',
      },
      {
        name: 'ค่าที่พัก',
        nameEn: 'Housing Allowance',
        code: 'HOUSING',
        isTaxable: true,
        sortOrder: 4,
        description: 'เบี้ยเลี้ยงที่พักอาศัย',
      },
      {
        name: 'ค่าโทรศัพท์',
        nameEn: 'Phone Allowance',
        code: 'PHONE',
        isTaxable: false,
        sortOrder: 5,
        description: 'ค่าใช้จ่ายโทรศัพท์',
      },
      {
        name: 'ค่าล่วงเวลา',
        nameEn: 'Overtime Pay',
        code: 'OVERTIME',
        isTaxable: true,
        sortOrder: 6,
        description: 'ค่าจ้างการทำงานล่วงเวลา',
      },
      {
        name: 'เบี้ยกะ',
        nameEn: 'Shift Allowance',
        code: 'SHIFT',
        isTaxable: false,
        sortOrder: 7,
        description: 'เบี้ยเลี้ยงสำหรับการทำงานกะ',
      },
      {
        name: 'โบนัสประจำปี',
        nameEn: 'Annual Bonus',
        code: 'BONUS',
        isTaxable: true,
        sortOrder: 8,
        description: 'โบนัสประจำปีตามผลประกอบการ',
      },
      {
        name: 'ค่าคอมมิชชั่น',
        nameEn: 'Commission',
        code: 'COMMISSION',
        isTaxable: true,
        sortOrder: 9,
        description: 'ค่าคอมมิชชั่นจากการขาย',
      },
    ];

    // ─── ประเภทการหักเงิน ─────────────────────────────────────────────────────
    const deductionTypeTemplates = [
      {
        name: 'ภาษีเงินได้บุคคลธรรมดา',
        nameEn: 'Personal Income Tax',
        code: 'INCOME_TAX',
        isRequired: true,
        sortOrder: 1,
        description: 'ภาษีเงินได้หัก ณ ที่จ่าย (ตามกฎหมาย)',
      },
      {
        name: 'ประกันสังคม',
        nameEn: 'Social Security',
        code: 'SOCIAL_SECURITY',
        isRequired: true,
        sortOrder: 2,
        description: 'เงินสมทบกองทุนประกันสังคม 5% (สูงสุด 750 บาท/เดือน)',
      },
      {
        name: 'กองทุนสำรองเลี้ยงชีพ',
        nameEn: 'Provident Fund',
        code: 'PROVIDENT_FUND',
        isRequired: false,
        sortOrder: 3,
        description: 'เงินสะสมกองทุนสำรองเลี้ยงชีพ',
      },
      {
        name: 'เงินกู้พนักงาน',
        nameEn: 'Employee Loan',
        code: 'EMPLOYEE_LOAN',
        isRequired: false,
        sortOrder: 4,
        description: 'หักคืนเงินกู้จากโรงแรม',
      },
      {
        name: 'หักขาดงาน',
        nameEn: 'Absence Deduction',
        code: 'ABSENCE',
        isRequired: false,
        sortOrder: 5,
        description: 'หักเงินกรณีขาดงานโดยไม่มีเหตุ',
      },
      {
        name: 'หักมาสาย',
        nameEn: 'Late Deduction',
        code: 'LATE',
        isRequired: false,
        sortOrder: 6,
        description: 'หักเงินกรณีมาทำงานสาย',
      },
      {
        name: 'สหกรณ์ออมทรัพย์',
        nameEn: 'Cooperative Savings',
        code: 'COOPERATIVE',
        isRequired: false,
        sortOrder: 7,
        description: 'เงินสะสมสหกรณ์ออมทรัพย์พนักงาน',
      },
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

      this.logger.log(
        `    ✓ ${departmentTemplates.length} departments, ${leaveTypeTemplates.length} leave types, ${shiftTypeTemplates.length} shifts, ${allowanceTypeTemplates.length} allowances, ${deductionTypeTemplates.length} deductions`,
      );
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

    const property = await this.prisma.property.findFirst({
      where: { tenantId },
    });

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
        findPosition(deptFB!.id, 'Chef de Partie'),
        deptMGT ? findPosition(deptMGT.id, 'General Manager') : Promise.resolve(null),
        deptENG ? findPosition(deptENG.id, 'Chief Engineer') : Promise.resolve(null),
      ]);

    // ─── Employee template data ──────────────────────────────────────────────
    const employeeTemplates = [
      {
        code: 'PM-0001',
        firstName: 'วิชัย',
        lastName: 'มณีรัตน์',
        nickname: 'ชัย',
        email: 'wichai.manee@mountain.hotel',
        phone: '081-234-5001',
        department: 'ฝ่ายบริหาร',
        departmentId: deptMGT?.id ?? deptFO!.id,
        position: 'ผู้จัดการทั่วไป',
        positionId: posGM?.id ?? null,
        baseSalary: 85000,
        initialSalary: 65000,
        allowance: 10000,
        overtime: 0,
        positionBonus: 15000,
        bankAccount: '123-4-56789-0',
        bankName: 'KBANK',
        gender: 'MALE',
        dateOfBirth: new Date('1975-03-15'),
        employmentType: 'FULLTIME',
        nationalId: '1100500123456',
        taxId: 'TX-1100500123456',
        socialSecurity: 'SS-1100500123456',
      },
      {
        code: 'PM-0002',
        firstName: 'นภาพร',
        lastName: 'ศรีสมบูรณ์',
        nickname: 'พร',
        email: 'napaporn.sri@mountain.hotel',
        phone: '081-234-5002',
        department: 'ฝ่ายต้อนรับ',
        departmentId: deptFO!.id,
        position: 'ผู้จัดการฝ่ายต้อนรับ',
        positionId: posFOM?.id ?? null,
        baseSalary: 45000,
        initialSalary: 35000,
        allowance: 5000,
        overtime: 0,
        positionBonus: 8000,
        bankAccount: '123-4-56789-1',
        bankName: 'SCB',
        gender: 'FEMALE',
        dateOfBirth: new Date('1985-07-22'),
        employmentType: 'FULLTIME',
        nationalId: '1100500234567',
        taxId: 'TX-1100500234567',
        socialSecurity: 'SS-1100500234567',
      },
      {
        code: 'PM-0003',
        firstName: 'สมชาย',
        lastName: 'ใจดี',
        nickname: 'ชาย',
        email: 'somchai.jaidee@mountain.hotel',
        phone: '081-234-5003',
        department: 'ฝ่ายต้อนรับ',
        departmentId: deptFO!.id,
        position: 'พนักงานต้อนรับ (กะกลางวัน)',
        positionId: posFDA?.id ?? null,
        baseSalary: 18000,
        initialSalary: 15000,
        allowance: 2000,
        overtime: 1500,
        positionBonus: 0,
        bankAccount: '123-4-56789-2',
        bankName: 'BBL',
        gender: 'MALE',
        dateOfBirth: new Date('1995-01-10'),
        employmentType: 'FULLTIME',
        nationalId: '1100500345678',
        taxId: 'TX-1100500345678',
        socialSecurity: 'SS-1100500345678',
      },
      {
        code: 'PM-0004',
        firstName: 'มาลี',
        lastName: 'รักษ์ดี',
        nickname: 'ลี',
        email: 'malee.rakdee@mountain.hotel',
        phone: '081-234-5004',
        department: 'ฝ่ายต้อนรับ',
        departmentId: deptFO!.id,
        position: 'พนักงานต้อนรับ (กะกลางวัน)',
        positionId: posFDA?.id ?? null,
        baseSalary: 17500,
        initialSalary: 15000,
        allowance: 2000,
        overtime: 1000,
        positionBonus: 0,
        bankAccount: '123-4-56789-3',
        bankName: 'KTB',
        gender: 'FEMALE',
        dateOfBirth: new Date('1997-11-05'),
        employmentType: 'FULLTIME',
        nationalId: '1100500456789',
        taxId: 'TX-1100500456789',
        socialSecurity: 'SS-1100500456789',
      },
      {
        code: 'PM-0005',
        firstName: 'รัตนา',
        lastName: 'แม่บ้านดี',
        nickname: 'นา',
        email: 'rattana.maebaan@mountain.hotel',
        phone: '081-234-5005',
        department: 'ฝ่ายแม่บ้าน',
        departmentId: deptHK!.id,
        position: 'หัวหน้าแม่บ้าน',
        positionId: posEHK?.id ?? null,
        baseSalary: 32000,
        initialSalary: 25000,
        allowance: 3000,
        overtime: 0,
        positionBonus: 5000,
        bankAccount: '123-4-56789-4',
        bankName: 'KBANK',
        gender: 'FEMALE',
        dateOfBirth: new Date('1980-06-18'),
        employmentType: 'FULLTIME',
        nationalId: '1100500567890',
        taxId: 'TX-1100500567890',
        socialSecurity: 'SS-1100500567890',
      },
      {
        code: 'PM-0006',
        firstName: 'สุนันท์',
        lastName: 'ทำความสะอาด',
        nickname: 'นัน',
        email: 'sunun.tam@mountain.hotel',
        phone: '081-234-5006',
        department: 'ฝ่ายแม่บ้าน',
        departmentId: deptHK!.id,
        position: 'แม่บ้านห้องพัก',
        positionId: posRA?.id ?? null,
        baseSalary: 13500,
        initialSalary: 12000,
        allowance: 1500,
        overtime: 2000,
        positionBonus: 0,
        bankAccount: '123-4-56789-5',
        bankName: 'GSB',
        gender: 'FEMALE',
        dateOfBirth: new Date('1992-09-28'),
        employmentType: 'FULLTIME',
        nationalId: '1100500678901',
        taxId: 'TX-1100500678901',
        socialSecurity: 'SS-1100500678901',
      },
      {
        code: 'PM-0007',
        firstName: 'ประภา',
        lastName: 'บุคลากรดี',
        nickname: 'ภา',
        email: 'prapa.hr@mountain.hotel',
        phone: '081-234-5007',
        department: 'ฝ่ายทรัพยากรบุคคล',
        departmentId: deptHR!.id,
        position: 'ผู้จัดการฝ่าย HR',
        positionId: posHRM?.id ?? null,
        baseSalary: 38000,
        initialSalary: 30000,
        allowance: 4000,
        overtime: 0,
        positionBonus: 6000,
        bankAccount: '123-4-56789-6',
        bankName: 'SCB',
        gender: 'FEMALE',
        dateOfBirth: new Date('1988-04-12'),
        employmentType: 'FULLTIME',
        nationalId: '1100500789012',
        taxId: 'TX-1100500789012',
        socialSecurity: 'SS-1100500789012',
      },
      {
        code: 'PM-0008',
        firstName: 'อนุชา',
        lastName: 'อาหารดี',
        nickname: 'ชา',
        email: 'anucha.fb@mountain.hotel',
        phone: '081-234-5008',
        department: 'ฝ่ายอาหารและเครื่องดื่ม',
        departmentId: deptFB!.id,
        position: 'ผู้จัดการอาหารและเครื่องดื่ม',
        positionId: posFBM?.id ?? null,
        baseSalary: 40000,
        initialSalary: 32000,
        allowance: 5000,
        overtime: 0,
        positionBonus: 7000,
        bankAccount: '123-4-56789-7',
        bankName: 'BAY',
        gender: 'MALE',
        dateOfBirth: new Date('1983-12-01'),
        employmentType: 'FULLTIME',
        nationalId: '1100500890123',
        taxId: 'TX-1100500890123',
        socialSecurity: 'SS-1100500890123',
      },
      {
        code: 'PM-0009',
        firstName: 'ไพศาล',
        lastName: 'ครัวเก่ง',
        nickname: 'ศาล',
        email: 'paisal.chef@mountain.hotel',
        phone: '081-234-5009',
        department: 'ฝ่ายอาหารและเครื่องดื่ม',
        departmentId: deptFB!.id,
        position: 'พ่อครัวแต่ละส่วน',
        positionId: posChef?.id ?? null,
        baseSalary: 22000,
        initialSalary: 18000,
        allowance: 2500,
        overtime: 3000,
        positionBonus: 0,
        bankAccount: '123-4-56789-8',
        bankName: 'KBANK',
        gender: 'MALE',
        dateOfBirth: new Date('1990-08-20'),
        employmentType: 'FULLTIME',
        nationalId: '1100500901234',
        taxId: 'TX-1100500901234',
        socialSecurity: 'SS-1100500901234',
      },
      {
        code: 'PM-0010',
        firstName: 'ธนกร',
        lastName: 'ช่างดี',
        nickname: 'กร',
        email: 'thanakorn.eng@mountain.hotel',
        phone: '081-234-5010',
        department: 'ฝ่ายวิศวกรรม',
        departmentId: deptENG?.id ?? deptFO!.id,
        position: 'หัวหน้าวิศวกร',
        positionId: posChiefEng?.id ?? null,
        baseSalary: 35000,
        initialSalary: 28000,
        allowance: 3500,
        overtime: 2000,
        positionBonus: 5000,
        bankAccount: '123-4-56789-9',
        bankName: 'TMBThanachart',
        gender: 'MALE',
        dateOfBirth: new Date('1987-02-14'),
        employmentType: 'FULLTIME',
        nationalId: '1100501012345',
        taxId: 'TX-1100501012345',
        socialSecurity: 'SS-1100501012345',
      },
    ];

    // ─── Create employees (upsert by email) ───────────────────────────────────
    const createdEmployees: any[] = [];
    for (const emp of employeeTemplates) {
      // Email is now unique per (tenantId, email) — must include tenantId in the lookup
      const existing = await (this.prisma.employee as any).findFirst({
        where: { tenantId, email: emp.email },
      });
      if (existing) {
        const updated = await (this.prisma.employee as any).update({
          where: { id: existing.id },
          data: {
            tenantId,
            firstName: emp.firstName,
            lastName: emp.lastName,
            nickname: emp.nickname,
            phone: emp.phone,
            department: emp.department,
            position: emp.position,
            departmentId: emp.departmentId,
            positionId: emp.positionId,
            propertyId: property?.id || null,
            baseSalary: emp.baseSalary,
            initialSalary: emp.initialSalary,
            allowance: emp.allowance,
            overtime: emp.overtime,
            positionBonus: emp.positionBonus,
            taxId: emp.taxId,
            socialSecurity: emp.socialSecurity,
            bankAccount: emp.bankAccount,
            bankName: emp.bankName,
            gender: emp.gender,
            dateOfBirth: emp.dateOfBirth,
            employmentType: emp.employmentType,
            nationalId: emp.nationalId,
            status: 'ACTIVE',
            employeeCode: emp.code,
          },
        });
        createdEmployees.push(updated);
      } else {
        const created = await (this.prisma.employee as any).create({
          data: {
            tenantId,
            email: emp.email,
            firstName: emp.firstName,
            lastName: emp.lastName,
            nickname: emp.nickname,
            phone: emp.phone,
            employeeCode: emp.code,
            department: emp.department,
            position: emp.position,
            departmentId: emp.departmentId,
            positionId: emp.positionId,
            propertyId: property?.id || null,
            baseSalary: emp.baseSalary,
            initialSalary: emp.initialSalary,
            allowance: emp.allowance,
            overtime: emp.overtime,
            positionBonus: emp.positionBonus,
            taxId: emp.taxId,
            socialSecurity: emp.socialSecurity,
            bankAccount: emp.bankAccount,
            bankName: emp.bankName,
            gender: emp.gender,
            dateOfBirth: emp.dateOfBirth,
            employmentType: emp.employmentType,
            nationalId: emp.nationalId,
            status: 'ACTIVE',
            startDate: new Date('2024-01-01'),
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
        if (dow !== 0 && dow !== 6) {
          // skip weekends
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

            if (rand < 0.8) {
              status = 'present';
              checkIn = new Date(dateOnly);
              checkIn.setUTCHours(8, Math.floor(Math.random() * 30), 0);
              checkOut = new Date(dateOnly);
              checkOut.setUTCHours(17, Math.floor(Math.random() * 30), 0);
              workMinutes = 480;
              overtimeMinutes = Math.random() < 0.3 ? Math.floor(Math.random() * 90 + 30) : 0;
            } else if (rand < 0.9) {
              status = 'late';
              checkIn = new Date(dateOnly);
              checkIn.setUTCHours(9, Math.floor(Math.random() * 30 + 15), 0);
              checkOut = new Date(dateOnly);
              checkOut.setUTCHours(18, 30, 0);
              workMinutes = 450;
              overtimeMinutes = 0;
            } else if (rand < 0.95) {
              status = 'absent';
            } else {
              status = 'on_leave';
            }

            await (this.prisma as any).hrAttendance.create({
              data: {
                tenantId,
                employeeId: emp.id,
                date: dateOnly,
                status,
                checkIn,
                checkOut,
                workMinutes,
                overtimeMinutes,
              },
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
          endDate: new Date(today.getFullYear(), today.getMonth(), 17),
          totalDays: 3,
          reason: 'พักผ่อนประจำปี ท่องเที่ยวกับครอบครัว',
          status: 'approved',
          approvedBy: ownerUser.id,
          approvedAt: new Date(),
        },
        {
          employeeId: createdEmployees[5].id, // สุนันท์
          leaveTypeId: sickLeaveType.id,
          startDate: new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1),
          endDate: new Date(today.getFullYear(), today.getMonth(), today.getDate() + 2),
          totalDays: 2,
          reason: 'ไม่สบาย มีไข้',
          status: 'pending',
        },
        {
          employeeId: createdEmployees[3].id, // มาลี
          leaveTypeId: annualLeaveType.id,
          startDate: new Date(today.getFullYear(), today.getMonth(), 5),
          endDate: new Date(today.getFullYear(), today.getMonth(), 5),
          totalDays: 1,
          reason: 'ธุระส่วนตัว',
          status: 'rejected',
          rejectedBy: ownerUser.id,
          rejectedAt: new Date(),
          rejectReason: 'ช่วงนั้นพนักงานน้อย ขอให้เลื่อนออกไป',
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
   * Seed Employee records for every tenant across all departments.
   * สร้างพนักงานตัวอย่างครบทุกแผนก (Front Office, Housekeeping, F&B, Engineering,
   * HR, Finance, Sales, Security, Spa, Management) พร้อมข้อมูลตำแหน่งและช่าง (ENG)
   * หลายประเภท เพื่อให้ demo ระบบ HR ได้อย่างสมบูรณ์
   */
  private async seedEmployeesForAllTenants(): Promise<void> {
    this.logger.log('👨‍💼 Seeding Employees for all tenants...');

    const allTenants = await this.tenantsService.findAll();
    if (allTenants.length === 0) {
      this.logger.warn('  ⚠️ No tenants found, skipping employee seeding');
      return;
    }

    // Employee templates per department code
    // Each template uses nameEn to look up the position from seedHrMasterData
    const employeeTemplatesByDept: Record<
      string,
      Array<{
        codePrefix: string;
        firstName: string;
        lastName: string;
        nickname: string;
        emailPrefix: string;
        positionNameEn: string;
        gender: string;
        dateOfBirth: Date;
        employmentType: string;
        baseSalary: number;
        initialSalary: number;
        allowance: number;
        overtime: number;
        positionBonus: number;
        bankName: string;
      }>
    > = {
      MGT: [
        {
          codePrefix: 'MGT-001',
          firstName: 'ธีระพล',
          lastName: 'วิชาการ',
          nickname: 'เติ้ล',
          emailPrefix: 'teeraphol.gm',
          positionNameEn: 'General Manager',
          gender: 'MALE',
          dateOfBirth: new Date('1972-04-10'),
          employmentType: 'FULLTIME',
          baseSalary: 95000,
          initialSalary: 70000,
          allowance: 12000,
          overtime: 0,
          positionBonus: 18000,
          bankName: 'KBANK',
        },
        {
          codePrefix: 'MGT-002',
          firstName: 'ศิริพร',
          lastName: 'บริหารดี',
          nickname: 'อ้อม',
          emailPrefix: 'siriporn.agm',
          positionNameEn: 'Assistant General Manager',
          gender: 'FEMALE',
          dateOfBirth: new Date('1978-09-25'),
          employmentType: 'FULLTIME',
          baseSalary: 72000,
          initialSalary: 55000,
          allowance: 8000,
          overtime: 0,
          positionBonus: 12000,
          bankName: 'SCB',
        },
      ],
      FO: [
        {
          codePrefix: 'FO-001',
          firstName: 'กนกวรรณ',
          lastName: 'ต้อนรับดี',
          nickname: 'กนก',
          emailPrefix: 'kanokwan.fom',
          positionNameEn: 'Front Office Manager',
          gender: 'FEMALE',
          dateOfBirth: new Date('1983-06-12'),
          employmentType: 'FULLTIME',
          baseSalary: 45000,
          initialSalary: 35000,
          allowance: 5000,
          overtime: 0,
          positionBonus: 8000,
          bankName: 'SCB',
        },
        {
          codePrefix: 'FO-002',
          firstName: 'พีรพัฒน์',
          lastName: 'เวรกลางวัน',
          nickname: 'เพชร',
          emailPrefix: 'peeraphat.fd',
          positionNameEn: 'Front Desk Agent (Day Shift)',
          gender: 'MALE',
          dateOfBirth: new Date('1996-03-20'),
          employmentType: 'FULLTIME',
          baseSalary: 18000,
          initialSalary: 15000,
          allowance: 2000,
          overtime: 1500,
          positionBonus: 0,
          bankName: 'KTB',
        },
        {
          codePrefix: 'FO-003',
          firstName: 'ณิชา',
          lastName: 'กลางคืนดี',
          nickname: 'นิค',
          emailPrefix: 'nicha.night',
          positionNameEn: 'Night Auditor',
          gender: 'FEMALE',
          dateOfBirth: new Date('1994-11-08'),
          employmentType: 'FULLTIME',
          baseSalary: 19000,
          initialSalary: 16000,
          allowance: 2500,
          overtime: 2500,
          positionBonus: 0,
          bankName: 'BBL',
        },
        {
          codePrefix: 'FO-004',
          firstName: 'สุเมธ',
          lastName: 'คอนเซียจ',
          nickname: 'เมธ',
          emailPrefix: 'sumet.concierge',
          positionNameEn: 'Concierge',
          gender: 'MALE',
          dateOfBirth: new Date('1990-07-15'),
          employmentType: 'FULLTIME',
          baseSalary: 22000,
          initialSalary: 18000,
          allowance: 2000,
          overtime: 1000,
          positionBonus: 0,
          bankName: 'KBANK',
        },
        {
          codePrefix: 'FO-005',
          firstName: 'วรรณิกา',
          lastName: 'รับจอง',
          nickname: 'ว่าน',
          emailPrefix: 'wannika.res',
          positionNameEn: 'Reservation Agent',
          gender: 'FEMALE',
          dateOfBirth: new Date('1998-02-28'),
          employmentType: 'FULLTIME',
          baseSalary: 17500,
          initialSalary: 15000,
          allowance: 1500,
          overtime: 800,
          positionBonus: 0,
          bankName: 'GSB',
        },
        {
          codePrefix: 'FO-006',
          firstName: 'ชลธิชา',
          lastName: 'เกสต์รีเลชัน',
          nickname: 'ชล',
          emailPrefix: 'cholticha.gro',
          positionNameEn: 'Guest Relations Officer',
          gender: 'FEMALE',
          dateOfBirth: new Date('1995-05-19'),
          employmentType: 'FULLTIME',
          baseSalary: 21000,
          initialSalary: 18000,
          allowance: 2000,
          overtime: 500,
          positionBonus: 0,
          bankName: 'BAY',
        },
      ],
      HK: [
        {
          codePrefix: 'HK-001',
          firstName: 'จินตนา',
          lastName: 'ดูแลห้อง',
          nickname: 'จิ๋ว',
          emailPrefix: 'jintana.ehk',
          positionNameEn: 'Executive Housekeeper',
          gender: 'FEMALE',
          dateOfBirth: new Date('1979-08-30'),
          employmentType: 'FULLTIME',
          baseSalary: 32000,
          initialSalary: 25000,
          allowance: 3000,
          overtime: 0,
          positionBonus: 5000,
          bankName: 'KBANK',
        },
        {
          codePrefix: 'HK-002',
          firstName: 'สุภาวดี',
          lastName: 'ชั้นหนึ่ง',
          nickname: 'พิ',
          emailPrefix: 'supawadee.sup',
          positionNameEn: 'Floor Supervisor',
          gender: 'FEMALE',
          dateOfBirth: new Date('1987-01-14'),
          employmentType: 'FULLTIME',
          baseSalary: 22000,
          initialSalary: 18000,
          allowance: 2000,
          overtime: 500,
          positionBonus: 2000,
          bankName: 'SCB',
        },
        {
          codePrefix: 'HK-003',
          firstName: 'ลำดวน',
          lastName: 'ทำห้อง',
          nickname: 'ดวน',
          emailPrefix: 'lamduan.ra',
          positionNameEn: 'Room Attendant',
          gender: 'FEMALE',
          dateOfBirth: new Date('1993-10-05'),
          employmentType: 'FULLTIME',
          baseSalary: 13500,
          initialSalary: 12000,
          allowance: 1500,
          overtime: 2000,
          positionBonus: 0,
          bankName: 'GSB',
        },
        {
          codePrefix: 'HK-004',
          firstName: 'อรวรรณ',
          lastName: 'ซักรีด',
          nickname: 'อ้อ',
          emailPrefix: 'orawan.laundry',
          positionNameEn: 'Laundry Attendant',
          gender: 'FEMALE',
          dateOfBirth: new Date('1991-04-22'),
          employmentType: 'FULLTIME',
          baseSalary: 13000,
          initialSalary: 11500,
          allowance: 1200,
          overtime: 1800,
          positionBonus: 0,
          bankName: 'KTB',
        },
        {
          codePrefix: 'HK-005',
          firstName: 'ปรีดา',
          lastName: 'พื้นที่กลาง',
          nickname: 'ดา',
          emailPrefix: 'preeda.pa',
          positionNameEn: 'Public Area Cleaner',
          gender: 'MALE',
          dateOfBirth: new Date('1989-12-11'),
          employmentType: 'FULLTIME',
          baseSalary: 12500,
          initialSalary: 11000,
          allowance: 1000,
          overtime: 2200,
          positionBonus: 0,
          bankName: 'BBL',
        },
      ],
      FB: [
        {
          codePrefix: 'FB-001',
          firstName: 'นิรันดร์',
          lastName: 'อาหารเลิศ',
          nickname: 'ดร',
          emailPrefix: 'niran.fbm',
          positionNameEn: 'F&B Manager',
          gender: 'MALE',
          dateOfBirth: new Date('1980-03-17'),
          employmentType: 'FULLTIME',
          baseSalary: 42000,
          initialSalary: 33000,
          allowance: 5000,
          overtime: 0,
          positionBonus: 7000,
          bankName: 'SCB',
        },
        {
          codePrefix: 'FB-002',
          firstName: 'ชาญชัย',
          lastName: 'ครัวเชฟ',
          nickname: 'ชาญ',
          emailPrefix: 'chanchai.chef',
          positionNameEn: 'Head Chef',
          gender: 'MALE',
          dateOfBirth: new Date('1977-11-22'),
          employmentType: 'FULLTIME',
          baseSalary: 55000,
          initialSalary: 42000,
          allowance: 6000,
          overtime: 0,
          positionBonus: 8000,
          bankName: 'KBANK',
        },
        {
          codePrefix: 'FB-003',
          firstName: 'สุชาติ',
          lastName: 'เชฟส่วน',
          nickname: 'ติ',
          emailPrefix: 'suchat.cdp',
          positionNameEn: 'Chef de Partie',
          gender: 'MALE',
          dateOfBirth: new Date('1988-07-09'),
          employmentType: 'FULLTIME',
          baseSalary: 24000,
          initialSalary: 19000,
          allowance: 2500,
          overtime: 3000,
          positionBonus: 0,
          bankName: 'BAY',
        },
        {
          codePrefix: 'FB-004',
          firstName: 'พัชรา',
          lastName: 'บาริสต้า',
          nickname: 'แพท',
          emailPrefix: 'patchara.barista',
          positionNameEn: 'Barista',
          gender: 'FEMALE',
          dateOfBirth: new Date('1999-06-30'),
          employmentType: 'FULLTIME',
          baseSalary: 15500,
          initialSalary: 14000,
          allowance: 1500,
          overtime: 1200,
          positionBonus: 0,
          bankName: 'GSB',
        },
        {
          codePrefix: 'FB-005',
          firstName: 'ปัณณ์',
          lastName: 'เสิร์ฟดี',
          nickname: 'ปัน',
          emailPrefix: 'pan.waiter',
          positionNameEn: 'Waiter / Waitress',
          gender: 'MALE',
          dateOfBirth: new Date('2000-09-14'),
          employmentType: 'FULLTIME',
          baseSalary: 14000,
          initialSalary: 12500,
          allowance: 1500,
          overtime: 1500,
          positionBonus: 0,
          bankName: 'KTB',
        },
        {
          codePrefix: 'FB-006',
          firstName: 'สิริกาญจน์',
          lastName: 'รูมเซอร์วิส',
          nickname: 'เกด',
          emailPrefix: 'sirikarn.rs',
          positionNameEn: 'Room Service Attendant',
          gender: 'FEMALE',
          dateOfBirth: new Date('1997-01-03'),
          employmentType: 'FULLTIME',
          baseSalary: 14500,
          initialSalary: 13000,
          allowance: 1500,
          overtime: 1800,
          positionBonus: 0,
          bankName: 'SCB',
        },
      ],
      ENG: [
        {
          codePrefix: 'ENG-001',
          firstName: 'ประกิต',
          lastName: 'ช่างใหญ่',
          nickname: 'กิต',
          emailPrefix: 'prakit.chief',
          positionNameEn: 'Chief Engineer',
          gender: 'MALE',
          dateOfBirth: new Date('1975-05-28'),
          employmentType: 'FULLTIME',
          baseSalary: 45000,
          initialSalary: 36000,
          allowance: 5000,
          overtime: 0,
          positionBonus: 7000,
          bankName: 'KBANK',
        },
        {
          codePrefix: 'ENG-002',
          firstName: 'พิสิฐ',
          lastName: 'ช่างรอง',
          nickname: 'พิ',
          emailPrefix: 'pisit.aeng',
          positionNameEn: 'Assistant Engineer',
          gender: 'MALE',
          dateOfBirth: new Date('1984-02-19'),
          employmentType: 'FULLTIME',
          baseSalary: 35000,
          initialSalary: 28000,
          allowance: 4000,
          overtime: 1500,
          positionBonus: 4000,
          bankName: 'SCB',
        },
        {
          codePrefix: 'ENG-003',
          firstName: 'อาทิตย์',
          lastName: 'ช่างไฟฟ้า',
          nickname: 'ท้า',
          emailPrefix: 'artit.elec',
          positionNameEn: 'Electrician',
          gender: 'MALE',
          dateOfBirth: new Date('1990-08-14'),
          employmentType: 'FULLTIME',
          baseSalary: 22000,
          initialSalary: 18000,
          allowance: 2500,
          overtime: 3500,
          positionBonus: 0,
          bankName: 'KTB',
        },
        {
          codePrefix: 'ENG-004',
          firstName: 'วันชัย',
          lastName: 'ช่างประปา',
          nickname: 'ชัย',
          emailPrefix: 'wanchai.plumb',
          positionNameEn: 'Plumber',
          gender: 'MALE',
          dateOfBirth: new Date('1988-11-30'),
          employmentType: 'FULLTIME',
          baseSalary: 21000,
          initialSalary: 17500,
          allowance: 2500,
          overtime: 3000,
          positionBonus: 0,
          bankName: 'BBL',
        },
        {
          codePrefix: 'ENG-005',
          firstName: 'สุรศักดิ์',
          lastName: 'ช่างแอร์',
          nickname: 'ศักดิ์',
          emailPrefix: 'surasak.hvac',
          positionNameEn: 'HVAC Technician',
          gender: 'MALE',
          dateOfBirth: new Date('1986-04-07'),
          employmentType: 'FULLTIME',
          baseSalary: 23000,
          initialSalary: 19000,
          allowance: 2500,
          overtime: 4000,
          positionBonus: 0,
          bankName: 'GSB',
        },
        {
          codePrefix: 'ENG-006',
          firstName: 'ปรเมศร์',
          lastName: 'ช่างไอที',
          nickname: 'เมศ',
          emailPrefix: 'paramet.it',
          positionNameEn: 'IT Technician',
          gender: 'MALE',
          dateOfBirth: new Date('1993-01-25'),
          employmentType: 'FULLTIME',
          baseSalary: 26000,
          initialSalary: 22000,
          allowance: 3000,
          overtime: 2000,
          positionBonus: 0,
          bankName: 'SCB',
        },
        {
          codePrefix: 'ENG-007',
          firstName: 'บุญยง',
          lastName: 'ช่างทั่วไป',
          nickname: 'บุญ',
          emailPrefix: 'bunyong.maint',
          positionNameEn: 'General Maintenance',
          gender: 'MALE',
          dateOfBirth: new Date('1991-06-18'),
          employmentType: 'FULLTIME',
          baseSalary: 14500,
          initialSalary: 12500,
          allowance: 1500,
          overtime: 3500,
          positionBonus: 0,
          bankName: 'KTB',
        },
      ],
      HR: [
        {
          codePrefix: 'HR-001',
          firstName: 'ดวงฤดี',
          lastName: 'บุคลากร',
          nickname: 'ดวง',
          emailPrefix: 'duangrudee.hrm',
          positionNameEn: 'HR Manager',
          gender: 'FEMALE',
          dateOfBirth: new Date('1982-09-03'),
          employmentType: 'FULLTIME',
          baseSalary: 38000,
          initialSalary: 30000,
          allowance: 4000,
          overtime: 0,
          positionBonus: 6000,
          bankName: 'SCB',
        },
        {
          codePrefix: 'HR-002',
          firstName: 'ภัทรพล',
          lastName: 'เจ้าหน้าที่ HR',
          nickname: 'แฝด',
          emailPrefix: 'pattarapon.hr',
          positionNameEn: 'HR Officer',
          gender: 'MALE',
          dateOfBirth: new Date('1996-12-15'),
          employmentType: 'FULLTIME',
          baseSalary: 20000,
          initialSalary: 17000,
          allowance: 2000,
          overtime: 500,
          positionBonus: 0,
          bankName: 'KBANK',
        },
        {
          codePrefix: 'HR-003',
          firstName: 'ธัญญา',
          lastName: 'เงินเดือน',
          nickname: 'ญา',
          emailPrefix: 'tanya.payroll',
          positionNameEn: 'Payroll Officer',
          gender: 'FEMALE',
          dateOfBirth: new Date('1990-03-27'),
          employmentType: 'FULLTIME',
          baseSalary: 22000,
          initialSalary: 18500,
          allowance: 2000,
          overtime: 0,
          positionBonus: 0,
          bankName: 'BBL',
        },
      ],
      FIN: [
        {
          codePrefix: 'FIN-001',
          firstName: 'ชัชพล',
          lastName: 'ผู้ควบคุมการเงิน',
          nickname: 'ชัช',
          emailPrefix: 'chatchapon.fc',
          positionNameEn: 'Financial Controller',
          gender: 'MALE',
          dateOfBirth: new Date('1973-07-11'),
          employmentType: 'FULLTIME',
          baseSalary: 70000,
          initialSalary: 55000,
          allowance: 8000,
          overtime: 0,
          positionBonus: 12000,
          bankName: 'KBANK',
        },
        {
          codePrefix: 'FIN-002',
          firstName: 'ฉันทนา',
          lastName: 'บัญชีดี',
          nickname: 'ฉัน',
          emailPrefix: 'chantana.acc',
          positionNameEn: 'Accountant',
          gender: 'FEMALE',
          dateOfBirth: new Date('1986-10-20'),
          employmentType: 'FULLTIME',
          baseSalary: 25000,
          initialSalary: 20000,
          allowance: 2500,
          overtime: 0,
          positionBonus: 0,
          bankName: 'SCB',
        },
        {
          codePrefix: 'FIN-003',
          firstName: 'วิโรจน์',
          lastName: 'จัดซื้อ',
          nickname: 'โรจน์',
          emailPrefix: 'wiroj.purchase',
          positionNameEn: 'Purchasing Officer',
          gender: 'MALE',
          dateOfBirth: new Date('1991-08-05'),
          employmentType: 'FULLTIME',
          baseSalary: 20000,
          initialSalary: 16500,
          allowance: 2000,
          overtime: 1000,
          positionBonus: 0,
          bankName: 'KTB',
        },
      ],
      SM: [
        {
          codePrefix: 'SM-001',
          firstName: 'ณัฐวุฒิ',
          lastName: 'ขายดี',
          nickname: 'วุฒิ',
          emailPrefix: 'nattawut.sm',
          positionNameEn: 'Sales Manager',
          gender: 'MALE',
          dateOfBirth: new Date('1981-05-16'),
          employmentType: 'FULLTIME',
          baseSalary: 48000,
          initialSalary: 38000,
          allowance: 6000,
          overtime: 0,
          positionBonus: 10000,
          bankName: 'SCB',
        },
        {
          codePrefix: 'SM-002',
          firstName: 'ทิพวรรณ',
          lastName: 'การตลาด',
          nickname: 'ทิพ',
          emailPrefix: 'thipwan.mkt',
          positionNameEn: 'Marketing Executive',
          gender: 'FEMALE',
          dateOfBirth: new Date('1993-02-08'),
          employmentType: 'FULLTIME',
          baseSalary: 26000,
          initialSalary: 22000,
          allowance: 3000,
          overtime: 0,
          positionBonus: 0,
          bankName: 'KBANK',
        },
        {
          codePrefix: 'SM-003',
          firstName: 'สัญญา',
          lastName: 'รายได้ดี',
          nickname: 'ยา',
          emailPrefix: 'sanya.rev',
          positionNameEn: 'Revenue Manager',
          gender: 'MALE',
          dateOfBirth: new Date('1985-09-21'),
          employmentType: 'FULLTIME',
          baseSalary: 38000,
          initialSalary: 30000,
          allowance: 4000,
          overtime: 0,
          positionBonus: 6000,
          bankName: 'BBL',
        },
      ],
      SEC: [
        {
          codePrefix: 'SEC-001',
          firstName: 'ศิลปิน',
          lastName: 'รปภ.ใหญ่',
          nickname: 'ศิล',
          emailPrefix: 'sillapin.secm',
          positionNameEn: 'Security Manager',
          gender: 'MALE',
          dateOfBirth: new Date('1976-12-04'),
          employmentType: 'FULLTIME',
          baseSalary: 32000,
          initialSalary: 26000,
          allowance: 3500,
          overtime: 0,
          positionBonus: 4000,
          bankName: 'KTB',
        },
        {
          codePrefix: 'SEC-002',
          firstName: 'สงกรานต์',
          lastName: 'รักษาความปลอดภัย',
          nickname: 'กรานต์',
          emailPrefix: 'songkran.sec',
          positionNameEn: 'Security Officer',
          gender: 'MALE',
          dateOfBirth: new Date('1995-04-13'),
          employmentType: 'FULLTIME',
          baseSalary: 14000,
          initialSalary: 12500,
          allowance: 1500,
          overtime: 3000,
          positionBonus: 0,
          bankName: 'GSB',
        },
        {
          codePrefix: 'SEC-003',
          firstName: 'มนัส',
          lastName: 'ดู CCTV',
          nickname: 'นัส',
          emailPrefix: 'manas.cctv',
          positionNameEn: 'CCTV Operator',
          gender: 'MALE',
          dateOfBirth: new Date('1993-07-29'),
          employmentType: 'FULLTIME',
          baseSalary: 16000,
          initialSalary: 14000,
          allowance: 1500,
          overtime: 2500,
          positionBonus: 0,
          bankName: 'SCB',
        },
      ],
      SPA: [
        {
          codePrefix: 'SPA-001',
          firstName: 'ศิริลักษณ์',
          lastName: 'สปาดี',
          nickname: 'ลักษณ์',
          emailPrefix: 'sirilak.spam',
          positionNameEn: 'Spa Manager',
          gender: 'FEMALE',
          dateOfBirth: new Date('1984-11-17'),
          employmentType: 'FULLTIME',
          baseSalary: 36000,
          initialSalary: 28000,
          allowance: 4000,
          overtime: 0,
          positionBonus: 5000,
          bankName: 'SCB',
        },
        {
          codePrefix: 'SPA-002',
          firstName: 'นวลพรรณ',
          lastName: 'นวดบำบัด',
          nickname: 'นวล',
          emailPrefix: 'nuanpan.ther',
          positionNameEn: 'Therapist',
          gender: 'FEMALE',
          dateOfBirth: new Date('1992-03-12'),
          employmentType: 'FULLTIME',
          baseSalary: 20000,
          initialSalary: 17000,
          allowance: 2000,
          overtime: 1500,
          positionBonus: 0,
          bankName: 'KBANK',
        },
        {
          codePrefix: 'SPA-003',
          firstName: 'เอกชัย',
          lastName: 'ฟิตเนสโค้ช',
          nickname: 'เอก',
          emailPrefix: 'ekkachai.fit',
          positionNameEn: 'Fitness Instructor',
          gender: 'MALE',
          dateOfBirth: new Date('1989-06-04'),
          employmentType: 'FULLTIME',
          baseSalary: 21000,
          initialSalary: 17500,
          allowance: 2000,
          overtime: 1000,
          positionBonus: 0,
          bankName: 'BBL',
        },
        {
          codePrefix: 'SPA-004',
          firstName: 'พิมพ์ชนก',
          lastName: 'รับสปา',
          nickname: 'พิม',
          emailPrefix: 'pimchanok.rec',
          positionNameEn: 'Spa Receptionist',
          gender: 'FEMALE',
          dateOfBirth: new Date('1998-08-22'),
          employmentType: 'FULLTIME',
          baseSalary: 15000,
          initialSalary: 13500,
          allowance: 1500,
          overtime: 800,
          positionBonus: 0,
          bankName: 'GSB',
        },
      ],
    };

    const deptCodes = Object.keys(employeeTemplatesByDept);
    let totalCreated = 0;

    for (const tenant of allTenants) {
      this.logger.log(`  🏨 Seeding employees for tenant: ${tenant.name}`);

      const property = await this.prisma.property.findFirst({ where: { tenantId: tenant.id } });

      // Find all departments for this tenant
      const departments = await this.prisma.hrDepartment.findMany({
        where: { tenantId: tenant.id, code: { in: deptCodes } },
      });

      if (departments.length === 0) {
        this.logger.warn(
          `    ⚠️ No HR departments found for ${tenant.name}, run seedHrMasterData first`,
        );
        continue;
      }

      const deptMap = new Map(departments.map((d) => [d.code, d]));
      let tenantCount = 0;

      for (const [deptCode, templates] of Object.entries(employeeTemplatesByDept)) {
        const dept = deptMap.get(deptCode);
        if (!dept) continue;

        for (const tmpl of templates) {
          const email = `${tmpl.emailPrefix}@${tenant.id.slice(0, 8)}.hotel`;

          // Look up position
          const position = await this.prisma.hrPosition.findFirst({
            where: { tenantId: tenant.id, departmentId: dept.id, nameEn: tmpl.positionNameEn },
          });

          // Upsert employee (unique on tenantId + email)
          const existing = await (this.prisma as any).employee.findFirst({
            where: { tenantId: tenant.id, email },
          });

          const employeeData = {
            tenantId: tenant.id,
            firstName: tmpl.firstName,
            lastName: tmpl.lastName,
            nickname: tmpl.nickname,
            phone: `08${Math.floor(Math.random() * 10)}-${Math.floor(100 + Math.random() * 900)}-${Math.floor(1000 + Math.random() * 9000)}`,
            email,
            employeeCode: `${tmpl.codePrefix}`,
            department: dept.name,
            position: position?.name ?? tmpl.positionNameEn,
            departmentId: dept.id,
            positionId: position?.id ?? null,
            propertyId: property?.id ?? null,
            baseSalary: tmpl.baseSalary,
            initialSalary: tmpl.initialSalary,
            allowance: tmpl.allowance,
            overtime: tmpl.overtime,
            positionBonus: tmpl.positionBonus,
            bankName: tmpl.bankName,
            gender: tmpl.gender,
            dateOfBirth: tmpl.dateOfBirth,
            employmentType: tmpl.employmentType,
            status: 'ACTIVE',
          };

          if (existing) {
            await (this.prisma as any).employee.update({
              where: { id: existing.id },
              data: employeeData,
            });
          } else {
            await (this.prisma as any).employee.create({
              data: { ...employeeData, startDate: new Date('2024-01-01') },
            });
            tenantCount++;
            totalCreated++;
          }
        }
      }

      this.logger.log(`    ✓ ${tenantCount} new employees created for ${tenant.name}`);
    }

    this.logger.log(
      `✅ Employee seeding complete — ${totalCreated} new employees across all tenants`,
    );
  }

  /**
   * Seed HR Performance reviews for premium.test@email.com (Mountain View Resort).
   * Creates one review per employee for the most recent completed quarter with
   * realistic Thai-hotel scoring data.
   */
  private async seedHrPerformanceData(): Promise<void> {
    this.logger.log('📊 Seeding HR Performance Data (Mountain View Resort)...');

    const ownerUser = await this.prisma.user.findUnique({
      where: { email: 'premium.test@email.com' },
    });
    if (!ownerUser?.tenantId) {
      this.logger.warn('  ⚠️  premium.test@email.com not found — skipping performance seed');
      return;
    }
    const tenantId = ownerUser.tenantId;

    const employees = await (this.prisma as any).employee.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, firstName: true, lastName: true },
    });

    if (employees.length === 0) {
      this.logger.warn('  ⚠️  No employees found — skipping performance seed');
      return;
    }

    // Determine the most-recently completed quarter
    const now = new Date();
    const curQ = Math.floor(now.getMonth() / 3) + 1; // 1-4
    let targetQ = curQ - 1;
    let targetYear = now.getFullYear();
    if (targetQ === 0) {
      targetQ = 4;
      targetYear -= 1;
    }
    const period = `${targetYear}-Q${targetQ}`;

    // Quarter end dates for reviewDate
    const qEndMonths: Record<number, number> = { 1: 2, 2: 5, 3: 8, 4: 11 }; // 0-indexed months
    const reviewDate = new Date(targetYear, qEndMonths[targetQ], 28);

    // Per-employee score profiles (cycling if more employees than profiles)
    const scoreProfiles = [
      {
        work: 92,
        attendance: 95,
        teamwork: 88,
        service: 90,
        status: 'approved',
        strengths: 'ทำงานได้ดีเยี่ยม มีความรับผิดชอบสูง บริการแขกได้อย่างมืออาชีพ',
        improvements: 'ควรพัฒนาทักษะภาษาอังกฤษเพิ่มเติม',
        goals: 'เป้าหมาย UPSELL rate 15% ในไตรมาสหน้า',
      },
      {
        work: 78,
        attendance: 82,
        teamwork: 85,
        service: 80,
        status: 'approved',
        strengths: 'ทำงานเป็นทีมได้ดี มีความสามัคคี',
        improvements: 'ควรพัฒนาความรวดเร็วในการทำงาน',
        goals: 'เพิ่มคะแนน guest satisfaction 5%',
      },
      {
        work: 88,
        attendance: 90,
        teamwork: 92,
        service: 86,
        status: 'approved',
        strengths: 'สื่อสารกับแขกได้ดี ยิ้มแย้มแจ่มใสเสมอ',
        improvements: 'ควรเรียนรู้ระบบ PMS เพิ่มเติม',
        goals: 'ผ่านการอบรม front desk excellence',
      },
      {
        work: 65,
        attendance: 70,
        teamwork: 72,
        service: 68,
        status: 'submitted',
        strengths: 'มีความพยายามและตั้งใจทำงาน',
        improvements: 'ควรปรับปรุงเรื่องเวลาการทำงาน ลดการมาสาย',
        goals: 'ลดอัตราการมาสายให้เหลือ 0% ในไตรมาสหน้า',
      },
      {
        work: 95,
        attendance: 98,
        teamwork: 94,
        service: 96,
        status: 'approved',
        strengths: 'พนักงานดีเด่น ทำงานได้ครบถ้วน รวดเร็ว และถูกต้อง',
        improvements: 'สามารถพัฒนาทักษะผู้นำทีมได้มากขึ้น',
        goals: 'เป็น mentor ให้พนักงานใหม่',
      },
      {
        work: 75,
        attendance: 80,
        teamwork: 78,
        service: 76,
        status: 'approved',
        strengths: 'มีความรู้ด้านอาหารและเครื่องดื่มดี',
        improvements: 'ควรพัฒนาการสื่อสารกับแขกต่างชาติ',
        goals: 'เรียนภาษาอังกฤษอย่างน้อย 1 คอร์ส',
      },
      {
        work: 82,
        attendance: 85,
        teamwork: 80,
        service: 84,
        status: 'submitted',
        strengths: 'ทักษะเทคนิคดี รู้จักระบบดี',
        improvements: 'ควรพัฒนา soft skill การบริการ',
        goals: 'ผ่านการอบรม customer excellence',
      },
      {
        work: 70,
        attendance: 75,
        teamwork: 73,
        service: 72,
        status: 'draft',
        strengths: 'มีความอดทนในการทำงาน',
        improvements: 'ควรปรับปรุงคุณภาพงาน',
        goals: 'เพิ่มคะแนนคุณภาพงาน 10%',
      },
      {
        work: 88,
        attendance: 92,
        teamwork: 87,
        service: 89,
        status: 'approved',
        strengths: 'บริการแขกได้อย่างยอดเยี่ยม มีทักษะการขายดี',
        improvements: 'ควรพัฒนาทักษะด้าน IT',
        goals: 'เพิ่มยอดขาย in-room dining 20%',
      },
      {
        work: 80,
        attendance: 83,
        teamwork: 82,
        service: 81,
        status: 'approved',
        strengths: 'ทำงานสม่ำเสมอและน่าเชื่อถือ',
        improvements: 'ควรริเริ่มสิ่งใหม่มากขึ้น',
        goals: 'เสนอโปรเจ็กต์ใหม่อย่างน้อย 1 อย่าง',
      },
    ];

    function deriveGrade(score: number): string {
      if (score >= 90) return 'A';
      if (score >= 80) return 'B+';
      if (score >= 70) return 'B';
      if (score >= 60) return 'C+';
      if (score >= 50) return 'C';
      return 'D';
    }

    let createdCount = 0;
    for (let i = 0; i < employees.length; i++) {
      const emp = employees[i];
      const profile = scoreProfiles[i % scoreProfiles.length];
      const scoreOverall =
        Math.round(
          (profile.work * 0.3 +
            profile.attendance * 0.2 +
            profile.teamwork * 0.2 +
            profile.service * 0.3) *
            100,
        ) / 100;
      const grade = deriveGrade(scoreOverall);

      // ตรวจสอบ unique constraint ใหม่: (employeeId, period, cycleId=null) สำหรับ legacy records
      const existing = await (this.prisma as any).hrPerformance.findFirst({
        where: { tenantId, employeeId: emp.id, period, cycleId: null },
      });
      if (!existing) {
        await (this.prisma as any).hrPerformance.create({
          data: {
            tenantId,
            employeeId: emp.id,
            cycleId: null, // legacy record — ไม่ผ่าน Cycle
            templateId: null, // legacy record — ใช้ fixed scores
            period,
            periodType: 'quarterly',
            reviewDate,
            reviewerName: 'ผู้จัดการ HR',
            scoreWork: profile.work,
            scoreAttendance: profile.attendance,
            scoreTeamwork: profile.teamwork,
            scoreService: profile.service,
            scoreOverall,
            grade,
            status: profile.status,
            strengths: profile.strengths,
            improvements: profile.improvements,
            goals: profile.goals,
            ...(profile.status === 'approved' ? { approvedAt: new Date() } : {}),
          },
        });
        createdCount++;
      }
    }
    this.logger.log(`  ✓ ${createdCount} performance records created for period ${period}`);
    this.logger.log('✅ HR Performance Data seeded successfully!');
  }

  // ─────────────────────────────────────────────────────────────────────────────
  /**
   * Seed KPI Templates (system defaults — isDefault = true, tenantId = null)
   * ครอบคลุม 6 แผนกหลักของโรงแรม:
   *   Front Desk / Housekeeping / F&B / Kitchen / Maintenance / HR
   * แต่ละ template มี 5 KPI items ที่น้ำหนักรวม = 100%
   * idempotent: ข้ามถ้า template ชื่อเดิมมีอยู่แล้ว (isDefault = true)
   */
  private async seedKpiTemplates(): Promise<void> {
    this.logger.log('🎯 Seeding KPI Templates...');

    interface KpiItemSeed {
      name: string;
      nameEn: string;
      description: string;
      weight: number;
      sortOrder: number;
    }

    interface KpiTemplateSeed {
      name: string;
      nameEn: string;
      departmentCode: string;
      periodType: string;
      description: string;
      items: KpiItemSeed[];
    }

    const templates: KpiTemplateSeed[] = [
      // ── Front Desk ──────────────────────────────────────────────────────────
      {
        name: 'พนักงานต้อนรับ (Front Desk)',
        nameEn: 'Front Desk KPI',
        departmentCode: 'FD',
        periodType: 'quarterly',
        description: 'เกณฑ์ประเมินสำหรับพนักงานต้อนรับ เน้นการบริการแขกและความรวดเร็ว',
        items: [
          {
            name: 'คุณภาพการบริการแขก',
            nameEn: 'Guest Service Quality',
            description: 'ความพึงพอใจของแขกจาก feedback และ guest score',
            weight: 30,
            sortOrder: 1,
          },
          {
            name: 'ความตรงต่อเวลา',
            nameEn: 'Punctuality & Attendance',
            description: 'อัตราการมาทำงานตรงเวลา ไม่ขาดงานโดยไม่มีเหตุผล',
            weight: 20,
            sortOrder: 2,
          },
          {
            name: 'ความรู้ด้านระบบ PMS',
            nameEn: 'PMS & System Knowledge',
            description: 'ความสามารถใช้ระบบ PMS check-in/out, booking management',
            weight: 20,
            sortOrder: 3,
          },
          {
            name: 'ทักษะสื่อสาร',
            nameEn: 'Communication Skills',
            description: 'ทักษะภาษาและการสื่อสารกับแขกชาวไทยและต่างชาติ',
            weight: 20,
            sortOrder: 4,
          },
          {
            name: 'การทำงานเป็นทีม',
            nameEn: 'Teamwork & Collaboration',
            description: 'ความร่วมมือกับเพื่อนร่วมงาน ส่งต่องานได้อย่างราบรื่น',
            weight: 10,
            sortOrder: 5,
          },
        ],
      },
      // ── Housekeeping ────────────────────────────────────────────────────────
      {
        name: 'แม่บ้าน (Housekeeping)',
        nameEn: 'Housekeeping KPI',
        departmentCode: 'HK',
        periodType: 'quarterly',
        description: 'เกณฑ์ประเมินสำหรับแม่บ้านและหัวหน้าแม่บ้าน เน้นคุณภาพและความเร็ว',
        items: [
          {
            name: 'คุณภาพการทำความสะอาด',
            nameEn: 'Cleaning Quality',
            description: 'ผลการตรวจห้องพักโดย supervisor มาตรฐาน 5 stars',
            weight: 35,
            sortOrder: 1,
          },
          {
            name: 'ความเร็วในการทำห้อง',
            nameEn: 'Room Turnaround Speed',
            description: 'เวลาเฉลี่ยการทำห้องเทียบกับมาตรฐาน SLA',
            weight: 25,
            sortOrder: 2,
          },
          {
            name: 'ความตรงต่อเวลา',
            nameEn: 'Punctuality & Attendance',
            description: 'อัตราการมาทำงานตรงเวลา ไม่ขาดงานโดยไม่มีเหตุผล',
            weight: 20,
            sortOrder: 3,
          },
          {
            name: 'การใช้สินค้าคงคลัง',
            nameEn: 'Inventory Management',
            description: 'การใช้ amenities และ supplies อย่างประหยัดและถูกต้อง',
            weight: 10,
            sortOrder: 4,
          },
          {
            name: 'ทัศนคติและความร่วมมือ',
            nameEn: 'Attitude & Teamwork',
            description: 'ความสุภาพต่อแขก ทัศนคติดี ทำงานร่วมกับทีมได้ดี',
            weight: 10,
            sortOrder: 5,
          },
        ],
      },
      // ── F&B Service ─────────────────────────────────────────────────────────
      {
        name: 'พนักงานเสิร์ฟ (F&B Service)',
        nameEn: 'F&B Service KPI',
        departmentCode: 'FB',
        periodType: 'quarterly',
        description: 'เกณฑ์ประเมินสำหรับพนักงานร้านอาหารและบาร์',
        items: [
          {
            name: 'การบริการลูกค้า',
            nameEn: 'Customer Service',
            description: 'คะแนน feedback จากลูกค้า ความรวดเร็ว ความสุภาพ',
            weight: 30,
            sortOrder: 1,
          },
          {
            name: 'ความรู้เมนูและเครื่องดื่ม',
            nameEn: 'Menu & Beverage Knowledge',
            description: 'ความสามารถแนะนำเมนู อธิบาย ingredients ได้ถูกต้อง',
            weight: 25,
            sortOrder: 2,
          },
          {
            name: 'ความตรงต่อเวลา',
            nameEn: 'Punctuality & Attendance',
            description: 'อัตราการมาทำงานตรงเวลา ไม่ขาดงานโดยไม่มีเหตุผล',
            weight: 20,
            sortOrder: 3,
          },
          {
            name: 'ยอดขาย Upsell',
            nameEn: 'Upsell Performance',
            description: 'ยอดขาย upsell เครื่องดื่มพรีเมียมและ dessert เทียบกับ target',
            weight: 15,
            sortOrder: 4,
          },
          {
            name: 'มาตรฐานความสะอาด',
            nameEn: 'Hygiene Standards',
            description: 'การรักษาความสะอาดสถานที่ อุปกรณ์ และ uniform',
            weight: 10,
            sortOrder: 5,
          },
        ],
      },
      // ── Kitchen ─────────────────────────────────────────────────────────────
      {
        name: 'ครัว (Kitchen)',
        nameEn: 'Kitchen / Chef KPI',
        departmentCode: 'KT',
        periodType: 'quarterly',
        description: 'เกณฑ์ประเมินสำหรับพ่อครัวและผู้ช่วย',
        items: [
          {
            name: 'คุณภาพอาหาร',
            nameEn: 'Food Quality',
            description: 'มาตรฐานรสชาติ การจัดจาน ตรงกับ recipe specification',
            weight: 35,
            sortOrder: 1,
          },
          {
            name: 'มาตรฐานสุขอนามัย',
            nameEn: 'Food Safety & Hygiene',
            description: 'การปฏิบัติตาม food safety standard HACCP',
            weight: 25,
            sortOrder: 2,
          },
          {
            name: 'ความเร็วในการปรุงอาหาร',
            nameEn: 'Cooking Speed',
            description: 'เวลาส่งอาหารเทียบกับ SLA ของร้าน',
            weight: 20,
            sortOrder: 3,
          },
          {
            name: 'การจัดการวัตถุดิบ',
            nameEn: 'Ingredient Management',
            description: 'การใช้วัตถุดิบอย่างประหยัด ลด food waste',
            weight: 10,
            sortOrder: 4,
          },
          {
            name: 'การทำงานเป็นทีม',
            nameEn: 'Teamwork',
            description: 'ความร่วมมือในครัว รับผิดชอบหน้าที่ของตัวเอง',
            weight: 10,
            sortOrder: 5,
          },
        ],
      },
      // ── Maintenance ─────────────────────────────────────────────────────────
      {
        name: 'ซ่อมบำรุง (Maintenance)',
        nameEn: 'Maintenance KPI',
        departmentCode: 'MT',
        periodType: 'quarterly',
        description: 'เกณฑ์ประเมินสำหรับช่างซ่อมบำรุงและทีม engineering',
        items: [
          {
            name: 'ความเร็วในการซ่อม',
            nameEn: 'Repair Response Time',
            description: 'เวลาตั้งแต่รับ work order ถึงเสร็จเทียบกับ SLA',
            weight: 30,
            sortOrder: 1,
          },
          {
            name: 'คุณภาพงานซ่อม',
            nameEn: 'Repair Quality',
            description: 'อัตราการกลับมาซ่อมซ้ำ (ต่ำ = ดี) และคุณภาพผลงาน',
            weight: 30,
            sortOrder: 2,
          },
          {
            name: 'ความตรงต่อเวลา',
            nameEn: 'Punctuality & Attendance',
            description: 'อัตราการมาทำงานตรงเวลา พร้อมรับ on-call',
            weight: 20,
            sortOrder: 3,
          },
          {
            name: 'การบำรุงรักษาเชิงป้องกัน',
            nameEn: 'Preventive Maintenance',
            description: 'ความสม่ำเสมอในการทำ PM schedule ตามแผน',
            weight: 10,
            sortOrder: 4,
          },
          {
            name: 'ความปลอดภัย',
            nameEn: 'Safety Compliance',
            description: 'การปฏิบัติตามมาตรฐานความปลอดภัยในการทำงาน',
            weight: 10,
            sortOrder: 5,
          },
        ],
      },
      // ── HR / Admin ──────────────────────────────────────────────────────────
      {
        name: 'HR และธุรการ',
        nameEn: 'HR & Administration KPI',
        departmentCode: 'HR',
        periodType: 'quarterly',
        description: 'เกณฑ์ประเมินสำหรับทีม HR และธุรการ',
        items: [
          {
            name: 'ความถูกต้องของเอกสาร',
            nameEn: 'Documentation Accuracy',
            description: 'ความถูกต้องครบถ้วนของเอกสาร HR สัญญาจ้าง payroll',
            weight: 30,
            sortOrder: 1,
          },
          {
            name: 'ความตรงต่อเวลา',
            nameEn: 'Punctuality & Attendance',
            description: 'อัตราการมาทำงานตรงเวลา ไม่ขาดงานโดยไม่มีเหตุผล',
            weight: 20,
            sortOrder: 2,
          },
          {
            name: 'การพัฒนาบุคลากร',
            nameEn: 'Employee Development',
            description: 'จัดการฝึกอบรม orientation และ development program ได้ตามแผน',
            weight: 20,
            sortOrder: 3,
          },
          {
            name: 'ความพึงพอใจพนักงาน',
            nameEn: 'Employee Satisfaction',
            description: 'ผลสำรวจ engagement score ของทีม',
            weight: 20,
            sortOrder: 4,
          },
          {
            name: 'การทำงานเชิงรุก',
            nameEn: 'Proactiveness',
            description: 'ริเริ่มปรับปรุง process หรือเสนอ initiative ใหม่',
            weight: 10,
            sortOrder: 5,
          },
        ],
      },
    ];

    let templatesCreated = 0;
    let itemsCreated = 0;

    for (const tpl of templates) {
      // idempotent check — ข้ามถ้ามีชื่อเดิมอยู่แล้วใน system defaults
      const existing = await (this.prisma as any).hrKpiTemplate.findFirst({
        where: { name: tpl.name, tenantId: null, isDefault: true },
      });

      if (existing) {
        this.logger.log(`  ↷ Skipped (already exists): ${tpl.name}`);
        continue;
      }

      await (this.prisma as any).hrKpiTemplate.create({
        data: {
          tenantId: null,
          name: tpl.name,
          nameEn: tpl.nameEn,
          departmentCode: tpl.departmentCode,
          periodType: tpl.periodType,
          description: tpl.description,
          isDefault: true,
          isActive: true,
          sortOrder: templatesCreated,
          items: {
            create: tpl.items.map((item) => ({
              name: item.name,
              nameEn: item.nameEn,
              description: item.description,
              weight: item.weight,
              minScore: 0,
              maxScore: 100,
              sortOrder: item.sortOrder,
            })),
          },
        },
      });

      templatesCreated++;
      itemsCreated += tpl.items.length;
      this.logger.log(`  ✓ ${tpl.name} (${tpl.items.length} KPI items)`);
    }

    this.logger.log(
      `✅ KPI Templates seeded: ${templatesCreated} templates, ${itemsCreated} items`,
    );
  }

  /**
   * 15️⃣ Seed Restaurant & POS demo data for Mountain View Resort (premium.test@email.com)
   *
   * Creates:
   *  - 1 Restaurant (Main Restaurant — CASUAL)
   *  - 1 Bar (Lobby Bar — BAR)
   *  - Tables for both venues (numbered, with zone layout)
   *  - Menu categories: อาหารเช้า, อาหารจานหลัก, ของหวาน, เครื่องดื่ม, ค็อกเทล
   *  - ~25 menu items with realistic Thai prices
   *
   * All records are idempotent — safe to run multiple times via db:refresh.
   */
  private async seedRestaurantData(): Promise<void> {
    this.logger.log('🍽️  Seeding Restaurant & POS demo data (Mountain View Resort)...');

    // ── Look up premium tenant ─────────────────────────────────────────────
    const ownerUser = await this.prisma.user.findUnique({
      where: { email: 'premium.test@email.com' },
    });
    if (!ownerUser?.tenantId) {
      this.logger.warn('  ⚠️  premium.test@email.com not found, skipping restaurant seed');
      return;
    }
    const tenantId = ownerUser.tenantId;

    const property = await this.prisma.property.findFirst({ where: { tenantId } });
    const propertyId = property?.id ?? null;

    // ── Helper: upsert restaurant by code ────────────────────────────────────
    const upsertRestaurant = async (data: {
      code: string;
      name: string;
      type: string;
      description?: string;
      location?: string;
      capacity?: number;
      openTime?: string;
      closeTime?: string;
    }) => {
      const existing = await this.prisma.restaurant.findUnique({ where: { code: data.code } });
      if (existing) return existing;
      return this.prisma.restaurant.create({
        data: {
          tenantId,
          propertyId,
          code: data.code,
          name: data.name,
          type: data.type as any,
          description: data.description,
          location: data.location,
          capacity: data.capacity,
          openTime: data.openTime,
          closeTime: data.closeTime,
          isActive: true,
        },
      });
    };

    // ── 1. Create venues ──────────────────────────────────────────────────────
    const mainRestaurant = await upsertRestaurant({
      code: 'MVR-MAIN',
      name: 'Mountain View Restaurant',
      type: 'CASUAL',
      description: 'ร้านอาหารหลักของ Mountain View Resort เสิร์ฟอาหารไทยและนานาชาติ',
      location: 'ชั้น 1 อาคารหลัก',
      capacity: 80,
      openTime: '06:00',
      closeTime: '22:00',
    });

    const lobbyBar = await upsertRestaurant({
      code: 'MVR-BAR',
      name: 'Summit Lobby Bar',
      type: 'BAR',
      description: 'บาร์บรรยากาศสบาย วิวภูเขา เครื่องดื่มคัดสรร',
      location: 'ล็อบบี้ ชั้น 1',
      capacity: 30,
      openTime: '10:00',
      closeTime: '00:00',
    });

    // ── 2. Create tables ──────────────────────────────────────────────────────
    const existingTables = await this.prisma.restaurantTable.count({
      where: { tenantId, restaurantId: mainRestaurant.id },
    });

    if (existingTables === 0) {
      const mainTables = [
        // Zone: Indoor
        {
          tableNumber: 'A1',
          capacity: 2,
          zone: 'Indoor',
          shape: 'SQUARE',
          positionX: 1,
          positionY: 1,
        },
        {
          tableNumber: 'A2',
          capacity: 2,
          zone: 'Indoor',
          shape: 'SQUARE',
          positionX: 2,
          positionY: 1,
        },
        {
          tableNumber: 'A3',
          capacity: 4,
          zone: 'Indoor',
          shape: 'RECTANGLE',
          positionX: 3,
          positionY: 1,
        },
        {
          tableNumber: 'A4',
          capacity: 4,
          zone: 'Indoor',
          shape: 'RECTANGLE',
          positionX: 4,
          positionY: 1,
        },
        {
          tableNumber: 'B1',
          capacity: 6,
          zone: 'Indoor',
          shape: 'RECTANGLE',
          positionX: 1,
          positionY: 2,
        },
        {
          tableNumber: 'B2',
          capacity: 6,
          zone: 'Indoor',
          shape: 'RECTANGLE',
          positionX: 2,
          positionY: 2,
        },
        {
          tableNumber: 'B3',
          capacity: 8,
          zone: 'Indoor',
          shape: 'RECTANGLE',
          positionX: 3,
          positionY: 2,
        },
        // Zone: Terrace
        {
          tableNumber: 'T1',
          capacity: 2,
          zone: 'Terrace',
          shape: 'ROUND',
          positionX: 1,
          positionY: 4,
        },
        {
          tableNumber: 'T2',
          capacity: 2,
          zone: 'Terrace',
          shape: 'ROUND',
          positionX: 2,
          positionY: 4,
        },
        {
          tableNumber: 'T3',
          capacity: 4,
          zone: 'Terrace',
          shape: 'ROUND',
          positionX: 3,
          positionY: 4,
        },
        {
          tableNumber: 'T4',
          capacity: 4,
          zone: 'Terrace',
          shape: 'ROUND',
          positionX: 4,
          positionY: 4,
        },
        // Zone: Private Dining
        {
          tableNumber: 'P1',
          capacity: 10,
          zone: 'Private',
          shape: 'OVAL',
          positionX: 1,
          positionY: 6,
        },
      ];

      await this.prisma.restaurantTable.createMany({
        data: mainTables.map((t) => ({
          id: uuidv4(),
          tenantId,
          restaurantId: mainRestaurant.id,
          tableNumber: t.tableNumber,
          capacity: t.capacity,
          zone: t.zone,
          shape: t.shape as any,
          positionX: t.positionX,
          positionY: t.positionY,
          isActive: true,
        })),
      });
      this.logger.log(`  ✓ Created ${mainTables.length} tables for ${mainRestaurant.name}`);
    } else {
      this.logger.log(`  ⊙ Tables already exist for ${mainRestaurant.name}, skipping`);
    }

    const existingBarTables = await this.prisma.restaurantTable.count({
      where: { tenantId, restaurantId: lobbyBar.id },
    });

    if (existingBarTables === 0) {
      const barTables = [
        { tableNumber: 'BAR1', capacity: 2, zone: 'Bar Counter', shape: 'RECTANGLE' },
        { tableNumber: 'BAR2', capacity: 2, zone: 'Bar Counter', shape: 'RECTANGLE' },
        { tableNumber: 'L1', capacity: 4, zone: 'Lounge', shape: 'ROUND' },
        { tableNumber: 'L2', capacity: 4, zone: 'Lounge', shape: 'ROUND' },
        { tableNumber: 'L3', capacity: 2, zone: 'Lounge', shape: 'ROUND' },
      ];

      await this.prisma.restaurantTable.createMany({
        data: barTables.map((t) => ({
          id: uuidv4(),
          tenantId,
          restaurantId: lobbyBar.id,
          tableNumber: t.tableNumber,
          capacity: t.capacity,
          zone: t.zone,
          shape: t.shape as any,
          isActive: true,
        })),
      });
      this.logger.log(`  ✓ Created ${barTables.length} tables for ${lobbyBar.name}`);
    } else {
      this.logger.log(`  ⊙ Tables already exist for ${lobbyBar.name}, skipping`);
    }

    // ── 3. Create Menu Categories ─────────────────────────────────────────────
    const existingCats = await this.prisma.menuCategory.count({
      where: { tenantId, restaurantId: mainRestaurant.id },
    });

    if (existingCats > 0) {
      this.logger.log(`  ⊙ Menu categories already exist, skipping`);
      return;
    }

    const categorySeed = [
      {
        name: 'อาหารเช้า',
        description: 'เมนูอาหารเช้าเสิร์ฟเวลา 06:00-10:30 น.',
        displayOrder: 1,
        items: [
          {
            name: 'ข้าวต้มปลา',
            description: 'ข้าวต้มปลาช่อนสด ขิง ต้นหอม น้ำปลา',
            price: 120,
            preparationTime: 10,
            isAvailable: true,
          },
          {
            name: 'โจ๊กหมูสับ',
            description: 'โจ๊กข้าวหอมมะลิ หมูสับนุ่ม ขิง ต้นหอม',
            price: 110,
            preparationTime: 8,
            isAvailable: true,
          },
          {
            name: 'ไข่กระทะ',
            description: 'ไข่ดาว 2 ฟอง เสิร์ฟพร้อมขนมปังปิ้ง แยม เนย',
            price: 90,
            preparationTime: 7,
            isAvailable: true,
          },
          {
            name: 'American Breakfast',
            description: 'ไข่คน เบคอน ไส้กรอก มะเขือเทศ เห็ด ถั่วอบ',
            price: 280,
            preparationTime: 15,
            isAvailable: true,
          },
          {
            name: 'Continental Breakfast',
            description: 'ขนมปังปิ้ง ครัวซองต์ ผลไม้ โยเกิร์ต',
            price: 220,
            preparationTime: 5,
            isAvailable: true,
          },
        ],
      },
      {
        name: 'อาหารจานหลัก',
        description: 'อาหารไทยและนานาชาติ',
        displayOrder: 2,
        items: [
          {
            name: 'ผัดไทยกุ้งสด',
            description: 'ผัดไทยกุ้งแม่น้ำสด เส้นจันทร์ ถั่วงอก ต้นหอม',
            price: 220,
            preparationTime: 15,
            isSpicy: false,
            isAvailable: true,
          },
          {
            name: 'ต้มยำกุ้ง',
            description: 'ต้มยำกุ้งน้ำข้น กุ้งแม่น้ำ เห็ดฟาง ตะไคร้ ใบมะกรูด',
            price: 280,
            preparationTime: 20,
            isSpicy: true,
            spicyLevel: 3,
            isAvailable: true,
          },
          {
            name: 'แกงเขียวหวานไก่',
            description: 'แกงเขียวหวานไก่บ้าน กะทิสด มะเขือเปราะ',
            price: 180,
            preparationTime: 20,
            isSpicy: true,
            spicyLevel: 2,
            isAvailable: true,
          },
          {
            name: 'ข้าวมันไก่',
            description: 'ข้าวมันไก่ต้มซอสขิง น้ำซุปใส แตงกวา ต้นหอม',
            price: 160,
            preparationTime: 12,
            isAvailable: true,
          },
          {
            name: 'สเต็กเนื้อออสเตรเลีย',
            description: 'เนื้อออสเตรเลีย 200g ย่างตามสั่ง มันฝรั่งบด ผักย่าง',
            price: 580,
            preparationTime: 25,
            isAvailable: true,
          },
          {
            name: 'Grilled Salmon',
            description: 'แซลมอนย่าง ซอส Lemon Dill เสิร์ฟพร้อมผักนึ่ง',
            price: 420,
            preparationTime: 20,
            isGlutenFree: true,
            isAvailable: true,
          },
        ],
      },
      {
        name: 'ของหวาน',
        description: 'ขนมหวานไทยและเดสเสิร์ตนานาชาติ',
        displayOrder: 3,
        items: [
          {
            name: 'ข้าวเหนียวมะม่วง',
            description: 'ข้าวเหนียวมะม่วงน้ำดอกไม้ กะทิสด งาขาว',
            price: 160,
            preparationTime: 5,
            isVegetarian: true,
            isAvailable: true,
          },
          {
            name: 'ทับทิมกรอบ',
            description: 'ทับทิมกรอบในน้ำกะทิ น้ำแข็ง',
            price: 120,
            preparationTime: 5,
            isVegetarian: true,
            isAvailable: true,
          },
          {
            name: 'Chocolate Lava Cake',
            description: 'เค้กช็อกโกแลตหน้าละลาย ไอศกรีมวนิลา',
            price: 190,
            preparationTime: 15,
            isVegetarian: true,
            isAvailable: true,
          },
          {
            name: 'Crème Brûlée',
            description: 'คัสตาร์ดวนิลาหน้าน้ำตาลไหม้',
            price: 175,
            preparationTime: 3,
            isVegetarian: true,
            isGlutenFree: true,
            isAvailable: true,
          },
        ],
      },
      {
        name: 'เครื่องดื่ม',
        description: 'เครื่องดื่มร้อน เย็น และผลไม้ปั่น',
        displayOrder: 4,
        restaurantId: mainRestaurant.id,
        items: [
          {
            name: 'ชาไทยเย็น',
            description: 'ชาไทยเข้มข้น นมข้น น้ำแข็ง',
            price: 80,
            preparationTime: 3,
            isVegetarian: true,
            isAvailable: true,
          },
          {
            name: 'กาแฟดำร้อน',
            description: 'เอสเปรสโซ่คัดพิเศษจากดอยช้าง',
            price: 90,
            preparationTime: 5,
            isVegetarian: true,
            isAvailable: true,
          },
          {
            name: 'Latte',
            description: 'เอสเปรสโซ่ + นมสด ตามสั่งร้อน/เย็น',
            price: 120,
            preparationTime: 5,
            isVegetarian: true,
            isAvailable: true,
          },
          {
            name: 'น้ำผลไม้ปั่นสด',
            description: 'เลือกได้: สตรอว์เบอรี่ มะม่วง ฝรั่ง ส้ม',
            price: 110,
            preparationTime: 5,
            isVegetarian: true,
            isVegan: true,
            isGlutenFree: true,
            isAvailable: true,
          },
          {
            name: 'มะพร้าวน้ำหอม',
            description: 'มะพร้าวน้ำหอมสด เนื้อมะพร้าวอ่อน',
            price: 90,
            preparationTime: 2,
            isVegetarian: true,
            isVegan: true,
            isGlutenFree: true,
            isAvailable: true,
          },
        ],
      },
    ];

    let categoryCount = 0;
    let itemCount = 0;

    for (const catData of categorySeed) {
      const category = await this.prisma.menuCategory.create({
        data: {
          tenantId,
          restaurantId: mainRestaurant.id,
          name: catData.name,
          description: catData.description,
          displayOrder: catData.displayOrder,
          isActive: true,
        },
      });
      categoryCount++;

      for (let i = 0; i < catData.items.length; i++) {
        const item = catData.items[i];
        await this.prisma.menuItem.create({
          data: {
            tenantId,
            restaurantId: mainRestaurant.id,
            categoryId: category.id,
            name: item.name,
            description: item.description,
            price: item.price,
            preparationTime: item.preparationTime,
            isVegetarian: (item as any).isVegetarian ?? false,
            isVegan: (item as any).isVegan ?? false,
            isGlutenFree: (item as any).isGlutenFree ?? false,
            isSpicy: (item as any).isSpicy ?? false,
            spicyLevel: (item as any).spicyLevel ?? null,
            isAvailable: item.isAvailable,
            displayOrder: i + 1,
          },
        });
        itemCount++;
      }
    }

    // ── Bar menu ──────────────────────────────────────────────────────────────
    const existingBarCats = await this.prisma.menuCategory.count({
      where: { tenantId, restaurantId: lobbyBar.id },
    });

    if (existingBarCats === 0) {
      const barCocktails = await this.prisma.menuCategory.create({
        data: {
          tenantId,
          restaurantId: lobbyBar.id,
          name: 'ค็อกเทลและเครื่องดื่มแอลกอฮอล์',
          description: 'ค็อกเทลทำสด ไวน์ เบียร์ สปิริต',
          displayOrder: 1,
          isActive: true,
        },
      });
      categoryCount++;

      const barItems = [
        {
          name: 'Mountain Breeze',
          description: 'Vodka, Blue Curacao, Lime Juice, Soda',
          price: 280,
          preparationTime: 5,
        },
        {
          name: 'Thai Mojito',
          description: 'White Rum, Mint, Lime, Lemongrass, Soda',
          price: 260,
          preparationTime: 7,
        },
        {
          name: 'Sunset Spritz',
          description: 'Aperol, Prosecco, Orange Slice',
          price: 320,
          preparationTime: 5,
        },
        {
          name: 'เบียร์สด (Chang / Singha)',
          description: 'เบียร์สดแก้วใหญ่ เย็นสดชื่น',
          price: 120,
          preparationTime: 2,
        },
        {
          name: 'House Wine (แดง/ขาว)',
          description: 'House wine แก้ว เลือกแดงหรือขาว',
          price: 220,
          preparationTime: 1,
        },
      ];

      for (let i = 0; i < barItems.length; i++) {
        const item = barItems[i];
        await this.prisma.menuItem.create({
          data: {
            tenantId,
            restaurantId: lobbyBar.id,
            categoryId: barCocktails.id,
            name: item.name,
            description: item.description,
            price: item.price,
            preparationTime: item.preparationTime,
            isAvailable: true,
            displayOrder: i + 1,
          },
        });
        itemCount++;
      }
    }

    // ── POS staff accounts ────────────────────────────────────────────────────
    // Each staff member gets allowedSystems scoped to their role:
    //   waiter / chef / cashier → ["pos"] only
    //   manager (restaurant manager) → ["main","pos"]
    const posStaff = [
      {
        email: 'waiter1@mountainviewresort.test',
        firstName: 'สมชาย',
        lastName: 'ใจดี',
        role: 'waiter',
        employeeId: 'MVR-W001',
        allowedSystems: '["pos"]',
      },
      {
        email: 'waiter2@mountainviewresort.test',
        firstName: 'สมหญิง',
        lastName: 'รักงาน',
        role: 'waiter',
        employeeId: 'MVR-W002',
        allowedSystems: '["pos"]',
      },
      {
        email: 'chef1@mountainviewresort.test',
        firstName: 'วิชัย',
        lastName: 'ฝีมือดี',
        role: 'chef',
        employeeId: 'MVR-C001',
        allowedSystems: '["pos"]',
      },
      {
        email: 'cashier1@mountainviewresort.test',
        firstName: 'นภา',
        lastName: 'คล่องแคล่ว',
        role: 'cashier',
        employeeId: 'MVR-CA001',
        allowedSystems: '["pos"]',
      },
      {
        email: 'restaurant.manager@mountainviewresort.test',
        firstName: 'ประสิทธิ์',
        lastName: 'บริหารเก่ง',
        role: 'manager',
        employeeId: 'MVR-M001',
        allowedSystems: '["main","pos"]',
      },
    ];

    const hashedPosPassword = await bcrypt.hash('pos123456', 10);
    let posCreated = 0;
    let posUpdated = 0;

    for (const staff of posStaff) {
      const existing = await this.prisma.user.findUnique({ where: { email: staff.email } });
      if (!existing) {
        await this.prisma.user.create({
          data: {
            email: staff.email,
            password: hashedPosPassword,
            firstName: staff.firstName,
            lastName: staff.lastName,
            role: staff.role,
            employeeId: staff.employeeId,
            tenantId,
            status: 'active',
            allowedSystems: staff.allowedSystems,
          } as any,
        });
        posCreated++;
      } else {
        // Ensure allowedSystems is correct on re-seed
        await this.prisma.user.update({
          where: { id: existing.id },
          data: {
            tenantId,
            allowedSystems: staff.allowedSystems,
            password: hashedPosPassword,
          } as any,
        });
        posUpdated++;
      }
    }

    this.logger.log(
      `  ✓ POS staff: ${posCreated} created, ${posUpdated} updated` +
        ` (password: pos123456, systems: waiter/chef/cashier → POS only, manager → main+POS)`,
    );

    // ── Backfill allowedSystems for existing hotel owner/admins ───────────────
    // tenant_admin and manager (non-restaurant) who were created before this migration
    // should be allowed into both systems.
    await (this.prisma.user.updateMany as any)({
      where: {
        tenantId,
        role: { in: ['tenant_admin', 'manager', 'receptionist'] },
        allowedSystems: '["main"]', // only update users still on default
      },
      data: { allowedSystems: '["main","pos"]' },
    }).catch(() => {
      // allowedSystems column may not exist yet — ignore (will work after db:refresh)
    });

    this.logger.log(
      `✅ Restaurant seed complete: 2 venues, ${categoryCount} categories, ${itemCount} menu items`,
    );
  }

  /**
   * Clear all data (ระวัง! ใช้สำหรับ development เท่านั้น)
   */
  async clear(): Promise<void> {
    this.logger.warn('🗑️ Clearing all data...');
    this.logger.warn('⚠️ Clear function not implemented. Use migration revert instead.');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INVENTORY MANAGEMENT SEEDER
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Seed Inventory data for demo tenants that have INVENTORY_MODULE add-on.
   * Creates: item categories, inventory items, suppliers, warehouses,
   * room-type amenity templates, and demo stock balances.
   */
  private async seedInventoryData(): Promise<void> {
    this.logger.log('📦 Seeding Inventory data...');

    // Only seed for the premium demo tenant (SUB-002)
    const allTenants = await this.tenantsService.findAll();
    const tenant = allTenants.find(t => (t as any).name_en === 'Mountain View Resort' || (t as any).slug === 'mountain' || t.name === 'Mountain View Resort (Premium Test)');
    if (!tenant) {
      this.logger.warn('  ⚠️ Demo tenant (mountain) not found — skipping inventory seed');
      return;
    }

    const property = await this.prisma.property.findFirst({
      where: { tenantId: tenant.id },
    });
    if (!property) {
      this.logger.warn('  ⚠️ No property found for demo tenant — skipping inventory seed');
      return;
    }

    const tenantId = tenant.id;
    const propertyId = property.id;

    // ── 1. Item Categories (hierarchical) ────────────────────────────────────
    const categoryDefs = [
      { code: 'CAT-FB',    name: 'F&B วัตถุดิบ',        parentCode: null },
      { code: 'CAT-FB-DRY',name: 'ของแห้ง',              parentCode: 'CAT-FB' },
      { code: 'CAT-FB-VEG',name: 'ผักและผลไม้',           parentCode: 'CAT-FB' },
      { code: 'CAT-FB-BEV',name: 'เครื่องดื่ม',            parentCode: 'CAT-FB' },
      { code: 'CAT-ROOM',  name: 'ของใช้ห้องพัก',         parentCode: null },
      { code: 'CAT-ROOM-BED', name: 'ผ้าปูและผ้าห่ม',    parentCode: 'CAT-ROOM' },
      { code: 'CAT-ROOM-AMEN',name: 'Amenities',          parentCode: 'CAT-ROOM' },
      { code: 'CAT-CLEAN', name: 'น้ำยาทำความสะอาด',      parentCode: null },
      { code: 'CAT-MAINT', name: 'อุปกรณ์ซ่อมบำรุง',       parentCode: null },
    ];

    const categoryMap: Record<string, string> = {};
    for (const cat of categoryDefs) {
      const parentId = cat.parentCode ? categoryMap[cat.parentCode] : null;
      const existing = await this.prisma.itemCategory.findFirst({
        where: { tenantId, code: cat.code },
      });
      if (!existing) {
        const created = await this.prisma.itemCategory.create({
          data: { tenantId, code: cat.code, name: cat.name, parentId, isActive: true, sortOrder: 0 },
        });
        categoryMap[cat.code] = created.id;
        this.logger.log(`  ✓ Category: ${cat.name}`);
      } else {
        categoryMap[cat.code] = existing.id;
      }
    }

    // ── 2. Suppliers ─────────────────────────────────────────────────────────
    const supplierDefs = [
      {
        code: 'SUP-MAKRO',  name: 'แม็คโคร (Makro)', contactPerson: 'จัดซื้อส่วนกลาง',
        email: 'order@makro.co.th', phone: '02-999-9999', paymentTerms: 'NET30',
        leadTimeDays: 2,
      },
      {
        code: 'SUP-BIGC',   name: 'บิ๊กซี ซัพพลาย', contactPerson: 'ฝ่ายขายส่ง',
        email: 'wholesale@bigc.co.th', phone: '02-888-8888', paymentTerms: 'COD',
        leadTimeDays: 1,
      },
      {
        code: 'SUP-CLEAN',  name: 'บริษัท ซัพพลายคลีน จำกัด', contactPerson: 'คุณสมหวัง',
        email: 'sales@supplyclean.th', phone: '086-111-2222', paymentTerms: 'NET15',
        leadTimeDays: 3,
      },
      {
        code: 'SUP-HOTEL',  name: 'Hotel Amenities TH', contactPerson: 'คุณนารี',
        email: 'info@hotelamenities.th', phone: '088-555-6666', paymentTerms: 'NET30',
        leadTimeDays: 5,
      },
    ];

    const supplierMap: Record<string, string> = {};
    for (const sup of supplierDefs) {
      const existing = await this.prisma.supplier.findFirst({
        where: { tenantId, code: sup.code },
      });
      if (!existing) {
        const created = await this.prisma.supplier.create({
          data: { tenantId, ...sup, isActive: true },
        });
        supplierMap[sup.code] = created.id;
        this.logger.log(`  ✓ Supplier: ${sup.name}`);
      } else {
        supplierMap[sup.code] = existing.id;
      }
    }

    // ── 3. Warehouses ─────────────────────────────────────────────────────────
    const warehouseDefs = [
      { code: 'WH-MAIN',  name: 'คลังกลาง',       type: 'GENERAL',      isDefault: true },
      { code: 'WH-KITCH', name: 'คลังครัว',        type: 'KITCHEN',      isDefault: false },
      { code: 'WH-HK',    name: 'คลัง Housekeeping', type: 'HOUSEKEEPING', isDefault: false },
      { code: 'WH-MAINT', name: 'คลังช่างซ่อม',    type: 'MAINTENANCE',  isDefault: false },
    ];

    const warehouseMap: Record<string, string> = {};
    for (const wh of warehouseDefs) {
      const existing = await this.prisma.warehouse.findFirst({
        where: { tenantId, propertyId, code: wh.code },
      });
      if (!existing) {
        const created = await this.prisma.warehouse.create({
          data: { tenantId, propertyId, ...wh, type: wh.type as WarehouseType, isActive: true },
        });
        warehouseMap[wh.code] = created.id;
        this.logger.log(`  ✓ Warehouse: ${wh.name}`);
      } else {
        warehouseMap[wh.code] = existing.id;
      }
    }

    // ── 4. Inventory Items ────────────────────────────────────────────────────
    const itemDefs = [
      // Room Amenities
      {
        sku: 'SOAP-75G',   name: 'สบู่ก้อน 75g',         catCode: 'CAT-ROOM-AMEN', unit: 'PIECE',
        reorderPoint: 200, reorderQty: 500, minStock: 50, costMethod: 'WEIGHTED_AVG',
        isPerishable: false, supplierCode: 'SUP-HOTEL', unitPrice: 18,
      },
      {
        sku: 'SHAMP-30ML', name: 'แชมพู 30ml',            catCode: 'CAT-ROOM-AMEN', unit: 'BOTTLE',
        reorderPoint: 150, reorderQty: 400, minStock: 30, costMethod: 'WEIGHTED_AVG',
        isPerishable: false, supplierCode: 'SUP-HOTEL', unitPrice: 22,
      },
      {
        sku: 'COND-30ML',  name: 'ครีมนวด 30ml',           catCode: 'CAT-ROOM-AMEN', unit: 'BOTTLE',
        reorderPoint: 150, reorderQty: 400, minStock: 30, costMethod: 'WEIGHTED_AVG',
        isPerishable: false, supplierCode: 'SUP-HOTEL', unitPrice: 22,
      },
      {
        sku: 'TOWEL-BATH', name: 'ผ้าเช็ดตัว',             catCode: 'CAT-ROOM-BED',  unit: 'PIECE',
        reorderPoint: 100, reorderQty: 200, minStock: 50, costMethod: 'WEIGHTED_AVG',
        isPerishable: false, supplierCode: 'SUP-HOTEL', unitPrice: 120,
      },
      {
        sku: 'TOWEL-FACE', name: 'ผ้าเช็ดหน้า',            catCode: 'CAT-ROOM-BED',  unit: 'PIECE',
        reorderPoint: 100, reorderQty: 200, minStock: 50, costMethod: 'WEIGHTED_AVG',
        isPerishable: false, supplierCode: 'SUP-HOTEL', unitPrice: 60,
      },
      {
        sku: 'SHEET-STD',  name: 'ผ้าปูที่นอน (Standard)',  catCode: 'CAT-ROOM-BED',  unit: 'SET',
        reorderPoint: 30,  reorderQty: 60,  minStock: 15, costMethod: 'WEIGHTED_AVG',
        isPerishable: false, supplierCode: 'SUP-HOTEL', unitPrice: 350,
      },
      // F&B Dry goods
      {
        sku: 'RICE-25KG',  name: 'ข้าวหอมมะลิ 25kg',       catCode: 'CAT-FB-DRY',    unit: 'BAG',
        reorderPoint: 10,  reorderQty: 20,  minStock: 5,  costMethod: 'WEIGHTED_AVG',
        isPerishable: true, defaultShelfLifeDays: 365, supplierCode: 'SUP-MAKRO', unitPrice: 780,
      },
      {
        sku: 'FLOUR-1KG',  name: 'แป้งอเนกประสงค์ 1kg',    catCode: 'CAT-FB-DRY',    unit: 'KG',
        reorderPoint: 20,  reorderQty: 50,  minStock: 5,  costMethod: 'WEIGHTED_AVG',
        isPerishable: true, defaultShelfLifeDays: 180, supplierCode: 'SUP-MAKRO', unitPrice: 32,
      },
      {
        sku: 'OIL-5L',     name: 'น้ำมันพืช 5 ลิตร',        catCode: 'CAT-FB-DRY',    unit: 'BOTTLE',
        reorderPoint: 10,  reorderQty: 24,  minStock: 3,  costMethod: 'WEIGHTED_AVG',
        isPerishable: true, defaultShelfLifeDays: 365, supplierCode: 'SUP-MAKRO', unitPrice: 220,
      },
      {
        sku: 'SUGAR-1KG',  name: 'น้ำตาลทราย 1kg',          catCode: 'CAT-FB-DRY',    unit: 'KG',
        reorderPoint: 10,  reorderQty: 30,  minStock: 5,  costMethod: 'WEIGHTED_AVG',
        isPerishable: true, defaultShelfLifeDays: 730, supplierCode: 'SUP-MAKRO', unitPrice: 28,
      },
      // Beverages
      {
        sku: 'WATER-600',  name: 'น้ำดื่ม 600ml (ลัง 24)',   catCode: 'CAT-FB-BEV',    unit: 'BOX',
        reorderPoint: 20,  reorderQty: 50,  minStock: 10, costMethod: 'WEIGHTED_AVG',
        isPerishable: true, defaultShelfLifeDays: 365, supplierCode: 'SUP-MAKRO', unitPrice: 90,
      },
      {
        sku: 'COLA-330',   name: 'น้ำอัดลม 330ml (ลัง 24)', catCode: 'CAT-FB-BEV',    unit: 'BOX',
        reorderPoint: 10,  reorderQty: 20,  minStock: 5,  costMethod: 'WEIGHTED_AVG',
        isPerishable: true, defaultShelfLifeDays: 365, supplierCode: 'SUP-BIGC', unitPrice: 180,
      },
      // Cleaning Supplies
      {
        sku: 'DETERGENT',  name: 'น้ำยาซักผ้า 5L',           catCode: 'CAT-CLEAN',     unit: 'BOTTLE',
        reorderPoint: 10,  reorderQty: 24,  minStock: 3,  costMethod: 'WEIGHTED_AVG',
        isPerishable: false, supplierCode: 'SUP-CLEAN', unitPrice: 180,
      },
      {
        sku: 'FLOOR-CLN',  name: 'น้ำยาถูพื้น 5L',            catCode: 'CAT-CLEAN',     unit: 'BOTTLE',
        reorderPoint: 8,   reorderQty: 20,  minStock: 2,  costMethod: 'WEIGHTED_AVG',
        isPerishable: false, supplierCode: 'SUP-CLEAN', unitPrice: 150,
      },
      {
        sku: 'TOILET-CLN', name: 'น้ำยาล้างห้องน้ำ 750ml',    catCode: 'CAT-CLEAN',     unit: 'BOTTLE',
        reorderPoint: 20,  reorderQty: 48,  minStock: 5,  costMethod: 'WEIGHTED_AVG',
        isPerishable: false, supplierCode: 'SUP-CLEAN', unitPrice: 65,
      },
      // Maintenance Parts
      {
        sku: 'BULB-E27',   name: 'หลอดไฟ LED E27 9W',        catCode: 'CAT-MAINT',     unit: 'PIECE',
        reorderPoint: 20,  reorderQty: 50,  minStock: 10, costMethod: 'WEIGHTED_AVG',
        isPerishable: false, supplierCode: 'SUP-BIGC', unitPrice: 85,
      },
      {
        sku: 'FILTER-AC',  name: 'ฟิลเตอร์แอร์',             catCode: 'CAT-MAINT',     unit: 'PIECE',
        reorderPoint: 10,  reorderQty: 20,  minStock: 5,  costMethod: 'WEIGHTED_AVG',
        isPerishable: false, supplierCode: 'SUP-BIGC', unitPrice: 120,
      },
    ];

    const itemMap: Record<string, string> = {};
    let itemCount = 0;
    for (const item of itemDefs) {
      const catId = categoryMap[item.catCode];
      const existing = await this.prisma.inventoryItem.findFirst({
        where: { tenantId, sku: item.sku },
      });
      let itemId: string;
      if (!existing) {
        const created = await this.prisma.inventoryItem.create({
          data: {
            tenantId, sku: item.sku, name: item.name, categoryId: catId,
            unit: item.unit as any, costMethod: item.costMethod as any,
            reorderPoint: item.reorderPoint, reorderQty: item.reorderQty,
            minStock: item.minStock, isPerishable: item.isPerishable,
            defaultShelfLifeDays: item.defaultShelfLifeDays ?? null,
            isActive: true,
          },
        });
        itemId = created.id;
        itemCount++;
      } else {
        itemId = existing.id;
      }
      itemMap[item.sku] = itemId;

      // Link supplier to item
      const suppId = supplierMap[item.supplierCode];
      if (suppId) {
        const existingLink = await this.prisma.itemSupplier.findFirst({
          where: { itemId, supplierId: suppId },
        });
        if (!existingLink) {
          await this.prisma.itemSupplier.create({
            data: {
              itemId, supplierId: suppId, unitPrice: item.unitPrice,
              currency: 'THB', isPreferred: true,
            },
          });
        }
      }
    }
    this.logger.log(`  ✓ ${itemCount} inventory items seeded`);

    // ── 5. Warehouse Stocks (initial balances) ────────────────────────────────
    const stockDefs: Array<{ sku: string; whCode: string; qty: number; avgCost: number }> = [
      // Housekeeping warehouse stocks
      { sku: 'SOAP-75G',   whCode: 'WH-HK',    qty: 320, avgCost: 18 },
      { sku: 'SHAMP-30ML', whCode: 'WH-HK',    qty: 280, avgCost: 22 },
      { sku: 'COND-30ML',  whCode: 'WH-HK',    qty: 260, avgCost: 22 },
      { sku: 'TOWEL-BATH', whCode: 'WH-HK',    qty: 180, avgCost: 120 },
      { sku: 'TOWEL-FACE', whCode: 'WH-HK',    qty: 180, avgCost: 60 },
      { sku: 'SHEET-STD',  whCode: 'WH-HK',    qty: 45,  avgCost: 350 },
      { sku: 'DETERGENT',  whCode: 'WH-HK',    qty: 18,  avgCost: 180 },
      { sku: 'TOILET-CLN', whCode: 'WH-HK',    qty: 32,  avgCost: 65 },
      // Kitchen warehouse stocks
      { sku: 'RICE-25KG',  whCode: 'WH-KITCH', qty: 15,  avgCost: 780 },
      { sku: 'FLOUR-1KG',  whCode: 'WH-KITCH', qty: 25,  avgCost: 32 },
      { sku: 'OIL-5L',     whCode: 'WH-KITCH', qty: 12,  avgCost: 220 },
      { sku: 'SUGAR-1KG',  whCode: 'WH-KITCH', qty: 20,  avgCost: 28 },
      { sku: 'WATER-600',  whCode: 'WH-KITCH', qty: 35,  avgCost: 90 },
      { sku: 'COLA-330',   whCode: 'WH-KITCH', qty: 15,  avgCost: 180 },
      // Maintenance warehouse stocks
      { sku: 'BULB-E27',   whCode: 'WH-MAINT', qty: 35,  avgCost: 85 },
      { sku: 'FILTER-AC',  whCode: 'WH-MAINT', qty: 12,  avgCost: 120 },
      { sku: 'FLOOR-CLN',  whCode: 'WH-MAINT', qty: 10,  avgCost: 150 },
    ];

    let stockCount = 0;
    for (const stock of stockDefs) {
      const itemId = itemMap[stock.sku];
      const warehouseId = warehouseMap[stock.whCode];
      if (!itemId || !warehouseId) continue;

      const existing = await this.prisma.warehouseStock.findUnique({
        where: { warehouseId_itemId: { warehouseId, itemId } },
      });
      if (!existing) {
        await this.prisma.warehouseStock.create({
          data: {
            warehouseId, itemId,
            quantity: stock.qty,
            avgCost: stock.avgCost,
            totalValue: stock.qty * stock.avgCost,
          },
        });
        stockCount++;
      }
    }
    this.logger.log(`  ✓ ${stockCount} warehouse stock records seeded`);

    // ── 6. Room Type Amenity Templates ────────────────────────────────────────
    // Define what gets auto-deducted per room type per housekeeping task
    const templateDefs = [
      // Standard room checkout
      { roomType: 'standard',  taskType: 'checkout', sku: 'SOAP-75G',   qty: 2 },
      { roomType: 'standard',  taskType: 'checkout', sku: 'SHAMP-30ML', qty: 1 },
      { roomType: 'standard',  taskType: 'checkout', sku: 'COND-30ML',  qty: 1 },
      { roomType: 'standard',  taskType: 'checkout', sku: 'TOWEL-BATH', qty: 1 },
      { roomType: 'standard',  taskType: 'checkout', sku: 'TOWEL-FACE', qty: 1 },
      // Deluxe room checkout
      { roomType: 'deluxe',    taskType: 'checkout', sku: 'SOAP-75G',   qty: 2 },
      { roomType: 'deluxe',    taskType: 'checkout', sku: 'SHAMP-30ML', qty: 2 },
      { roomType: 'deluxe',    taskType: 'checkout', sku: 'COND-30ML',  qty: 2 },
      { roomType: 'deluxe',    taskType: 'checkout', sku: 'TOWEL-BATH', qty: 2 },
      { roomType: 'deluxe',    taskType: 'checkout', sku: 'TOWEL-FACE', qty: 2 },
      // Suite checkout
      { roomType: 'suite',     taskType: 'checkout', sku: 'SOAP-75G',   qty: 4 },
      { roomType: 'suite',     taskType: 'checkout', sku: 'SHAMP-30ML', qty: 3 },
      { roomType: 'suite',     taskType: 'checkout', sku: 'COND-30ML',  qty: 3 },
      { roomType: 'suite',     taskType: 'checkout', sku: 'TOWEL-BATH', qty: 3 },
      { roomType: 'suite',     taskType: 'checkout', sku: 'TOWEL-FACE', qty: 3 },
      // Daily turndown
      { roomType: 'standard',  taskType: 'daily',    sku: 'TOILET-CLN', qty: 1 },
      { roomType: 'deluxe',    taskType: 'daily',    sku: 'TOILET-CLN', qty: 1 },
    ];

    let templateCount = 0;
    for (const tmpl of templateDefs) {
      const itemId = itemMap[tmpl.sku];
      const warehouseId = warehouseMap['WH-HK'];
      if (!itemId) continue;
      const existing = await this.prisma.roomTypeAmenityTemplate.findFirst({
        where: { tenantId, roomType: tmpl.roomType, taskType: tmpl.taskType, itemId },
      });
      if (!existing) {
        await this.prisma.roomTypeAmenityTemplate.create({
          data: {
            tenantId, roomType: tmpl.roomType, taskType: tmpl.taskType,
            itemId, quantity: tmpl.qty, warehouseId, isActive: true,
          },
        });
        templateCount++;
      }
    }
    this.logger.log(`  ✓ ${templateCount} room type amenity templates seeded`);

    // ── 7. Inventory Recipes (F&B BOM) ────────────────────────────────────────
    // Seed a simple recipe for demo (links to a restaurant menu item by ID placeholder)
    const existingRecipe = await this.prisma.inventoryRecipe.findFirst({
      where: { tenantId, menuItemId: 'DEMO-KAOPAT-001' },
    });
    if (!existingRecipe) {
      const recipe = await this.prisma.inventoryRecipe.create({
        data: {
          tenantId, menuItemId: 'DEMO-KAOPAT-001', menuItemName: 'ข้าวผัดกุ้ง',
          servings: 1, isActive: true, notes: 'สูตรมาตรฐาน',
        },
      });
      const riceId = itemMap['RICE-25KG'];
      const oilId  = itemMap['OIL-5L'];
      if (riceId && oilId) {
        await this.prisma.inventoryRecipeIngredient.createMany({
          data: [
            { recipeId: recipe.id, itemId: riceId, quantity: 0.2, unit: 'กก.', wastagePercent: 5 },
            { recipeId: recipe.id, itemId: oilId,  quantity: 0.02, unit: 'ลิตร', wastagePercent: 10 },
          ],
        });
        this.logger.log(`  ✓ Recipe seeded: ข้าวผัดกุ้ง`);
      }
    }

    this.logger.log(`✅ Inventory seed complete: warehouses, ${itemDefs.length} items, templates`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PURCHASE REQUISITION & SUPPLIER QUOTES SEEDER
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Seed Purchase Requisition (PR), Supplier Quotes, and Price Comparison data.
   * Depends on: seedInventoryData() (needs suppliers, items, warehouses).
   */
  private async seedPurchaseRequisitionData(): Promise<void> {
    this.logger.log('📋 Seeding Purchase Requisition & Supplier Quotes data...');

    // ── Find tenant (same as inventory seeder — Mountain View Resort SUB-002)
    const ownerUser = await this.prisma.user.findUnique({
      where: { email: 'premium.test@email.com' },
    });
    if (!ownerUser?.tenantId) {
      this.logger.warn('  ⚠️ premium.test@email.com not found — skipping PR seed');
      return;
    }
    const tenantId = ownerUser.tenantId;
    const userId = ownerUser.id;

    const property = await this.prisma.property.findFirst({
      where: { tenantId },
    });
    if (!property) {
      this.logger.warn('  ⚠️ No property for demo tenant — skipping PR seed');
      return;
    }
    const propertyId = property.id;

    // ── Load existing inventory data
    const suppliers = await this.prisma.supplier.findMany({ where: { tenantId, deletedAt: null } });
    const items = await this.prisma.inventoryItem.findMany({ where: { tenantId } });
    const warehouses = await this.prisma.warehouse.findMany({ where: { tenantId } });

    if (suppliers.length < 2 || items.length < 3 || warehouses.length === 0) {
      this.logger.warn('  ⚠️ Insufficient inventory data — skipping PR seed');
      return;
    }

    const mainWarehouse = warehouses.find(w => w.code === 'WH-MAIN') || warehouses[0];

    // Helper: find item by SKU prefix
    const findItem = (skuPrefix: string) => items.find(i => i.sku.startsWith(skuPrefix));
    const findSupplier = (code: string) => suppliers.find(s => s.code === code);

    // ── Generate document number
    const generateDocNumber = async (prefix: string, docType: string): Promise<string> => {
      const now = new Date();
      const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
      const seq = await this.prisma.documentSequence.upsert({
        where: { tenantId_docType_yearMonth: { tenantId, docType, yearMonth: ym } },
        update: { lastNumber: { increment: 1 } },
        create: { tenantId, docType, prefix, yearMonth: ym, lastNumber: 1 },
      });
      return `${prefix}-${ym}-${String(seq.lastNumber).padStart(4, '0')}`;
    };

    // ══════════════════════════════════════════════════════════════════════════
    // PR-1: ใบขอซื้อวัสดุห้องพัก — สถานะ PO_CREATED (completed workflow)
    // ══════════════════════════════════════════════════════════════════════════
    const soapItem = findItem('SOAP');
    const shampooItem = findItem('SHMP');
    const towelItem = findItem('TWL-200');
    const supHotel = findSupplier('SUP-HOTEL');
    const supMakro = findSupplier('SUP-MAKRO');

    if (soapItem && shampooItem && towelItem && supHotel && supMakro) {
      const pr1Number = await generateDocNumber('PR', 'PURCHASE_REQUISITION');
      const pr1 = await this.prisma.purchaseRequisition.create({
        data: {
          tenantId,
          propertyId,
          prNumber: pr1Number,
          status: PurchaseRequisitionStatus.PO_CREATED,
          priority: 'HIGH',
          requiredDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          purpose: 'เติมสต็อกวัสดุห้องพักประจำเดือน',
          department: 'แม่บ้าน (Housekeeping)',
          notes: 'สต็อกสบู่และแชมพูเหลือน้อย ต้องเติมก่อนสิ้นเดือน',
          requestedBy: userId,
          approvedBy: userId,
          approvedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        },
      });

      // PR-1 Items
      await this.prisma.purchaseRequisitionItem.createMany({
        data: [
          { purchaseRequisitionId: pr1.id, itemId: soapItem.id, quantity: 200, estimatedUnitPrice: 15, estimatedTotalPrice: 3000 },
          { purchaseRequisitionId: pr1.id, itemId: shampooItem.id, quantity: 200, estimatedUnitPrice: 25, estimatedTotalPrice: 5000 },
          { purchaseRequisitionId: pr1.id, itemId: towelItem.id, quantity: 50, estimatedUnitPrice: 150, estimatedTotalPrice: 7500 },
        ],
      });

      // Supplier Quotes for PR-1 (2 suppliers competed)
      const sq1Hotel = await this.prisma.supplierQuote.create({
        data: {
          tenantId,
          purchaseRequisitionId: pr1.id,
          supplierId: supHotel.id,
          quoteNumber: 'QT-HOTEL-2604-001',
          status: SupplierQuoteStatus.SELECTED,
          quotedDate: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000),
          validUntil: new Date(Date.now() + 26 * 24 * 60 * 60 * 1000),
          deliveryDays: 5,
          paymentTerms: 'NET30',
          subtotal: 14500,
          taxAmount: 1015,
          discountAmount: 500,
          totalAmount: 15015,
          receivedAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000),
          selectedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
        },
      });

      // Quote items for Hotel Amenities
      await this.prisma.supplierQuoteItem.createMany({
        data: [
          { supplierQuoteId: sq1Hotel.id, itemId: soapItem.id, quantity: 200, unitPrice: 12, discount: 0, taxRate: 7, totalPrice: 2568 },
          { supplierQuoteId: sq1Hotel.id, itemId: shampooItem.id, quantity: 200, unitPrice: 20, discount: 0, taxRate: 7, totalPrice: 4280 },
          { supplierQuoteId: sq1Hotel.id, itemId: towelItem.id, quantity: 50, unitPrice: 140, discount: 500, taxRate: 7, totalPrice: 7167 },
        ],
      });

      const sq1Makro = await this.prisma.supplierQuote.create({
        data: {
          tenantId,
          purchaseRequisitionId: pr1.id,
          supplierId: supMakro.id,
          quoteNumber: 'QT-MAKRO-2604-088',
          status: SupplierQuoteStatus.REJECTED,
          quotedDate: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000),
          validUntil: new Date(Date.now() + 26 * 24 * 60 * 60 * 1000),
          deliveryDays: 2,
          paymentTerms: 'NET30',
          subtotal: 16000,
          taxAmount: 1120,
          discountAmount: 0,
          totalAmount: 17120,
          receivedAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000),
          rejectedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
          rejectionReason: 'ราคาสูงกว่าคู่แข่ง',
        },
      });

      await this.prisma.supplierQuoteItem.createMany({
        data: [
          { supplierQuoteId: sq1Makro.id, itemId: soapItem.id, quantity: 200, unitPrice: 18, discount: 0, taxRate: 7, totalPrice: 3852 },
          { supplierQuoteId: sq1Makro.id, itemId: shampooItem.id, quantity: 200, unitPrice: 28, discount: 0, taxRate: 7, totalPrice: 5992 },
          { supplierQuoteId: sq1Makro.id, itemId: towelItem.id, quantity: 50, unitPrice: 160, discount: 0, taxRate: 7, totalPrice: 8560 },
        ],
      });

      // Price Comparison for PR-1
      await this.prisma.priceComparison.create({
        data: {
          tenantId,
          purchaseRequisitionId: pr1.id,
          comparisonNumber: await generateDocNumber('PC', 'PRICE_COMPARISON'),
          selectedQuoteId: sq1Hotel.id,
          selectionReason: 'ราคาต่ำกว่า ส่วนลดผ้าเช็ดหน้า และเป็นซัพพลายเออร์เฉพาะทาง',
          comparedBy: userId,
          comparedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
          approvedBy: userId,
          approvedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
        },
      });

      // PO created from this PR
      const po1Number = await generateDocNumber('PO', 'PURCHASE_ORDER');
      await this.prisma.purchaseOrder.create({
        data: {
          tenantId,
          propertyId,
          poNumber: po1Number,
          supplierId: supHotel.id,
          warehouseId: mainWarehouse.id,
          status: PurchaseOrderStatus.APPROVED,
          expectedDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
          subtotal: 14500,
          taxAmount: 1015,
          totalAmount: 15015,
          requestedBy: userId,
          approvedBy: userId,
          approvedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
          quotationNumber: 'QT-HOTEL-2604-001',
          quotationDate: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000),
          purchaseRequisitionId: pr1.id,
          notes: 'สร้างจาก PR ' + pr1Number,
          items: {
            create: [
              { itemId: soapItem.id, quantity: 200, unitPrice: 12, discount: 0, taxRate: 7, totalPrice: 2568 },
              { itemId: shampooItem.id, quantity: 200, unitPrice: 20, discount: 0, taxRate: 7, totalPrice: 4280 },
              { itemId: towelItem.id, quantity: 50, unitPrice: 140, discount: 5, taxRate: 7, totalPrice: 7167 },
            ],
          },
        },
      });

      this.logger.log(`  ✓ PR-1 (${pr1Number}): วัสดุห้องพัก — PO_CREATED + 2 quotes + comparison`);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // PR-2: ใบขอซื้อน้ำยาทำความสะอาด — สถานะ QUOTES_RECEIVED (ready to compare)
    // ══════════════════════════════════════════════════════════════════════════
    const detergentItem = findItem('DET');
    const floorCleanItem = findItem('FLR-CLN');
    const toiletCleanItem = findItem('TLT-CLN');
    const supClean = findSupplier('SUP-CLEAN');
    const supBigc = findSupplier('SUP-BIGC');

    if (detergentItem && floorCleanItem && supClean && supBigc) {
      const pr2Number = await generateDocNumber('PR', 'PURCHASE_REQUISITION');
      const pr2 = await this.prisma.purchaseRequisition.create({
        data: {
          tenantId,
          propertyId,
          prNumber: pr2Number,
          status: PurchaseRequisitionStatus.QUOTES_RECEIVED,
          priority: 'NORMAL',
          requiredDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
          purpose: 'สั่งซื้อน้ำยาทำความสะอาดรอบ Q2',
          department: 'แม่บ้าน (Housekeeping)',
          notes: 'เตรียมสต็อกสำหรับไตรมาสที่ 2',
          requestedBy: userId,
          approvedBy: userId,
          approvedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        },
      });

      const pr2Items = [
        { purchaseRequisitionId: pr2.id, itemId: detergentItem.id, quantity: 30, estimatedUnitPrice: 250, estimatedTotalPrice: 7500 },
        { purchaseRequisitionId: pr2.id, itemId: floorCleanItem.id, quantity: 20, estimatedUnitPrice: 180, estimatedTotalPrice: 3600 },
      ];
      if (toiletCleanItem) {
        pr2Items.push({ purchaseRequisitionId: pr2.id, itemId: toiletCleanItem.id, quantity: 25, estimatedUnitPrice: 120, estimatedTotalPrice: 3000 });
      }
      await this.prisma.purchaseRequisitionItem.createMany({ data: pr2Items });

      // Quote from SupplyClean — lower price
      const sq2Clean = await this.prisma.supplierQuote.create({
        data: {
          tenantId,
          purchaseRequisitionId: pr2.id,
          supplierId: supClean.id,
          quoteNumber: 'QT-SC-2604-045',
          status: SupplierQuoteStatus.RECEIVED,
          quotedDate: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
          validUntil: new Date(Date.now() + 29 * 24 * 60 * 60 * 1000),
          deliveryDays: 3,
          paymentTerms: 'NET15',
          subtotal: 12800,
          taxAmount: 896,
          discountAmount: 800,
          totalAmount: 12896,
          receivedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
        },
      });

      const sq2CleanItems = [
        { supplierQuoteId: sq2Clean.id, itemId: detergentItem.id, quantity: 30, unitPrice: 230, discount: 5, taxRate: 7, totalPrice: 7009.5 },
        { supplierQuoteId: sq2Clean.id, itemId: floorCleanItem.id, quantity: 20, unitPrice: 165, discount: 0, taxRate: 7, totalPrice: 3531 },
      ];
      if (toiletCleanItem) {
        sq2CleanItems.push({ supplierQuoteId: sq2Clean.id, itemId: toiletCleanItem.id, quantity: 25, unitPrice: 110, discount: 0, taxRate: 7, totalPrice: 2942.5 });
      }
      await this.prisma.supplierQuoteItem.createMany({ data: sq2CleanItems });

      // Quote from BigC — faster delivery but higher price
      const sq2Bigc = await this.prisma.supplierQuote.create({
        data: {
          tenantId,
          purchaseRequisitionId: pr2.id,
          supplierId: supBigc.id,
          quoteNumber: 'QT-BIGC-2604-112',
          status: SupplierQuoteStatus.RECEIVED,
          quotedDate: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
          validUntil: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
          deliveryDays: 1,
          paymentTerms: 'COD',
          subtotal: 14500,
          taxAmount: 1015,
          discountAmount: 0,
          totalAmount: 15515,
          receivedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
        },
      });

      const sq2BigcItems = [
        { supplierQuoteId: sq2Bigc.id, itemId: detergentItem.id, quantity: 30, unitPrice: 270, discount: 0, taxRate: 7, totalPrice: 8667 },
        { supplierQuoteId: sq2Bigc.id, itemId: floorCleanItem.id, quantity: 20, unitPrice: 200, discount: 0, taxRate: 7, totalPrice: 4280 },
      ];
      if (toiletCleanItem) {
        sq2BigcItems.push({ supplierQuoteId: sq2Bigc.id, itemId: toiletCleanItem.id, quantity: 25, unitPrice: 130, discount: 0, taxRate: 7, totalPrice: 3477.5 });
      }
      await this.prisma.supplierQuoteItem.createMany({ data: sq2BigcItems });

      this.logger.log(`  ✓ PR-2 (${pr2Number}): น้ำยาทำความสะอาด — QUOTES_RECEIVED (2 quotes, ready to compare)`);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // PR-3: ใบขอซื้อวัตถุดิบอาหาร — สถานะ APPROVED (waiting for quotes)
    // ══════════════════════════════════════════════════════════════════════════
    const riceItem = findItem('RICE');
    const flourItem = findItem('FLOUR');
    const oilItem = findItem('OIL');
    const sugarItem = findItem('SUGAR');

    if (riceItem && flourItem) {
      const pr3Number = await generateDocNumber('PR', 'PURCHASE_REQUISITION');
      const pr3 = await this.prisma.purchaseRequisition.create({
        data: {
          tenantId,
          propertyId,
          prNumber: pr3Number,
          status: PurchaseRequisitionStatus.APPROVED,
          priority: 'NORMAL',
          requiredDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
          purpose: 'สั่งซื้อวัตถุดิบอาหารประจำสัปดาห์',
          department: 'ครัว (Kitchen)',
          notes: 'สต็อกข้าวสารเหลือน้อยกว่า reorder point',
          requestedBy: userId,
          approvedBy: userId,
          approvedAt: new Date(),
        },
      });

      const pr3Items = [
        { purchaseRequisitionId: pr3.id, itemId: riceItem.id, quantity: 10, estimatedUnitPrice: 45, estimatedTotalPrice: 450 },
        { purchaseRequisitionId: pr3.id, itemId: flourItem.id, quantity: 5, estimatedUnitPrice: 35, estimatedTotalPrice: 175 },
      ];
      if (oilItem) pr3Items.push({ purchaseRequisitionId: pr3.id, itemId: oilItem.id, quantity: 8, estimatedUnitPrice: 65, estimatedTotalPrice: 520 });
      if (sugarItem) pr3Items.push({ purchaseRequisitionId: pr3.id, itemId: sugarItem.id, quantity: 5, estimatedUnitPrice: 30, estimatedTotalPrice: 150 });

      await this.prisma.purchaseRequisitionItem.createMany({ data: pr3Items });

      this.logger.log(`  ✓ PR-3 (${pr3Number}): วัตถุดิบอาหาร — APPROVED (ready to request quotes)`);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // PR-4: ใบขอซื้ออุปกรณ์ซ่อมบำรุง — สถานะ DRAFT
    // ══════════════════════════════════════════════════════════════════════════
    const bulbItem = findItem('LED');
    const filterItem = findItem('AC-FLT');

    if (bulbItem && filterItem) {
      const pr4Number = await generateDocNumber('PR', 'PURCHASE_REQUISITION');
      const pr4 = await this.prisma.purchaseRequisition.create({
        data: {
          tenantId,
          propertyId,
          prNumber: pr4Number,
          status: PurchaseRequisitionStatus.DRAFT,
          priority: 'LOW',
          requiredDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          purpose: 'เตรียมสต็อกอุปกรณ์ซ่อมบำรุงล่วงหน้า',
          department: 'ช่างซ่อมบำรุง (Maintenance)',
          requestedBy: userId,
        },
      });

      await this.prisma.purchaseRequisitionItem.createMany({
        data: [
          { purchaseRequisitionId: pr4.id, itemId: bulbItem.id, quantity: 50, estimatedUnitPrice: 85, estimatedTotalPrice: 4250 },
          { purchaseRequisitionId: pr4.id, itemId: filterItem.id, quantity: 20, estimatedUnitPrice: 350, estimatedTotalPrice: 7000 },
        ],
      });

      this.logger.log(`  ✓ PR-4 (${pr4Number}): อุปกรณ์ซ่อมบำรุง — DRAFT`);
    }

    this.logger.log('✅ Purchase Requisition & Supplier Quotes seed complete');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // COST ACCOUNTING SEEDER
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Seed Cost Accounting data for demo tenants that have COST_ACCOUNTING_MODULE.
   * Creates: USALI cost centers, standard cost types, sample cost entries,
   * and budget entries for current month.
   */
  private async seedCostAccountingData(): Promise<void> {
    this.logger.log('📊 Seeding Cost Accounting data...');

    const allTenants2 = await this.tenantsService.findAll();
    const tenant = allTenants2.find(t => (t as any).name_en === 'Mountain View Resort' || (t as any).slug === 'mountain' || t.name === 'Mountain View Resort (Premium Test)');
    if (!tenant) {
      this.logger.warn('  ⚠️ Demo tenant not found — skipping cost accounting seed');
      return;
    }
    const property = await this.prisma.property.findFirst({
      where: { tenantId: tenant.id },
    });
    if (!property) {
      this.logger.warn('  ⚠️ No property found — skipping cost accounting seed');
      return;
    }

    const tenantId = tenant.id;
    const propertyId = property.id;
    const now = new Date();
    const currentPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    // ── 1. Cost Centers (USALI standard) ─────────────────────────────────────
    const centerDefs = [
      { code: 'CC-ROOMS', name: 'Rooms Division',              type: 'ROOMS',           sortOrder: 1 },
      { code: 'CC-FB',    name: 'Food & Beverage',             type: 'FOOD_BEVERAGE',   sortOrder: 2 },
      { code: 'CC-ADMIN', name: 'Administrative & General',    type: 'ADMIN_GENERAL',   sortOrder: 3 },
      { code: 'CC-SM',    name: 'Sales & Marketing',           type: 'SALES_MARKETING', sortOrder: 4 },
      { code: 'CC-MAINT', name: 'Property Operations & Maint', type: 'MAINTENANCE_DEPT',sortOrder: 5 },
      { code: 'CC-ENERGY',name: 'Energy / Utilities',          type: 'ENERGY',          sortOrder: 6 },
    ];

    const centerMap: Record<string, string> = {};
    for (const cc of centerDefs) {
      const existing = await this.prisma.costCenter.findFirst({
        where: { tenantId, propertyId, code: cc.code },
      });
      if (!existing) {
        const created = await this.prisma.costCenter.create({
          data: { tenantId, propertyId, ...cc, type: cc.type as CostCenterType, isActive: true },
        });
        centerMap[cc.code] = created.id;
        this.logger.log(`  ✓ Cost Center: ${cc.name}`);
      } else {
        centerMap[cc.code] = existing.id;
      }
    }

    // ── 2. Cost Types ─────────────────────────────────────────────────────────
    const typeDefs = [
      // Material
      { code: 'CT-AMEN',  name: 'Room Amenities',    category: 'MATERIAL',  sortOrder: 1 },
      { code: 'CT-INGR',  name: 'F&B Ingredients',   category: 'MATERIAL',  sortOrder: 2 },
      { code: 'CT-PARTS', name: 'Maintenance Parts',  category: 'MATERIAL',  sortOrder: 3 },
      { code: 'CT-CLEAN', name: 'Cleaning Supplies',  category: 'MATERIAL',  sortOrder: 4 },
      // Labor
      { code: 'CT-SAL',   name: 'Staff Salary',       category: 'LABOR',     sortOrder: 5 },
      { code: 'CT-BEN',   name: 'Staff Benefits',     category: 'LABOR',     sortOrder: 6 },
      { code: 'CT-OT',    name: 'Overtime Pay',        category: 'LABOR',     sortOrder: 7 },
      // Overhead
      { code: 'CT-ELEC',  name: 'Electricity',        category: 'OVERHEAD',  sortOrder: 8 },
      { code: 'CT-WATER', name: 'Water & Sewage',      category: 'OVERHEAD',  sortOrder: 9 },
      { code: 'CT-DEPR',  name: 'Depreciation',        category: 'OVERHEAD',  sortOrder: 10 },
      { code: 'CT-INS',   name: 'Insurance',           category: 'OVERHEAD',  sortOrder: 11 },
      { code: 'CT-RENT',  name: 'Rent / Lease',        category: 'OVERHEAD',  sortOrder: 12 },
      // Revenue
      { code: 'CT-RREV',  name: 'Room Revenue',        category: 'REVENUE',   sortOrder: 13 },
      { code: 'CT-FBREV', name: 'F&B Revenue',         category: 'REVENUE',   sortOrder: 14 },
      { code: 'CT-OREV',  name: 'Other Revenue',       category: 'REVENUE',   sortOrder: 15 },
    ];

    const typeMap: Record<string, string> = {};
    for (const ct of typeDefs) {
      const existing = await this.prisma.costType.findFirst({
        where: { tenantId, code: ct.code },
      });
      if (!existing) {
        const created = await this.prisma.costType.create({
          data: { tenantId, ...ct, category: ct.category as CostCategory, isActive: true },
        });
        typeMap[ct.code] = created.id;
      } else {
        typeMap[ct.code] = existing.id;
      }
    }
    this.logger.log(`  ✓ ${typeDefs.length} cost types seeded`);

    // ── 3. Sample Cost Entries (current month) ────────────────────────────────
    const entriesExist = await this.prisma.costEntry.findFirst({
      where: { tenantId, propertyId, period: currentPeriod },
    });
    if (!entriesExist) {
      const entryDefs = [
        // Rooms Division costs
        { centerCode: 'CC-ROOMS', typeCode: 'CT-AMEN',  amount: 18500, desc: 'Room amenities consumption' },
        { centerCode: 'CC-ROOMS', typeCode: 'CT-CLEAN', amount: 8200,  desc: 'Cleaning supplies - rooms' },
        { centerCode: 'CC-ROOMS', typeCode: 'CT-SAL',   amount: 95000, desc: 'Housekeeping staff salary' },
        { centerCode: 'CC-ROOMS', typeCode: 'CT-RREV',  amount: 485000,desc: 'Room revenue this month' },
        // F&B costs
        { centerCode: 'CC-FB',    typeCode: 'CT-INGR',  amount: 62000, desc: 'F&B ingredient cost' },
        { centerCode: 'CC-FB',    typeCode: 'CT-SAL',   amount: 72000, desc: 'F&B staff salary' },
        { centerCode: 'CC-FB',    typeCode: 'CT-FBREV', amount: 195000,desc: 'F&B revenue this month' },
        // Admin costs
        { centerCode: 'CC-ADMIN', typeCode: 'CT-SAL',   amount: 85000, desc: 'Admin staff salary' },
        { centerCode: 'CC-ADMIN', typeCode: 'CT-BEN',   amount: 12000, desc: 'Staff benefits & insurance' },
        // Maintenance
        { centerCode: 'CC-MAINT', typeCode: 'CT-PARTS', amount: 15500, desc: 'Maintenance parts used' },
        { centerCode: 'CC-MAINT', typeCode: 'CT-SAL',   amount: 38000, desc: 'Maintenance staff salary' },
        // Energy
        { centerCode: 'CC-ENERGY',typeCode: 'CT-ELEC',  amount: 52000, desc: 'Electricity bill' },
        { centerCode: 'CC-ENERGY',typeCode: 'CT-WATER', amount: 8500,  desc: 'Water & sewage bill' },
      ];

      for (const entry of entryDefs) {
        const costCenterId = centerMap[entry.centerCode];
        const costTypeId   = typeMap[entry.typeCode];
        if (!costCenterId || !costTypeId) continue;
        await this.prisma.costEntry.create({
          data: {
            tenantId, propertyId, costCenterId, costTypeId,
            amount: entry.amount, period: currentPeriod,
            description: entry.desc,
            sourceType: 'manual', isAutoPosted: false, status: 'posted',
            createdBy: 'seeder',
          },
        });
      }
      this.logger.log(`  ✓ ${entryDefs.length} sample cost entries seeded for ${currentPeriod}`);
    } else {
      this.logger.log(`  ⊙ Cost entries already exist for period ${currentPeriod}`);
    }

    // ── 4. Cost Budgets (current month) ───────────────────────────────────────
    const budgetsExist = await this.prisma.costBudget.findFirst({
      where: { tenantId, propertyId, period: currentPeriod },
    });
    if (!budgetsExist) {
      const budgetDefs = [
        { centerCode: 'CC-ROOMS', typeCode: 'CT-AMEN',  budget: 20000 },
        { centerCode: 'CC-ROOMS', typeCode: 'CT-CLEAN', budget: 10000 },
        { centerCode: 'CC-ROOMS', typeCode: 'CT-SAL',   budget: 100000 },
        { centerCode: 'CC-FB',    typeCode: 'CT-INGR',  budget: 60000 },
        { centerCode: 'CC-FB',    typeCode: 'CT-SAL',   budget: 70000 },
        { centerCode: 'CC-ADMIN', typeCode: 'CT-SAL',   budget: 90000 },
        { centerCode: 'CC-MAINT', typeCode: 'CT-PARTS', budget: 20000 },
        { centerCode: 'CC-MAINT', typeCode: 'CT-SAL',   budget: 40000 },
        { centerCode: 'CC-ENERGY',typeCode: 'CT-ELEC',  budget: 55000 },
        { centerCode: 'CC-ENERGY',typeCode: 'CT-WATER', budget: 10000 },
      ];

      for (const b of budgetDefs) {
        const costCenterId = centerMap[b.centerCode];
        const costTypeId   = typeMap[b.typeCode];
        if (!costCenterId || !costTypeId) continue;
        await this.prisma.costBudget.create({
          data: {
            tenantId, propertyId, costCenterId, costTypeId,
            period: currentPeriod, budgetAmount: b.budget,
            actualAmount: 0, variance: 0, variancePercent: 0,
            createdBy: 'seeder',
          },
        });
      }
      this.logger.log(`  ✓ ${budgetDefs.length} budget entries seeded for ${currentPeriod}`);
    } else {
      this.logger.log(`  ⊙ Budgets already exist for period ${currentPeriod}`);
    }

    this.logger.log('✅ Cost accounting seed complete: cost centers, types, entries, budgets');
  }

  /**
   * Seed Procurement Users + Approval Flow templates for Mountain View Resort.
   *
   * Creates 6 procurement accounts (manager, buyers, approvers, receiver) and
   * 3 default approval flow templates (PR / Price Comparison / PO). All records
   * are idempotent — re-running the seed updates in place.
   */
  private async seedProcurementUsersAndFlows(): Promise<void> {
    this.logger.log('🛒 Seeding Procurement Users & Approval Flows...');

    const ownerUser = await this.prisma.user.findUnique({
      where: { email: 'premium.test@email.com' },
    });
    if (!ownerUser?.tenantId) {
      this.logger.warn('  ⚠️ premium.test@email.com not found — skipping procurement seed');
      return;
    }
    const tenantId = ownerUser.tenantId;

    // ── 1. Procurement user accounts ────────────────────────────────────────
    const hashedPassword = await bcrypt.hash('procure123', 10);

    interface ProcUserSeed {
      email: string;
      firstName: string;
      lastName: string;
      role: 'procurement_manager' | 'buyer' | 'approver' | 'receiver';
      employeeId: string;
      approvalLimit: number | null;
      permissions: string[];
    }

    const procurementUsers: ProcUserSeed[] = [
      {
        email: 'procurement.manager@mountainviewresort.test',
        firstName: 'ธนพล',
        lastName: 'จัดซื้อเก่ง',
        role: 'procurement_manager',
        employeeId: 'MVR-PRC-M01',
        approvalLimit: null, // unlimited
        permissions: [
          'pr.create', 'pr.approve',
          'rfq.create', 'quote.compare',
          'po.create', 'po.approve',
          'supplier.manage', 'grn.view', 'report.view',
          'approval-flow.manage', 'user.manage',
        ],
      },
      {
        email: 'buyer1@mountainviewresort.test',
        firstName: 'สุดา',
        lastName: 'ต่อรองดี',
        role: 'buyer',
        employeeId: 'MVR-PRC-B01',
        approvalLimit: 50_000,
        permissions: ['pr.create', 'rfq.create', 'quote.compare', 'po.create', 'supplier.view', 'report.view'],
      },
      {
        email: 'buyer2@mountainviewresort.test',
        firstName: 'อรุณ',
        lastName: 'ซื้อคุ้ม',
        role: 'buyer',
        employeeId: 'MVR-PRC-B02',
        approvalLimit: 50_000,
        permissions: ['pr.create', 'rfq.create', 'quote.compare', 'po.create', 'supplier.view', 'report.view'],
      },
      {
        email: 'approver1@mountainviewresort.test',
        firstName: 'ชลธี',
        lastName: 'ผู้อนุมัติ',
        role: 'approver',
        employeeId: 'MVR-PRC-A01',
        approvalLimit: 500_000,
        permissions: ['pr.approve', 'po.approve', 'quote.compare', 'report.view'],
      },
      {
        email: 'approver2@mountainviewresort.test',
        firstName: 'มาลี',
        lastName: 'ตรวจละเอียด',
        role: 'approver',
        employeeId: 'MVR-PRC-A02',
        approvalLimit: 1_000_000,
        permissions: ['pr.approve', 'po.approve', 'quote.compare', 'report.view'],
      },
      {
        email: 'receiver1@mountainviewresort.test',
        firstName: 'วิชัย',
        lastName: 'รับของ',
        role: 'receiver',
        employeeId: 'MVR-PRC-R01',
        approvalLimit: 0,
        permissions: ['grn.create', 'grn.view', 'qc.inspect'],
      },
    ];

    let created = 0;
    let updated = 0;
    const userByEmail: Record<string, { id: string; role: string }> = {};

    for (const u of procurementUsers) {
      const allowedSystems = '["main","procurement"]';
      const existing = await this.prisma.user.findUnique({ where: { email: u.email } });
      if (!existing) {
        const fresh = await this.prisma.user.create({
          data: {
            email: u.email,
            password: hashedPassword,
            firstName: u.firstName,
            lastName: u.lastName,
            role: u.role,
            tenantId,
            status: 'active',
            employeeId: u.employeeId,
            allowedSystems,
            approvalLimit: u.approvalLimit === null ? null : (u.approvalLimit as unknown as any),
            procurementPermissions: JSON.stringify(u.permissions),
          } as any,
        });
        userByEmail[u.email] = { id: fresh.id, role: u.role };
        created++;
      } else {
        const refreshed = await this.prisma.user.update({
          where: { id: existing.id },
          data: {
            tenantId,
            password: hashedPassword,
            firstName: u.firstName,
            lastName: u.lastName,
            role: u.role,
            employeeId: u.employeeId,
            status: 'active',
            allowedSystems,
            approvalLimit: u.approvalLimit === null ? null : (u.approvalLimit as unknown as any),
            procurementPermissions: JSON.stringify(u.permissions),
          } as any,
        });
        userByEmail[u.email] = { id: refreshed.id, role: u.role };
        updated++;
      }
    }

    this.logger.log(
      `  ✓ Procurement users: ${created} created, ${updated} updated ` +
        `(password: procure123, systems: main+procurement)`,
    );

    // ── 2. Approval Flow templates ──────────────────────────────────────────
    const approverA = userByEmail['approver1@mountainviewresort.test'];
    const approverB = userByEmail['approver2@mountainviewresort.test'];
    const manager = userByEmail['procurement.manager@mountainviewresort.test'];

    if (!approverA || !approverB || !manager) {
      this.logger.warn('  ⚠️ Approver/manager users missing — skipping approval flow seed');
      return;
    }

    interface FlowStepSeed {
      stepOrder: number;
      name: string;
      approverType: 'SPECIFIC_USER' | 'ROLE' | 'DEPARTMENT_HEAD';
      approverRole?: string | null;
      approverUserIds?: string[];
      minApprovals?: number;
      isParallel?: boolean;
      slaHours?: number | null;
    }
    interface FlowSeed {
      name: string;
      description: string;
      documentType: 'PURCHASE_REQUISITION' | 'PRICE_COMPARISON' | 'PURCHASE_ORDER';
      minAmount: number;
      maxAmount: number | null;
      isDefault: boolean;
      steps: FlowStepSeed[];
    }

    const flows: FlowSeed[] = [
      {
        name: 'Flow อนุมัติ PR (มาตรฐาน)',
        description: 'Flow อนุมัติใบขอซื้อ (PR) แบบ sequential 2 ขั้น',
        documentType: 'PURCHASE_REQUISITION',
        minAmount: 0,
        maxAmount: 500_000,
        isDefault: true,
        steps: [
          {
            stepOrder: 1,
            name: 'หัวหน้าแผนกจัดซื้ออนุมัติ',
            approverType: 'SPECIFIC_USER',
            approverUserIds: [manager.id],
            slaHours: 24,
          },
          {
            stepOrder: 2,
            name: 'ผู้อนุมัติขั้นสุดท้าย',
            approverType: 'SPECIFIC_USER',
            approverUserIds: [approverA.id, approverB.id],
            minApprovals: 1,
            isParallel: true,
            slaHours: 48,
          },
        ],
      },
      {
        name: 'Flow เปรียบเทียบราคา (Price Comparison)',
        description: 'Flow อนุมัติใบเปรียบเทียบราคาผู้ขาย — 1 ขั้น',
        documentType: 'PRICE_COMPARISON',
        minAmount: 0,
        maxAmount: 1_000_000,
        isDefault: true,
        steps: [
          {
            stepOrder: 1,
            name: 'หัวหน้าจัดซื้ออนุมัติการเลือกผู้ขาย',
            approverType: 'SPECIFIC_USER',
            approverUserIds: [manager.id],
            slaHours: 24,
          },
        ],
      },
      {
        name: 'Flow อนุมัติใบสั่งซื้อ (PO)',
        description: 'Flow อนุมัติใบสั่งซื้อ — 2 ขั้น sequential',
        documentType: 'PURCHASE_ORDER',
        minAmount: 0,
        maxAmount: null,
        isDefault: true,
        steps: [
          {
            stepOrder: 1,
            name: 'Approver ระดับแผนก',
            approverType: 'SPECIFIC_USER',
            approverUserIds: [approverA.id],
            slaHours: 24,
          },
          {
            stepOrder: 2,
            name: 'ผู้มีอำนาจอนุมัติ PO',
            approverType: 'SPECIFIC_USER',
            approverUserIds: [approverB.id, manager.id],
            minApprovals: 1,
            isParallel: true,
            slaHours: 48,
          },
        ],
      },
    ];

    let flowsCreated = 0;
    let flowsUpdated = 0;

    for (const f of flows) {
      const existing = await (this.prisma as any).approvalFlow.findFirst({
        where: { tenantId, name: f.name, documentType: f.documentType },
      });

      if (existing) {
        // Full replace of steps
        await (this.prisma as any).approvalFlowStep.deleteMany({
          where: { flowId: existing.id },
        });
        await (this.prisma as any).approvalFlow.update({
          where: { id: existing.id },
          data: {
            description: f.description,
            minAmount: f.minAmount as unknown as any,
            maxAmount: f.maxAmount === null ? null : (f.maxAmount as unknown as any),
            isActive: true,
            isDefault: f.isDefault,
            steps: {
              create: f.steps.map((s) => ({
                stepOrder: s.stepOrder,
                name: s.name,
                approverType: s.approverType,
                approverRole: s.approverRole ?? null,
                minApprovals: s.minApprovals ?? 1,
                isParallel: s.isParallel ?? false,
                slaHours: s.slaHours ?? null,
                approvers:
                  s.approverType === 'SPECIFIC_USER' && s.approverUserIds
                    ? {
                        create: s.approverUserIds.map((userId, idx) => ({
                          userId,
                          order: idx,
                        })),
                      }
                    : undefined,
              })),
            },
          },
        });
        flowsUpdated++;
      } else {
        await (this.prisma as any).approvalFlow.create({
          data: {
            tenantId,
            name: f.name,
            description: f.description,
            documentType: f.documentType,
            minAmount: f.minAmount as unknown as any,
            maxAmount: f.maxAmount === null ? null : (f.maxAmount as unknown as any),
            isActive: true,
            isDefault: f.isDefault,
            createdBy: manager.id,
            steps: {
              create: f.steps.map((s) => ({
                stepOrder: s.stepOrder,
                name: s.name,
                approverType: s.approverType,
                approverRole: s.approverRole ?? null,
                minApprovals: s.minApprovals ?? 1,
                isParallel: s.isParallel ?? false,
                slaHours: s.slaHours ?? null,
                approvers:
                  s.approverType === 'SPECIFIC_USER' && s.approverUserIds
                    ? {
                        create: s.approverUserIds.map((userId, idx) => ({
                          userId,
                          order: idx,
                        })),
                      }
                    : undefined,
              })),
            },
          },
        });
        flowsCreated++;
      }
    }

    this.logger.log(
      `  ✓ Approval flows: ${flowsCreated} created, ${flowsUpdated} updated (PR / Price Comparison / PO)`,
    );
    this.logger.log('✅ Procurement users & approval flows seeded successfully');
  }
}
