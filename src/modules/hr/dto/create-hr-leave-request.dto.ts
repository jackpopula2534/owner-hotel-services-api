import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsDateString,
  IsNumber,
  IsPositive,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PartialType } from '@nestjs/swagger';

export class CreateHrLeaveRequestDto {
  @ApiProperty({ description: 'Employee ID' })
  @IsString()
  @IsNotEmpty()
  employeeId: string;

  @ApiProperty({ description: 'Leave Type ID' })
  @IsString()
  @IsNotEmpty()
  leaveTypeId: string;

  @ApiProperty({ description: 'Start date (YYYY-MM-DD)', example: '2026-04-10' })
  @IsDateString()
  startDate: string;

  @ApiProperty({ description: 'End date (YYYY-MM-DD)', example: '2026-04-12' })
  @IsDateString()
  endDate: string;

  @ApiProperty({ description: 'Total leave days', example: 3 })
  @IsNumber()
  @IsPositive()
  totalDays: number;

  @ApiPropertyOptional({ description: 'Reason for leave' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;

  @ApiPropertyOptional({ description: 'Employee ID of the substitute' })
  @IsOptional()
  @IsString()
  substituteId?: string;
}

export class UpdateHrLeaveRequestDto extends PartialType(CreateHrLeaveRequestDto) {}

export class RejectLeaveRequestDto {
  @ApiProperty({ description: 'Reason for rejection' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}

export class LeaveBalanceQueryDto {
  @ApiPropertyOptional({ description: 'Year to calculate balance for', example: 2026 })
  @IsOptional()
  @IsNumber()
  @Min(2020)
  year?: number;
}
