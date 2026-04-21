import { IsOptional, IsString, IsNumber, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export enum DashboardPeriod {
  DAILY = 'daily',
  WEEKLY = 'weekly',
  MONTHLY = 'monthly',
}

export class QueryDashboardWidgetsDto {
  @ApiProperty({
    description: 'Property ID (required for filtering)',
    example: 'prop-123',
  })
  @IsString()
  propertyId: string;

  @ApiProperty({
    description: 'Number of days to include in charts (default: 30)',
    example: 30,
    required: false,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  days?: number = 30;

  @ApiProperty({
    description: 'Period for analysis (daily, weekly, monthly)',
    enum: DashboardPeriod,
    example: DashboardPeriod.MONTHLY,
    required: false,
  })
  @IsOptional()
  @IsEnum(DashboardPeriod)
  period?: DashboardPeriod = DashboardPeriod.MONTHLY;
}
