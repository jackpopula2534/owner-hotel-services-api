import { IsOptional, IsString, IsNumber, IsDateString, IsEnum, Min, Max } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { WasteReason } from './create-waste-record.dto';

export class QueryWasteDto {
  @ApiPropertyOptional({
    description: 'Page number for pagination',
    example: 1,
    minimum: 1,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    description: 'Records per page',
    example: 20,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({
    description: 'Filter by property ID (UUID)',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsOptional()
  @IsString()
  propertyId?: string;

  @ApiPropertyOptional({
    description: 'Filter by warehouse/storage location ID (UUID)',
    example: '550e8400-e29b-41d4-a716-446655440001',
  })
  @IsOptional()
  @IsString()
  warehouseId?: string;

  @ApiPropertyOptional({
    description: 'Filter by inventory item ID (UUID)',
    example: '550e8400-e29b-41d4-a716-446655440002',
  })
  @IsOptional()
  @IsString()
  itemId?: string;

  @ApiPropertyOptional({
    description: 'Filter by waste reason',
    enum: WasteReason,
    example: WasteReason.EXPIRED,
  })
  @IsOptional()
  @IsEnum(WasteReason)
  reason?: WasteReason;

  @ApiPropertyOptional({
    description: 'Filter by department that generated waste',
    example: 'Kitchen',
  })
  @IsOptional()
  @IsString()
  department?: string;

  @ApiPropertyOptional({
    description: 'Filter by start date (ISO 8601)',
    example: '2026-04-01',
  })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({
    description: 'Filter by end date (ISO 8601)',
    example: '2026-04-30',
  })
  @IsOptional()
  @IsDateString()
  endDate?: string;
}
