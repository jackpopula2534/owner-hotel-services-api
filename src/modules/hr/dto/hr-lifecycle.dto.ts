import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsDateString,
  IsIn,
  IsBoolean,
  IsInt,
  IsNumber,
  Min,
  Max,
  MaxLength,
  IsArray,
  ValidateNested,
  ArrayNotEmpty,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ─── Onboarding ────────────────────────────────────────────────────────────

export class CreateOnboardingTaskDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @ApiPropertyOptional({ enum: ['document', 'account', 'training', 'equipment', 'general'] })
  @IsOptional()
  @IsIn(['document', 'account', 'training', 'equipment', 'general'])
  category?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class SeedOnboardingDto {
  @ApiProperty({ description: 'Employee ID' })
  @IsString()
  @IsNotEmpty()
  employeeId: string;

  @ApiPropertyOptional({ type: [CreateOnboardingTaskDto], description: 'Custom checklist (omit for default template)' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateOnboardingTaskDto)
  tasks?: CreateOnboardingTaskDto[];
}

export class AddOnboardingTaskDto extends CreateOnboardingTaskDto {
  @ApiProperty({ description: 'Employee ID' })
  @IsString()
  @IsNotEmpty()
  employeeId: string;
}

export class UpdateOnboardingTaskDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isComplete?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

// ─── Probation ─────────────────────────────────────────────────────────────

export class CreateProbationRoundDto {
  @ApiProperty({ description: 'Employee ID' })
  @IsString()
  @IsNotEmpty()
  employeeId: string;

  @ApiProperty({ description: 'Probation start date (YYYY-MM-DD)' })
  @IsDateString()
  startDate: string;

  @ApiProperty({ description: 'Probation due date (YYYY-MM-DD)' })
  @IsDateString()
  dueDate: string;

  @ApiPropertyOptional({ description: 'Checkpoint days, default [30, 60, 90]', type: [Number] })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  checkpointDays?: number[];
}

export class ReviewProbationCheckpointDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  score?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  strengths?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  improvements?: string;

  @ApiPropertyOptional({ description: 'Mark checkpoint as skipped instead of done' })
  @IsOptional()
  @IsBoolean()
  skip?: boolean;
}

export class DecideProbationRoundDto {
  @ApiProperty({ enum: ['passed', 'extended', 'failed'] })
  @IsIn(['passed', 'extended', 'failed'])
  decision: 'passed' | 'extended' | 'failed';

  @ApiPropertyOptional({ description: 'New due date when decision = extended (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString()
  newDueDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
