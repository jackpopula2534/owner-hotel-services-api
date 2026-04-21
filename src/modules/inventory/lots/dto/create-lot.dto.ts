import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsInt,
  IsPositive,
  IsDateString,
  IsNumber,
  Min,
} from 'class-validator';

export class CreateLotDto {
  @ApiProperty({ description: 'Item ID' })
  @IsString()
  itemId: string;

  @ApiProperty({ description: 'Warehouse ID' })
  @IsString()
  warehouseId: string;

  @ApiPropertyOptional({ description: 'Batch number from supplier' })
  @IsOptional()
  @IsString()
  batchNumber?: string;

  @ApiPropertyOptional({ description: 'GoodsReceiveItem ID to link' })
  @IsOptional()
  @IsString()
  grItemId?: string;

  @ApiPropertyOptional({ description: 'Supplier ID' })
  @IsOptional()
  @IsString()
  supplierId?: string;

  @ApiProperty({ description: 'Initial quantity received' })
  @IsInt()
  @IsPositive()
  initialQty: number;

  @ApiProperty({ description: 'Unit cost' })
  @IsNumber()
  @Min(0)
  unitCost: number;

  @ApiPropertyOptional({ description: 'Manufacture date (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  manufactureDate?: string;

  @ApiPropertyOptional({ description: 'Expiry date (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  expiryDate?: string;

  @ApiPropertyOptional({ description: 'Additional notes' })
  @IsOptional()
  @IsString()
  notes?: string;
}
