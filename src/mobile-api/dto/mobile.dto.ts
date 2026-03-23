import { IsString, IsOptional, IsNumber, IsEnum, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum MobilePlatform {
  IOS = 'ios',
  ANDROID = 'android',
}

export class MobilePaginationDto {
  @ApiPropertyOptional({ description: 'Page number', default: 1 })
  @IsNumber()
  @IsOptional()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Items per page', default: 20 })
  @IsNumber()
  @IsOptional()
  @Min(1)
  @Max(50)
  limit?: number = 20;
}

export class RegisterDeviceDto {
  @ApiProperty({ description: 'FCM device token' })
  @IsString()
  deviceToken: string;

  @ApiProperty({ enum: MobilePlatform, description: 'Platform type' })
  @IsEnum(MobilePlatform)
  platform: MobilePlatform;

  @ApiPropertyOptional({ description: 'Device model' })
  @IsString()
  @IsOptional()
  deviceModel?: string;

  @ApiPropertyOptional({ description: 'App version' })
  @IsString()
  @IsOptional()
  appVersion?: string;
}

// Lightweight response DTOs for mobile
export class MobileBookingSummaryDto {
  id: string;
  bookingNumber: string;
  guestName: string;
  roomNumber: string;
  checkIn: Date;
  checkOut: Date;
  status: string;
  totalPrice: number;
}

export class MobileRoomSummaryDto {
  id: string;
  number: string;
  type: string;
  status: string;
  price: number;
  floor?: number;
}

export class MobileDashboardDto {
  todayCheckIns: number;
  todayCheckOuts: number;
  occupancyRate: number;
  totalRevenue: number;
  pendingBookings: number;
  availableRooms: number;
  recentBookings: MobileBookingSummaryDto[];
}

export class MobileGuestSummaryDto {
  id: string;
  fullName: string;
  phone?: string;
  email?: string;
  isVip: boolean;
  totalStays: number;
}

export class MobileNotificationDto {
  id: string;
  title: string;
  message: string;
  type: string;
  isRead: boolean;
  createdAt: Date;
}

export class MobileAppConfigDto {
  minVersion: string;
  latestVersion: string;
  forceUpdate: boolean;
  maintenanceMode: boolean;
  maintenanceMessage?: string;
  features: {
    bookingEnabled: boolean;
    paymentEnabled: boolean;
    pushNotifications: boolean;
  };
}
