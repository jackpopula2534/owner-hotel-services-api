import {
  IsString,
  IsOptional,
  IsInt,
  IsNumber,
  IsArray,
  ValidateNested,
  Min,
  Max,
  IsNotEmpty,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateRecipeIngredientDto {
  @ApiProperty({ example: 'Coconut milk', description: 'Ingredient name' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ example: 200, description: 'Quantity amount' })
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsOptional()
  @Type(() => Number)
  quantity?: number;

  @ApiPropertyOptional({ example: 'ml', description: 'Unit of measurement (e.g. g, ml, cup, tbsp)' })
  @IsString()
  @IsOptional()
  unit?: string;

  @ApiPropertyOptional({ example: 'Full-fat preferred', description: 'Extra note for this ingredient' })
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiPropertyOptional({ example: 0, description: 'Display order within the ingredient list' })
  @IsInt()
  @Min(0)
  @IsOptional()
  displayOrder?: number;
}

export class CreateRecipeDto {
  @ApiPropertyOptional({ example: 4, description: 'Number of servings this recipe yields' })
  @IsInt()
  @Min(1)
  @Max(9999)
  @IsOptional()
  @Type(() => Number)
  servings?: number;

  @ApiPropertyOptional({
    example: '1. Heat oil in a wok over medium-high heat.\n2. Add curry paste and fry until fragrant...',
    description: 'Step-by-step cooking instructions (supports multi-line)',
  })
  @IsString()
  @IsOptional()
  instructions?: string;

  @ApiPropertyOptional({
    example: 'Use fresh galangal for best results. Can substitute with dried galangal powder.',
    description: 'Additional chef notes visible in the kitchen',
  })
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiPropertyOptional({
    type: [CreateRecipeIngredientDto],
    description: 'Ingredient list — sending this array replaces all existing ingredients',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateRecipeIngredientDto)
  @IsOptional()
  ingredients?: CreateRecipeIngredientDto[];
}
