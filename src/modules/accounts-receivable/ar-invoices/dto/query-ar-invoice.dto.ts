import { IsOptional, IsEnum, IsUUID, IsDateString, IsString, IsInt, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export enum ArInvoiceStatus {
  DRAFT = 'DRAFT',
  ISSUED = 'ISSUED',
  PARTIAL = 'PARTIAL',
  PAID = 'PAID',
  OVERDUE = 'OVERDUE',
  VOID = 'VOID',
}

export class QueryArInvoiceDto {
  @ApiPropertyOptional({ description: 'Property ID' })
  @IsOptional()
  @IsUUID()
  propertyId?: string;

  @ApiPropertyOptional({ description: 'สถานะ Invoice', enum: ArInvoiceStatus })
  @IsOptional()
  @IsEnum(ArInvoiceStatus)
  status?: ArInvoiceStatus;

  @ApiPropertyOptional({ description: 'Guest ID' })
  @IsOptional()
  @IsUUID()
  guestId?: string;

  @ApiPropertyOptional({ description: 'วันที่เริ่มต้น', example: '2025-01-01' })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({ description: 'วันที่สิ้นสุด', example: '2025-01-31' })
  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @ApiPropertyOptional({ description: 'ค้นหา (invoiceNo, companyName, guestName)' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  limit?: number;
}
