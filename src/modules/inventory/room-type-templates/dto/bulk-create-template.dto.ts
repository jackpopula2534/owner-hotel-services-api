import {
  IsString,
  IsOptional,
  IsArray,
  ValidateNested,
  IsNumber,
  Min,
  IsUUID,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class BulkTemplateItemDto {
  @ApiProperty({
    description: 'Inventory item ID (UUID)',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsUUID()
  itemId: string;

  @ApiProperty({
    description: 'Quantity to deduct',
    example: 2,
    minimum: 1,
  })
  @IsNumber()
  @Min(1)
  quantity: number;

  @ApiProperty({
    description: 'Warehouse ID (optional)',
    example: '550e8400-e29b-41d4-a716-446655440001',
    required: false,
  })
  @IsUUID()
  @IsOptional()
  warehouseId?: string;

  @ApiProperty({
    description: 'Notes for this item',
    example: 'Standard quantity',
    required: false,
  })
  @IsString()
  @IsOptional()
  notes?: string;
}

export class BulkCreateTemplateDto {
  @ApiProperty({
    description: 'Room type (e.g., deluxe, standard, suite)',
    example: 'deluxe',
  })
  @IsString()
  roomType: string;

  @ApiProperty({
    description: 'Housekeeping task type',
    example: 'checkout',
    default: 'checkout',
  })
  @IsString()
  @IsOptional()
  taskType?: string = 'checkout';

  @ApiProperty({
    description: 'Array of inventory items to include',
    type: [BulkTemplateItemDto],
    example: [
      {
        itemId: '550e8400-e29b-41d4-a716-446655440000',
        quantity: 2,
        warehouseId: '550e8400-e29b-41d4-a716-446655440001',
      },
    ],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BulkTemplateItemDto)
  items: BulkTemplateItemDto[];
}
