import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsDateString,
  IsIn,
  IsArray,
  IsBoolean,
  ValidateNested,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ClearanceItemDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  label: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  done?: boolean;
}

export class CreateHrOffboardingDto {
  @ApiProperty({ description: 'Employee ID' })
  @IsString()
  @IsNotEmpty()
  employeeId: string;

  @ApiProperty({ enum: ['resignation', 'termination'] })
  @IsIn(['resignation', 'termination'])
  type: 'resignation' | 'termination';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;

  @ApiPropertyOptional({ description: 'Notice date (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString()
  noticeDate?: string;

  @ApiPropertyOptional({ description: 'Last working date (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString()
  lastWorkingDate?: string;

  @ApiPropertyOptional({ type: [ClearanceItemDto], description: 'Clearance checklist (omit for default)' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ClearanceItemDto)
  clearanceItems?: ClearanceItemDto[];
}

export class UpdateClearanceDto {
  @ApiProperty({ type: [ClearanceItemDto], description: 'Full clearance checklist with done flags' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ClearanceItemDto)
  clearanceItems: ClearanceItemDto[];
}
