import { IsOptional, IsString, IsInt, IsEnum, IsDateString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { StockMovementTypeDto } from './create-stock-movement.dto';

export class QueryStockMovementDto {
  @ApiPropertyOptional({ description: 'Page number (default: 1)', example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    description: 'Items per page (default: 20)',
    example: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 20;

  @ApiPropertyOptional({
    description: 'Filter by warehouse ID',
  })
  @IsOptional()
  @IsString()
  warehouseId?: string;

  @ApiPropertyOptional({
    description: 'Filter by inventory item ID',
  })
  @IsOptional()
  @IsString()
  itemId?: string;

  @ApiPropertyOptional({
    enum: StockMovementTypeDto,
    description: 'Filter by movement type',
  })
  @IsOptional()
  @IsEnum(StockMovementTypeDto)
  type?: StockMovementTypeDto;

  @ApiPropertyOptional({
    description: 'Start date filter (ISO 8601 format)',
    example: '2026-01-01T00:00:00Z',
  })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({
    description: 'End date filter (ISO 8601 format)',
    example: '2026-12-31T23:59:59Z',
  })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({
    description: 'Sort field (default: createdAt)',
    example: 'createdAt',
  })
  @IsOptional()
  @IsString()
  sort?: string = 'createdAt';

  @ApiPropertyOptional({
    description: 'Sort order (default: desc)',
    enum: ['asc', 'desc'],
    example: 'desc',
  })
  @IsOptional()
  @IsString()
  order?: 'asc' | 'desc' = 'desc';
}
