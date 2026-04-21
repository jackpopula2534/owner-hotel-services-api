import {
  IsString,
  IsOptional,
  IsNumber,
  IsArray,
  ValidateNested,
  Min,
  IsUUID,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class RecipeIngredientDto {
  @ApiProperty({
    description: 'Inventory item ID (UUID)',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsUUID()
  itemId: string;

  @ApiProperty({
    description: 'Quantity needed',
    example: 500,
  })
  @IsNumber()
  @Min(0)
  quantity: number;

  @ApiProperty({
    description: 'Unit of measurement (e.g., grams, liters, pieces)',
    example: 'grams',
  })
  @IsString()
  unit: string;

  @ApiProperty({
    description: 'Wastage percentage for this ingredient',
    example: 5,
    required: false,
  })
  @IsNumber()
  @Min(0)
  @IsOptional()
  wastagePercent?: number;

  @ApiProperty({
    description: 'Notes for this ingredient',
    example: 'Premium grade',
    required: false,
  })
  @IsString()
  @IsOptional()
  notes?: string;
}

export class CreateRecipeDto {
  @ApiProperty({
    description: 'Menu item ID (UUID)',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsUUID()
  menuItemId: string;

  @ApiProperty({
    description: 'Menu item name',
    example: 'Caesar Salad',
  })
  @IsString()
  menuItemName: string;

  @ApiProperty({
    description: 'Number of servings this recipe makes',
    example: 4,
    default: 1,
    required: false,
  })
  @IsNumber()
  @Min(1)
  @IsOptional()
  servings?: number = 1;

  @ApiProperty({
    description: 'Notes about the recipe',
    example: 'Classic preparation',
    required: false,
  })
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiProperty({
    description: 'Array of ingredients',
    type: [RecipeIngredientDto],
    example: [
      {
        itemId: '550e8400-e29b-41d4-a716-446655440001',
        quantity: 500,
        unit: 'grams',
        wastagePercent: 5,
      },
    ],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecipeIngredientDto)
  ingredients: RecipeIngredientDto[];
}
