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
  ArrayMinSize,
  ArrayMaxSize,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';

// ─── QC Template DTOs ─────────────────────────────────────────────────────────

/**
 * Pass condition payload for NUMERIC checklist items.
 *
 * Kept as its own class so the global ValidationPipe with
 * `whitelist + forbidNonWhitelisted` can validate the nested object instead
 * of silently stripping it (or worse, rejecting unknown shapes 400-style).
 */
export class PassConditionDto {
  @ApiProperty({ enum: ['eq', 'lte', 'gte', 'range'] })
  @IsEnum(['eq', 'lte', 'gte', 'range'])
  op: 'eq' | 'lte' | 'gte' | 'range';

  // Single number (op = eq/lte/gte) is allowed — see ValidateIf below.
  @ApiPropertyOptional({ description: 'Threshold for eq/lte/gte', type: Number })
  @ValidateIf((o: PassConditionDto) => o.op !== 'range')
  @IsNumber()
  // Number range tuple [min, max] for op = range.
  @ValidateIf((o: PassConditionDto) => o.op === 'range')
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(2)
  @IsNumber({}, { each: true })
  value: number | [number, number];
}

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

  @ApiPropertyOptional({
    description: 'Pass condition for NUMERIC type (e.g. { op: "lte", value: 4 })',
    type: PassConditionDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => PassConditionDto)
  passCondition?: PassConditionDto;

  @ApiPropertyOptional({ description: 'Display order index', default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  orderIndex?: number = 0;
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

  // categoryId is mandatory when appliesTo=CATEGORY, otherwise must be absent.
  @ApiPropertyOptional({ description: 'Category ID (required when appliesTo=CATEGORY)' })
  @ValidateIf((o: CreateQCTemplateDto) => o.appliesTo === 'CATEGORY')
  @IsUUID('4', { message: 'categoryId ต้องเป็น UUID v4' })
  @ValidateIf((o: CreateQCTemplateDto) => o.appliesTo !== 'CATEGORY')
  @IsOptional()
  categoryId?: string;

  // itemId is mandatory when appliesTo=ITEM, otherwise must be absent.
  @ApiPropertyOptional({ description: 'Item ID (required when appliesTo=ITEM)' })
  @ValidateIf((o: CreateQCTemplateDto) => o.appliesTo === 'ITEM')
  @IsUUID('4', { message: 'itemId ต้องเป็น UUID v4' })
  @ValidateIf((o: CreateQCTemplateDto) => o.appliesTo !== 'ITEM')
  @IsOptional()
  itemId?: string;

  @ApiPropertyOptional({ description: 'Checklist items', type: [CreateChecklistItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateChecklistItemDto)
  checklistItems?: CreateChecklistItemDto[];
}

/**
 * Full update DTO for PATCH /inventory/qc/templates/:id
 *
 * Previously only contained `name` and `isActive`, which caused the global
 * ValidationPipe (forbidNonWhitelisted: true) to reject any payload that
 * included `appliesTo`, `categoryId`, `itemId`, or `checklistItems`.
 * All editable fields are now whitelisted here.
 */
export class UpdateQCTemplateDto {
  @ApiPropertyOptional({ description: 'Template name' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ description: 'Whether template is active' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Applies to CATEGORY or ITEM', enum: ['CATEGORY', 'ITEM'] })
  @IsOptional()
  @IsEnum(['CATEGORY', 'ITEM'])
  appliesTo?: 'CATEGORY' | 'ITEM';

  // categoryId is required when appliesTo=CATEGORY, otherwise optional/absent.
  @ApiPropertyOptional({ description: 'Category ID (required when appliesTo=CATEGORY)' })
  @ValidateIf((o: UpdateQCTemplateDto) => o.appliesTo === 'CATEGORY')
  @IsUUID('4', { message: 'categoryId ต้องเป็น UUID v4' })
  @ValidateIf((o: UpdateQCTemplateDto) => o.appliesTo !== 'CATEGORY')
  @IsOptional()
  categoryId?: string;

  // itemId is required when appliesTo=ITEM, otherwise optional/absent.
  @ApiPropertyOptional({ description: 'Item ID (required when appliesTo=ITEM)' })
  @ValidateIf((o: UpdateQCTemplateDto) => o.appliesTo === 'ITEM')
  @IsUUID('4', { message: 'itemId ต้องเป็น UUID v4' })
  @ValidateIf((o: UpdateQCTemplateDto) => o.appliesTo !== 'ITEM')
  @IsOptional()
  itemId?: string;

  @ApiPropertyOptional({ description: 'Replacement checklist items (replaces all existing)', type: [CreateChecklistItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateChecklistItemDto)
  checklistItems?: CreateChecklistItemDto[];
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
