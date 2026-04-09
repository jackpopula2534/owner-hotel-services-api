import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsNumber,
  IsIn,
  IsArray,
  ValidateNested,
  Min,
  Max,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';

// ─── KPI Criteria Item ────────────────────────────────────────────────────────

export class CreateKpiTemplateItemDto {
  @ApiProperty({ description: 'ชื่อ KPI criteria', example: 'คุณภาพงาน' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ description: 'ชื่อภาษาอังกฤษ', example: 'Work Quality' })
  @IsOptional()
  @IsString()
  nameEn?: string;

  @ApiPropertyOptional({ description: 'คำอธิบายเกณฑ์นี้' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ description: 'น้ำหนัก % (รวมทุกข้อ = 100)', example: 30 })
  @IsNumber()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  weight: number;

  @ApiPropertyOptional({ description: 'คะแนนต่ำสุด', example: 1, default: 1 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  minScore?: number;

  @ApiPropertyOptional({ description: 'คะแนนสูงสุด', example: 5, default: 5 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  maxScore?: number;

  @ApiPropertyOptional({ description: 'ลำดับ', example: 1, default: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  sortOrder?: number;
}

// ─── KPI Template ─────────────────────────────────────────────────────────────

export class CreateKpiTemplateDto {
  @ApiProperty({ description: 'ชื่อ Template', example: 'Front Desk Standard KPI' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ description: 'ชื่อภาษาอังกฤษ' })
  @IsOptional()
  @IsString()
  nameEn?: string;

  @ApiPropertyOptional({ description: 'รหัสแผนก (soft-link)', example: 'FRONT_OFFICE' })
  @IsOptional()
  @IsString()
  departmentCode?: string;

  @ApiPropertyOptional({ description: 'รหัสตำแหน่ง (soft-link)', example: 'RECEPTIONIST' })
  @IsOptional()
  @IsString()
  positionCode?: string;

  @ApiProperty({
    description: 'ประเภทรอบประเมิน',
    enum: ['quarterly', 'half_yearly', 'yearly'],
    example: 'quarterly',
  })
  @IsString()
  @IsIn(['quarterly', 'half_yearly', 'yearly'])
  periodType: string;

  @ApiPropertyOptional({ description: 'คำอธิบาย Template' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'ใช้งาน?', default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiProperty({
    description: 'รายการ KPI criteria (น้ำหนักรวม = 100%)',
    type: [CreateKpiTemplateItemDto],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateKpiTemplateItemDto)
  items: CreateKpiTemplateItemDto[];
}

// ─── Update DTOs ─────────────────────────────────────────────────────────────

export class UpdateKpiTemplateDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  nameEn?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  departmentCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  positionCode?: string;

  @ApiPropertyOptional({ enum: ['quarterly', 'half_yearly', 'yearly'] })
  @IsOptional()
  @IsString()
  @IsIn(['quarterly', 'half_yearly', 'yearly'])
  periodType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateKpiTemplateItemDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  nameEn?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'น้ำหนัก %' })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  weight?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  minScore?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  maxScore?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  sortOrder?: number;
}
