/**
 * Hotel Detail Response DTO
 * ข้อมูลรายละเอียดโรงแรมสำหรับแสดงผลแบบ Professional UX/UI
 */

// ===== Status Badge Types =====
export type HotelStatusBadge = {
  status: 'trial' | 'active' | 'suspended' | 'expired';
  label: string;
  labelTh: string;
  color: 'blue' | 'green' | 'red' | 'gray' | 'orange';
  bgColor: string;
  textColor: string;
};

export type SubscriptionStatusBadge = {
  status: 'trial' | 'pending' | 'active' | 'expired' | 'cancelled';
  label: string;
  labelTh: string;
  color: 'blue' | 'green' | 'yellow' | 'red' | 'gray';
  bgColor: string;
  textColor: string;
};

// ===== Plan Information =====
export type PlanInfo = {
  id: string;
  code: string;
  name: string;
  nameTh: string;
  priceMonthly: number;
  priceMonthlyFormatted: string;
  maxRooms: number;
  maxUsers: number;
  isCurrentPlan: boolean;
};

// ===== Subscription Information =====
export type SubscriptionInfo = {
  id: string;
  status: SubscriptionStatusBadge;
  plan: PlanInfo;
  startDate: string;
  endDate: string;
  startDateFormatted: string;
  endDateFormatted: string;
  daysRemaining: number;
  daysRemainingText: string;
  autoRenew: boolean;
  isExpiringSoon: boolean; // < 7 วัน
  isExpired: boolean;
};

// ===== Feature Information =====
export type FeatureInfo = {
  id: string;
  code: string;
  name: string;
  nameTh: string;
  description: string;
  descriptionTh: string;
  type: 'MODULE' | 'TOGGLE' | 'LIMIT';
  icon: string;
  isEnabled: boolean;
  source: 'plan' | 'addon'; // มาจาก plan หรือซื้อเพิ่ม
};

// ===== Statistics =====
export type HotelStatistics = {
  roomCount: number;
  roomCountFormatted: string;
  usedRooms: number;
  availableRooms: number;
  roomUsagePercent: number;
  totalInvoices: number;
  pendingInvoices: number;
  paidInvoices: number;
  totalRevenue: number;
  totalRevenueFormatted: string;
};

// ===== Trial Information =====
export type TrialInfo = {
  isInTrial: boolean;
  trialEndsAt: string | null;
  trialEndsAtFormatted: string | null;
  daysRemaining: number;
  daysRemainingText: string;
  isExpiringSoon: boolean; // < 3 วัน
  isExpired: boolean;
  canAccessPMS: boolean;
  restrictedFeatures: string[];
};

// ===== Invoice Summary =====
export type InvoiceSummary = {
  id: string;
  invoiceNo: string;
  amount: number;
  amountFormatted: string;
  status: 'pending' | 'paid' | 'rejected';
  statusLabel: string;
  statusLabelTh: string;
  statusColor: string;
  dueDate: string;
  dueDateFormatted: string;
  isOverdue: boolean;
  createdAt: string;
};

// ===== Quick Actions =====
export type QuickAction = {
  key: string;
  label: string;
  labelTh: string;
  icon: string;
  type: 'primary' | 'secondary' | 'danger' | 'warning';
  href?: string;
  action?: string;
  isDisabled: boolean;
  disabledReason?: string;
};

// ===== Contact Information =====
export type ContactInfo = {
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  province?: string;
  postalCode?: string;
  country?: string;
};

// ===== Main Hotel Detail Response =====
export class HotelDetailResponseDto {
  // === Basic Information ===
  id: string;
  name: string;
  code?: string;
  description?: string;

  // === Status ===
  status: HotelStatusBadge;

  // === Location ===
  location?: {
    city?: string;
    province?: string;
    region?: string;
    country?: string;
    fullAddress?: string;
  };

  // === Contact ===
  contact?: ContactInfo;

  // === Statistics ===
  statistics: HotelStatistics;

  // === Subscription & Plan ===
  subscription: SubscriptionInfo | null;

  // === Trial Status ===
  trial: TrialInfo;

  // === Features ===
  features: {
    planFeatures: FeatureInfo[];
    addonFeatures: FeatureInfo[];
    allFeatures: FeatureInfo[];
    totalFeatureCount: number;
  };

  // === Recent Invoices ===
  recentInvoices: InvoiceSummary[];
  invoiceSummary: {
    totalPending: number;
    totalPendingFormatted: string;
    pendingCount: number;
    hasOverdueInvoices: boolean;
  };

  // === Quick Actions ===
  quickActions: QuickAction[];

  // === Alerts & Notifications ===
  alerts: {
    type: 'info' | 'warning' | 'error' | 'success';
    title: string;
    titleTh: string;
    message: string;
    messageTh: string;
    action?: QuickAction;
  }[];

  // === Metadata ===
  metadata: {
    createdAt: string;
    createdAtFormatted: string;
    updatedAt: string;
    updatedAtFormatted: string;
    memberSince: string; // e.g., "เป็นสมาชิกมา 3 เดือน"
    lastActivityAt?: string;
  };

  // === Permissions (สำหรับ UI control) ===
  permissions: {
    canEdit: boolean;
    canDelete: boolean;
    canUpgrade: boolean;
    canDowngrade: boolean;
    canAddFeatures: boolean;
    canViewInvoices: boolean;
    canMakePayment: boolean;
    canAccessPMS: boolean;
  };
}
