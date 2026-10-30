import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** ระบุลูกค้า 1 ใน 3 แบบ: guestId (แขก) / companyTaxId / companyName (City Ledger) */
export class QueryArStatementDto {
  @ApiProperty() @IsUUID() propertyId!: string;

  @ApiPropertyOptional({ description: 'ลูกค้าแขก' })
  @IsOptional()
  @IsUUID()
  guestId?: string;

  @ApiPropertyOptional({ description: 'เลขผู้เสียภาษีบริษัท (City Ledger)' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  companyTaxId?: string;

  @ApiPropertyOptional({ description: 'ชื่อบริษัท (ใช้เมื่อไม่มีเลขผู้เสียภาษี)' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  companyName?: string;

  @ApiPropertyOptional({ description: 'YYYY-MM-DD (ค่าเริ่มต้น = วันที่ 1 ของเดือนนี้)' })
  @IsOptional()
  @Matches(YMD, { message: 'dateFrom ต้องเป็น YYYY-MM-DD' })
  dateFrom?: string;

  @ApiPropertyOptional({ description: 'YYYY-MM-DD (ค่าเริ่มต้น = วันนี้)' })
  @IsOptional()
  @Matches(YMD, { message: 'dateTo ต้องเป็น YYYY-MM-DD' })
  dateTo?: string;
}

export class QueryArStatementCustomersDto {
  @ApiProperty() @IsUUID() propertyId!: string;

  @ApiPropertyOptional({ description: 'ค้นหาชื่อลูกค้า / บริษัท / เลขผู้เสียภาษี (รวมรายที่ชำระครบแล้ว)' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
