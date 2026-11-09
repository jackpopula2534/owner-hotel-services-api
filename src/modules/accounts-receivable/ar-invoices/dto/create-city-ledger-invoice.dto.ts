import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CreateCityLedgerInvoiceDto {
  @ApiProperty({ description: 'Property ID' })
  @IsUUID()
  propertyId: string;

  @ApiProperty({ description: 'ชื่อบริษัทผู้รับหนี้ (ตรงกับชื่อตอนโอน Folio เข้า City Ledger)' })
  @IsNotEmpty()
  @IsString()
  @MaxLength(200)
  companyName: string;

  @ApiPropertyOptional({ description: 'เลขผู้เสียภาษีบริษัท (บังคับก่อนออกใบกำกับภาษี)' })
  @IsOptional()
  @Matches(/^\d{13}$/, { message: 'companyTaxId ต้องเป็นตัวเลข 13 หลัก' })
  companyTaxId?: string;

  @ApiPropertyOptional({ description: 'ที่อยู่บริษัท' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  companyAddress?: string;

  @ApiProperty({
    description: 'FolioPayment (method CITY_LEDGER) ที่จะรวมเป็นใบเดียว',
    type: [String],
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  folioPaymentIds: string[];

  @ApiPropertyOptional({ description: 'เครดิตเทอม (วัน) ค่าเริ่มต้น 30', default: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(365)
  creditDays?: number;
}
