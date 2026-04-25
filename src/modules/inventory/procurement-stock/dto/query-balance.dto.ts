import { IsOptional, IsString, IsEnum, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Stock health filter for the procurement-side balance report.
 * Drives which rows are returned and which sort order is applied.
 */
export enum StockBalanceFilter {
  ALL = 'ALL',
  /** quantity below reorder point (or below minStock if reorderPoint=0) */
  LOW = 'LOW',
  /** quantity above maxStock (when maxStock is set) */
  OVERSTOCK = 'OVERSTOCK',
  /** quantity is exactly 0 — separate from LOW so the UI can highlight stockouts */
  OUT_OF_STOCK = 'OUT_OF_STOCK',
}

export class QueryStockBalanceDto {
  @ApiProperty({ example: 1, required: false, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiProperty({ example: 50, required: false, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 50;

  @ApiProperty({
    enum: StockBalanceFilter,
    description: 'Filter by stock health status. Defaults to ALL.',
    required: false,
    default: StockBalanceFilter.ALL,
  })
  @IsOptional()
  @IsEnum(StockBalanceFilter)
  filter?: StockBalanceFilter = StockBalanceFilter.ALL;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  warehouseId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  categoryId?: string;

  @ApiProperty({
    description: 'Search by SKU or item name (partial match)',
    required: false,
  })
  @IsOptional()
  @IsString()
  search?: string;
}
