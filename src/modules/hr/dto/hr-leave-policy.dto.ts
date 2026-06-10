import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsInt,
  Min,
  Max,
  MaxLength,
  IsArray,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateHrLeavePolicyDto {
  @ApiProperty({ example: 'ลาพักร้อนอายุงาน 1 ปี+' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @ApiPropertyOptional({ description: 'Leave type ID (omit for generic)' })
  @IsOptional()
  @IsString()
  leaveTypeId?: string;

  @ApiPropertyOptional({ description: 'Minimum tenure in months to qualify', default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  minTenureMonths?: number;

  @ApiPropertyOptional({ description: 'Entitlement days per year', default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  entitlementDays?: number;

  @ApiPropertyOptional({ description: 'Require supporting document', default: false })
  @IsOptional()
  @IsBoolean()
  requiresAttachment?: boolean;

  @ApiPropertyOptional({ description: 'Approval levels: 1=hr, 2=manager+hr, 3=supervisor+manager+hr', default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3)
  approvalLevels?: number;

  @ApiPropertyOptional({ description: 'Blackout dates (YYYY-MM-DD[])', type: [String] })
  @IsOptional()
  @IsArray()
  blackoutDates?: string[];

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class UpdateHrLeavePolicyDto extends CreateHrLeavePolicyDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  declare name: string;
}
