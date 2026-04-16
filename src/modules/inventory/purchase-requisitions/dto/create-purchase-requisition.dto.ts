import {
  IsString,
  IsOptional,
  IsISO8601,
  IsArray,
  ValidateNested,
  IsNumber,
  IsEnum,
  Min,
  Max,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export enum PurchaseRequisitionPriority {
  LOW = 'LOW',
  NORMAL = 'NORMAL',
  HIGH = 'HIGH',
  URGENT = 'URGENT',
}

export class CreatePRItemDto {
  @ApiProperty({
    example: '123e4567-e89b-12d3-a456-426614174000',
    description: 'Inventory item ID',
  })
  @IsString()
  itemId: string;

  @ApiProperty({ example: 5, description: 'Quantity required (minimum 1)' })
  @IsNumber()
  @Min(1)
  quantity: number;

  @ApiProperty({
    example: 250.5,
    description: 'Estimated unit price',
    required: false,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  estimatedUnitPrice?: number;

  @ApiProperty({
    example: 'Must be premium quality, 100% cotton',
    description: 'Product specifications and requirements',
    required: false,
  })
  @IsOptional()
  @IsString()
  specifications?: string;

  @ApiProperty({
    example: '123e4567-e89b-12d3-a456-426614174001',
    description: 'Preferred supplier ID if any',
    required: false,
  })
  @IsOptional()
  @IsString()
  preferredSupplierId?: string;

  @ApiProperty({
    example: 'Confirm availability before ordering',
    description: 'Item-specific notes',
    required: false,
  })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreatePurchaseRequisitionDto {
  @ApiProperty({
    example: '123e4567-e89b-12d3-a456-426614174000',
    description: 'Property ID for which this requisition is',
  })
  @IsString()
  propertyId: string;

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
    description: 'Priority level of this requisition',
    required: false,
    default: 'NORMAL',
  })
  @IsOptional()
  @IsEnum(PurchaseRequisitionPriority)
  priority?: PurchaseRequisitionPriority;

  @ApiProperty({
    example: 'Bedding supplies for seasonal inventory increase',
    description: 'Purpose of this purchase requisition',
    required: false,
  })
  @IsOptional()
  @IsString()
  purpose?: string;

  @ApiProperty({
    example: 'Housekeeping',
    description: 'Department requesting the items',
    required: false,
  })
  @IsOptional()
  @IsString()
  department?: string;

  @ApiProperty({
    example: 'For summer season preparation, estimated cost 15000 THB',
    description: 'Public notes visible to stakeholders',
    required: false,
  })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiProperty({
    example: 'Budget approved by GM on 2026-04-10',
    description: 'Internal notes for procurement team only',
    required: false,
  })
  @IsOptional()
  @IsString()
  internalNotes?: string;

  @ApiProperty({
    type: [CreatePRItemDto],
    description: 'Array of items to requisition (minimum 1 item)',
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'At least one item is required' })
  @ValidateNested({ each: true })
  @Type(() => CreatePRItemDto)
  items: CreatePRItemDto[];
}
