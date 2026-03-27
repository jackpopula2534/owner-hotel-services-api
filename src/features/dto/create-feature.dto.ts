import { IsString, IsNumber, IsEnum, IsBoolean, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FeatureType } from '../entities/feature.entity';

export class CreateFeatureDto {
  @ApiProperty({
    example: 'ota_booking',
    description: 'Unique feature code identifier',
  })
  @IsString()
  code: string;

  @ApiProperty({
    example: 'OTA Booking Integration',
    description: 'Feature display name',
  })
  @IsString()
  name: string;

  @ApiPropertyOptional({
    example: 'Connect with Booking.com, Agoda, and other OTA platforms',
    description: 'Feature description',
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({
    example: 'module',
    description: 'Feature type (module, toggle, limit)',
  })
  @IsEnum(FeatureType)
  type: FeatureType;

  @ApiPropertyOptional({
    example: 990,
    description: 'Monthly price for this feature add-on',
  })
  @IsNumber()
  @IsOptional()
  priceMonthly?: number;

  @ApiPropertyOptional({
    example: true,
    description: 'Whether this feature is available for purchase',
  })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
