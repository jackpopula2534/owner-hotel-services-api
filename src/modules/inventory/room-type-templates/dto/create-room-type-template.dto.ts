import { IsString, IsOptional, IsNumber, Min, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateRoomTypeTemplateDto {
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
    description: 'Notes or remarks',
    example: 'For standard checkout procedure',
    required: false,
  })
  @IsString()
  @IsOptional()
  notes?: string;
}
