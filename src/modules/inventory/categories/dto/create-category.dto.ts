import { IsNotEmpty, IsString, IsOptional, IsInt, IsBoolean, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CreateCategoryDto {
  @ApiProperty({ description: 'Category name', example: 'Raw Materials' })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiProperty({ description: 'Unique category code', example: 'CAT-RM-001' })
  @IsNotEmpty()
  @IsString()
  code: string;

  @ApiPropertyOptional({
    description: 'Category description',
    example: 'All raw materials for kitchen',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: 'Parent category ID for hierarchical structure',
    example: 'uuid',
  })
  @IsOptional()
  @IsString()
  parentId?: string;

  @ApiPropertyOptional({ description: 'Sort order within parent category', example: 1, default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  sortOrder?: number;

  @ApiPropertyOptional({ description: 'Whether category is active', example: true, default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
