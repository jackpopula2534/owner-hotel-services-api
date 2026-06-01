import {
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsUUID,
  IsNumber,
  IsString,
  IsBoolean,
  Min,
  Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export enum TaxType {
  VAT = 'VAT',
  WHT_INDIVIDUAL = 'WHT_INDIVIDUAL',
  WHT_JURISTIC = 'WHT_JURISTIC',
  SPECIFIC_BUSINESS = 'SPECIFIC_BUSINESS',
}

export enum WhtIncomeType {
  TYPE_40_2 = 'TYPE_40_2',
  TYPE_40_3 = 'TYPE_40_3',
  TYPE_40_4 = 'TYPE_40_4',
  TYPE_40_5 = 'TYPE_40_5',
  TYPE_40_6 = 'TYPE_40_6',
  TYPE_40_7 = 'TYPE_40_7',
  TYPE_40_8 = 'TYPE_40_8',
}

export class CreateTaxRateDto {
  @ApiProperty({ description: 'ชื่ออัตราภาษี', example: 'VAT 7%' })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiProperty({ description: 'รหัสอัตราภาษี', example: 'VAT_7' })
  @IsNotEmpty()
  @IsString()
  code: string;

  @ApiProperty({ description: 'ประเภทภาษี', enum: TaxType })
  @IsEnum(TaxType)
  type: TaxType;

  @ApiProperty({ description: 'อัตราภาษี (%)', example: 7 })
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(100)
  @Type(() => Number)
  rate: number;

  @ApiPropertyOptional({ description: 'Account ID สำหรับ Tax Payable (Output VAT)' })
  @IsOptional()
  @IsUUID()
  taxPayableAccountId?: string;

  @ApiPropertyOptional({ description: 'Account ID สำหรับ Tax Input (Input VAT)' })
  @IsOptional()
  @IsUUID()
  taxInputAccountId?: string;

  @ApiPropertyOptional({ description: 'ประเภทเงินได้ WHT', enum: WhtIncomeType })
  @IsOptional()
  @IsEnum(WhtIncomeType)
  whtIncomeType?: WhtIncomeType;

  @ApiPropertyOptional({ description: 'ตั้งเป็นค่า default', default: false })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional({ description: 'คำอธิบาย' })
  @IsOptional()
  @IsString()
  description?: string;
}
