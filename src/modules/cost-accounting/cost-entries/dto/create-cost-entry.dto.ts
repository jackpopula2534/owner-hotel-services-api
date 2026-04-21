import { IsString, IsNumber, IsOptional, IsUUID, IsDateString, IsEnum, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum CostSourceType {
  STOCK_MOVEMENT = 'stock_movement',
  PAYROLL = 'payroll',
  INVOICE = 'invoice',
  MANUAL = 'manual',
  BOOKING = 'booking',
}

export class CreateCostEntryDto {
  @ApiProperty({
    description: 'Property ID (UUID)',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsUUID()
  propertyId: string;

  @ApiProperty({
    description: 'Cost Center ID (UUID)',
    example: '550e8400-e29b-41d4-a716-446655440001',
  })
  @IsUUID()
  costCenterId: string;

  @ApiProperty({
    description: 'Cost Type ID (UUID)',
    example: '550e8400-e29b-41d4-a716-446655440002',
  })
  @IsUUID()
  costTypeId: string;

  @ApiProperty({ description: 'Cost amount (number)', example: 1500.5, minimum: 0 })
  @IsNumber()
  @Min(0)
  amount: number;

  @ApiProperty({ description: 'Period in YYYY-MM format', example: '2026-04' })
  @IsString()
  period: string;

  @ApiProperty({
    description: 'Entry date in ISO format (default: current date)',
    example: '2026-04-15',
    required: false,
  })
  @IsOptional()
  @IsDateString()
  entryDate?: string;

  @ApiProperty({
    description: 'Description of the cost entry',
    example: 'Monthly electricity bill',
    required: false,
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    description: 'Source type of the cost entry',
    enum: CostSourceType,
    required: false,
  })
  @IsOptional()
  @IsEnum(CostSourceType)
  sourceType?: CostSourceType;

  @ApiProperty({
    description: 'Source ID (UUID) for linked cost entries',
    example: '550e8400-e29b-41d4-a716-446655440003',
    required: false,
  })
  @IsOptional()
  @IsUUID()
  sourceId?: string;
}
