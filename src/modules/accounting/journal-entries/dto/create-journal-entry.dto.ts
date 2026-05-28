import {
  IsNotEmpty, IsString, IsOptional, IsEnum, IsUUID,
  IsDateString, IsArray, ValidateNested, IsNumber, Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export enum JournalSourceTypeEnum {
  MANUAL = 'MANUAL',
  BOOKING_PAYMENT = 'BOOKING_PAYMENT',
  FOLIO_CHARGE = 'FOLIO_CHARGE',
  AR_RECEIPT = 'AR_RECEIPT',
  AP_PAYMENT = 'AP_PAYMENT',
  NIGHT_AUDIT = 'NIGHT_AUDIT',
  DEPRECIATION = 'DEPRECIATION',
  PAYROLL = 'PAYROLL',
  PURCHASE_RECEIPT = 'PURCHASE_RECEIPT',
  TAX_FILING = 'TAX_FILING',
  CLOSING_ENTRY = 'CLOSING_ENTRY',
  ADJUSTMENT = 'ADJUSTMENT',
}

export class CreateJournalLineDto {
  @ApiProperty({ description: 'รหัสบัญชี (AccountChart ID)' })
  @IsNotEmpty()
  @IsUUID()
  accountId: string;

  @ApiProperty({ description: 'บรรทัดที่', example: 1 })
  @IsNumber()
  @Min(1)
  lineNo: number;

  @ApiPropertyOptional({ description: 'คำอธิบายบรรทัด' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ description: 'ยอด Debit (ถ้าไม่มีให้ใส่ 0)', example: 1000.00 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  debit: number;

  @ApiProperty({ description: 'ยอด Credit (ถ้าไม่มีให้ใส่ 0)', example: 0 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  credit: number;

  @ApiPropertyOptional({ description: 'Cost Center ID' })
  @IsOptional()
  @IsUUID()
  costCenterId?: string;

  @ApiPropertyOptional({ description: 'อ้างอิงรายการย่อย' })
  @IsOptional()
  @IsString()
  subRef?: string;
}

export class CreateJournalEntryDto {
  @ApiProperty({ description: 'Property ID' })
  @IsNotEmpty()
  @IsUUID()
  propertyId: string;

  @ApiProperty({ description: 'วันที่บันทึกรายการ', example: '2025-01-15' })
  @IsDateString()
  entryDate: string;

  @ApiProperty({ description: 'คำอธิบายรายการ', example: 'รับชำระค่าห้องพัก Booking #1234' })
  @IsNotEmpty()
  @IsString()
  description: string;

  @ApiPropertyOptional({ description: 'เลขที่อ้างอิงเอกสาร' })
  @IsOptional()
  @IsString()
  reference?: string;

  @ApiPropertyOptional({ description: 'แหล่งที่มา', enum: JournalSourceTypeEnum, default: JournalSourceTypeEnum.MANUAL })
  @IsOptional()
  @IsEnum(JournalSourceTypeEnum)
  sourceType?: JournalSourceTypeEnum;

  @ApiPropertyOptional({ description: 'ID ของ source document' })
  @IsOptional()
  @IsString()
  sourceId?: string;

  @ApiProperty({ description: 'รายการบัญชี (ต้อง debit = credit)', type: [CreateJournalLineDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateJournalLineDto)
  lines: CreateJournalLineDto[];
}
