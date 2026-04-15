import {
  IsOptional,
  IsISO8601,
  IsArray,
  ValidateNested,
  IsNumber,
  IsString,
  Min,
  Max,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class UpdatePurchaseOrderItemDto {
  @ApiProperty({
    example: '123e4567-e89b-12d3-a456-426614174000',
    description: 'Inventory item ID',
  })
  @IsString()
  itemId: string;

  @ApiProperty({ example: 5, description: 'Quantity to order (minimum 1)' })
  @IsNumber()
  @Min(1)
  quantity: number;

  @ApiProperty({ example: 250.5, description: 'Unit price per item' })
  @IsNumber()
  @Min(0)
  unitPrice: number;

  @ApiProperty({
    example: 10,
    description: 'Discount percentage (0-100)',
    required: false,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  discount?: number;

  @ApiProperty({
    example: 7,
    description: 'Tax rate percentage (0-100)',
    required: false,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  taxRate?: number;

  @ApiProperty({
    example: 'High-quality linens',
    description: 'Item-specific notes',
    required: false,
  })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdatePurchaseOrderDto {
  @ApiProperty({
    example: '2026-05-01',
    description: 'Expected delivery date (ISO 8601)',
    required: false,
  })
  @IsOptional()
  @IsISO8601()
  expectedDate?: string;

  @ApiProperty({
    example: 'Urgent order for kitchen supplies',
    description: 'Public notes visible to suppliers',
    required: false,
  })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiProperty({
    example: 'Follow up on delivery status by phone',
    description: 'Internal notes for hotel staff only',
    required: false,
  })
  @IsOptional()
  @IsString()
  internalNotes?: string;

  @ApiProperty({
    type: [UpdatePurchaseOrderItemDto],
    description: 'Array of items to order (minimum 1 item). Replaces all existing items.',
    required: false,
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => UpdatePurchaseOrderItemDto)
  items?: UpdatePurchaseOrderItemDto[];
}
