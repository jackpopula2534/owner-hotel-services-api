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

export class UpdateRecipeIngredientDto {
  @ApiProperty({
    description: 'Inventory item ID (UUID)',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsUUID()
  itemId: string;

  @ApiProperty({
    description: 'Quantity needed',
    example: 600,
  })
  @IsNumber()
  @Min(0)
  quantity: number;

  @ApiProperty({
    description: 'Unit of measurement',
    example: 'grams',
  })
  @IsString()
  unit: string;

  @ApiProperty({
    description: 'Wastage percentage',
    example: 5,
    required: false,
  })
  @IsNumber()
  @Min(0)
  @IsOptional()
  wastagePercent?: number;

  @ApiProperty({
    description: 'Notes for this ingredient',
    example: 'Updated notes',
    required: false,
  })
  @IsString()
  @IsOptional()
  notes?: string;
}

export class UpdateRecipeDto {
  @ApiProperty({
    description: 'Menu item name',
    example: 'Caesar Salad with Parmesan',
    required: false,
  })
  @IsString()
  @IsOptional()
  menuItemName?: string;

  @ApiProperty({
    description: 'Number of servings',
    example: 6,
    required: false,
  })
  @IsNumber()
  @Min(1)
  @IsOptional()
  servings?: number;

  @ApiProperty({
    description: 'Notes about the recipe',
    example: 'Updated version',
    required: false,
  })
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiProperty({
    description: 'Array of ingredients (replaces existing if provided)',
    type: [UpdateRecipeIngredientDto],
    required: false,
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateRecipeIngredientDto)
  @IsOptional()
  ingredients?: UpdateRecipeIngredientDto[];
}
