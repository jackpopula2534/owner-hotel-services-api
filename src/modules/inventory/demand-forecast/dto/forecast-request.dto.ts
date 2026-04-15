import { IsUUID, IsISO8601, IsOptional, IsNotEmpty } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

export class ForecastRequestDto {
  @ApiProperty({
    description: 'Property ID (UUID)',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsUUID()
  @IsNotEmpty()
  propertyId: string;

  @ApiPropertyOptional({
    description: 'Start date for forecast (ISO 8601)',
    example: '2026-04-15',
  })
  @IsISO8601()
  @IsOptional()
  @Transform(({ value }) => {
    if (!value) return undefined;
    return new Date(value).toISOString().split('T')[0];
  })
  startDate?: string;

  @ApiPropertyOptional({
    description: 'End date for forecast (ISO 8601)',
    example: '2026-05-15',
  })
  @IsISO8601()
  @IsOptional()
  @Transform(({ value }) => {
    if (!value) return undefined;
    return new Date(value).toISOString().split('T')[0];
  })
  endDate?: string;
}

export class WeeklyForecastRequestDto {
  @ApiProperty({
    description: 'Property ID (UUID)',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsUUID()
  @IsNotEmpty()
  propertyId: string;
}

export class OccupancyForecastRequestDto {
  @ApiProperty({
    description: 'Property ID (UUID)',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsUUID()
  @IsNotEmpty()
  propertyId: string;

  @ApiProperty({
    description: 'Start date for occupancy forecast (ISO 8601)',
    example: '2026-04-15',
  })
  @IsISO8601()
  @IsNotEmpty()
  @Transform(({ value }) => {
    return new Date(value).toISOString().split('T')[0];
  })
  startDate: string;

  @ApiProperty({
    description: 'End date for occupancy forecast (ISO 8601)',
    example: '2026-05-15',
  })
  @IsISO8601()
  @IsNotEmpty()
  @Transform(({ value }) => {
    return new Date(value).toISOString().split('T')[0];
  })
  endDate: string;
}
