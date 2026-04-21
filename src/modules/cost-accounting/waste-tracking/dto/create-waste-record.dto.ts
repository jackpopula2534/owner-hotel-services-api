import { IsString, IsNumber, IsOptional, IsUUID, IsDateString, IsEnum, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum WasteReason {
  EXPIRED = 'expired',
  SPOILED = 'spoiled',
  OVERPRODUCTION = 'overproduction',
  PLATE_WASTE = 'plate_waste',
  PREPARATION = 'preparation',
  DAMAGED = 'damaged',
  OTHER = 'other',
}

export class CreateWasteRecordDto {
  @ApiProperty({
    description: 'Property ID (UUID)',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsUUID()
  propertyId: string;

  @ApiProperty({
    description: 'Warehouse/Storage location ID (UUID)',
    example: '550e8400-e29b-41d4-a716-446655440001',
  })
  @IsUUID()
  warehouseId: string;

  @ApiProperty({
    description: 'Inventory item ID (UUID)',
    example: '550e8400-e29b-41d4-a716-446655440002',
  })
  @IsUUID()
  itemId: string;

  @ApiProperty({
    description: 'Quantity wasted (minimum 0.001)',
    example: 2.5,
    minimum: 0.001,
  })
  @IsNumber()
  @Min(0.001)
  quantity: number;

  @ApiProperty({
    description: 'Unit of measurement (kg, liter, piece, etc.)',
    example: 'kg',
  })
  @IsString()
  unit: string;

  @ApiProperty({
    description: 'Estimated cost of waste in primary currency',
    example: 250.5,
    minimum: 0,
  })
  @IsNumber()
  @Min(0)
  estimatedCost: number;

  @ApiProperty({
    description: 'Reason for waste',
    enum: WasteReason,
    example: WasteReason.EXPIRED,
  })
  @IsEnum(WasteReason)
  reason: WasteReason;

  @ApiPropertyOptional({
    description: 'Department that generated the waste',
    example: 'Kitchen',
  })
  @IsOptional()
  @IsString()
  department?: string;

  @ApiPropertyOptional({
    description: 'Additional notes about the waste incident',
    example: 'Vegetables stored incorrectly, discovered during inventory check',
  })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({
    description: 'Date of waste incident (ISO 8601, defaults to current date)',
    example: '2026-04-15',
  })
  @IsOptional()
  @IsDateString()
  wasteDate?: string;
}
