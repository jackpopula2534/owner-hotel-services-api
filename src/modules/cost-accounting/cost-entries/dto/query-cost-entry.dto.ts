import {
  IsString,
  IsOptional,
  IsUUID,
  IsDateString,
  IsEnum,
  IsNumber,
  Min,
  Max,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export enum CostEntryStatus {
  POSTED = 'posted',
  PENDING = 'pending',
  REVERSED = 'reversed',
}

export enum CostSourceType {
  STOCK_MOVEMENT = 'stock_movement',
  PAYROLL = 'payroll',
  INVOICE = 'invoice',
  MANUAL = 'manual',
  BOOKING = 'booking',
}

export class QueryCostEntryDto {
  @ApiProperty({ description: 'Page number', example: 1, required: false })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @ApiProperty({ description: 'Items per page', example: 20, required: false })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiProperty({
    description: 'Filter by property ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
    required: false,
  })
  @IsOptional()
  @IsUUID()
  propertyId?: string;

  @ApiProperty({
    description: 'Filter by cost center ID',
    example: '550e8400-e29b-41d4-a716-446655440001',
    required: false,
  })
  @IsOptional()
  @IsUUID()
  costCenterId?: string;

  @ApiProperty({
    description: 'Filter by cost type ID',
    example: '550e8400-e29b-41d4-a716-446655440002',
    required: false,
  })
  @IsOptional()
  @IsUUID()
  costTypeId?: string;

  @ApiProperty({
    description: 'Filter by period in YYYY-MM format',
    example: '2026-04',
    required: false,
  })
  @IsOptional()
  @IsString()
  period?: string;

  @ApiProperty({
    description: 'Filter by start date (ISO format)',
    example: '2026-04-01',
    required: false,
  })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiProperty({
    description: 'Filter by end date (ISO format)',
    example: '2026-04-30',
    required: false,
  })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiProperty({ description: 'Filter by source type', enum: CostSourceType, required: false })
  @IsOptional()
  @IsEnum(CostSourceType)
  sourceType?: CostSourceType;

  @ApiProperty({ description: 'Filter by status', enum: CostEntryStatus, required: false })
  @IsOptional()
  @IsEnum(CostEntryStatus)
  status?: CostEntryStatus;
}
