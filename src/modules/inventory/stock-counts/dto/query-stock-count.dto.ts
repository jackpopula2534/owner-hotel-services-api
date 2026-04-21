import { IsOptional, IsNumber, IsString, IsISO8601, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class QueryStockCountDto {
  @ApiPropertyOptional({ example: 1, description: 'Page number' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ example: 20, description: 'Items per page' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  limit?: number;

  @ApiPropertyOptional({
    example: 'createdAt',
    description: 'Sort field: createdAt, scNumber, warehouseId, status',
  })
  @IsOptional()
  @IsString()
  sort?: string;

  @ApiPropertyOptional({ example: 'desc', description: 'Sort direction: asc, desc' })
  @IsOptional()
  @IsString()
  order?: 'asc' | 'desc';

  @ApiPropertyOptional({
    example: '123e4567-e89b-12d3-a456-426614174002',
    description: 'Filter by warehouse ID',
  })
  @IsOptional()
  @IsString()
  warehouseId?: string;

  @ApiPropertyOptional({
    example: 'PLANNED',
    description: 'Filter by status: PLANNED, IN_PROGRESS, COMPLETED, APPROVED, CANCELLED',
  })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({
    example: 'FULL',
    description: 'Filter by count type: FULL, PARTIAL, CYCLE',
  })
  @IsOptional()
  @IsString()
  countType?: string;

  @ApiPropertyOptional({
    example: '2026-04-01',
    description: 'Filter from date (ISO 8601)',
  })
  @IsOptional()
  @IsISO8601()
  startDate?: string;

  @ApiPropertyOptional({
    example: '2026-04-30',
    description: 'Filter to date (ISO 8601)',
  })
  @IsOptional()
  @IsISO8601()
  endDate?: string;
}
