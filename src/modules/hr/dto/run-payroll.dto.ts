import {
  IsInt,
  IsOptional,
  IsString,
  IsArray,
  ValidateNested,
  IsNumber,
  IsIn,
  Min,
  Max,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class PayrollItemDto {
  @ApiProperty({ description: 'Item type', enum: ['allowance', 'deduction', 'overtime', 'bonus'] })
  @IsString()
  @IsIn(['allowance', 'deduction', 'overtime', 'bonus'])
  type: string;

  @ApiProperty({ description: 'Item name', example: 'ค่าที่พัก' })
  @IsString()
  @MaxLength(200)
  name: string;

  @ApiProperty({ description: 'Amount in THB', example: 1500 })
  @IsNumber()
  @Min(0)
  amount: number;

  @ApiPropertyOptional({ description: 'Additional note' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class RunPayrollDto {
  @ApiProperty({ description: 'Month (1-12)', example: 4 })
  @IsInt()
  @Min(1)
  @Max(12)
  month: number;

  @ApiProperty({ description: 'Year', example: 2026 })
  @IsInt()
  @Min(2020)
  year: number;

  @ApiPropertyOptional({ description: 'Specific employee IDs to run payroll for (empty = all active employees)' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  employeeIds?: string[];

  @ApiPropertyOptional({ description: 'Additional payroll items per employee' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PayrollItemDto)
  items?: PayrollItemDto[];
}

export class ApprovePayrollDto {
  @ApiPropertyOptional({ description: 'Note for approval' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
