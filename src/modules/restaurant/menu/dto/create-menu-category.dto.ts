import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsInt,
  IsBoolean,
  Min,
  Matches,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateMenuCategoryDto {
  @ApiProperty({ example: 'Appetizers' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @ApiPropertyOptional({ example: 'Light starters to begin your meal' })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({
    example: 'https://cdn.example.com/categories/appetizers.jpg',
    description: 'Cover image URL or data URI',
  })
  @IsString()
  @IsOptional()
  image?: string;

  @ApiPropertyOptional({
    example: 'utensils',
    description: 'Lucide icon identifier (kebab-case)',
  })
  @IsString()
  @IsOptional()
  @MaxLength(64)
  icon?: string;

  @ApiPropertyOptional({
    example: '#7C3AED',
    description: 'Hex color code (#RGB or #RRGGBB) used for UI badges',
  })
  @IsString()
  @IsOptional()
  @Matches(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, {
    message: 'color must be a valid hex code (#RGB or #RRGGBB)',
  })
  color?: string;

  @ApiPropertyOptional({ example: 1, description: 'Display order (lower = first)' })
  @IsInt()
  @Min(0)
  @IsOptional()
  displayOrder?: number;

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
