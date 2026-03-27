import { IsString, IsNotEmpty, IsOptional, IsEnum, IsUrl } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum LineNotifyEventType {
  BOOKING_CREATED = 'booking_created',
  BOOKING_CONFIRMED = 'booking_confirmed',
  BOOKING_CANCELLED = 'booking_cancelled',
  BOOKING_CHECKIN = 'booking_checkin',
  BOOKING_CHECKOUT = 'booking_checkout',
  PAYMENT_RECEIVED = 'payment_received',
  PAYMENT_FAILED = 'payment_failed',
  DAILY_SUMMARY = 'daily_summary',
  LOW_INVENTORY = 'low_inventory',
  NEW_REVIEW = 'new_review',
  SYSTEM_ALERT = 'system_alert',
}

export class ConnectLineNotifyDto {
  @ApiProperty({ description: 'OAuth callback code from Line Notify' })
  @IsString()
  @IsNotEmpty()
  code: string;

  @ApiPropertyOptional({ description: 'State parameter for verification' })
  @IsString()
  @IsOptional()
  state?: string;
}

export class SendLineNotifyDto {
  @ApiProperty({ description: 'Message to send' })
  @IsString()
  @IsNotEmpty()
  message: string;

  @ApiPropertyOptional({ description: 'Image URL to include' })
  @IsUrl()
  @IsOptional()
  imageUrl?: string;

  @ApiPropertyOptional({ description: 'Image thumbnail URL' })
  @IsUrl()
  @IsOptional()
  imageThumbnail?: string;

  @ApiPropertyOptional({ description: 'Sticker package ID' })
  @IsString()
  @IsOptional()
  stickerPackageId?: string;

  @ApiPropertyOptional({ description: 'Sticker ID' })
  @IsString()
  @IsOptional()
  stickerId?: string;
}

export class LineNotifyPreferenceDto {
  @ApiProperty({
    description: 'Event types to receive notifications for',
    enum: LineNotifyEventType,
    isArray: true,
  })
  @IsEnum(LineNotifyEventType, { each: true })
  enabledEvents: LineNotifyEventType[];
}

export class LineNotifyStatusDto {
  isConnected: boolean;
  targetName?: string;
  targetType?: string;
  enabledEvents?: LineNotifyEventType[];
  connectedAt?: Date;
}

export class LineNotifyCallbackResponseDto {
  success: boolean;
  message: string;
  targetName?: string;
}

export class LineNotifyTokenResponseDto {
  access_token: string;
  token_type: string;
}

export class LineNotifyStatusResponseDto {
  status: number;
  message: string;
  targetType?: string;
  target?: string;
}
