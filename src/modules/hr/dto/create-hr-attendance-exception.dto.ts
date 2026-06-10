import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsDateString,
  IsIn,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const ATTENDANCE_EXCEPTION_TYPES = [
  'missed_check_in',
  'missed_check_out',
  'wrong_time',
  'late_reason',
  'absent_reason',
  'manual_adjust',
] as const;

export class CreateHrAttendanceExceptionDto {
  @ApiProperty({ description: 'Employee ID' })
  @IsString()
  @IsNotEmpty()
  employeeId: string;

  @ApiProperty({ description: 'Date of the exception (YYYY-MM-DD)', example: '2026-06-09' })
  @IsDateString()
  date: string;

  @ApiProperty({
    description: 'Exception type',
    enum: ATTENDANCE_EXCEPTION_TYPES,
  })
  @IsIn(ATTENDANCE_EXCEPTION_TYPES as unknown as string[])
  type: string;

  @ApiPropertyOptional({ description: 'Linked attendance record ID, if any' })
  @IsOptional()
  @IsString()
  attendanceId?: string;

  @ApiPropertyOptional({ description: 'Requested corrected check-in (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  requestedCheckIn?: string;

  @ApiPropertyOptional({ description: 'Requested corrected check-out (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  requestedCheckOut?: string;

  @ApiProperty({ description: 'Reason / justification' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason: string;
}

export class ReviewHrAttendanceExceptionDto {
  @ApiProperty({ description: 'Review decision', enum: ['approved', 'rejected'] })
  @IsIn(['approved', 'rejected'])
  status: 'approved' | 'rejected';

  @ApiPropertyOptional({ description: 'Reviewer note' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reviewNote?: string;
}
