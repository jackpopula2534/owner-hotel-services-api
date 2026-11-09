import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsDateString,
  IsIn,
  IsNumber,
  Min,
  Max,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateHrTrainingRecordDto {
  @ApiProperty({ description: 'Employee ID' })
  @IsString()
  @IsNotEmpty()
  employeeId: string;

  @ApiProperty({ example: 'อบรมความปลอดภัยในการทำงาน' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @ApiPropertyOptional({ enum: ['training', 'certification'], default: 'training' })
  @IsOptional()
  @IsIn(['training', 'certification'])
  type?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  provider?: string;

  @ApiPropertyOptional({ enum: ['planned', 'in_progress', 'completed', 'expired'], default: 'planned' })
  @IsOptional()
  @IsIn(['planned', 'in_progress', 'completed', 'expired'])
  status?: string;

  @ApiPropertyOptional({ description: 'Completed date (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString()
  completedAt?: string;

  @ApiPropertyOptional({ description: 'Expiry date (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  score?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  certificateUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class UpdateHrTrainingRecordDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({ enum: ['training', 'certification'] })
  @IsOptional()
  @IsIn(['training', 'certification'])
  type?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  provider?: string;

  @ApiPropertyOptional({ enum: ['planned', 'in_progress', 'completed', 'expired'] })
  @IsOptional()
  @IsIn(['planned', 'in_progress', 'completed', 'expired'])
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  completedAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  score?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  certificateUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
