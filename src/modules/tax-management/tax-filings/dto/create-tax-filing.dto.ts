import {
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsUUID,
  IsDateString,
  IsNumber,
  IsString,
  IsArray,
  ValidateNested,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export enum TaxFilingType {
  VAT_PP30 = 'VAT_PP30',
  WHT_PND1 = 'WHT_PND1',
  WHT_PND3 = 'WHT_PND3',
  WHT_PND53 = 'WHT_PND53',
  CIT_PND51 = 'CIT_PND51',
  CIT_PND50 = 'CIT_PND50',
}

export class TaxFilingLineDto {
  @ApiProperty({ description: 'คำอธิบายรายการ' })
  @IsNotEmpty()
  @IsString()
  description: string;

  @ApiPropertyOptional({ description: 'เลขที่เอกสารอ้างอิง' })
  @IsOptional()
  @IsString()
  docRef?: string;

  @ApiProperty({ description: 'ฐานภาษี', example: 100000.0 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  baseAmount: number;

  @ApiProperty({ description: 'อัตราภาษี (%)', example: 7 })
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(100)
  @Type(() => Number)
  taxRate: number;

  @ApiProperty({ description: 'ยอดภาษี', example: 7000.0 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  taxAmount: number;
}

export class CreateTaxFilingDto {
  @ApiProperty({ description: 'Property ID' })
  @IsNotEmpty()
  @IsUUID()
  propertyId: string;

  @ApiProperty({ description: 'ประเภทแบบยื่นภาษี', enum: TaxFilingType })
  @IsEnum(TaxFilingType)
  filingType: TaxFilingType;

  @ApiProperty({ description: 'งวดภาษี', example: '2025-01' })
  @IsNotEmpty()
  @IsString()
  period: string;

  @ApiProperty({ description: 'ปีภาษี', example: 2025 })
  @IsInt()
  @Min(2000)
  @Type(() => Number)
  taxYear: number;

  @ApiProperty({ description: 'เดือนภาษี (1-12)', example: 1 })
  @IsInt()
  @Min(1)
  @Max(12)
  @Type(() => Number)
  taxMonth: number;

  @ApiProperty({ description: 'วันครบกำหนดยื่น', example: '2025-02-15' })
  @IsDateString()
  dueDate: string;

  @ApiPropertyOptional({ description: 'หมายเหตุ' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ description: 'รายการภาษี', type: [TaxFilingLineDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TaxFilingLineDto)
  lines?: TaxFilingLineDto[];
}
