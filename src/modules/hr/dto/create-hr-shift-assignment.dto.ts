import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsDateString,
  IsBoolean,
  IsIn,
  IsArray,
  ValidateNested,
  ArrayNotEmpty,
  Matches,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreateHrShiftAssignmentDto {
  @ApiProperty({ description: 'Employee ID' })
  @IsString()
  @IsNotEmpty()
  employeeId: string;

  @ApiPropertyOptional({ description: 'Shift type ID (omit for day off / custom time)' })
  @IsOptional()
  @IsString()
  shiftTypeId?: string;

  @ApiPropertyOptional({ description: 'Property ID' })
  @IsOptional()
  @IsString()
  propertyId?: string;

  @ApiPropertyOptional({ description: 'Department ID' })
  @IsOptional()
  @IsString()
  departmentId?: string;

  @ApiProperty({ description: 'Assignment date (YYYY-MM-DD)', example: '2026-06-10' })
  @IsDateString()
  date: string;

  @ApiPropertyOptional({ description: 'Override start time (HH:mm)', example: '08:00' })
  @IsOptional()
  @Matches(TIME_REGEX, { message: 'startTime must be HH:mm' })
  startTime?: string;

  @ApiPropertyOptional({ description: 'Override end time (HH:mm)', example: '17:00' })
  @IsOptional()
  @Matches(TIME_REGEX, { message: 'endTime must be HH:mm' })
  endTime?: string;

  @ApiPropertyOptional({ description: 'Mark as day off', default: false })
  @IsOptional()
  @IsBoolean()
  isDayOff?: boolean;

  @ApiPropertyOptional({
    description: 'Assignment status',
    enum: ['scheduled', 'published', 'swap_requested', 'cancelled'],
    default: 'scheduled',
  })
  @IsOptional()
  @IsIn(['scheduled', 'published', 'swap_requested', 'cancelled'])
  status?: string;

  @ApiPropertyOptional({ description: 'Note' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class UpdateHrShiftAssignmentDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  shiftTypeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(TIME_REGEX, { message: 'startTime must be HH:mm' })
  startTime?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(TIME_REGEX, { message: 'endTime must be HH:mm' })
  endTime?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isDayOff?: boolean;

  @ApiPropertyOptional({ enum: ['scheduled', 'published', 'swap_requested', 'cancelled'] })
  @IsOptional()
  @IsIn(['scheduled', 'published', 'swap_requested', 'cancelled'])
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class BulkCreateHrShiftAssignmentDto {
  @ApiProperty({ type: [CreateHrShiftAssignmentDto], description: 'Roster entries to upsert' })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => CreateHrShiftAssignmentDto)
  assignments: CreateHrShiftAssignmentDto[];
}
