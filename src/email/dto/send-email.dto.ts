import {
  IsEmail,
  IsString,
  IsOptional,
  IsEnum,
  IsObject,
  IsArray,
  IsBoolean,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export enum EmailTemplate {
  BOOKING_CONFIRMATION = 'booking-confirmation',
  CHECK_IN_REMINDER = 'check-in-reminder',
  CHECK_IN_CONFIRMATION = 'check-in-confirmation',
  CHECK_OUT_REMINDER = 'check-out-reminder',
  PAYMENT_RECEIPT = 'payment-receipt',
  PASSWORD_RESET = 'password-reset',
  WELCOME = 'welcome',
  INVOICE = 'invoice',
  CANCELLATION = 'cancellation',
  SUBSCRIPTION_WELCOME = 'subscription-welcome',
  SUBSCRIPTION_RENEWAL = 'subscription-renewal',
  SUBSCRIPTION_EXPIRING = 'subscription-expiring',
  RFQ_INVITATION = 'rfq-invitation',
  PRICE_COMPARISON_PENDING_APPROVAL = 'price-comparison-pending-approval',
  PRICE_COMPARISON_APPROVED = 'price-comparison-approved',
  PRICE_COMPARISON_REJECTED = 'price-comparison-rejected',
}

export class SendEmailDto {
  @ApiProperty({ description: 'Recipient email address' })
  @IsEmail()
  to: string;

  @ApiProperty({ description: 'Email subject' })
  @IsString()
  subject: string;

  @ApiProperty({ enum: EmailTemplate, description: 'Email template to use' })
  @IsEnum(EmailTemplate)
  template: EmailTemplate;

  @ApiPropertyOptional({ description: 'Template variables' })
  @IsOptional()
  @IsObject()
  context?: Record<string, any>;

  @ApiPropertyOptional({ description: 'Language code (th/en)', default: 'th' })
  @IsOptional()
  @IsString()
  language?: string;

  @ApiPropertyOptional({ description: 'Tenant ID for multi-tenant tracking' })
  @IsOptional()
  @IsString()
  tenantId?: string;
}

export class BulkEmailRecipient {
  @ApiProperty({ description: 'Recipient email address' })
  @IsEmail()
  to: string;

  @ApiPropertyOptional({ description: 'Template variables for this recipient' })
  @IsOptional()
  @IsObject()
  context?: Record<string, any>;
}

export class SendBulkEmailDto {
  @ApiProperty({ type: [BulkEmailRecipient], description: 'List of recipients' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BulkEmailRecipient)
  recipients: BulkEmailRecipient[];

  @ApiProperty({ description: 'Email subject' })
  @IsString()
  subject: string;

  @ApiProperty({ enum: EmailTemplate, description: 'Email template to use' })
  @IsEnum(EmailTemplate)
  template: EmailTemplate;

  @ApiPropertyOptional({ description: 'Common template variables' })
  @IsOptional()
  @IsObject()
  commonContext?: Record<string, any>;

  @ApiPropertyOptional({ description: 'Language code (th/en)', default: 'th' })
  @IsOptional()
  @IsString()
  language?: string;

  @ApiPropertyOptional({ description: 'Tenant ID' })
  @IsOptional()
  @IsString()
  tenantId?: string;
}

export class EmailHistoryQueryDto {
  @ApiPropertyOptional({ description: 'Filter by recipient email' })
  @IsOptional()
  @IsEmail()
  recipient?: string;

  @ApiPropertyOptional({
    enum: ['pending', 'queued', 'sent', 'delivered', 'opened', 'bounced', 'failed'],
  })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ enum: EmailTemplate })
  @IsOptional()
  @IsEnum(EmailTemplate)
  template?: EmailTemplate;

  @ApiPropertyOptional({ description: 'Start date (ISO string)' })
  @IsOptional()
  @IsString()
  startDate?: string;

  @ApiPropertyOptional({ description: 'End date (ISO string)' })
  @IsOptional()
  @IsString()
  endDate?: string;

  @ApiPropertyOptional({ description: 'Page number', default: 1 })
  @IsOptional()
  page?: number;

  @ApiPropertyOptional({ description: 'Items per page', default: 20 })
  @IsOptional()
  limit?: number;
}

export class ResendEmailDto {
  @ApiProperty({ description: 'Email log ID to resend' })
  @IsString()
  emailLogId: string;
}

// ==========================================
// Email Preferences DTOs
// ==========================================

export class EmailPreferencesDto {
  @ApiProperty({ description: 'Receive booking confirmation emails', default: true })
  @IsBoolean()
  bookingConfirmation: boolean;

  @ApiProperty({ description: 'Receive check-in reminder emails', default: true })
  @IsBoolean()
  checkInReminder: boolean;

  @ApiProperty({ description: 'Receive check-out reminder emails', default: true })
  @IsBoolean()
  checkOutReminder: boolean;

  @ApiProperty({ description: 'Receive payment receipt emails', default: true })
  @IsBoolean()
  paymentReceipt: boolean;

  @ApiProperty({ description: 'Receive promotional emails', default: false })
  @IsBoolean()
  promotionalEmails: boolean;

  @ApiProperty({ description: 'Receive newsletter emails', default: false })
  @IsBoolean()
  newsletter: boolean;
}

export class UpdateEmailPreferencesDto {
  @ApiPropertyOptional({ description: 'Receive booking confirmation emails' })
  @IsOptional()
  @IsBoolean()
  bookingConfirmation?: boolean;

  @ApiPropertyOptional({ description: 'Receive check-in reminder emails' })
  @IsOptional()
  @IsBoolean()
  checkInReminder?: boolean;

  @ApiPropertyOptional({ description: 'Receive check-out reminder emails' })
  @IsOptional()
  @IsBoolean()
  checkOutReminder?: boolean;

  @ApiPropertyOptional({ description: 'Receive payment receipt emails' })
  @IsOptional()
  @IsBoolean()
  paymentReceipt?: boolean;

  @ApiPropertyOptional({ description: 'Receive promotional emails' })
  @IsOptional()
  @IsBoolean()
  promotionalEmails?: boolean;

  @ApiPropertyOptional({ description: 'Receive newsletter emails' })
  @IsOptional()
  @IsBoolean()
  newsletter?: boolean;
}

export class EmailPreferencesResponseDto {
  @ApiProperty({ description: 'Preference ID' })
  id: string;

  @ApiProperty({ description: 'Email address' })
  email: string;

  @ApiProperty({ description: 'Booking confirmation preference' })
  bookingConfirmation: boolean;

  @ApiProperty({ description: 'Check-in reminder preference' })
  checkInReminder: boolean;

  @ApiProperty({ description: 'Check-out reminder preference' })
  checkOutReminder: boolean;

  @ApiProperty({ description: 'Payment receipt preference' })
  paymentReceipt: boolean;

  @ApiProperty({ description: 'Promotional emails preference' })
  promotionalEmails: boolean;

  @ApiProperty({ description: 'Newsletter preference' })
  newsletter: boolean;

  @ApiPropertyOptional({ description: 'Date when unsubscribed from all emails' })
  unsubscribedAt?: Date;

  @ApiProperty({ description: 'Created timestamp' })
  createdAt: Date;

  @ApiProperty({ description: 'Updated timestamp' })
  updatedAt: Date;
}

export class UnsubscribeDto {
  @ApiProperty({ description: 'Email address to unsubscribe' })
  @IsEmail()
  email: string;

  @ApiPropertyOptional({ description: 'Unsubscribe token for verification' })
  @IsOptional()
  @IsString()
  token?: string;
}
