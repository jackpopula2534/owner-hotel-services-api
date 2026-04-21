import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsInt,
  IsBoolean,
  IsNumber,
  IsArray,
  IsPositive,
  Min,
  Max,
  IsUrl,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateMenuItemDto {
  @ApiProperty({ example: 'uuid-category-id' })
  @IsString()
  @IsNotEmpty()
  categoryId: string;

  @ApiProperty({ example: 'Grilled Salmon' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ example: 'Fresh Atlantic salmon with lemon butter sauce' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ example: 450.0, description: 'Price in THB' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Type(() => Number)
  price: number;

  @ApiPropertyOptional({ example: 120.0, description: 'Cost price (internal use)' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @IsOptional()
  @Type(() => Number)
  cost?: number;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/menu/salmon.jpg' })
  @IsString()
  @IsOptional()
  image?: string;

  @ApiPropertyOptional({ example: 20, description: 'Estimated preparation time in minutes' })
  @IsInt()
  @Min(1)
  @IsOptional()
  preparationTime?: number;

  @ApiPropertyOptional({ example: 520, description: 'Calories (kcal)' })
  @IsInt()
  @Min(0)
  @IsOptional()
  calories?: number;

  @ApiPropertyOptional({
    example: ['fish', 'dairy', 'gluten'],
    description: 'List of allergens',
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  allergens?: string[];

  @ApiPropertyOptional({ example: false })
  @IsBoolean()
  @IsOptional()
  isVegetarian?: boolean;

  @ApiPropertyOptional({ example: false })
  @IsBoolean()
  @IsOptional()
  isVegan?: boolean;

  @ApiPropertyOptional({ example: false })
  @IsBoolean()
  @IsOptional()
  isGlutenFree?: boolean;

  @ApiPropertyOptional({ example: false })
  @IsBoolean()
  @IsOptional()
  isSpicy?: boolean;

  @ApiPropertyOptional({ example: 2, description: 'Spicy level 1-5' })
  @IsInt()
  @Min(1)
  @Max(5)
  @IsOptional()
  spicyLevel?: number;

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  isAvailable?: boolean;

  @ApiPropertyOptional({ example: 1 })
  @IsInt()
  @Min(0)
  @IsOptional()
  displayOrder?: number;
}
