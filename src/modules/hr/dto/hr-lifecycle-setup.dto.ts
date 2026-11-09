import { PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const DOCUMENT_ACCESS_LEVELS = ['hr', 'manager', 'employee'] as const;
const LIFECYCLE_TYPES = ['onboarding', 'offboarding', 'probation', 'compliance'] as const;
const TASK_CATEGORIES = ['document', 'account', 'training', 'equipment', 'general'] as const;

export class CreateHrDocumentTypeDto {
  @ApiProperty({ example: 'contract' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  code: string;

  @ApiProperty({ example: 'สัญญาจ้าง' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @ApiPropertyOptional({ example: 'employment' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  requiredByDefault?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  hasExpiry?: boolean;

  @ApiPropertyOptional({ example: 365 })
  @IsOptional()
  @IsInt()
  @Min(1)
  expiryPolicyDays?: number;

  @ApiPropertyOptional({ enum: DOCUMENT_ACCESS_LEVELS, default: 'hr' })
  @IsOptional()
  @IsIn(DOCUMENT_ACCESS_LEVELS)
  accessLevel?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  requiresVerification?: boolean;

  @ApiPropertyOptional({ type: [String], example: ['application/pdf', 'image/jpeg'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  allowedFileTypes?: string[];

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateHrDocumentTypeDto extends PartialType(CreateHrDocumentTypeDto) {}

export class CreateHrLifecyclePackageDocumentDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  documentTypeId: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;

  @ApiPropertyOptional({ example: 7 })
  @IsOptional()
  @IsInt()
  dueOffsetDays?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  ruleNote?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class CreateHrLifecyclePackageTaskDto {
  @ApiProperty({ example: 'เซ็นสัญญาจ้าง' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @ApiPropertyOptional({ enum: TASK_CATEGORIES, default: 'general' })
  @IsOptional()
  @IsIn(TASK_CATEGORIES)
  category?: string;

  @ApiPropertyOptional({ example: 'hr' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  ownerRole?: string;

  @ApiPropertyOptional({ example: 3 })
  @IsOptional()
  @IsInt()
  dueOffsetDays?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  requiresApproval?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class CreateHrLifecyclePackageDto {
  @ApiProperty({ example: 'NEW_HIRE_FRONT_OFFICE' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  code: string;

  @ApiProperty({ example: 'พนักงานใหม่ - Front Office' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @ApiPropertyOptional({ enum: LIFECYCLE_TYPES, default: 'onboarding' })
  @IsOptional()
  @IsIn(LIFECYCLE_TYPES)
  lifecycleType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ type: [CreateHrLifecyclePackageDocumentDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateHrLifecyclePackageDocumentDto)
  documents?: CreateHrLifecyclePackageDocumentDto[];

  @ApiPropertyOptional({ type: [CreateHrLifecyclePackageTaskDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateHrLifecyclePackageTaskDto)
  tasks?: CreateHrLifecyclePackageTaskDto[];
}

export class UpdateHrLifecyclePackageDto extends PartialType(CreateHrLifecyclePackageDto) {}

export class CreateHrLifecycleAssignmentRuleDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  packageId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  propertyId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  departmentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  positionId?: string;

  @ApiPropertyOptional({ example: 'FULLTIME' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  employmentType?: string;

  @ApiPropertyOptional({ default: 100 })
  @IsOptional()
  @IsInt()
  priority?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateHrLifecycleAssignmentRuleDto extends PartialType(CreateHrLifecycleAssignmentRuleDto) {}

export class WaiveRequirementDto {
  @ApiPropertyOptional({ example: 'ไม่จำเป็นสำหรับตำแหน่งนี้' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}

export class BulkAssignPackageDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  packageId: string;

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(2000)
  @IsString({ each: true })
  employeeIds: string[];
}

export class BulkVerifyRequirementsDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(2000)
  @IsString({ each: true })
  ids: string[];
}
