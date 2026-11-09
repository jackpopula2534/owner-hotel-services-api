import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsDateString,
  IsBoolean,
  IsIn,
  IsNumber,
  Min,
  Max,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateHrWorkCalendarDto {
  @ApiProperty({ description: 'Calendar date (YYYY-MM-DD)', example: '2026-12-05' })
  @IsDateString()
  date: string;

  @ApiProperty({ description: 'Holiday / event name', example: 'วันพ่อแห่งชาติ' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @ApiPropertyOptional({ description: 'Property ID (omit for tenant-wide)' })
  @IsOptional()
  @IsString()
  propertyId?: string;

  @ApiPropertyOptional({
    description: 'Calendar entry type',
    enum: ['holiday', 'special', 'company_event'],
    default: 'holiday',
  })
  @IsOptional()
  @IsIn(['holiday', 'special', 'company_event'])
  type?: string;

  @ApiPropertyOptional({ description: 'Is this still a working day', default: false })
  @IsOptional()
  @IsBoolean()
  isWorkingDay?: boolean;

  @ApiPropertyOptional({ description: 'Pay multiplier when worked on this day', default: 1.0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10)
  payMultiplier?: number;

  @ApiPropertyOptional({ description: 'Note' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class UpdateHrWorkCalendarDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({ enum: ['holiday', 'special', 'company_event'] })
  @IsOptional()
  @IsIn(['holiday', 'special', 'company_event'])
  type?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isWorkingDay?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10)
  payMultiplier?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
