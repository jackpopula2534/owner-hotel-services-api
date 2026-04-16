import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsDateString,
  IsIn,
  IsInt,
  Min,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateHrAttendanceDto {
  @ApiProperty({ description: 'Employee ID' })
  @IsString()
  @IsNotEmpty()
  employeeId: string;

  @ApiProperty({ description: 'Attendance date (YYYY-MM-DD)', example: '2026-04-07' })
  @IsDateString()
  date: string;

  @ApiPropertyOptional({
    description: 'Check-in time (ISO 8601)',
    example: '2026-04-07T08:00:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  checkIn?: string;

  @ApiPropertyOptional({ description: 'Check-out time (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  checkOut?: string;

  @ApiPropertyOptional({
    description: 'Attendance status',
    enum: ['present', 'late', 'absent', 'on_leave', 'holiday'],
    default: 'present',
  })
  @IsOptional()
  @IsString()
  @IsIn(['present', 'late', 'absent', 'on_leave', 'holiday'])
  status?: string;

  @ApiPropertyOptional({ description: 'Work duration in minutes' })
  @IsOptional()
  @IsInt()
  @Min(0)
  workMinutes?: number;

  @ApiPropertyOptional({ description: 'Overtime duration in minutes' })
  @IsOptional()
  @IsInt()
  @Min(0)
  overtimeMinutes?: number;

  @ApiPropertyOptional({ description: 'Additional note' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class CheckInDto {
  @ApiProperty({ description: 'Employee ID' })
  @IsString()
  @IsNotEmpty()
  employeeId: string;

  @ApiPropertyOptional({ description: 'Check-in time (ISO 8601) — defaults to now' })
  @IsOptional()
  @IsDateString()
  checkIn?: string;

  @ApiPropertyOptional({ description: 'Additional note' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class CheckOutDto {
  @ApiPropertyOptional({ description: 'Check-out time (ISO 8601) — defaults to now' })
  @IsOptional()
  @IsDateString()
  checkOut?: string;

  @ApiPropertyOptional({ description: 'Additional note' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
