import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  Min,
  Max,
  IsDateString,
  IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateHrPerformanceDto {
  @ApiProperty({ description: 'Employee ID', example: 'uuid' })
  @IsString()
  @IsNotEmpty()
  employeeId: string;

  @ApiProperty({ description: 'Review period e.g. 2025-Q1 | 2025-H1 | 2025', example: '2025-Q1' })
  @IsString()
  @IsNotEmpty()
  period: string;

  @ApiProperty({ description: 'Period type', enum: ['quarterly', 'half_yearly', 'yearly'], example: 'quarterly' })
  @IsString()
  @IsIn(['quarterly', 'half_yearly', 'yearly'])
  periodType: string;

  @ApiProperty({ description: 'Review date (ISO format)', example: '2025-04-01' })
  @IsDateString()
  reviewDate: string;

  @ApiPropertyOptional({ description: 'Reviewer user ID' })
  @IsOptional()
  @IsString()
  reviewerId?: string;

  @ApiPropertyOptional({ description: 'Reviewer full name' })
  @IsOptional()
  @IsString()
  reviewerName?: string;

  @ApiProperty({ description: 'Work quality & output score (0-100)', example: 85 })
  @IsNumber()
  @Min(0)
  @Max(100)
  @Type(() => Number)
  scoreWork: number;

  @ApiProperty({ description: 'Punctuality & attendance score (0-100)', example: 90 })
  @IsNumber()
  @Min(0)
  @Max(100)
  @Type(() => Number)
  scoreAttendance: number;

  @ApiProperty({ description: 'Teamwork & collaboration score (0-100)', example: 80 })
  @IsNumber()
  @Min(0)
  @Max(100)
  @Type(() => Number)
  scoreTeamwork: number;

  @ApiProperty({ description: 'Customer / guest service score (0-100)', example: 88 })
  @IsNumber()
  @Min(0)
  @Max(100)
  @Type(() => Number)
  scoreService: number;

  @ApiPropertyOptional({ description: 'Strengths & achievements', example: 'ทำงานได้ดี มีความรับผิดชอบสูง' })
  @IsOptional()
  @IsString()
  strengths?: string;

  @ApiPropertyOptional({ description: 'Areas for improvement', example: 'ควรพัฒนาทักษะภาษาอังกฤษ' })
  @IsOptional()
  @IsString()
  improvements?: string;

  @ApiPropertyOptional({ description: 'Goals for next period', example: 'เพิ่ม UPSELL rate 10%' })
  @IsOptional()
  @IsString()
  goals?: string;

  @ApiPropertyOptional({ description: 'Internal note' })
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional({ description: 'Status', enum: ['draft', 'submitted', 'approved', 'rejected'], default: 'draft' })
  @IsOptional()
  @IsString()
  @IsIn(['draft', 'submitted', 'approved', 'rejected'])
  status?: string;
}

export class UpdateHrPerformanceDto {
  @ApiPropertyOptional({ description: 'Review date (ISO format)' })
  @IsOptional()
  @IsDateString()
  reviewDate?: string;

  @ApiPropertyOptional({ description: 'Reviewer name' })
  @IsOptional()
  @IsString()
  reviewerName?: string;

  @ApiPropertyOptional({ description: 'Work quality score (0-100)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  @Type(() => Number)
  scoreWork?: number;

  @ApiPropertyOptional({ description: 'Attendance score (0-100)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  @Type(() => Number)
  scoreAttendance?: number;

  @ApiPropertyOptional({ description: 'Teamwork score (0-100)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  @Type(() => Number)
  scoreTeamwork?: number;

  @ApiPropertyOptional({ description: 'Service score (0-100)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  @Type(() => Number)
  scoreService?: number;

  @ApiPropertyOptional({ description: 'Strengths' })
  @IsOptional()
  @IsString()
  strengths?: string;

  @ApiPropertyOptional({ description: 'Improvements' })
  @IsOptional()
  @IsString()
  improvements?: string;

  @ApiPropertyOptional({ description: 'Goals' })
  @IsOptional()
  @IsString()
  goals?: string;

  @ApiPropertyOptional({ description: 'Note' })
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional({ description: 'Status', enum: ['draft', 'submitted', 'approved', 'rejected'] })
  @IsOptional()
  @IsString()
  @IsIn(['draft', 'submitted', 'approved', 'rejected'])
  status?: string;
}
