import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';

// ─── Enums (mirror Prisma) ───────────────────────────────────────────────

export enum OpExpenseTypeDto {
  RECURRING = 'RECURRING',
  ONE_TIME = 'ONE_TIME',
  USAGE = 'USAGE',
}

export enum OpBillingCycleDto {
  MONTHLY = 'MONTHLY',
  QUARTERLY = 'QUARTERLY',
  YEARLY = 'YEARLY',
}

export enum OpCostBehaviorDto {
  FIXED = 'FIXED',
  VARIABLE = 'VARIABLE',
  SEMI_VARIABLE = 'SEMI_VARIABLE',
}

// ─── Category DTOs ────────────────────────────────────────────────────────

export class CreateCostCategoryDto {
  @ApiProperty({ example: 'infrastructure' })
  @IsString()
  @Length(2, 50)
  code!: string;

  @ApiProperty({ example: 'ค่าโครงสร้างพื้นฐาน' })
  @IsString()
  @Length(1, 100)
  name!: string;

  @ApiPropertyOptional({ example: 'Infrastructure' })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  nameEn?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: '#3b82f6' })
  @IsOptional()
  @IsString()
  color?: string;

  @ApiPropertyOptional({ example: 'server' })
  @IsOptional()
  @IsString()
  icon?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isCogs?: boolean;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateCostCategoryDto extends PartialType(CreateCostCategoryDto) {}

// ─── Vendor DTOs ─────────────────────────────────────────────────────────

export class CreateCostVendorDto {
  @ApiProperty({ example: 'AWS' })
  @IsString()
  @Length(1, 150)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  website?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  contactName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  contactEmail?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateCostVendorDto extends PartialType(CreateCostVendorDto) {}

// ─── Expense DTOs ────────────────────────────────────────────────────────

export class CreateOperatingExpenseDto {
  @ApiProperty()
  @IsUUID()
  categoryId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  vendorId?: string;

  @ApiProperty({ example: 'AWS EC2 Production Server' })
  @IsString()
  @Length(1, 200)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ example: 12500.5, description: 'Amount in THB' })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  amount!: number;

  @ApiPropertyOptional({ default: 'THB' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiProperty({ enum: OpExpenseTypeDto })
  @IsEnum(OpExpenseTypeDto)
  type!: OpExpenseTypeDto;

  @ApiPropertyOptional({ enum: OpCostBehaviorDto, default: OpCostBehaviorDto.FIXED })
  @IsOptional()
  @IsEnum(OpCostBehaviorDto)
  behavior?: OpCostBehaviorDto;

  @ApiPropertyOptional({ enum: OpBillingCycleDto })
  @IsOptional()
  @IsEnum(OpBillingCycleDto)
  billingCycle?: OpBillingCycleDto;

  @ApiProperty({ example: '2026-01-01' })
  @IsDateString()
  startDate!: string;

  @ApiPropertyOptional({ example: '2027-01-01' })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'comma-separated tags' })
  @IsOptional()
  @IsString()
  tags?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reference?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  attachmentUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateOperatingExpenseDto extends PartialType(CreateOperatingExpenseDto) {}

export class ListExpensesQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  vendorId?: string;

  @ApiPropertyOptional({ enum: OpExpenseTypeDto })
  @IsOptional()
  @IsEnum(OpExpenseTypeDto)
  type?: OpExpenseTypeDto;

  @ApiPropertyOptional({ description: 'Filter by active status' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

// ─── Budget DTO ──────────────────────────────────────────────────────────

export class UpsertCostBudgetDto {
  @ApiPropertyOptional({ description: 'null = budget รวมทุกหมวด' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiProperty({ example: 2026 })
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(3000)
  year!: number;

  @ApiPropertyOptional({ example: 5, description: 'null = annual budget' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month?: number;

  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  budgetAmount!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

// ─── Marketing Campaign DTOs ─────────────────────────────────────────────

export class CreateMarketingCampaignDto {
  @ApiProperty()
  @IsString()
  @Length(1, 200)
  name!: string;

  @ApiProperty({ example: 'google_ads' })
  @IsString()
  channel!: string;

  @ApiProperty()
  @IsDateString()
  startDate!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  totalSpend?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  attributedTenants?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateMarketingCampaignDto extends PartialType(CreateMarketingCampaignDto) {}

// ─── Report Query DTOs ───────────────────────────────────────────────────

export class SummaryQueryDto {
  @ApiPropertyOptional({ description: 'Year (default = current year)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(3000)
  year?: number;

  @ApiPropertyOptional({ description: 'Month 1-12 (default = current month)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month?: number;
}

export class TrendQueryDto {
  @ApiPropertyOptional({ default: 12 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(36)
  months?: number;
}

export class PnLQueryDto {
  @ApiPropertyOptional({ example: '2026-01-01' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @IsDateString()
  to?: string;
}

export class RegenerateSnapshotDto {
  @ApiPropertyOptional({ description: 'Year (default = current year)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(3000)
  year?: number;

  @ApiPropertyOptional({ description: 'Month 1-12 (default = current month)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month?: number;
}
