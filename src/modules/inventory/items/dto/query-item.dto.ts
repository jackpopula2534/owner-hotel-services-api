import { IsOptional, IsString, IsInt, IsBoolean, IsEnum, Min, Max } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export enum SortField {
  CREATED_AT = 'createdAt',
  NAME = 'name',
  SKU = 'sku',
  TOTAL_STOCK = 'totalStock',
  UPDATED_AT = 'updatedAt',
}

export enum SortOrder {
  ASC = 'asc',
  DESC = 'desc',
}

export class QueryItemDto {
  @ApiPropertyOptional({ description: 'Page number', example: 1, default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number;

  @ApiPropertyOptional({ description: 'Items per page', example: 20, default: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number;

  @ApiPropertyOptional({
    description: 'Search by name or SKU',
    example: 'Tomato',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Filter by category ID', example: 'uuid' })
  @IsOptional()
  @IsString()
  categoryId?: string;

  @ApiPropertyOptional({
    description: 'Filter by active status',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'Filter by perishable status',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  isPerishable?: boolean;

  @ApiPropertyOptional({
    enum: SortField,
    default: SortField.CREATED_AT,
    description: 'Field to sort by',
  })
  @IsOptional()
  @IsEnum(SortField)
  sort?: SortField;

  @ApiPropertyOptional({
    enum: SortOrder,
    default: SortOrder.DESC,
    description: 'Sort direction',
  })
  @IsOptional()
  @IsEnum(SortOrder)
  order?: SortOrder;
}
