import {
  IsString,
  IsOptional,
  IsBoolean,
  IsInt,
  IsEnum,
  Min,
  Max,
  MaxLength,
  MinLength,
  Matches,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UpsertEmployeeCodeConfigDto {
  @ApiProperty({
    description: 'Pattern template using placeholders: {PREFIX}, {DEPT}, {YYYY}, {YY}, {MM}, {NNNN}',
    example: '{PREFIX}-{DEPT}-{YYYY}-{NNNN}',
  })
  @IsString()
  @MinLength(3)
  @MaxLength(100)
  pattern: string;

  @ApiProperty({ description: 'Custom prefix text', example: 'MV' })
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  @Matches(/^[A-Za-z0-9]+$/, { message: 'Prefix must be alphanumeric' })
  prefix: string;

  @ApiPropertyOptional({ description: 'Separator character between elements', example: '-' })
  @IsString()
  @IsOptional()
  @MaxLength(1)
  separator?: string;

  @ApiPropertyOptional({ description: 'Number of digits for running number (1-8)', example: 4 })
  @IsInt()
  @IsOptional()
  @Min(1)
  @Max(8)
  digitLength?: number;

  @ApiPropertyOptional({
    description: 'When to reset the running number counter',
    enum: ['NEVER', 'YEARLY', 'MONTHLY'],
    example: 'YEARLY',
  })
  @IsString()
  @IsOptional()
  @IsEnum(['NEVER', 'YEARLY', 'MONTHLY'], { message: 'resetCycle must be NEVER, YEARLY, or MONTHLY' })
  resetCycle?: string;

  @ApiPropertyOptional({ description: 'Include year in code', example: true })
  @IsBoolean()
  @IsOptional()
  includeYear?: boolean;

  @ApiPropertyOptional({ description: 'Year format: YYYY or YY', enum: ['YYYY', 'YY'], example: 'YYYY' })
  @IsString()
  @IsOptional()
  @IsEnum(['YYYY', 'YY'], { message: 'yearFormat must be YYYY or YY' })
  yearFormat?: string;

  @ApiPropertyOptional({ description: 'Include department code in employee code', example: true })
  @IsBoolean()
  @IsOptional()
  includeDept?: boolean;

  @ApiPropertyOptional({
    description: 'How to derive department code: CODE or NAME_SHORT',
    enum: ['CODE', 'NAME_SHORT'],
    example: 'CODE',
  })
  @IsString()
  @IsOptional()
  @IsEnum(['CODE', 'NAME_SHORT'], { message: 'deptSource must be CODE or NAME_SHORT' })
  deptSource?: string;

  @ApiPropertyOptional({ description: 'Enable/disable this config', example: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class PreviewEmployeeCodeDto {
  @ApiPropertyOptional({ description: 'Department code for preview', example: 'HR' })
  @IsString()
  @IsOptional()
  departmentCode?: string;
}
