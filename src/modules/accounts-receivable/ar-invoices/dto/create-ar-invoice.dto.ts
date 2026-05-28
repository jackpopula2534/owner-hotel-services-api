import {
  IsNotEmpty, IsOptional, IsEnum, IsUUID, IsDateString, IsNumber,
  IsString, IsArray, ValidateNested, Min, Max, IsBoolean,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { FolioChargeType } from '../../guest-folio/dto/create-folio-charge.dto';

export enum ArInvoiceType {
  GUEST_BILL = 'GUEST_BILL',
  CITY_LEDGER = 'CITY_LEDGER',
  ADVANCE_DEPOSIT = 'ADVANCE_DEPOSIT',
  CREDIT_NOTE = 'CREDIT_NOTE',
  PROFORMA = 'PROFORMA',
}

export class CreateArInvoiceLineDto {
  @ApiProperty({ description: 'คำอธิบายรายการ' })
  @IsNotEmpty()
  @IsString()
  description: string;

  @ApiProperty({ description: 'ประเภท charge', enum: FolioChargeType })
  @IsEnum(FolioChargeType)
  chargeType: FolioChargeType;

  @ApiProperty({ description: 'จำนวน', example: 1 })
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Type(() => Number)
  quantity: number;

  @ApiProperty({ description: 'ราคาต่อหน่วย', example: 2500.00 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  unitPrice: number;

  @ApiPropertyOptional({ description: 'ส่วนลด', default: 0 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  discountAmt?: number;

  @ApiPropertyOptional({ description: 'อัตรา VAT (%)', default: 7 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  @Type(() => Number)
  vatRate?: number;

  @ApiPropertyOptional({ description: 'Account ID สำหรับ GL posting' })
  @IsOptional()
  @IsUUID()
  accountId?: string;

  @ApiPropertyOptional({ description: 'Cost Center ID' })
  @IsOptional()
  @IsUUID()
  costCenterId?: string;

  @ApiPropertyOptional({ description: 'เลขที่อ้างอิง source document' })
  @IsOptional()
  @IsString()
  sourceRef?: string;
}

export class CreateArInvoiceDto {
  @ApiProperty({ description: 'Property ID' })
  @IsNotEmpty()
  @IsUUID()
  propertyId: string;

  @ApiProperty({ description: 'ประเภท Invoice', enum: ArInvoiceType })
  @IsEnum(ArInvoiceType)
  invoiceType: ArInvoiceType;

  @ApiPropertyOptional({ description: 'Guest ID' })
  @IsOptional()
  @IsUUID()
  guestId?: string;

  @ApiPropertyOptional({ description: 'Booking ID' })
  @IsOptional()
  @IsUUID()
  bookingId?: string;

  @ApiPropertyOptional({ description: 'Folio ID' })
  @IsOptional()
  @IsUUID()
  folioId?: string;

  @ApiPropertyOptional({ description: 'ชื่อบริษัท (กรณี City Ledger)' })
  @IsOptional()
  @IsString()
  companyName?: string;

  @ApiPropertyOptional({ description: 'เลขที่ผู้เสียภาษีบริษัท' })
  @IsOptional()
  @IsString()
  companyTaxId?: string;

  @ApiPropertyOptional({ description: 'ที่อยู่บริษัท' })
  @IsOptional()
  @IsString()
  companyAddress?: string;

  @ApiProperty({ description: 'วันที่ออก Invoice', example: '2025-01-15' })
  @IsDateString()
  issueDate: string;

  @ApiProperty({ description: 'วันที่ครบกำหนดชำระ', example: '2025-01-30' })
  @IsDateString()
  dueDate: string;

  @ApiPropertyOptional({ description: 'สกุลเงิน', default: 'THB' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({ description: 'อัตราแลกเปลี่ยน', default: 1 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0)
  @Type(() => Number)
  exchangeRate?: number;

  @ApiPropertyOptional({ description: 'หมายเหตุ' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiProperty({ description: 'รายการในใบแจ้งหนี้', type: [CreateArInvoiceLineDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateArInvoiceLineDto)
  lines: CreateArInvoiceLineDto[];
}
