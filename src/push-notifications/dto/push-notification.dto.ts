import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsBoolean,
  IsObject,
  IsArray,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum PushNotificationType {
  BOOKING = 'booking',
  PAYMENT = 'payment',
  REMINDER = 'reminder',
  PROMOTION = 'promotion',
  SYSTEM = 'system',
  ALERT = 'alert',
}

export enum DevicePlatform {
  IOS = 'ios',
  ANDROID = 'android',
  WEB = 'web',
}

export class RegisterDeviceDto {
  @ApiProperty({ description: 'FCM device token' })
  @IsString()
  @IsNotEmpty()
  deviceToken: string;

  @ApiProperty({ enum: DevicePlatform, description: 'Device platform' })
  @IsEnum(DevicePlatform)
  platform: DevicePlatform;

  @ApiPropertyOptional({ description: 'Device model name' })
  @IsString()
  @IsOptional()
  deviceModel?: string;

  @ApiPropertyOptional({ description: 'Device OS version' })
  @IsString()
  @IsOptional()
  osVersion?: string;

  @ApiPropertyOptional({ description: 'App version' })
  @IsString()
  @IsOptional()
  appVersion?: string;
}

export class SendPushNotificationDto {
  @ApiProperty({ description: 'User ID to send notification to' })
  @IsString()
  @IsNotEmpty()
  userId: string;

  @ApiProperty({ description: 'Notification title' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({ description: 'Notification body' })
  @IsString()
  @IsNotEmpty()
  body: string;

  @ApiPropertyOptional({ enum: PushNotificationType })
  @IsEnum(PushNotificationType)
  @IsOptional()
  type?: PushNotificationType;

  @ApiPropertyOptional({ description: 'Additional data payload' })
  @IsObject()
  @IsOptional()
  data?: Record<string, string>;

  @ApiPropertyOptional({ description: 'Image URL for rich notification' })
  @IsString()
  @IsOptional()
  imageUrl?: string;

  @ApiPropertyOptional({ description: 'Action URL when notification is tapped' })
  @IsString()
  @IsOptional()
  actionUrl?: string;
}

export class SendBulkPushNotificationDto {
  @ApiProperty({ description: 'User IDs to send notification to' })
  @IsArray()
  @IsString({ each: true })
  userIds: string[];

  @ApiProperty({ description: 'Notification title' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({ description: 'Notification body' })
  @IsString()
  @IsNotEmpty()
  body: string;

  @ApiPropertyOptional({ enum: PushNotificationType })
  @IsEnum(PushNotificationType)
  @IsOptional()
  type?: PushNotificationType;

  @ApiPropertyOptional({ description: 'Additional data payload' })
  @IsObject()
  @IsOptional()
  data?: Record<string, string>;
}

export class SendTopicNotificationDto {
  @ApiProperty({ description: 'Topic name to send notification to' })
  @IsString()
  @IsNotEmpty()
  topic: string;

  @ApiProperty({ description: 'Notification title' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({ description: 'Notification body' })
  @IsString()
  @IsNotEmpty()
  body: string;

  @ApiPropertyOptional({ enum: PushNotificationType })
  @IsEnum(PushNotificationType)
  @IsOptional()
  type?: PushNotificationType;

  @ApiPropertyOptional({ description: 'Additional data payload' })
  @IsObject()
  @IsOptional()
  data?: Record<string, string>;
}

export class UpdatePushPreferencesDto {
  @ApiPropertyOptional({ description: 'Enable booking notifications' })
  @IsBoolean()
  @IsOptional()
  bookingNotifications?: boolean;

  @ApiPropertyOptional({ description: 'Enable payment notifications' })
  @IsBoolean()
  @IsOptional()
  paymentNotifications?: boolean;

  @ApiPropertyOptional({ description: 'Enable reminder notifications' })
  @IsBoolean()
  @IsOptional()
  reminderNotifications?: boolean;

  @ApiPropertyOptional({ description: 'Enable promotional notifications' })
  @IsBoolean()
  @IsOptional()
  promotionalNotifications?: boolean;

  @ApiPropertyOptional({ description: 'Enable system notifications' })
  @IsBoolean()
  @IsOptional()
  systemNotifications?: boolean;
}

export class PushNotificationResponseDto {
  success: boolean;
  messageId?: string;
  error?: string;
}

export class DeviceInfoDto {
  id: string;
  platform: DevicePlatform;
  deviceModel?: string;
  appVersion?: string;
  isActive: boolean;
  lastActiveAt: Date;
}
