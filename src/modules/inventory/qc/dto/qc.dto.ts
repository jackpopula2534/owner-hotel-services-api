import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsEnum,
  IsInt,
  Min,
  MaxLength,
  IsArray,
  ValidateNested,
  IsUUID,
  IsNumber,
  IsDateString,
} from 'class-validator';
import { Type } from 'class-transformer';

// ─── QC Template DTOs ─────────────────────────────────────────────────────────

export class CreateChecklistItemDto {
  @ApiProperty({ description: 'Checklist item label', example: 'สี/กลิ่นปกติ' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  label: string;

  @ApiProperty({ description: 'Item type', enum: ['BOOLEAN', 'NUMERIC', 'TEXT', 'PHOTO'] })
  @IsEnum(['BOOLEAN', 'NUMERIC', 'TEXT', 'PHOTO'])
  type: 'BOOLEAN' | 'NUMERIC' | 'TEXT' | 'PHOTO';

  @ApiPropertyOptional({ description: 'Whether this item is required', default: true })
  @IsOptional()
  @IsBoolean()
  required?: boolean = true;

  @ApiPropertyOptional({ description: 'Pass condition for NUMERIC type (e.g. { op: "lte", value: 4 })' })
  @IsOptional()
  passCondition?: { op: 'eq' | 'lte' | 'gte' | 'range'; value: number | [number, number] };

  @ApiProperty({ description: 'Display order index' })
  @IsInt()
  @Min(0)
  orderIndex: number;
}

export class CreateQCTemplateDto {
  @ApiProperty({ description: 'Template name' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiProperty({ description: 'Applies to CATEGORY or ITEM', enum: ['CATEGORY', 'ITEM'] })
  @IsEnum(['CATEGORY', 'ITEM'])
  appliesTo: 'CATEGORY' | 'ITEM';

  @ApiPropertyOptional({ description: 'Category ID (required when appliesTo=CATEGORY)' })
  @IsOptional()
  @IsString()
  categoryId?: string;

  @ApiPropertyOptional({ description: 'Item ID (required when appliesTo=ITEM)' })
  @IsOptional()
  @IsString()
  itemId?: string;

  @ApiPropertyOptional({ description: 'Checklist items' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateChecklistItemDto)
  checklistItems?: CreateChecklistItemDto[];
}

export class UpdateQCTemplateDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// ─── QC Record DTOs ───────────────────────────────────────────────────────────

export class CreateQCRecordDto {
  @ApiProperty({ description: 'QC Template ID' })
  @IsString()
  @IsNotEmpty()
  templateId: string;

  @ApiPropertyOptional({ description: 'Goods Receive ID (if linked to GR)' })
  @IsOptional()
  @IsString()
  goodsReceiveId?: string;

  @ApiPropertyOptional({ description: 'Lot ID (if linked to lot)' })
  @IsOptional()
  @IsString()
  lotId?: string;

  @ApiPropertyOptional({ description: 'Additional notes' })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class SubmitQCResultDto {
  @ApiProperty({ description: 'Checklist item ID' })
  @IsString()
  checklistItemId: string;

  @ApiPropertyOptional({ description: 'Boolean result (for type=BOOLEAN)' })
  @IsOptional()
  @IsBoolean()
  valueBool?: boolean;

  @ApiPropertyOptional({ description: 'Numeric result (for type=NUMERIC)' })
  @IsOptional()
  @IsNumber()
  valueNumeric?: number;

  @ApiPropertyOptional({ description: 'Text result (for type=TEXT)' })
  @IsOptional()
  @IsString()
  valueText?: string;

  @ApiPropertyOptional({ description: 'Photo URLs array (for type=PHOTO)' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  photoUrls?: string[];

  @ApiProperty({ description: 'Whether this item passed' })
  @IsBoolean()
  passed: boolean;
}

export class SubmitQCRecordDto {
  @ApiProperty({ description: 'All result items', type: [SubmitQCResultDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SubmitQCResultDto)
  results: SubmitQCResultDto[];

  @ApiPropertyOptional({ description: 'Notes' })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class QueryQCRecordDto {
  @ApiPropertyOptional({ description: 'Filter by status' })
  @IsOptional()
  @IsEnum(['PENDING', 'PASSED', 'PARTIAL_FAIL', 'FAILED'])
  status?: string;

  @ApiPropertyOptional({ description: 'Filter by supplier ID' })
  @IsOptional()
  @IsString()
  supplierId?: string;

  @ApiPropertyOptional({ description: 'Filter by GR ID' })
  @IsOptional()
  @IsString()
  goodsReceiveId?: string;

  @ApiPropertyOptional({ description: 'Filter from date (ISO date string e.g. 2026-01-01)' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: 'Filter to date (ISO date string e.g. 2026-04-30)' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  limit?: number = 20;
}
