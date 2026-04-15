import { IsNotEmpty, IsString, IsOptional, IsEnum, IsInt, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export enum CostTypeCategory {
  MATERIAL = 'MATERIAL',
  LABOR = 'LABOR',
  OVERHEAD = 'OVERHEAD',
  REVENUE = 'REVENUE',
  OTHER = 'OTHER',
}

export class CreateCostTypeDto {
  @ApiProperty({
    description: 'Cost type name',
    example: 'Room Amenities',
  })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiProperty({
    description: 'Cost type code (unique per tenant)',
    example: 'CT-AMEN',
  })
  @IsNotEmpty()
  @IsString()
  code: string;

  @ApiProperty({
    description: 'Cost type category',
    enum: CostTypeCategory,
    example: CostTypeCategory.MATERIAL,
  })
  @IsNotEmpty()
  @IsEnum(CostTypeCategory)
  category: CostTypeCategory;

  @ApiPropertyOptional({
    description: 'Cost type description',
    example: 'Toiletries and amenities for guest rooms',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: 'Sort order for display',
    example: 1,
    default: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  sortOrder?: number;
}
