import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNumber,
  IsInt,
  IsOptional,
  IsBoolean,
  Min,
  MinLength,
  MaxLength,
} from 'class-validator';

// ============ Request DTOs ============

export class CreatePlanDto {
  @ApiProperty({
    description: 'Unique plan code (e.g., S, M, L)',
    example: 'M',
    minLength: 1,
    maxLength: 10,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(10)
  code: string;

  @ApiProperty({
    description: 'Plan name',
    example: 'Medium Plan',
  })
  @IsString()
  name: string;

  @ApiProperty({
    description: 'Monthly price in THB',
    example: 2990,
    minimum: 0,
  })
  @IsNumber()
  @Min(0)
  priceMonthly: number;

  @ApiPropertyOptional({
    description: 'Yearly price in THB (optional, can be auto-calculated from monthly * 12 - discount)',
    example: 30504,
    minimum: 0,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  priceYearly?: number;

  @ApiPropertyOptional({
    description: 'Yearly discount percentage (0-100)',
    example: 15,
    minimum: 0,
    maximum: 100,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  yearlyDiscountPercent?: number;

  @ApiProperty({
    description: 'Maximum number of rooms allowed',
    example: 50,
    minimum: 1,
  })
  @IsInt()
  @Min(1)
  maxRooms: number;

  @ApiProperty({
    description: 'Maximum number of users allowed',
    example: 10,
    minimum: 1,
  })
  @IsInt()
  @Min(1)
  maxUsers: number;

  @ApiPropertyOptional({
    description: 'Is plan active',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  // Sales Page fields
  @ApiPropertyOptional({
    description: 'Plan description for sales page',
    example: 'เริ่มต้นใช้งานได้ทันที พร้อมทดลองใช้ฟรี 14 วัน',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: 'Display order on sales page (lower number = higher priority)',
    example: 1,
    minimum: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  displayOrder?: number;

  @ApiPropertyOptional({
    description: 'Mark as popular/featured plan',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isPopular?: boolean;

  @ApiPropertyOptional({
    description: 'Badge text (e.g., "ยอดนิยม", "แนะนำ")',
    example: 'ยอดนิยม',
  })
  @IsOptional()
  @IsString()
  badge?: string;

  @ApiPropertyOptional({
    description: 'Highlight color for the plan card (hex color)',
    example: '#8B5CF6',
  })
  @IsOptional()
  @IsString()
  highlightColor?: string;

  @ApiPropertyOptional({
    description: 'List of feature descriptions (JSON array as string)',
    example: '["รองรับ 50 ห้อง", "ผู้ใช้งาน 10 คน", "ระบบจองครบครัน"]',
  })
  @IsOptional()
  @IsString()
  features?: string;

  @ApiPropertyOptional({
    description: 'Button text for subscription',
    example: 'เริ่มใช้งาน',
    default: 'เริ่มใช้งาน',
  })
  @IsOptional()
  @IsString()
  buttonText?: string;
}

export class UpdatePlanDto {
  @ApiPropertyOptional({
    description: 'Plan name',
    example: 'Medium Plan Updated',
  })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({
    description: 'Monthly price in THB',
    example: 3490,
    minimum: 0,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  priceMonthly?: number;

  @ApiPropertyOptional({
    description: 'Yearly price in THB',
    minimum: 0,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  priceYearly?: number;

  @ApiPropertyOptional({
    description: 'Yearly discount percentage',
    minimum: 0,
    maximum: 100,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  yearlyDiscountPercent?: number;

  @ApiPropertyOptional({
    description: 'Maximum number of rooms allowed',
    example: 100,
    minimum: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxRooms?: number;

  @ApiPropertyOptional({
    description: 'Maximum number of users allowed',
    example: 20,
    minimum: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxUsers?: number;

  @ApiPropertyOptional({
    description: 'Is plan active',
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  // Sales Page fields
  @ApiPropertyOptional({
    description: 'Plan description for sales page',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: 'Display order on sales page',
    minimum: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  displayOrder?: number;

  @ApiPropertyOptional({
    description: 'Mark as popular/featured plan',
  })
  @IsOptional()
  @IsBoolean()
  isPopular?: boolean;

  @ApiPropertyOptional({
    description: 'Badge text',
  })
  @IsOptional()
  @IsString()
  badge?: string;

  @ApiPropertyOptional({
    description: 'Highlight color (hex)',
  })
  @IsOptional()
  @IsString()
  highlightColor?: string;

  @ApiPropertyOptional({
    description: 'List of features (JSON string)',
  })
  @IsOptional()
  @IsString()
  features?: string;

  @ApiPropertyOptional({
    description: 'Button text',
  })
  @IsOptional()
  @IsString()
  buttonText?: string;
}

// ============ Response DTOs ============

export class PlanFeatureItemDto {
  @ApiProperty({ example: 'uuid-1234' })
  id: string;

  @ApiProperty({ example: 'extra-analytics' })
  featureCode: string;

  @ApiProperty({ example: 'Extra Analytics' })
  featureName: string;

  @ApiProperty({ example: 990 })
  priceMonthly: number;
}

export class AdminPlanItemDto {
  @ApiProperty({ example: 'uuid-1234' })
  id: string;

  @ApiProperty({ example: 'M' })
  code: string;

  @ApiProperty({ example: 'Medium Plan' })
  name: string;

  @ApiProperty({ example: 2990 })
  priceMonthly: number;

  @ApiPropertyOptional({ example: 30504 })
  priceYearly?: number;

  @ApiPropertyOptional({ example: 15 })
  yearlyDiscountPercent?: number;

  @ApiProperty({ example: 50 })
  maxRooms: number;

  @ApiProperty({ example: 10 })
  maxUsers: number;

  @ApiProperty({ example: true })
  isActive: boolean;

  @ApiPropertyOptional({ example: 5 })
  subscriptionCount?: number;

  @ApiPropertyOptional({ example: 3 })
  featureCount?: number;

  // Sales Page fields
  @ApiPropertyOptional({
    example: 'เริ่มต้นใช้งานได้ทันที พร้อมทดลองใช้ฟรี 14 วัน',
  })
  description?: string;

  @ApiPropertyOptional({ example: 1 })
  displayOrder?: number;

  @ApiPropertyOptional({ example: false })
  isPopular?: boolean;

  @ApiPropertyOptional({ example: 'ยอดนิยม' })
  badge?: string;

  @ApiPropertyOptional({ example: '#8B5CF6' })
  highlightColor?: string;

  @ApiPropertyOptional({
    example: '["รองรับ 50 ห้อง", "ผู้ใช้งาน 10 คน"]',
  })
  features?: string;

  @ApiPropertyOptional({ example: 'เริ่มใช้งาน' })
  buttonText?: string;
}

export class AdminPlansListDto {
  @ApiProperty({ type: [AdminPlanItemDto] })
  data: AdminPlanItemDto[];

  @ApiProperty({ example: 3 })
  total: number;
}

export class PlanResponseDto {
  @ApiProperty({ example: 'uuid-1234' })
  id: string;

  @ApiProperty({ example: 'M' })
  code: string;

  @ApiProperty({ example: 'Medium Plan' })
  name: string;

  @ApiProperty({ example: 2990 })
  priceMonthly: number;

  @ApiPropertyOptional({ example: 30504 })
  priceYearly?: number;

  @ApiPropertyOptional({ example: 15 })
  yearlyDiscountPercent?: number;

  @ApiProperty({ example: 50 })
  maxRooms: number;

  @ApiProperty({ example: 10 })
  maxUsers: number;

  @ApiProperty({ example: true })
  isActive: boolean;

  @ApiPropertyOptional({
    type: [PlanFeatureItemDto],
    description: 'Features included in this plan',
  })
  planFeatures?: PlanFeatureItemDto[];

  @ApiPropertyOptional({ example: 5 })
  subscriptionCount?: number;

  // Sales Page fields
  @ApiPropertyOptional({
    example: 'เริ่มต้นใช้งานได้ทันที พร้อมทดลองใช้ฟรี 14 วัน',
  })
  description?: string;

  @ApiPropertyOptional({ example: 1 })
  displayOrder?: number;

  @ApiPropertyOptional({ example: true })
  isPopular?: boolean;

  @ApiPropertyOptional({ example: 'ยอดนิยม' })
  badge?: string;

  @ApiPropertyOptional({ example: '#8B5CF6' })
  highlightColor?: string;

  @ApiPropertyOptional({
    example: '["รองรับ 50 ห้อง", "ผู้ใช้งาน 10 คน", "ระบบจองครบครัน"]',
  })
  features?: string;

  @ApiPropertyOptional({ example: 'เริ่มใช้งาน' })
  buttonText?: string;
}
