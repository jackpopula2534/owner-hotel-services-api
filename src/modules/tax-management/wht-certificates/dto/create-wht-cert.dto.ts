import {
  IsNotEmpty, IsOptional, IsEnum, IsUUID, IsDateString, IsNumber, IsString, Min, Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { WhtIncomeType } from '../../tax-rates/dto/create-tax-rate.dto';

export class CreateWhtCertDto {
  @ApiProperty({ description: 'Property ID' })
  @IsNotEmpty()
  @IsUUID()
  propertyId: string;

  @ApiProperty({ description: 'Supplier ID' })
  @IsNotEmpty()
  @IsUUID()
  supplierId: string;

  @ApiPropertyOptional({ description: 'AP Payment ID ที่เกี่ยวข้อง' })
  @IsOptional()
  @IsUUID()
  apPaymentId?: string;

  @ApiProperty({ description: 'วันที่จ่ายเงิน', example: '2025-01-20' })
  @IsDateString()
  paymentDate: string;

  @ApiProperty({ description: 'ประเภทเงินได้ WHT', enum: WhtIncomeType })
  @IsEnum(WhtIncomeType)
  incomeType: WhtIncomeType;

  @ApiProperty({ description: 'ยอดเงินได้ก่อนหัก WHT', example: 10000.00 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Type(() => Number)
  incomeAmount: number;

  @ApiProperty({ description: 'อัตรา WHT (%)', example: 3 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  @Type(() => Number)
  whtRate: number;

  @ApiProperty({ description: 'ยอด WHT หัก ณ ที่จ่าย', example: 300.00 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  whtAmount: number;

  @ApiProperty({ description: 'ชื่อผู้รับเงิน / ผู้ถูกหัก', example: 'บริษัท ABC จำกัด' })
  @IsNotEmpty()
  @IsString()
  payeeName: string;

  @ApiPropertyOptional({ description: 'เลขที่ผู้เสียภาษีของผู้รับเงิน' })
  @IsOptional()
  @IsString()
  payeeTaxId?: string;

  @ApiPropertyOptional({ description: 'ที่อยู่ผู้รับเงิน' })
  @IsOptional()
  @IsString()
  payeeAddress?: string;

  @ApiPropertyOptional({ description: 'ชื่อผู้จ่ายเงิน (ออกหนังสือรับรอง)' })
  @IsOptional()
  @IsString()
  issuerName?: string;

  @ApiPropertyOptional({ description: 'เลขที่ผู้เสียภาษีของผู้จ่ายเงิน' })
  @IsOptional()
  @IsString()
  issuerTaxId?: string;
}
