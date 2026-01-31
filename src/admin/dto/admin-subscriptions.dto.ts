import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';

// ============ Enums ============

export enum AdminSubscriptionStatusFilter {
  ALL = 'all',
  ACTIVE = 'active',
  TRIAL = 'trial',
  PENDING = 'pending',
  EXPIRED = 'expired',
}

export enum AdminSubscriptionStatusUpdate {
  ACTIVE = 'active',
  PENDING = 'pending',
  CANCELLED = 'cancelled',
  EXPIRED = 'expired',
}

// ============ Query DTOs ============

export class AdminSubscriptionsQueryDto {
  @ApiPropertyOptional({
    description: 'Filter by subscription status',
    enum: AdminSubscriptionStatusFilter,
    default: AdminSubscriptionStatusFilter.ALL,
  })
  @IsOptional()
  @IsEnum(AdminSubscriptionStatusFilter)
  status?: AdminSubscriptionStatusFilter = AdminSubscriptionStatusFilter.ALL;

  @ApiPropertyOptional({
    description: 'Search by hotel name or subscription ID (SUB-xxx)',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Page number', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Items per page', default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 10;
}

// ============ Request DTOs ============

export class UpdateSubscriptionStatusDto {
  @ApiProperty({
    description: 'New status for the subscription',
    enum: AdminSubscriptionStatusUpdate,
    example: AdminSubscriptionStatusUpdate.ACTIVE,
  })
  @IsEnum(AdminSubscriptionStatusUpdate)
  status: AdminSubscriptionStatusUpdate;
}

// ============ Response DTOs ============

export class SubscriptionPeriodDto {
  @ApiProperty({ example: '2024-01-01' })
  start: string;

  @ApiProperty({ example: '2024-02-01' })
  end: string;
}

export class SubscriptionAddonItemDto {
  @ApiProperty({ example: 'Extra Analytics' })
  name: string;

  @ApiProperty({ example: 990 })
  price: number;
}

export class AdminSubscriptionListItemDto {
  @ApiProperty({ example: 'uuid', description: 'Primary key UUID for updates' })
  id: string;

  @ApiProperty({ example: 'SUB-001', description: 'Display subscription code' })
  subscriptionCode: string;

  @ApiProperty({ example: 'โรงแรมสุขใจ' })
  hotelName: string;

  @ApiProperty({ example: 'Professional' })
  plan: string;

  @ApiPropertyOptional({ example: 'Starter' })
  previousPlan?: string;

  @ApiProperty({ type: SubscriptionPeriodDto })
  period: SubscriptionPeriodDto;

  @ApiProperty({ type: [SubscriptionAddonItemDto], description: 'List of add-ons with name and price' })
  addons: SubscriptionAddonItemDto[];

  @ApiProperty({ example: 2480, description: 'Total add-on amount' })
  addonAmount: number;

  @ApiProperty({ example: 7470 })
  pricePerMonth: number;

  @ApiProperty({ example: 'Active' })
  status: string;
}

export class AdminSubscriptionsListResponseDto {
  @ApiProperty({ example: 4 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 10 })
  limit: number;

  @ApiProperty({ type: [AdminSubscriptionListItemDto] })
  data: AdminSubscriptionListItemDto[];
}

export class AdminSubscriptionsSummaryDto {
  @ApiProperty({ example: 2, description: 'จำนวน Active subscriptions' })
  active: number;

  @ApiProperty({ example: 1, description: 'จำนวน Trial subscriptions' })
  trial: number;

  @ApiProperty({ example: 1, description: 'จำนวน Pending subscriptions' })
  pending: number;

  @ApiProperty({ example: 1, description: 'จำนวน Expired subscriptions' })
  expired: number;

  @ApiProperty({ example: 21430, description: 'Monthly Recurring Revenue (MRR)' })
  mrr: number;

  @ApiProperty({ example: 1, description: 'จำนวน upgrades ในเดือนนี้' })
  upgrades: number;

  @ApiProperty({ example: 1, description: 'จำนวน downgrades ในเดือนนี้' })
  downgrades: number;
}

export class SubscriptionAddonDto {
  @ApiProperty({ example: 'Extra Analytics' })
  name: string;

  @ApiProperty({ example: 990 })
  price: number;
}

export class AdminSubscriptionDetailDto {
  @ApiProperty({ example: 'uuid', description: 'Primary key UUID for updates' })
  id: string;

  @ApiProperty({ example: 'SUB-001', description: 'Display subscription code' })
  subscriptionCode: string;

  @ApiProperty({ example: 'โรงแรมสุขใจ' })
  hotelName: string;

  @ApiProperty({ example: 'somchai@email.com' })
  hotelEmail: string;

  @ApiProperty({ example: 'Professional' })
  plan: string;

  @ApiPropertyOptional({ example: 'Starter' })
  previousPlan?: string;

  @ApiProperty({ type: [SubscriptionAddonDto] })
  addons: SubscriptionAddonDto[];

  @ApiProperty({ type: SubscriptionPeriodDto })
  period: SubscriptionPeriodDto;

  @ApiProperty({ example: 7470 })
  pricePerMonth: number;

  @ApiProperty({ example: 'Active' })
  status: string;

  @ApiPropertyOptional({ example: 'INV-2024-045' })
  invoice?: string;

  @ApiProperty({ example: true })
  autoRenew: boolean;

  @ApiProperty({ example: '2024-01-01' })
  createdAt: string;
}

export class SubscriptionStatusUpdateResponseDto {
  @ApiProperty({ example: 'Subscription status updated successfully' })
  message: string;

  @ApiProperty({ example: 'SUB-004' })
  subscriptionId: string;

  @ApiProperty({ example: 'Active' })
  newStatus: string;
}
