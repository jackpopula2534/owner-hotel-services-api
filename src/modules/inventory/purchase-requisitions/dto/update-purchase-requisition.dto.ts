import {
  IsString,
  IsOptional,
  IsISO8601,
  IsArray,
  ValidateNested,
  IsNumber,
  IsEnum,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { CreatePRItemDto, PurchaseRequisitionPriority } from './create-purchase-requisition.dto';

export class UpdatePurchaseRequisitionDto {
  @ApiProperty({
    example: '123e4567-e89b-12d3-a456-426614174000',
    description: 'Property ID',
    required: false,
  })
  @IsOptional()
  @IsString()
  propertyId?: string;

  @ApiProperty({
    example: '2026-05-15',
    description: 'Date when items are required (ISO 8601)',
    required: false,
  })
  @IsOptional()
  @IsISO8601()
  requiredDate?: string;

  @ApiProperty({
    enum: PurchaseRequisitionPriority,
    description: 'Priority level',
    required: false,
  })
  @IsOptional()
  @IsEnum(PurchaseRequisitionPriority)
  priority?: PurchaseRequisitionPriority;

  @ApiProperty({
    example: 'Bedding supplies update',
    description: 'Purpose of requisition',
    required: false,
  })
  @IsOptional()
  @IsString()
  purpose?: string;

  @ApiProperty({
    example: 'Housekeeping',
    description: 'Department requesting',
    required: false,
  })
  @IsOptional()
  @IsString()
  department?: string;

  @ApiProperty({
    example: 'Updated notes',
    description: 'Public notes',
    required: false,
  })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiProperty({
    example: 'Updated internal notes',
    description: 'Internal notes',
    required: false,
  })
  @IsOptional()
  @IsString()
  internalNotes?: string;

  @ApiProperty({
    type: [CreatePRItemDto],
    description: 'Updated array of items',
    required: false,
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreatePRItemDto)
  items?: CreatePRItemDto[];
}
