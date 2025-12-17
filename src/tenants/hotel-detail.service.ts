import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tenant, TenantStatus } from './entities/tenant.entity';
import { Subscription, SubscriptionStatus } from '../subscriptions/entities/subscription.entity';
import { Invoice, InvoiceStatus } from '../invoices/entities/invoice.entity';
import {
  HotelDetailResponseDto,
  HotelStatusBadge,
  SubscriptionStatusBadge,
  SubscriptionInfo,
  PlanInfo,
  FeatureInfo,
  HotelStatistics,
  TrialInfo,
  InvoiceSummary,
  QuickAction,
} from './dto/hotel-detail-response.dto';

@Injectable()
export class HotelDetailService {
  constructor(
    @InjectRepository(Tenant)
    private tenantsRepository: Repository<Tenant>,
    @InjectRepository(Subscription)
    private subscriptionsRepository: Repository<Subscription>,
    @InjectRepository(Invoice)
    private invoicesRepository: Repository<Invoice>,
  ) {}

  /**
   * ดึงข้อมูลรายละเอียดโรงแรมแบบครบถ้วนสำหรับ Professional UX/UI
   */
  async getHotelDetail(tenantId: string): Promise<HotelDetailResponseDto> {
    // 1. ดึงข้อมูล tenant พร้อม relations
    const tenant = await this.tenantsRepository.findOne({
      where: { id: tenantId },
      relations: ['subscription', 'subscription.plan', 'subscription.plan.planFeatures', 'subscription.plan.planFeatures.feature', 'subscription.subscriptionFeatures', 'subscription.subscriptionFeatures.feature', 'invoices', 'invoices.payments'],
    });

    if (!tenant) {
      throw new NotFoundException(`Hotel with ID ${tenantId} not found`);
    }

    // 2. ดึง invoices แยก (เพื่อ ordering)
    const invoices = await this.invoicesRepository.find({
      where: { tenantId },
      relations: ['payments'],
      order: { createdAt: 'DESC' },
      take: 5,
    });

    // 3. Build response
    const response: HotelDetailResponseDto = {
      id: tenant.id,
      name: tenant.name,
      status: this.buildHotelStatusBadge(tenant.status),
      statistics: this.buildStatistics(tenant, invoices),
      subscription: tenant.subscription ? this.buildSubscriptionInfo(tenant.subscription) : null,
      trial: this.buildTrialInfo(tenant),
      features: this.buildFeatures(tenant.subscription),
      recentInvoices: this.buildRecentInvoices(invoices),
      invoiceSummary: this.buildInvoiceSummary(invoices),
      quickActions: this.buildQuickActions(tenant),
      alerts: this.buildAlerts(tenant),
      metadata: this.buildMetadata(tenant),
      permissions: this.buildPermissions(tenant),
    };

    return response;
  }

  // ===== Helper Methods =====

  private buildHotelStatusBadge(status: TenantStatus): HotelStatusBadge {
    const statusMap: Record<TenantStatus, HotelStatusBadge> = {
      [TenantStatus.TRIAL]: {
        status: 'trial',
        label: 'Trial',
        labelTh: 'ทดลองใช้',
        color: 'blue',
        bgColor: 'bg-blue-100',
        textColor: 'text-blue-800',
      },
      [TenantStatus.ACTIVE]: {
        status: 'active',
        label: 'Active',
        labelTh: 'ใช้งานอยู่',
        color: 'green',
        bgColor: 'bg-green-100',
        textColor: 'text-green-800',
      },
      [TenantStatus.SUSPENDED]: {
        status: 'suspended',
        label: 'Suspended',
        labelTh: 'ระงับการใช้งาน',
        color: 'red',
        bgColor: 'bg-red-100',
        textColor: 'text-red-800',
      },
      [TenantStatus.EXPIRED]: {
        status: 'expired',
        label: 'Expired',
        labelTh: 'หมดอายุ',
        color: 'gray',
        bgColor: 'bg-gray-100',
        textColor: 'text-gray-800',
      },
    };

    return statusMap[status];
  }

  private buildSubscriptionStatusBadge(status: SubscriptionStatus): SubscriptionStatusBadge {
    const statusMap: Record<SubscriptionStatus, SubscriptionStatusBadge> = {
      [SubscriptionStatus.TRIAL]: {
        status: 'trial',
        label: 'Trial',
        labelTh: 'ทดลองใช้',
        color: 'blue',
        bgColor: 'bg-blue-100',
        textColor: 'text-blue-800',
      },
      [SubscriptionStatus.PENDING]: {
        status: 'pending',
        label: 'Pending',
        labelTh: 'รอดำเนินการ',
        color: 'yellow',
        bgColor: 'bg-yellow-100',
        textColor: 'text-yellow-800',
      },
      [SubscriptionStatus.ACTIVE]: {
        status: 'active',
        label: 'Active',
        labelTh: 'ใช้งานอยู่',
        color: 'green',
        bgColor: 'bg-green-100',
        textColor: 'text-green-800',
      },
      [SubscriptionStatus.EXPIRED]: {
        status: 'expired',
        label: 'Expired',
        labelTh: 'หมดอายุ',
        color: 'red',
        bgColor: 'bg-red-100',
        textColor: 'text-red-800',
      },
    };

    return statusMap[status];
  }

  private buildPlanInfo(plan: any): PlanInfo {
    const planNameTh: Record<string, string> = {
      S: 'แพ็คเกจ S (เล็ก)',
      M: 'แพ็คเกจ M (กลาง)',
      L: 'แพ็คเกจ L (ใหญ่)',
    };

    return {
      id: plan.id,
      code: plan.code,
      name: plan.name,
      nameTh: planNameTh[plan.code] || plan.name,
      priceMonthly: Number(plan.priceMonthly),
      priceMonthlyFormatted: this.formatCurrency(plan.priceMonthly),
      maxRooms: plan.maxRooms,
      maxUsers: plan.maxUsers,
      isCurrentPlan: true,
    };
  }

  private buildSubscriptionInfo(subscription: Subscription): SubscriptionInfo {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const endDate = new Date(subscription.endDate);
    endDate.setHours(0, 0, 0, 0);

    const daysRemaining = Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    const isExpired = daysRemaining < 0;
    const isExpiringSoon = daysRemaining <= 7 && daysRemaining > 0;

    return {
      id: subscription.id,
      status: this.buildSubscriptionStatusBadge(subscription.status),
      plan: subscription.plan ? this.buildPlanInfo(subscription.plan) : null,
      startDate: subscription.startDate?.toISOString?.() || String(subscription.startDate),
      endDate: subscription.endDate?.toISOString?.() || String(subscription.endDate),
      startDateFormatted: this.formatDateTh(subscription.startDate),
      endDateFormatted: this.formatDateTh(subscription.endDate),
      daysRemaining: Math.max(0, daysRemaining),
      daysRemainingText: this.getDaysRemainingText(daysRemaining),
      autoRenew: subscription.autoRenew,
      isExpiringSoon,
      isExpired,
    };
  }

  private buildStatistics(tenant: Tenant, invoices: Invoice[]): HotelStatistics {
    const paidInvoices = invoices.filter(inv => inv.status === InvoiceStatus.PAID);
    const pendingInvoices = invoices.filter(inv => inv.status === InvoiceStatus.PENDING);

    const totalRevenue = paidInvoices.reduce((sum, inv) => sum + Number(inv.amount), 0);
    const maxRooms = tenant.subscription?.plan?.maxRooms || 0;
    const usedRooms = tenant.roomCount;
    const availableRooms = Math.max(0, maxRooms - usedRooms);
    const roomUsagePercent = maxRooms > 0 ? Math.round((usedRooms / maxRooms) * 100) : 0;

    return {
      roomCount: tenant.roomCount,
      roomCountFormatted: `${tenant.roomCount} ห้อง`,
      usedRooms,
      availableRooms,
      roomUsagePercent,
      totalInvoices: invoices.length,
      pendingInvoices: pendingInvoices.length,
      paidInvoices: paidInvoices.length,
      totalRevenue,
      totalRevenueFormatted: this.formatCurrency(totalRevenue),
    };
  }

  private buildTrialInfo(tenant: Tenant): TrialInfo {
    const isInTrial = tenant.status === TenantStatus.TRIAL;

    if (!isInTrial || !tenant.trialEndsAt) {
      return {
        isInTrial: false,
        trialEndsAt: null,
        trialEndsAtFormatted: null,
        daysRemaining: 0,
        daysRemainingText: '-',
        isExpiringSoon: false,
        isExpired: false,
        canAccessPMS: tenant.status === TenantStatus.ACTIVE,
        restrictedFeatures: [],
      };
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const trialEnd = new Date(tenant.trialEndsAt);
    trialEnd.setHours(0, 0, 0, 0);

    const daysRemaining = Math.ceil((trialEnd.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    const isExpired = daysRemaining < 0;
    const isExpiringSoon = daysRemaining <= 3 && daysRemaining > 0;

    return {
      isInTrial: true,
      trialEndsAt: tenant.trialEndsAt?.toISOString?.() || String(tenant.trialEndsAt),
      trialEndsAtFormatted: this.formatDateTh(tenant.trialEndsAt),
      daysRemaining: Math.max(0, daysRemaining),
      daysRemainingText: this.getDaysRemainingText(daysRemaining),
      isExpiringSoon,
      isExpired,
      canAccessPMS: !isExpired,
      restrictedFeatures: ['ota_booking', 'advanced_report'],
    };
  }

  private buildFeatures(subscription: Subscription | null): {
    planFeatures: FeatureInfo[];
    addonFeatures: FeatureInfo[];
    allFeatures: FeatureInfo[];
    totalFeatureCount: number;
  } {
    if (!subscription) {
      return {
        planFeatures: [],
        addonFeatures: [],
        allFeatures: [],
        totalFeatureCount: 0,
      };
    }

    const featureNameTh: Record<string, string> = {
      pms_basic: 'ระบบจัดการโรงแรมพื้นฐาน',
      booking_calendar: 'ปฏิทินการจอง',
      guest_management: 'จัดการข้อมูลลูกค้า',
      basic_report: 'รายงานพื้นฐาน',
      ota_booking: 'เชื่อมต่อ OTA',
      advanced_report: 'รายงานขั้นสูง',
      automation: 'ระบบอัตโนมัติ',
      tax_invoice: 'ใบกำกับภาษี',
      multi_branch: 'หลายสาขา',
      api_access: 'API Access',
      extra_user: 'เพิ่มผู้ใช้',
    };

    const featureDescTh: Record<string, string> = {
      pms_basic: 'ระบบจัดการห้องพัก เช็คอิน/เช็คเอาท์',
      booking_calendar: 'ดูและจัดการการจองผ่านปฏิทิน',
      guest_management: 'บันทึกและจัดการข้อมูลผู้เข้าพัก',
      basic_report: 'รายงานยอดขาย และสถิติพื้นฐาน',
      ota_booking: 'รับจองจาก Agoda, Booking.com',
      advanced_report: 'รายงานวิเคราะห์เชิงลึก',
      automation: 'ส่งอีเมล/SMS อัตโนมัติ',
      tax_invoice: 'ออกใบกำกับภาษีอิเล็กทรอนิกส์',
      multi_branch: 'จัดการหลายสาขา',
      api_access: 'เชื่อมต่อระบบภายนอก',
      extra_user: 'เพิ่มบัญชีผู้ใช้งาน',
    };

    const featureIcons: Record<string, string> = {
      pms_basic: 'hotel',
      booking_calendar: 'calendar',
      guest_management: 'users',
      basic_report: 'chart-bar',
      ota_booking: 'globe',
      advanced_report: 'chart-pie',
      automation: 'cpu',
      tax_invoice: 'file-text',
      multi_branch: 'git-branch',
      api_access: 'code',
      extra_user: 'user-plus',
    };

    const planFeatures: FeatureInfo[] = (subscription.plan?.planFeatures || []).map((pf: any) => ({
      id: pf.feature?.id || '',
      code: pf.feature?.code || '',
      name: pf.feature?.name || '',
      nameTh: featureNameTh[pf.feature?.code] || pf.feature?.name || '',
      description: pf.feature?.description || '',
      descriptionTh: featureDescTh[pf.feature?.code] || pf.feature?.description || '',
      type: pf.feature?.type || 'MODULE',
      icon: featureIcons[pf.feature?.code] || 'check',
      isEnabled: true,
      source: 'plan' as const,
    }));

    const addonFeatures: FeatureInfo[] = (subscription.subscriptionFeatures || []).map((sf: any) => ({
      id: sf.feature?.id || '',
      code: sf.feature?.code || '',
      name: sf.feature?.name || '',
      nameTh: featureNameTh[sf.feature?.code] || sf.feature?.name || '',
      description: sf.feature?.description || '',
      descriptionTh: featureDescTh[sf.feature?.code] || sf.feature?.description || '',
      type: sf.feature?.type || 'MODULE',
      icon: featureIcons[sf.feature?.code] || 'check',
      isEnabled: true,
      source: 'addon' as const,
    }));

    // Combine unique features
    const allFeaturesMap = new Map<string, FeatureInfo>();
    [...planFeatures, ...addonFeatures].forEach(f => {
      if (f.id) allFeaturesMap.set(f.id, f);
    });

    return {
      planFeatures,
      addonFeatures,
      allFeatures: Array.from(allFeaturesMap.values()),
      totalFeatureCount: allFeaturesMap.size,
    };
  }

  private buildRecentInvoices(invoices: Invoice[]): InvoiceSummary[] {
    const statusLabelTh: Record<string, string> = {
      pending: 'รอชำระ',
      paid: 'ชำระแล้ว',
      rejected: 'ปฏิเสธ',
    };

    const statusColors: Record<string, string> = {
      pending: 'yellow',
      paid: 'green',
      rejected: 'red',
    };

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return invoices.slice(0, 5).map(inv => {
      const dueDate = new Date(inv.dueDate);
      dueDate.setHours(0, 0, 0, 0);
      const isOverdue = inv.status === InvoiceStatus.PENDING && dueDate < today;

      return {
        id: inv.id,
        invoiceNo: inv.invoiceNo,
        amount: Number(inv.amount),
        amountFormatted: this.formatCurrency(inv.amount),
        status: inv.status as 'pending' | 'paid' | 'rejected',
        statusLabel: inv.status.charAt(0).toUpperCase() + inv.status.slice(1),
        statusLabelTh: statusLabelTh[inv.status] || inv.status,
        statusColor: statusColors[inv.status] || 'gray',
        dueDate: inv.dueDate?.toISOString?.() || String(inv.dueDate),
        dueDateFormatted: this.formatDateTh(inv.dueDate),
        isOverdue,
        createdAt: inv.createdAt?.toISOString?.() || String(inv.createdAt),
      };
    });
  }

  private buildInvoiceSummary(invoices: Invoice[]): {
    totalPending: number;
    totalPendingFormatted: string;
    pendingCount: number;
    hasOverdueInvoices: boolean;
  } {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const pendingInvoices = invoices.filter(inv => inv.status === InvoiceStatus.PENDING);
    const totalPending = pendingInvoices.reduce((sum, inv) => sum + Number(inv.amount), 0);
    const hasOverdueInvoices = pendingInvoices.some(inv => {
      const dueDate = new Date(inv.dueDate);
      dueDate.setHours(0, 0, 0, 0);
      return dueDate < today;
    });

    return {
      totalPending,
      totalPendingFormatted: this.formatCurrency(totalPending),
      pendingCount: pendingInvoices.length,
      hasOverdueInvoices,
    };
  }

  private buildQuickActions(tenant: Tenant): QuickAction[] {
    const actions: QuickAction[] = [];
    const isActive = tenant.status === TenantStatus.ACTIVE;
    const isTrial = tenant.status === TenantStatus.TRIAL;
    const isSuspended = tenant.status === TenantStatus.SUSPENDED;

    // Edit Hotel
    actions.push({
      key: 'edit',
      label: 'Edit Hotel',
      labelTh: 'แก้ไขข้อมูล',
      icon: 'edit',
      type: 'secondary',
      action: 'edit',
      isDisabled: false,
    });

    // Upgrade Plan
    if (isActive || isTrial) {
      actions.push({
        key: 'upgrade',
        label: 'Upgrade Plan',
        labelTh: 'อัพเกรดแพ็คเกจ',
        icon: 'arrow-up',
        type: 'primary',
        action: 'upgrade',
        isDisabled: false,
      });
    }

    // Add Feature
    if (isActive) {
      actions.push({
        key: 'add_feature',
        label: 'Add Feature',
        labelTh: 'เพิ่มฟีเจอร์',
        icon: 'plus',
        type: 'secondary',
        action: 'add_feature',
        isDisabled: false,
      });
    }

    // View Invoices
    actions.push({
      key: 'invoices',
      label: 'View Invoices',
      labelTh: 'ดูใบแจ้งหนี้',
      icon: 'file-text',
      type: 'secondary',
      action: 'invoices',
      isDisabled: false,
    });

    // Make Payment (if trial)
    if (isTrial) {
      actions.push({
        key: 'subscribe',
        label: 'Subscribe Now',
        labelTh: 'สมัครแพ็คเกจ',
        icon: 'credit-card',
        type: 'primary',
        action: 'subscribe',
        isDisabled: false,
      });
    }

    // Suspend/Unsuspend
    if (isActive) {
      actions.push({
        key: 'suspend',
        label: 'Suspend Hotel',
        labelTh: 'ระงับโรงแรม',
        icon: 'pause',
        type: 'danger',
        action: 'suspend',
        isDisabled: false,
      });
    } else if (isSuspended) {
      actions.push({
        key: 'unsuspend',
        label: 'Unsuspend Hotel',
        labelTh: 'ยกเลิกการระงับ',
        icon: 'play',
        type: 'warning',
        action: 'unsuspend',
        isDisabled: false,
      });
    }

    return actions;
  }

  private buildAlerts(tenant: Tenant): {
    type: 'info' | 'warning' | 'error' | 'success';
    title: string;
    titleTh: string;
    message: string;
    messageTh: string;
    action?: QuickAction;
  }[] {
    const alerts: any[] = [];

    // Trial Alert
    if (tenant.status === TenantStatus.TRIAL && tenant.trialEndsAt) {
      const today = new Date();
      const trialEnd = new Date(tenant.trialEndsAt);
      const daysRemaining = Math.ceil((trialEnd.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

      if (daysRemaining <= 3 && daysRemaining > 0) {
        alerts.push({
          type: 'warning',
          title: 'Trial Expiring Soon',
          titleTh: 'ทดลองใช้ใกล้หมดอายุ',
          message: `Your trial expires in ${daysRemaining} day(s)`,
          messageTh: `เหลือเวลาทดลองใช้อีก ${daysRemaining} วัน`,
          action: {
            key: 'subscribe',
            label: 'Subscribe Now',
            labelTh: 'สมัครแพ็คเกจเลย',
            icon: 'credit-card',
            type: 'primary',
            action: 'subscribe',
            isDisabled: false,
          },
        });
      } else if (daysRemaining > 3) {
        alerts.push({
          type: 'info',
          title: 'Trial Period',
          titleTh: 'ช่วงทดลองใช้',
          message: `${daysRemaining} days remaining in your trial`,
          messageTh: `เหลือเวลาทดลองใช้อีก ${daysRemaining} วัน`,
        });
      }
    }

    // Expired Alert
    if (tenant.status === TenantStatus.EXPIRED) {
      alerts.push({
        type: 'error',
        title: 'Subscription Expired',
        titleTh: 'แพ็คเกจหมดอายุ',
        message: 'Your subscription has expired. Please renew to continue using.',
        messageTh: 'แพ็คเกจของคุณหมดอายุแล้ว กรุณาต่ออายุเพื่อใช้งานต่อ',
        action: {
          key: 'renew',
          label: 'Renew Now',
          labelTh: 'ต่ออายุเลย',
          icon: 'refresh-cw',
          type: 'primary',
          action: 'renew',
          isDisabled: false,
        },
      });
    }

    // Suspended Alert
    if (tenant.status === TenantStatus.SUSPENDED) {
      alerts.push({
        type: 'error',
        title: 'Account Suspended',
        titleTh: 'บัญชีถูกระงับ',
        message: 'Your account has been suspended. Please contact support.',
        messageTh: 'บัญชีของคุณถูกระงับ กรุณาติดต่อฝ่ายสนับสนุน',
      });
    }

    return alerts;
  }

  private buildMetadata(tenant: Tenant): {
    createdAt: string;
    createdAtFormatted: string;
    updatedAt: string;
    updatedAtFormatted: string;
    memberSince: string;
    lastActivityAt?: string;
  } {
    const createdAt = new Date(tenant.createdAt);
    const now = new Date();
    const monthsDiff = Math.floor((now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24 * 30));

    let memberSince: string;
    if (monthsDiff < 1) {
      const daysDiff = Math.floor((now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24));
      memberSince = daysDiff <= 0 ? 'วันนี้' : `${daysDiff} วัน`;
    } else if (monthsDiff < 12) {
      memberSince = `${monthsDiff} เดือน`;
    } else {
      const years = Math.floor(monthsDiff / 12);
      memberSince = `${years} ปี`;
    }

    return {
      createdAt: tenant.createdAt?.toISOString?.() || String(tenant.createdAt),
      createdAtFormatted: this.formatDateTh(tenant.createdAt),
      updatedAt: tenant.updatedAt?.toISOString?.() || String(tenant.updatedAt),
      updatedAtFormatted: this.formatDateTh(tenant.updatedAt),
      memberSince: `เป็นสมาชิกมา ${memberSince}`,
    };
  }

  private buildPermissions(tenant: Tenant): {
    canEdit: boolean;
    canDelete: boolean;
    canUpgrade: boolean;
    canDowngrade: boolean;
    canAddFeatures: boolean;
    canViewInvoices: boolean;
    canMakePayment: boolean;
    canAccessPMS: boolean;
  } {
    const isActive = tenant.status === TenantStatus.ACTIVE;
    const isTrial = tenant.status === TenantStatus.TRIAL;
    const isSuspended = tenant.status === TenantStatus.SUSPENDED;

    return {
      canEdit: true,
      canDelete: !isActive, // Can't delete active hotels
      canUpgrade: isActive || isTrial,
      canDowngrade: isActive,
      canAddFeatures: isActive,
      canViewInvoices: true,
      canMakePayment: isActive || isTrial,
      canAccessPMS: isActive || isTrial,
    };
  }

  // ===== Utility Methods =====

  private formatCurrency(amount: number | string): string {
    const num = typeof amount === 'string' ? parseFloat(amount) : amount;
    return new Intl.NumberFormat('th-TH', {
      style: 'currency',
      currency: 'THB',
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(num);
  }

  private formatDateTh(date: Date | string): string {
    if (!date) return '-';

    const d = typeof date === 'string' ? new Date(date) : date;

    const thaiMonths = [
      'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
      'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
    ];

    const day = d.getDate();
    const month = thaiMonths[d.getMonth()];
    const year = d.getFullYear() + 543; // Buddhist Era

    return `${day} ${month} ${year}`;
  }

  private getDaysRemainingText(days: number): string {
    if (days < 0) {
      return 'หมดอายุแล้ว';
    } else if (days === 0) {
      return 'หมดอายุวันนี้';
    } else if (days === 1) {
      return 'เหลือ 1 วัน';
    } else {
      return `เหลือ ${days} วัน`;
    }
  }
}
