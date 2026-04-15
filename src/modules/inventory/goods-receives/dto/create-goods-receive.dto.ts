import {
  IsString,
  IsOptional,
  IsISO8601,
  IsArray,
  ValidateNested,
  IsNumber,
  Min,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class GoodsReceiveItemDto {
  @ApiProperty({
    example: '123e4567-e89b-12d3-a456-426614174000',
    description: 'Inventory item ID',
  })
  @IsString()
  itemId: string;

  @ApiProperty({ example: 10, description: 'Quantity received (minimum 1)' })
  @IsNumber()
  @Min(1)
  receivedQty: number;

  @ApiPropertyOptional({ example: 0, description: 'Rejected quantity (default 0)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  rejectedQty?: number;

  @ApiProperty({ example: 150.5, description: 'Unit cost per item' })
  @IsNumber()
  @Min(0)
  unitCost: number;

  @ApiPropertyOptional({
    example: 'BATCH-2026-001',
    description: 'Batch/lot number',
  })
  @IsOptional()
  @IsString()
  batchNumber?: string;

  @ApiPropertyOptional({
    example: '2026-06-14',
    description: 'Expiry date (ISO 8601)',
  })
  @IsOptional()
  @IsISO8601()
  expiryDate?: string;

  @ApiPropertyOptional({
    example: 'Damaged packaging',
    description: 'Reason for rejection if rejectedQty > 0',
  })
  @IsOptional()
  @IsString()
  rejectReason?: string;

  @ApiPropertyOptional({
    example: 'Verified storage location B-01',
    description: 'Item-specific notes',
  })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateGoodsReceiveDto {
  @ApiPropertyOptional({
    example: '123e4567-e89b-12d3-a456-426614174001',
    description: 'Purchase Order ID (optional - can receive without PO)',
  })
  @IsOptional()
  @IsString()
  purchaseOrderId?: string;

  @ApiProperty({
    example: '123e4567-e89b-12d3-a456-426614174002',
    description: 'Target warehouse ID',
  })
  @IsString()
  warehouseId: string;

  @ApiPropertyOptional({
    example: 'INV-2026-001234',
    description: 'Supplier invoice number',
  })
  @IsOptional()
  @IsString()
  invoiceNumber?: string;

  @ApiPropertyOptional({
    example: '2026-04-14',
    description: 'Invoice date (ISO 8601)',
  })
  @IsOptional()
  @IsISO8601()
  invoiceDate?: string;

  @ApiPropertyOptional({
    example: 'Rush delivery - fragile items packed carefully',
    description: 'General notes for this goods receive',
  })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiProperty({
    type: [GoodsReceiveItemDto],
    description: 'Array of items received (minimum 1 item)',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => GoodsReceiveItemDto)
  items: GoodsReceiveItemDto[];
}
