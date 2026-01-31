import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNumber,
  IsOptional,
  IsBoolean,
  IsEnum,
  Min,
} from 'class-validator';

// ============ Enums ============
// Must match Feature entity enum

export enum FeatureType {
  TOGGLE = 'toggle',
  LIMIT = 'limit',
  MODULE = 'module',
}

// ============ Request DTOs ============

export class CreateFeatureDto {
  @ApiProperty({
    description: 'Unique feature code',
    example: 'extra-analytics',
  })
  @IsString()
  code: string;

  @ApiProperty({ description: 'Feature name', example: 'Extra Analytics' })
  @IsString()
  name: string;

  @ApiPropertyOptional({
    description: 'Feature description',
    example: 'Advanced analytics and reporting features',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    description: 'Feature type',
    enum: FeatureType,
    example: 'module',
  })
  @IsEnum(FeatureType)
  type: FeatureType;

  @ApiProperty({ description: 'Monthly price', example: 990 })
  @IsNumber()
  @Min(0)
  priceMonthly: number;

  @ApiPropertyOptional({
    description: 'Yearly price (not supported in current schema)',
    example: 9900,
    deprecated: true,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  priceYearly?: number;

  @ApiPropertyOptional({ description: 'Is feature active', default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'Additional metadata (not supported in current schema)',
    example: { icon: 'chart', color: 'blue' },
    deprecated: true,
  })
  @IsOptional()
  metadata?: Record<string, any>;
}

export class UpdateFeatureDto {
  @ApiPropertyOptional({ description: 'Feature name' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: 'Feature description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: 'Feature type',
    enum: FeatureType,
  })
  @IsOptional()
  @IsEnum(FeatureType)
  type?: FeatureType;

  @ApiPropertyOptional({ description: 'Monthly price' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  priceMonthly?: number;

  @ApiPropertyOptional({
    description: 'Yearly price (not supported in current schema)',
    deprecated: true,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  priceYearly?: number;

  @ApiPropertyOptional({ description: 'Is feature active' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'Additional metadata (not supported in current schema)',
    deprecated: true,
  })
  @IsOptional()
  metadata?: Record<string, any>;
}

// ============ Response DTOs ============

export class AdminFeatureItemDto {
  @ApiProperty({ example: 'uuid-1234' })
  id: string;

  @ApiProperty({ example: 'extra-analytics' })
  code: string;

  @ApiProperty({ example: 'Extra Analytics' })
  name: string;

  @ApiProperty({ example: 'Advanced analytics and reporting features' })
  description: string;

  @ApiProperty({ enum: ['toggle', 'limit', 'module'] })
  type: string;

  @ApiProperty({ example: 990 })
  priceMonthly: number;

  @ApiPropertyOptional({ example: 9900 })
  priceYearly?: number;

  @ApiProperty({ example: true })
  isActive: boolean;

  @ApiProperty({ example: '2024-01-01' })
  createdAt: string;
}

export class AdminFeaturesListDto {
  @ApiProperty({ type: [AdminFeatureItemDto] })
  data: AdminFeatureItemDto[];

  @ApiProperty({ example: 10 })
  total: number;
}

export class FeatureResponseDto {
  @ApiProperty({ example: 'uuid-1234' })
  id: string;

  @ApiProperty({ example: 'extra-analytics' })
  code: string;

  @ApiProperty({ example: 'Extra Analytics' })
  name: string;

  @ApiProperty({ example: 'Advanced analytics and reporting features' })
  description: string;

  @ApiProperty({ enum: ['toggle', 'limit', 'module'] })
  type: string;

  @ApiProperty({ example: 990 })
  priceMonthly: number;

  @ApiPropertyOptional({ example: 9900 })
  priceYearly?: number;

  @ApiProperty({ example: true })
  isActive: boolean;

  @ApiPropertyOptional({ example: { icon: 'chart', color: 'blue' } })
  metadata?: Record<string, any>;

  @ApiProperty({ example: '2024-01-01' })
  createdAt: string;

  @ApiProperty({ example: '2024-01-01' })
  updatedAt: string;
}
