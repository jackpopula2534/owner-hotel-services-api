/**
 * Hotel Services API - Frontend Type Definitions
 * Generated from Backend Controllers
 *
 * Usage in Frontend:
 * import { LoginDto, BookingStatus, ApiResponse } from '@hotel-services/api-types';
 */

// ============================================
// Common Types
// ============================================

export interface ApiResponse<T> {
  success: boolean;
  statusCode: number;
  timestamp: string;
  data: T;
  metadata?: {
    page?: number;
    limit?: number;
    total?: number;
    totalPages?: number;
  };
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages?: number;
}

export interface PaginationParams {
  page?: number;
  limit?: number;
}

// ============================================
// Authentication Types
// ============================================

export interface LoginDto {
  email: string;
  password: string;
}

export interface RegisterDto {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
  requires2FA?: boolean;
  tempToken?: string;
}

export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  tenantId?: string;
  isPlatformAdmin?: boolean;
}

export type UserRole =
  | 'platform_admin'
  | 'tenant_admin'
  | 'admin'
  | 'manager'
  | 'receptionist'
  | 'accountant'
  | 'staff'
  | 'user';

export interface RefreshTokenDto {
  refreshToken: string;
}

export interface ForgotPasswordDto {
  email: string;
}

export interface ResetPasswordDto {
  token: string;
  newPassword: string;
}

// ============================================
// Two-Factor Authentication Types
// ============================================

export interface TwoFactorEnableResponse {
  secret: string;
  qrCode: string;
  otpauthUrl: string;
}

export interface TwoFactorStatus {
  enabled: boolean;
  enabledAt: string | null;
  backupCodesRemaining: number;
}

export interface Verify2FADto {
  code: string;
}

export interface Disable2FADto {
  password: string;
  code: string;
}

export interface Login2FADto {
  code: string;
  tempToken: string;
}

export interface VerifyBackupCodeDto {
  backupCode: string;
  tempToken: string;
}

export interface TwoFactorVerifyResponse {
  success: boolean;
  message: string;
  backupCodes?: string[];
}

export interface TwoFactorValidateResponse {
  success: boolean;
  userId?: string;
  email?: string;
  message: string;
}

// ============================================
// Email Notification Types
// ============================================

export type EmailTemplate =
  | 'welcome'
  | 'booking_confirmation'
  | 'booking_cancellation'
  | 'booking_reminder'
  | 'payment_received'
  | 'payment_failed'
  | 'password_reset'
  | 'promotion'
  | 'review_request'
  | 'invoice';

export interface SendEmailDto {
  to: string;
  subject: string;
  template: EmailTemplate;
  context: Record<string, any>;
  tenantId?: string;
}

export interface SendBulkEmailDto {
  recipients: Array<{
    to: string;
    context: Record<string, any>;
  }>;
  subject: string;
  template: EmailTemplate;
  tenantId?: string;
}

export interface EmailHistoryQueryDto extends PaginationParams {
  startDate?: string;
  endDate?: string;
  status?: EmailStatus;
  template?: EmailTemplate;
}

export type EmailStatus = 'pending' | 'sent' | 'failed' | 'bounced';

export interface EmailLog {
  id: string;
  to: string;
  subject: string;
  template: EmailTemplate;
  status: EmailStatus;
  sentAt?: string;
  error?: string;
  createdAt: string;
}

export interface EmailTemplateInfo {
  id: string;
  name: string;
  description: string;
  variables: string[];
}

export interface ResendEmailDto {
  emailLogId: string;
}

// ============================================
// PromptPay Payment Types
// ============================================

export interface GenerateQRCodeDto {
  amount: number;
  reference: string;
  description?: string;
  bookingId?: string;
  invoiceId?: string;
  tenantId?: string;
}

export interface GenerateQRCodeResponse {
  success: boolean;
  transactionRef: string;
  qrCodeData: string;
  qrCodeString: string;
  amount: number;
  expiresAt: string;
}

export type PaymentStatus = 'pending' | 'completed' | 'failed' | 'expired' | 'refunded';

export interface PaymentStatusResponse {
  transactionRef: string;
  status: PaymentStatus;
  amount: number;
  createdAt: string;
  paidAt?: string;
  payerInfo?: {
    bankCode: string;
    bankName?: string;
    accountLastDigits: string;
  };
}

export interface WebhookPaymentDto {
  transactionRef: string;
  status: 'SUCCESS' | 'FAILED' | 'EXPIRED';
  amount?: number;
  paidAt?: string;
  errorCode?: string;
  signature: string;
}

export interface VerifyPaymentDto {
  transactionRef: string;
}

export interface TransactionQueryDto extends PaginationParams {
  status?: PaymentStatus;
  startDate?: string;
  endDate?: string;
}

export interface Transaction {
  id: string;
  transactionRef: string;
  amount: number;
  status: PaymentStatus;
  reference: string;
  description?: string;
  bookingId?: string;
  createdAt: string;
  paidAt?: string;
  verifiedBy?: string;
}

export interface ReconciliationReport {
  date: string;
  totalTransactions: number;
  totalAmount: number;
  successfulTransactions: number;
  failedTransactions: number;
  pendingTransactions: number;
  breakdown: {
    byHour: Array<{ hour: number; count: number; amount: number }>;
    byStatus: Record<PaymentStatus, { count: number; amount: number }>;
  };
}

export interface RefundRequestDto {
  transactionRef: string;
  amount: number;
  reason: string;
}

export interface RefundResponse {
  success: boolean;
  refundRef: string;
  originalTransaction: string;
  refundAmount: number;
  originalAmount?: number;
  status: 'processing' | 'completed' | 'failed';
}

// ============================================
// Reports Export Types
// ============================================

export type ExportFormat = 'excel' | 'csv' | 'pdf';

export type ReportType =
  | 'bookings'
  | 'rooms'
  | 'guests'
  | 'revenue'
  | 'occupancy'
  | 'payments'
  | 'audit_logs';

export interface ExportRequestDto {
  type: ReportType;
  format: ExportFormat;
  dateRange?: {
    start: string;
    end: string;
  };
  columns?: string[];
  filters?: Record<string, any>;
  title?: string;
}

export interface ExportResponseDto {
  success: boolean;
  filename: string;
  data: string; // base64 encoded
  mimeType: string;
}

// ============================================
// Audit Log Types
// ============================================

export type AuditAction =
  | 'USER_LOGIN'
  | 'USER_LOGOUT'
  | 'USER_CREATED'
  | 'USER_UPDATED'
  | 'USER_DELETED'
  | 'BOOKING_CREATED'
  | 'BOOKING_UPDATED'
  | 'BOOKING_CANCELLED'
  | 'BOOKING_CHECKIN'
  | 'BOOKING_CHECKOUT'
  | 'ROOM_STATUS_CHANGED'
  | 'PAYMENT_RECEIVED'
  | 'PAYMENT_REFUNDED'
  | 'SETTINGS_UPDATED'
  | 'SUBSCRIPTION_CHANGED';

export interface AuditLogQueryDto extends PaginationParams {
  action?: AuditAction;
  userId?: string;
  startDate?: string;
  endDate?: string;
}

export interface AuditLog {
  id: string;
  action: AuditAction;
  userId: string;
  userEmail: string;
  tenantId: string;
  timestamp: string;
  ipAddress: string;
  userAgent: string;
  details: Record<string, any>;
}

// ============================================
// Line Notify Types
// ============================================

export type LineNotifyEventType =
  | 'BOOKING_CREATED'
  | 'BOOKING_CONFIRMED'
  | 'BOOKING_CANCELLED'
  | 'BOOKING_CHECKIN'
  | 'BOOKING_CHECKOUT'
  | 'PAYMENT_RECEIVED'
  | 'PAYMENT_FAILED'
  | 'DAILY_SUMMARY'
  | 'NEW_REVIEW'
  | 'SYSTEM_ALERT';

export interface LineNotifyStatus {
  connected: boolean;
  targetName: string | null;
  targetType: 'USER' | 'GROUP' | null;
  connectedAt: string | null;
  preferences: LineNotifyPreferences | null;
}

export interface LineNotifyPreferences {
  booking_created: boolean;
  booking_cancelled: boolean;
  booking_checkin: boolean;
  booking_checkout: boolean;
  payment_received: boolean;
  payment_failed: boolean;
  daily_summary: boolean;
  new_review: boolean;
  system_alert: boolean;
}

export interface SendLineNotifyDto {
  message: string;
  imageUrl?: string;
  stickerPackageId?: number;
  stickerId?: number;
}

export interface LineNotifyEventTypeInfo {
  key: LineNotifyEventType;
  label: string;
  labelTh: string;
}

export interface LineNotifyConnectedUser {
  userId: string;
  targetName: string;
  targetType: 'USER' | 'GROUP';
  connectedAt: string;
}

// ============================================
// i18n Translation Types
// ============================================

export type SupportedLanguage = 'th' | 'en' | 'zh' | 'ja' | 'ko';

export interface LanguageInfo {
  code: SupportedLanguage;
  name: string;
  nativeName: string;
  default: boolean;
}

export interface TranslateDto {
  key: string;
  language: SupportedLanguage;
  variables?: Record<string, string>;
}

export interface TranslateBulkDto {
  keys: string[];
  language: SupportedLanguage;
}

export interface TranslationResponse {
  key: string;
  value: string;
  language: SupportedLanguage;
}

// ============================================
// Database Performance Types (Admin Only)
// ============================================

export interface SlowQueryReport {
  totalSlowQueries: number;
  averageExecutionTime: number;
  slowestQueries: Array<{
    query: string;
    executionTime: number;
    timestamp: string;
    table: string;
  }>;
  byTable: Record<string, number>;
}

export interface QueryPatternAnalysis {
  totalQueries: number;
  uniquePatterns: number;
  patterns: Array<{
    pattern: string;
    count: number;
    averageTime: number;
    recommendation: string | null;
  }>;
  recommendations: Array<{
    type: 'INDEX' | 'QUERY_OPTIMIZATION' | 'CACHING';
    table: string;
    column?: string;
    impact: 'HIGH' | 'MEDIUM' | 'LOW';
    description: string;
  }>;
}

export interface N1DetectionResult {
  detectedProblems: number;
  problems: Array<{
    entity: string;
    relation: string;
    occurrences: number;
    suggestedFix: string;
    severity: 'HIGH' | 'MEDIUM' | 'LOW';
  }>;
  analyzedPeriod?: {
    start: string;
    end: string;
  };
  message?: string;
}

export type DatabaseHealthStatus = 'healthy' | 'degraded' | 'unhealthy';

export interface DatabaseHealth {
  status: DatabaseHealthStatus;
  connectionPool: {
    total: number;
    active: number;
    idle: number;
    waiting: number;
  };
  performance: {
    averageQueryTime: number;
    queriesPerSecond: number;
    slowQueryPercentage: number;
  };
  storage?: {
    databaseSize: string;
    indexSize: string;
    tableCount: number;
  };
  replication?: {
    enabled: boolean;
    lag: number;
    status: string;
  };
  issues?: string[];
  warnings?: string[];
  lastChecked: string;
}

// ============================================
// Mobile API Types
// ============================================

export interface MobileAppConfig {
  appVersion: string;
  minVersion: string;
  forceUpdate: boolean;
  maintenanceMode: boolean;
  maintenanceMessage?: string;
  features: {
    qrCheckIn: boolean;
    offlineMode: boolean;
    pushNotifications: boolean;
    biometricAuth: boolean;
  };
  apiEndpoints: {
    baseUrl: string;
    wsUrl: string;
  };
}

export interface MobileDashboard {
  todayStats: {
    checkIns: number;
    checkOuts: number;
    newBookings: number;
    revenue: number;
  };
  occupancy: {
    total: number;
    occupied: number;
    available: number;
    maintenance: number;
    percentage: number;
  };
  upcomingCheckIns: Array<{
    id: string;
    guestName: string;
    roomNumber: string;
    time: string;
  }>;
  alerts: Array<{
    type: 'info' | 'warning' | 'error';
    message: string;
    timestamp?: string;
  }>;
}

export type BookingStatus =
  | 'pending'
  | 'confirmed'
  | 'checked_in'
  | 'checked_out'
  | 'cancelled'
  | 'no_show';

export interface MobileBookingSummary {
  id: string;
  guestName: string;
  guestPhone?: string;
  roomNumber: string;
  roomType?: string;
  checkIn: string;
  checkOut: string;
  status: BookingStatus;
  totalAmount?: number;
  paidAmount?: number;
  notes?: string;
}

export type RoomStatus = 'available' | 'occupied' | 'maintenance' | 'cleaning' | 'reserved';

export interface MobileRoomSummary {
  id: string;
  number: string;
  type: string;
  status: RoomStatus;
  floor: number;
  currentGuest?: string;
  checkoutTime?: string;
}

export interface MobileGuestSummary {
  id: string;
  name: string;
  email: string;
  phone?: string;
  visits: number;
  lastVisit?: string;
  totalSpent?: number;
  vipStatus?: boolean;
}

export interface MobileSearchResult {
  bookings: MobileBookingSummary[];
  rooms: MobileRoomSummary[];
  guests: MobileGuestSummary[];
}

// ============================================
// Push Notifications Types
// ============================================

export type DevicePlatform = 'ios' | 'android' | 'web';

export interface RegisterDeviceDto {
  token: string;
  platform: DevicePlatform;
  deviceName?: string;
  osVersion?: string;
  appVersion?: string;
}

export interface DeviceInfo {
  id: string;
  userId: string;
  token: string;
  platform: DevicePlatform;
  deviceName: string;
  createdAt: string;
  lastActiveAt?: string;
}

export interface PushPreferences {
  bookingCreated: boolean;
  bookingCancelled: boolean;
  checkInReminder: boolean;
  paymentReceived: boolean;
  dailySummary: boolean;
  promotions: boolean;
  systemAlerts: boolean;
}

export interface SendPushNotificationDto {
  userId: string;
  title: string;
  body: string;
  data?: Record<string, any>;
  imageUrl?: string;
  badge?: number;
  sound?: string;
}

export interface SendBulkPushNotificationDto {
  userIds: string[];
  title: string;
  body: string;
  data?: Record<string, any>;
}

export interface SendTopicNotificationDto {
  topic: string;
  title: string;
  body: string;
  data?: Record<string, any>;
}

export interface PushNotificationResult {
  success: boolean;
  messageId?: string;
  sentTo?: number;
  failed?: number;
  errors?: Array<{
    userId: string;
    error: string;
  }>;
}

// ============================================
// Booking Types
// ============================================

export interface Booking {
  id: string;
  bookingNumber: string;
  guestId: string;
  guest: Guest;
  roomId: string;
  room: Room;
  checkIn: string;
  checkOut: string;
  status: BookingStatus;
  adults: number;
  children: number;
  totalAmount: number;
  paidAmount: number;
  paymentStatus: 'unpaid' | 'partial' | 'paid' | 'refunded';
  source: 'direct' | 'website' | 'ota' | 'phone' | 'walkin';
  specialRequests?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBookingDto {
  guestId?: string;
  guestInfo?: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
  };
  roomId: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  children?: number;
  specialRequests?: string;
  source?: string;
}

export interface UpdateBookingDto {
  roomId?: string;
  checkIn?: string;
  checkOut?: string;
  status?: BookingStatus;
  adults?: number;
  children?: number;
  specialRequests?: string;
  notes?: string;
}

// ============================================
// Room Types
// ============================================

export interface Room {
  id: string;
  number: string;
  name?: string;
  type: string;
  floor: number;
  status: RoomStatus;
  capacity: {
    adults: number;
    children: number;
  };
  basePrice: number;
  amenities: string[];
  images: string[];
  description?: string;
  isActive: boolean;
}

export interface RoomType {
  id: string;
  name: string;
  description: string;
  basePrice: number;
  maxOccupancy: number;
  amenities: string[];
  images: string[];
}

// ============================================
// Guest Types
// ============================================

export interface Guest {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  nationality?: string;
  idNumber?: string;
  idType?: 'passport' | 'national_id' | 'driving_license';
  dateOfBirth?: string;
  address?: Address;
  notes?: string;
  vipStatus: boolean;
  totalVisits: number;
  totalSpent: number;
  createdAt: string;
  updatedAt: string;
}

export interface Address {
  street?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
}

// ============================================
// Subscription & Plan Types
// ============================================

export type SubscriptionStatus = 'active' | 'trial' | 'past_due' | 'cancelled' | 'expired';

export interface Subscription {
  id: string;
  tenantId: string;
  planId: string;
  plan: Plan;
  status: SubscriptionStatus;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  trialEndsAt?: string;
  createdAt: string;
}

export interface Plan {
  id: string;
  code: string;
  name: string;
  description: string;
  price: number;
  billingPeriod: 'monthly' | 'yearly';
  features: PlanFeature[];
  limits: {
    rooms: number;
    users: number;
    bookingsPerMonth: number;
  };
  isPopular?: boolean;
  isActive: boolean;
}

export interface PlanFeature {
  id: string;
  name: string;
  description: string;
  included: boolean;
}

// ============================================
// Invoice Types
// ============================================

export type InvoiceStatus = 'draft' | 'pending' | 'paid' | 'overdue' | 'cancelled' | 'refunded';

export interface Invoice {
  id: string;
  invoiceNumber: string;
  tenantId: string;
  subscriptionId?: string;
  status: InvoiceStatus;
  amount: number;
  tax: number;
  total: number;
  currency: string;
  dueDate: string;
  paidAt?: string;
  items: InvoiceItem[];
  createdAt: string;
}

export interface InvoiceItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

// ============================================
// Tenant/Hotel Types
// ============================================

export type TenantStatus = 'active' | 'inactive' | 'suspended' | 'pending';

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  email: string;
  phone?: string;
  address?: Address;
  logo?: string;
  website?: string;
  status: TenantStatus;
  settings: TenantSettings;
  subscription?: Subscription;
  createdAt: string;
  updatedAt: string;
}

export interface TenantSettings {
  timezone: string;
  currency: string;
  language: SupportedLanguage;
  checkInTime: string;
  checkOutTime: string;
  taxRate: number;
  emailNotifications: boolean;
  smsNotifications: boolean;
}

// ============================================
// Error Types
// ============================================

export interface ApiError {
  success: false;
  statusCode: number;
  timestamp: string;
  message: string;
  error?: string;
  details?: Record<string, any>;
  validationErrors?: ValidationError[];
}

export interface ValidationError {
  field: string;
  message: string;
  value?: any;
}

// ============================================
// Utility Types
// ============================================

export type Nullable<T> = T | null;
export type Optional<T> = T | undefined;

export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

export type AsyncResult<T> = Promise<ApiResponse<T>>;
