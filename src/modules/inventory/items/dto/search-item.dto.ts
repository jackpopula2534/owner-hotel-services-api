import {
  IsOptional,
  IsString,
  IsInt,
  IsBoolean,
  MinLength,
  MaxLength,
  Min,
  Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type, Transform } from 'class-transformer';

/**
 * Query DTO for the lightweight typeahead search endpoint.
 *
 * Differs from `QueryItemDto` in two important ways:
 *   1. `q` is required and must be at least 2 characters — prevents accidental
 *      full-table scans from eagerly mounted dropdowns (root cause of the
 *      "limit ต้องไม่เกิน 100 รายการต่อหน้า" bug on the Goods Receive form).
 *   2. Response shape is intentionally slim — `searchItems` returns only the
 *      fields needed to render a selectable option, so `limit` can safely go
 *      up to 50 without paying the cost of joining warehouseStocks.
 */
export class SearchItemDto {
  @ApiProperty({
    description: 'Search query. Matches item.name, item.sku or item.barcode (case-insensitive).',
    example: 'tom',
    minLength: 2,
    maxLength: 100,
  })
  @IsString()
  @MinLength(2, { message: 'กรุณาพิมพ์อย่างน้อย 2 ตัวอักษรเพื่อค้นหา' })
  @MaxLength(100)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  q!: string;

  @ApiPropertyOptional({
    description: 'Maximum number of results to return (default 20, max 50).',
    example: 20,
    default: 20,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  @Type(() => Number)
  limit?: number;

  @ApiPropertyOptional({ description: 'Restrict results to a given category', example: 'uuid' })
  @IsOptional()
  @IsString()
  categoryId?: string;

  @ApiPropertyOptional({
    description:
      'Restrict results to active items. Default true (dropdowns rarely need archived items).',
    example: true,
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') return value.toLowerCase() === 'true';
    return undefined;
  })
  isActive?: boolean;
}
