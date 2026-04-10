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
  ROOM_STATUS_CHANGE = 'room_status_change',

  // Guest
  GUEST_CREATE = 'guest_create',
  GUEST_UPDATE = 'guest_update',
  GUEST_DATA_ACCESS = 'guest_data_access',

  // Settings
  SETTINGS_UPDATE = 'settings_update',

  // Employee/HR
  EMPLOYEE_CREATE = 'employee_create',
  EMPLOYEE_UPDATE = 'employee_update',
  EMPLOYEE_DELETE = 'employee_delete',

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
  @IsEnum(AuditAction)
  action?: AuditAction;

  @ApiPropertyOptional({ enum: AuditResource })
  @IsOptional()
  @IsEnum(AuditResource)
  resource?: AuditResource;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  resourceId?: string;

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
