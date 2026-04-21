import { IsString, IsOptional, IsISO8601, IsArray, ValidateNested, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum CountTypeDto {
  FULL = 'FULL',
  PARTIAL = 'PARTIAL',
  CYCLE = 'CYCLE',
}

export class StockCountItemDto {
  @ApiProperty({
    example: '123e4567-e89b-12d3-a456-426614174000',
    description: 'Inventory item ID',
  })
  @IsString()
  itemId: string;
}

export class CreateStockCountDto {
  @ApiProperty({
    example: '123e4567-e89b-12d3-a456-426614174002',
    description: 'Warehouse ID to count',
  })
  @IsString()
  warehouseId: string;

  @ApiProperty({
    example: '2026-04-14',
    description: 'Count date (ISO 8601)',
  })
  @IsISO8601()
  countDate: string;

  @ApiPropertyOptional({
    enum: CountTypeDto,
    description:
      'Type of count: FULL (entire warehouse), PARTIAL (specific items), CYCLE (cyclic count)',
    example: 'FULL',
  })
  @IsOptional()
  @IsEnum(CountTypeDto)
  countType?: CountTypeDto;

  @ApiPropertyOptional({
    example: 'Monthly full count - prepared by manager',
    description: 'Notes for this count',
  })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({
    type: [StockCountItemDto],
    description:
      'Items to count (for PARTIAL counts). If empty, all items in warehouse will be counted.',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StockCountItemDto)
  items?: StockCountItemDto[];
}
