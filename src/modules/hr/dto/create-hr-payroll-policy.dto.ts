import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  Min,
  Max,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateHrPayrollPolicyDto {
  @ApiProperty({ description: 'Policy name', example: 'นโยบายเงินเดือนมาตรฐาน' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @ApiPropertyOptional({ description: 'Property ID (omit for tenant-wide)' })
  @IsOptional()
  @IsString()
  propertyId?: string;

  @ApiPropertyOptional({ description: 'Mark as default policy', default: false })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional({ description: 'Is active', default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ enum: ['monthly', 'biweekly', 'weekly'], default: 'monthly' })
  @IsOptional()
  @IsIn(['monthly', 'biweekly', 'weekly'])
  payPeriod?: string;

  @ApiPropertyOptional({ description: 'Attendance cutoff day of month', default: 25 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  cutoffDay?: number;

  @ApiPropertyOptional({ description: 'Pay day of month', default: 30 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  payDay?: number;

  @ApiPropertyOptional({ description: 'Working days per month for daily-rate calc', default: 30 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  workingDaysPerMonth?: number;

  @ApiPropertyOptional({ description: 'Working hours per day', default: 8 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(24)
  workingHoursPerDay?: number;

  @ApiPropertyOptional({ description: 'Regular OT multiplier', default: 1.5 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(5)
  otMultiplier?: number;

  @ApiPropertyOptional({ description: 'Holiday OT multiplier', default: 2.0 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(5)
  holidayOtMultiplier?: number;

  @ApiPropertyOptional({ description: 'OT must be approved before counting in payroll', default: true })
  @IsOptional()
  @IsBoolean()
  otRequiresApproval?: boolean;

  @ApiPropertyOptional({ description: 'Whether paid leave still deducts salary', default: false })
  @IsOptional()
  @IsBoolean()
  paidLeaveDeducted?: boolean;

  @ApiPropertyOptional({ description: 'Unpaid leave deduction rate (× daily rate)', default: 1.0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(3)
  unpaidLeaveRate?: number;

  @ApiPropertyOptional({ description: 'Enable social security deduction', default: true })
  @IsOptional()
  @IsBoolean()
  socialSecurityEnabled?: boolean;

  @ApiPropertyOptional({ description: 'Social security rate (0.05 = 5%)', default: 0.05 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  socialSecurityRate?: number;

  @ApiPropertyOptional({ description: 'Social security monthly cap', default: 750 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  socialSecurityCap?: number;

  @ApiPropertyOptional({ description: 'Enable withholding tax (simple)', default: false })
  @IsOptional()
  @IsBoolean()
  taxEnabled?: boolean;

  @ApiPropertyOptional({ description: 'Late deduction per minute (THB)', default: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  lateDeductionPerMin?: number;

  @ApiPropertyOptional({ description: 'Note' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class UpdateHrPayrollPolicyDto extends CreateHrPayrollPolicyDto {
  @ApiPropertyOptional({ description: 'Policy name' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  declare name: string;
}
