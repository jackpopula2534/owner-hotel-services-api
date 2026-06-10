import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  Min,
  Max,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateHrOvertimeRequestDto {
  @ApiProperty({ description: 'Employee ID' })
  @IsString()
  @IsNotEmpty()
  employeeId: string;

  @ApiProperty({ description: 'OT date (YYYY-MM-DD)', example: '2026-06-09' })
  @IsDateString()
  date: string;

  @ApiProperty({ description: 'Overtime duration in minutes', example: 120 })
  @IsInt()
  @Min(1)
  @Max(1440)
  minutes: number;

  @ApiPropertyOptional({ description: 'OT pay multiplier', default: 1.5 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(5)
  multiplier?: number;

  @ApiPropertyOptional({ description: 'Linked attendance record ID' })
  @IsOptional()
  @IsString()
  attendanceId?: string;

  @ApiPropertyOptional({ description: 'Reason' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}

export class ReviewHrOvertimeRequestDto {
  @ApiProperty({ description: 'Review decision', enum: ['approved', 'rejected'] })
  @IsIn(['approved', 'rejected'])
  status: 'approved' | 'rejected';

  @ApiPropertyOptional({ description: 'Reviewer note' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reviewNote?: string;
}
