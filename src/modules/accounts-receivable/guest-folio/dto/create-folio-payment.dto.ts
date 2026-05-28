import {
  IsNotEmpty, IsOptional, IsEnum, IsUUID, IsNumber, IsString, Min,
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

export class CreateFolioPaymentDto {
  @ApiProperty({ description: 'Folio ID' })
  @IsNotEmpty()
  @IsUUID()
  folioId: string;

  @ApiProperty({ description: 'วิธีชำระเงิน', enum: AccPaymentMethod })
  @IsEnum(AccPaymentMethod)
  method: AccPaymentMethod;

  @ApiProperty({ description: 'จำนวนเงิน', example: 2675.00 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Type(() => Number)
  amount: number;

  @ApiPropertyOptional({ description: 'เลขที่อ้างอิง (Transaction ID, cheque no.)' })
  @IsOptional()
  @IsString()
  reference?: string;

  @ApiPropertyOptional({ description: 'ชื่อผู้ชำระเงิน' })
  @IsOptional()
  @IsString()
  payerName?: string;

  @ApiPropertyOptional({ description: 'หมายเหตุ' })
  @IsOptional()
  @IsString()
  notes?: string;
}
