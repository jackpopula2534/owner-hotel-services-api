import {
  IsNotEmpty,
  IsString,
  IsOptional,
  IsInt,
  IsNumber,
  IsEnum,
  IsDateString,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum StockMovementTypeDto {
  GOODS_RECEIVE = 'GOODS_RECEIVE',
  GOODS_ISSUE = 'GOODS_ISSUE',
  TRANSFER_IN = 'TRANSFER_IN',
  TRANSFER_OUT = 'TRANSFER_OUT',
  ADJUSTMENT_IN = 'ADJUSTMENT_IN',
  ADJUSTMENT_OUT = 'ADJUSTMENT_OUT',
  RETURN_SUPPLIER = 'RETURN_SUPPLIER',
  WASTE = 'WASTE',
}

export class CreateStockMovementDto {
  @ApiProperty({ description: 'Warehouse ID' })
  @IsNotEmpty()
  @IsString()
  warehouseId: string;

  @ApiProperty({ description: 'Inventory Item ID' })
  @IsNotEmpty()
  @IsString()
  itemId: string;

  @ApiProperty({
    enum: StockMovementTypeDto,
    description: 'Type of stock movement',
  })
  @IsNotEmpty()
  @IsEnum(StockMovementTypeDto)
  type: StockMovementTypeDto;

  @ApiProperty({ description: 'Quantity moved' })
  @IsNotEmpty()
  @IsInt()
  @Min(1)
  quantity: number;

  @ApiProperty({ description: 'Unit cost for this movement' })
  @IsNotEmpty()
  @IsNumber()
  unitCost: number;

  @ApiPropertyOptional({
    description: 'Type of reference (e.g., PO, RMA, Requisition)',
  })
  @IsOptional()
  @IsString()
  referenceType?: string;

  @ApiPropertyOptional({
    description: 'Reference document ID (e.g., PO number)',
  })
  @IsOptional()
  @IsString()
  referenceId?: string;

  @ApiPropertyOptional({
    description: 'Target warehouse ID for transfers',
  })
  @IsOptional()
  @IsString()
  transferWarehouseId?: string;

  @ApiPropertyOptional({ description: 'Notes/remarks' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ description: 'Batch/Lot number' })
  @IsOptional()
  @IsString()
  batchNumber?: string;

  @ApiPropertyOptional({ description: 'Expiry date (ISO 8601 format)' })
  @IsOptional()
  @IsDateString()
  expiryDate?: string;
}
