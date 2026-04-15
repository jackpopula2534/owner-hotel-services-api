import { IsOptional, IsString, IsDateString, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum KPIGranularity {
  DAILY = 'daily',
  WEEKLY = 'weekly',
  MONTHLY = 'monthly',
}

export class QueryKpiSnapshotDto {
  @ApiProperty({
    description: 'Property ID (required for filtering)',
    example: 'prop-123',
  })
  @IsString()
  propertyId: string;

  @ApiProperty({
    description: 'Start date (YYYY-MM-DD)',
    example: '2026-04-01',
    required: false,
  })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiProperty({
    description: 'End date (YYYY-MM-DD)',
    example: '2026-04-15',
    required: false,
  })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiProperty({
    description: 'KPI granularity level',
    enum: KPIGranularity,
    example: 'daily',
    required: false,
  })
  @IsOptional()
  @IsEnum(KPIGranularity)
  granularity?: KPIGranularity = KPIGranularity.DAILY;
}

export class GenerateDailySnapshotDto {
  @ApiProperty({
    description: 'Property ID',
    example: 'prop-123',
  })
  @IsString()
  propertyId: string;

  @ApiProperty({
    description: 'Snapshot date (YYYY-MM-DD, defaults to today)',
    example: '2026-04-15',
    required: false,
  })
  @IsOptional()
  @IsDateString()
  snapshotDate?: string;
}
