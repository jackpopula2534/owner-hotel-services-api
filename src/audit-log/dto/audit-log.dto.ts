import { IsString, IsOptional, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum AuditAction {
  // Auth
  LOGIN = 'login',
  LOGOUT = 'logout',
  LOGIN_FAILED = 'login_failed',
  PASSWORD_RESET = 'password_reset',
  TWO_FA_ENABLED = '2fa_enabled',
  TWO_FA_DISABLED = '2fa_disabled',

  // CRUD
  CREATE = 'create',
  READ = 'read',
  UPDATE = 'update',
  DELETE = 'delete',

  // Booking
  BOOKING_CREATE = 'booking_create',
  BOOKING_CONFIRM = 'booking_confirm',
  BOOKING_UPDATE = 'booking_update',
  BOOKING_CANCEL = 'booking_cancel',
  BOOKING_CHECKIN = 'booking_checkin',
  BOOKING_CHECKOUT = 'booking_checkout',
  BOOKING_EARLY_CHECKIN_REQUEST = 'booking_early_checkin_request',
  BOOKING_EARLY_CHECKIN_APPROVE = 'booking_early_checkin_approve',
  BOOKING_LATE_CHECKOUT_REQUEST = 'booking_late_checkout_request',
  BOOKING_LATE_CHECKOUT_APPROVE = 'booking_late_checkout_approve',
  BOOKING_FOLIO_CHARGE = 'booking_folio_charge',
  BOOKING_FOLIO_FINALIZE = 'booking_folio_finalize',
  BOOKING_PAYMENT = 'booking_payment',
  BOOKING_NOTE_UPDATE = 'booking_note_update',
  HOUSEKEEPING_TASK_COMPLETE = 'housekeeping_task_complete',

  // Payment
  PAYMENT_CREATE = 'payment_create',
  PAYMENT_APPROVE = 'payment_approve',
  PAYMENT_REJECT = 'payment_reject',
  REFUND_CREATE = 'refund_create',
  REFUND_APPROVE = 'refund_approve',

  // Room
  ROOM_CREATE = 'room_create',
  ROOM_UPDATE = 'room_update',
  ROOM_DELETE = 'room_delete',
  ROOM_STATUS_CHANGE = 'room_status_change',

  // Guest
  GUEST_CREATE = 'guest_create',
  GUEST_UPDATE = 'guest_update',
  GUEST_DELETE = 'guest_delete',
  GUEST_DATA_ACCESS = 'guest_data_access',

  // Restaurant
  ORDER_CREATE = 'order_create',
  ORDER_UPDATE = 'order_update',
  ORDER_CANCEL = 'order_cancel',
  MENU_CREATE = 'menu_create',
  MENU_UPDATE = 'menu_update',
  MENU_DELETE = 'menu_delete',

  // Maintenance
  MAINTENANCE_CREATE = 'maintenance_create',
  MAINTENANCE_UPDATE = 'maintenance_update',
  MAINTENANCE_COMPLETE = 'maintenance_complete',

  // Settings
  SETTINGS_UPDATE = 'settings_update',

  // Employee/HR
  EMPLOYEE_CREATE = 'employee_create',
  EMPLOYEE_UPDATE = 'employee_update',
  EMPLOYEE_DELETE = 'employee_delete',

  // Staff
  STAFF_CREATE = 'staff_create',
  STAFF_UPDATE = 'staff_update',
  STAFF_DELETE = 'staff_delete',

  // Properties
  PROPERTY_CREATE = 'property_create',
  PROPERTY_UPDATE = 'property_update',

  // Permissions
  ROLE_CHANGE = 'role_change',
  PERMISSION_GRANT = 'permission_grant',
  PERMISSION_REVOKE = 'permission_revoke',

  // Subscription
  SUBSCRIPTION_CREATE = 'subscription_create',
  SUBSCRIPTION_UPDATE = 'subscription_update',
  SUBSCRIPTION_CANCEL = 'subscription_cancel',
  PLAN_UPGRADE = 'plan_upgrade',
  PLAN_DOWNGRADE = 'plan_downgrade',

  // User
  USER_CREATE = 'user_create',
  USER_UPDATE = 'user_update',
  USER_DELETE = 'user_delete',
  USER_STATUS_CHANGE = 'user_status_change',
  USER_SUSPEND = 'user_suspend',
  USER_ACTIVATE = 'user_activate',
  USER_DEACTIVATE = 'user_deactivate',
  USER_EXPIRATION_SET = 'user_expiration_set',
  USER_AUTO_EXPIRED = 'user_auto_expired',

  // Procurement — Price Comparison approval workflow
  PRICE_COMPARISON_SUBMITTED = 'price_comparison_submitted',
  PRICE_COMPARISON_APPROVED = 'price_comparison_approved',
  PRICE_COMPARISON_REJECTED = 'price_comparison_rejected',
}

export enum AuditResource {
  USER = 'user',
  ADMIN = 'admin',
  BOOKING = 'booking',
  GUEST = 'guest',
  ROOM = 'room',
  PROPERTY = 'property',
  PAYMENT = 'payment',
  INVOICE = 'invoice',
  EMPLOYEE = 'employee',
  SUBSCRIPTION = 'subscription',
  PLAN = 'plan',
  SETTINGS = 'settings',
  CHANNEL = 'channel',
  REVIEW = 'review',
  HOUSEKEEPING_TASK = 'housekeeping_task',
  MAINTENANCE_TASK = 'maintenance_task',
  ORDER = 'order',
  MENU = 'menu',
  STAFF = 'staff',
  PRICE_COMPARISON = 'price_comparison',
}

/** Category tags for grouping audit logs by system area */
export enum AuditCategory {
  AUTH = 'auth',
  ROOMS = 'rooms',
  GUESTS = 'guests',
  BOOKINGS = 'bookings',
  RESTAURANT = 'restaurant',
  HOUSEKEEPING = 'housekeeping',
  MAINTENANCE = 'maintenance',
  PAYMENTS = 'payments',
  HR = 'hr',
  STAFF = 'staff',
  PROPERTIES = 'properties',
  SETTINGS = 'settings',
  USERS = 'users',
  PROCUREMENT = 'procurement',
  GENERAL = 'general',
}

export class CreateAuditLogDto {
  @ApiProperty({ enum: AuditAction })
  @IsEnum(AuditAction)
  action: AuditAction;

  @ApiProperty({ enum: AuditResource })
  @IsEnum(AuditResource)
  resource: AuditResource;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  resourceId?: string;

  @ApiPropertyOptional({ enum: AuditCategory, description: 'Category tag for grouping' })
  @IsOptional()
  @IsEnum(AuditCategory)
  category?: AuditCategory;

  @ApiPropertyOptional()
  @IsOptional()
  oldValues?: Record<string, any>;

  @ApiPropertyOptional()
  @IsOptional()
  newValues?: Record<string, any>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tenantId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  adminId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ipAddress?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  userAgent?: string;
}

export class AuditLogQueryDto {
  @ApiPropertyOptional({ description: 'Filter by user ID' })
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiPropertyOptional({ description: 'Filter by admin ID' })
  @IsOptional()
  @IsString()
  adminId?: string;

  @ApiPropertyOptional({ enum: AuditAction })
  @IsOptional()
  action?: string;

  @ApiPropertyOptional({ enum: AuditResource })
  @IsOptional()
  resource?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  resourceId?: string;

  @ApiPropertyOptional({ enum: AuditCategory, description: 'Filter by category tag' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ description: 'Search in description' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Start date (ISO string)' })
  @IsOptional()
  @IsString()
  startDate?: string;

  @ApiPropertyOptional({ description: 'End date (ISO string)' })
  @IsOptional()
  @IsString()
  endDate?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  page?: number;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  limit?: number;
}
