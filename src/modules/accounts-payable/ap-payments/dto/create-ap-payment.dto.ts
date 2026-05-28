import {
  IsNotEmpty, IsOptional, IsEnum, IsUUID, IsDateString, IsNumber,
  IsString, IsArray, ValidateNested, Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export enum AccPaymentMethod {
  CASH = 'CASH',
  BANK_TRANSFER = 'BANK_TRANSFER',
  CREDIT_CARD = 'CREDIT_CARD',
  DEBIT_CARD = 'DEBIT_CARD',
  QR_PROMPTPAY = 'QR_PROMPTPAY',
  TRUEMONEY = 'TRUEMONEY',
  CHEQUE = 'CHEQUE',
  CREDIT_NOTE = 'CREDIT_NOTE',
  ADVANCE = 'ADVANCE',
  CITY_LEDGER = 'CITY_LEDGER',
  ONLINE_BOOKING = 'ONLINE_BOOKING',
  OTHER = 'OTHER',
}

export class ApPaymentAllocationDto {
  @ApiProperty({ description: 'AP Invoice ID ที่ต้องการ allocate' })
  @IsNotEmpty()
  @IsUUID()
  invoiceId: string;

  @ApiProperty({ description: 'จำนวนเงินที่จัดสรร', example: 5000.00 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Type(() => Number)
  amount: number;
}

export class CreateApPaymentDto {
  @ApiProperty({ description: 'Property ID' })
  @IsNotEmpty()
  @IsUUID()
  propertyId: string;

  @ApiProperty({ description: 'Supplier ID' })
  @IsNotEmpty()
  @IsUUID()
  supplierId: string;

  @ApiProperty({ description: 'วันที่จ่ายเงิน', example: '2025-01-20' })
  @IsDateString()
  paymentDate: string;

  @ApiProperty({ description: 'วิธีชำระเงิน', enum: AccPaymentMethod })
  @IsEnum(AccPaymentMethod)
  method: AccPaymentMethod;

  @ApiProperty({ description: 'ยอดจ่ายก่อนหัก WHT', example: 10000.00 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Type(() => Number)
  grossAmount: number;

  @ApiPropertyOptional({ description: 'ยอด WHT หัก ณ ที่จ่าย', default: 0 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  whtAmount?: number;

  @ApiPropertyOptional({ description: 'Bank Account ID ที่ใช้จ่าย' })
  @IsOptional()
  @IsUUID()
  bankAccountId?: string;

  @ApiPropertyOptional({ description: 'เลขที่อ้างอิง (cheque no., transfer ref.)' })
  @IsOptional()
  @IsString()
  reference?: string;

  @ApiPropertyOptional({ description: 'หมายเหตุ' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ description: 'รายการ Invoice ที่ต้องการ allocate', type: [ApPaymentAllocationDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ApPaymentAllocationDto)
  allocations?: ApPaymentAllocationDto[];
}
