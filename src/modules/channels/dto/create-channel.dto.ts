import { IsString, IsNotEmpty, IsOptional, IsBoolean, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum ChannelType {
  OTA = 'ota',
  DIRECT = 'direct',
  CORPORATE = 'corporate',
}

export class CreateChannelDto {
  @ApiProperty({ example: 'Booking.com' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 'BOOKING_COM' })
  @IsString()
  @IsNotEmpty()
  code: string;

  @ApiProperty({ example: 'ota', enum: ChannelType })
  @IsEnum(ChannelType)
  @IsNotEmpty()
  type: ChannelType;

  @ApiPropertyOptional({ example: 'api-key-123' })
  @IsString()
  @IsOptional()
  apiKey?: string;

  @ApiPropertyOptional({ example: 'api-secret-456' })
  @IsString()
  @IsOptional()
  apiSecret?: string;

  @ApiPropertyOptional({ example: true, default: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional({ example: false, default: false })
  @IsBoolean()
  @IsOptional()
  syncEnabled?: boolean;

  @ApiPropertyOptional({ example: '{"rateLimit": 100}' })
  @IsString()
  @IsOptional()
  settings?: string;
}


