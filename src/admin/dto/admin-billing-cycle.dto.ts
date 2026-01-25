import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsBoolean,
  IsEnum,
  IsDateString,
  IsNumber,
  Min,
} from 'class-validator';

// ============ Enums ============

export enum BillingCycleDto {
  MONTHLY = 'monthly',
  YEARLY = 'yearly',
}

// ============ Request DTOs ============

export class UpdateBillingCycleDto {
  @ApiProperty({
    enum: BillingCycleDto,
    description: 'New billing cycle',
    example: 'yearly',
  })
  @IsEnum(BillingCycleDto)
  billingCycle: BillingCycleDto;

  @ApiPropertyOptional({
    description: 'Effective date for the change (default: next billing date)',
    example: '2024-03-01',
  })
  @IsOptional()
  @IsDateString()
  effectiveDate?: string;

  @ApiPropertyOptional({
    description: 'Apply proration for the change',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  applyProration?: boolean;

  @ApiPropertyOptional({ description: 'Reason for change' })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class RenewSubscriptionDto {
  @ApiPropertyOptional({
    description: 'Custom renewal period in months (default based on billing cycle)',
    example: 12,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  periodMonths?: number;

  @ApiPropertyOptional({
    description: 'Custom renewal price (default: plan price)',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  customPrice?: number;

  @ApiPropertyOptional({
    description: 'Create invoice for renewal',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  createInvoice?: boolean;

  @ApiPropertyOptional({ description: 'Notes for the renewal' })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class CancelRenewalDto {
  @ApiProperty({ description: 'Reason for cancellation' })
  @IsString()
  reason: string;

  @ApiPropertyOptional({
    description: 'Cancel immediately or at end of billing period',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  cancelImmediately?: boolean;

  @ApiPropertyOptional({
    description: 'Create credit for remaining period (if cancel immediately)',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  createCredit?: boolean;
}

// ============ Response DTOs ============

export class BillingCycleResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: 'Billing cycle updated successfully' })
  message: string;

  @ApiProperty()
  data: {
    subscriptionId: string;
    subscriptionCode: string;
    oldBillingCycle: string;
    newBillingCycle: string;
    effectiveDate: string;
    proratedAmount?: number;
    nextBillingDate: string;
  };
}

export class RenewSubscriptionResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: 'Subscription renewed successfully' })
  message: string;

  @ApiProperty()
  data: {
    subscriptionId: string;
    subscriptionCode: string;
    newStartDate: string;
    newEndDate: string;
    renewalAmount: number;
    invoiceNo?: string;
    renewedCount: number;
  };
}

export class CancelRenewalResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: 'Subscription renewal cancelled' })
  message: string;

  @ApiProperty()
  data: {
    subscriptionId: string;
    subscriptionCode: string;
    cancelledAt: string;
    effectiveEndDate: string;
    autoRenew: boolean;
    creditAmount?: number;
    creditCreated: boolean;
  };
}

// ============ Billing History DTOs ============

export class BillingHistoryItemDto {
  @ApiProperty({ example: 'uuid-1234' })
  id: string;

  @ApiProperty({
    enum: ['created', 'renewed', 'upgraded', 'downgraded', 'cycle_changed', 'cancelled', 'reactivated', 'expired'],
  })
  eventType: string;

  @ApiProperty({ example: 'Subscription renewed for 1 month' })
  description: string;

  @ApiPropertyOptional({ example: 'Starter' })
  oldPlan?: string;

  @ApiPropertyOptional({ example: 'Professional' })
  newPlan?: string;

  @ApiPropertyOptional({ example: 'monthly' })
  oldBillingCycle?: string;

  @ApiPropertyOptional({ example: 'yearly' })
  newBillingCycle?: string;

  @ApiPropertyOptional({ example: 4990 })
  oldAmount?: number;

  @ApiPropertyOptional({ example: 49900 })
  newAmount?: number;

  @ApiPropertyOptional({ example: '2024-01-01' })
  periodStart?: string;

  @ApiPropertyOptional({ example: '2024-02-01' })
  periodEnd?: string;

  @ApiPropertyOptional({ example: 'INV-2024-045' })
  invoiceNo?: string;

  @ApiProperty({ example: '2024-01-25T10:30:00Z' })
  createdAt: string;

  @ApiPropertyOptional({ example: 'admin@staysync.io' })
  createdBy?: string;
}

export class BillingHistoryListDto {
  @ApiProperty({ example: 'SUB-001' })
  subscriptionCode: string;

  @ApiProperty({ example: 'โรงแรมสุขใจ' })
  hotelName: string;

  @ApiProperty({ example: 'Professional' })
  currentPlan: string;

  @ApiProperty({ example: 'monthly' })
  billingCycle: string;

  @ApiProperty({ example: '2024-02-01' })
  nextBillingDate: string;

  @ApiProperty({ type: [BillingHistoryItemDto] })
  history: BillingHistoryItemDto[];

  @ApiProperty({ example: 10 })
  total: number;
}

// ============ Subscription Billing Info ============

export class SubscriptionBillingInfoDto {
  @ApiProperty({ example: 'SUB-001' })
  subscriptionCode: string;

  @ApiProperty({ example: 'โรงแรมสุขใจ' })
  hotelName: string;

  @ApiProperty({ example: 'Professional' })
  planName: string;

  @ApiProperty({ example: 4990 })
  planPrice: number;

  @ApiProperty({ example: 'monthly' })
  billingCycle: string;

  @ApiProperty({ example: 'active' })
  status: string;

  @ApiProperty({ example: '2024-01-01' })
  currentPeriodStart: string;

  @ApiProperty({ example: '2024-02-01' })
  currentPeriodEnd: string;

  @ApiProperty({ example: '2024-02-01' })
  nextBillingDate: string;

  @ApiProperty({ example: '2024-01-01' })
  billingAnchorDate: string;

  @ApiProperty({ example: true })
  autoRenew: boolean;

  @ApiProperty({ example: 3 })
  renewedCount: number;

  @ApiPropertyOptional({ example: '2024-01-01T10:30:00Z' })
  lastRenewedAt?: string;

  @ApiProperty({ example: 2480 })
  addonAmount: number;

  @ApiProperty({ example: 7470 })
  totalMonthlyAmount: number;

  @ApiPropertyOptional()
  cancelledAt?: string;

  @ApiPropertyOptional()
  cancellationReason?: string;
}
