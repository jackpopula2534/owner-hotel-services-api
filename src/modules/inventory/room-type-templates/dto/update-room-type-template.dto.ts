import { PartialType } from '@nestjs/swagger';
import { CreateRoomTypeTemplateDto } from './create-room-type-template.dto';
import { IsOptional, IsNumber, Min, IsString, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateRoomTypeTemplateDto extends PartialType(CreateRoomTypeTemplateDto) {
  @ApiProperty({
    description: 'Quantity to deduct',
    example: 3,
    minimum: 1,
    required: false,
  })
  @IsNumber()
  @Min(1)
  @IsOptional()
  quantity?: number;

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
    example: 'Updated remarks',
    required: false,
  })
  @IsString()
  @IsOptional()
  notes?: string;
}
