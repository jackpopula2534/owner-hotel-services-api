import { IsString, IsNumber, IsEnum, IsBoolean, IsOptional, IsInt, Min } from 'class-validator';
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
    example: 'INTEGRATION',
    description:
      'Logical category bucket: CORE, PMS, RESTAURANT, HR, HOUSEKEEPING, MAINTENANCE, REPORTING, INTEGRATION, ADVANCED',
  })
  @IsString()
  @IsOptional()
  category?: string;

  @ApiPropertyOptional({
    example: 'Plug',
    description: 'Lucide-react icon name to render in the admin UI',
  })
  @IsString()
  @IsOptional()
  icon?: string;

  @ApiPropertyOptional({
    example: 10,
    description: 'Sort order within a category (lower comes first)',
  })
  @IsInt()
  @Min(0)
  @IsOptional()
  displayOrder?: number;

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
