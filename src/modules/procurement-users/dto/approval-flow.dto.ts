import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export enum ApprovalDocumentTypeDto {
  PURCHASE_REQUISITION = 'PURCHASE_REQUISITION',
  PRICE_COMPARISON = 'PRICE_COMPARISON',
  PURCHASE_ORDER = 'PURCHASE_ORDER',
}

export enum ApproverTypeDto {
  SPECIFIC_USER = 'SPECIFIC_USER',
  ROLE = 'ROLE',
  DEPARTMENT_HEAD = 'DEPARTMENT_HEAD',
}

export class CreateApprovalFlowStepDto {
  @ApiProperty({ example: 1, description: '1-based step order' })
  @IsInt()
  @Min(1)
  stepOrder!: number;

  @ApiProperty({ example: 'หัวหน้าแผนกอนุมัติ' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name!: string;

  @ApiProperty({ enum: ApproverTypeDto, example: ApproverTypeDto.SPECIFIC_USER })
  @IsEnum(ApproverTypeDto)
  approverType!: ApproverTypeDto;

  @ApiPropertyOptional({ description: 'When approverType = ROLE', example: 'approver' })
  @IsOptional()
  @IsString()
  approverRole?: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'User IDs when approverType = SPECIFIC_USER',
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  approverUserIds?: string[];

  @ApiPropertyOptional({
    default: 1,
    description: 'Minimum approvals required (for parallel steps)',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  minApprovals?: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isParallel?: boolean;

  @ApiPropertyOptional({ example: 24, description: 'Escalation SLA in hours' })
  @IsOptional()
  @IsInt()
  @Min(1)
  slaHours?: number;
}

export class CreateApprovalFlowDto {
  @ApiProperty({ example: 'Flow อนุมัติ PR (มาตรฐาน)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ enum: ApprovalDocumentTypeDto })
  @IsEnum(ApprovalDocumentTypeDto)
  documentType!: ApprovalDocumentTypeDto;

  @ApiPropertyOptional({
    example: 0,
    description: 'Minimum document amount to match (inclusive)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  minAmount?: number;

  @ApiPropertyOptional({
    example: 100000,
    description: 'Maximum document amount to match (inclusive)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  maxAmount?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  propertyId?: string;

  @ApiProperty({ type: [CreateApprovalFlowStepDto], minItems: 1 })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateApprovalFlowStepDto)
  steps!: CreateApprovalFlowStepDto[];
}

export class UpdateApprovalFlowDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(150)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ enum: ApprovalDocumentTypeDto })
  @IsOptional()
  @IsEnum(ApprovalDocumentTypeDto)
  documentType?: ApprovalDocumentTypeDto;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  minAmount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  maxAmount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional({
    type: [CreateApprovalFlowStepDto],
    description: 'Replace the entire list of steps (passing this replaces all existing steps)',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateApprovalFlowStepDto)
  steps?: CreateApprovalFlowStepDto[];
}
