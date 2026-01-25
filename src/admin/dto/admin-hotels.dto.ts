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
import { TenantStatus } from '../../tenants/entities/tenant.entity';

// ============ Query DTOs ============

export class AdminHotelsQueryDto {
  @ApiPropertyOptional({
    description: 'Filter by hotel status',
    enum: TenantStatus,
  })
  @IsOptional()
  @IsEnum(TenantStatus)
  status?: TenantStatus;

  @ApiPropertyOptional({ description: 'Search by hotel name or owner name' })
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

export class UpdateHotelStatusDto {
  @ApiProperty({
    description: 'New status for the hotel',
    enum: TenantStatus,
    example: TenantStatus.SUSPENDED,
  })
  @IsEnum(TenantStatus)
  status: TenantStatus;
}

export enum NotificationType {
  SUSPENSION = 'suspension',
  TRIAL_ENDING = 'trial_ending',
  PAYMENT_REMINDER = 'payment_reminder',
  SUBSCRIPTION_EXPIRED = 'subscription_expired',
}

export class SendHotelNotificationDto {
  @ApiProperty({
    description: 'Type of notification to send',
    enum: NotificationType,
    example: NotificationType.SUSPENSION,
  })
  @IsEnum(NotificationType)
  type: NotificationType;

  @ApiPropertyOptional({ description: 'Custom message for the notification' })
  @IsOptional()
  @IsString()
  message?: string;
}

// ============ Response DTOs ============

export class AdminHotelListItemDto {
  @ApiProperty({ example: 'uuid-1234' })
  id: string;

  @ApiProperty({ example: 'โรงแรมสุขใจ' })
  hotelName: string;

  @ApiProperty({ example: 'สมชาย ใจดี' })
  ownerName: string;

  @ApiProperty({ example: 'Professional' })
  plan: string;

  @ApiProperty({ example: 45 })
  rooms: number;

  @ApiProperty({ example: 5 })
  users: number;

  @ApiProperty({ enum: TenantStatus, example: TenantStatus.ACTIVE })
  status: TenantStatus;

  @ApiProperty({ example: 47958 })
  revenue: number;
}

export class AdminHotelsListResponseDto {
  @ApiProperty({ example: 6 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 10 })
  limit: number;

  @ApiProperty({ type: [AdminHotelListItemDto] })
  data: AdminHotelListItemDto[];
}

export class AdminHotelsSummaryDto {
  @ApiProperty({ example: 6 })
  total: number;

  @ApiProperty({ example: 3 })
  active: number;

  @ApiProperty({ example: 1 })
  trial: number;

  @ApiProperty({ example: 1 })
  expired: number;

  @ApiProperty({ example: 1 })
  suspended: number;
}

export class HotelSubscriptionDto {
  @ApiProperty({ example: '2024-02-15' })
  expiresAt: string;
}

export class AdminHotelDetailDto {
  @ApiProperty({ example: 'uuid-1234' })
  id: string;

  @ApiProperty({ example: 'โรงแรมสุขใจ' })
  hotelName: string;

  @ApiProperty({ example: 'สมชาย ใจดี' })
  ownerName: string;

  @ApiProperty({ example: 'somchai@email.com' })
  email: string;

  @ApiProperty({ example: '2023-06-15' })
  createdAt: string;

  @ApiProperty({ example: 45 })
  rooms: number;

  @ApiProperty({ example: 5 })
  users: number;

  @ApiProperty({ example: 'Professional' })
  plan: string;

  @ApiProperty({ enum: TenantStatus, example: TenantStatus.ACTIVE })
  status: TenantStatus;

  @ApiProperty({ example: 47958 })
  revenue: number;

  @ApiProperty({ type: HotelSubscriptionDto })
  subscription: HotelSubscriptionDto;
}

export class HotelStatusUpdateResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: 'Hotel status updated successfully' })
  message: string;

  @ApiProperty({ enum: TenantStatus })
  newStatus: TenantStatus;
}

export class HotelNotificationResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: 'Notification sent successfully' })
  message: string;

  @ApiProperty({ enum: NotificationType })
  notificationType: NotificationType;
}
