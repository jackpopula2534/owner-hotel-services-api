import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { AddonBillingCycle } from './create-addon.dto';

/**
 * Query parameters สำหรับ list endpoint /addons
 */
export class QueryAddonDto {
  @ApiPropertyOptional({ description: 'ค้นหาจาก code/name', example: 'report' })
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({ description: 'กรองเฉพาะ active', example: true })
  @Type(() => Boolean)
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional({ enum: AddonBillingCycle })
  @IsEnum(AddonBillingCycle)
  @IsOptional()
  billingCycle?: AddonBillingCycle;

  @ApiPropertyOptional({ example: 'reports' })
  @IsString()
  @IsOptional()
  category?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit?: number;
}
