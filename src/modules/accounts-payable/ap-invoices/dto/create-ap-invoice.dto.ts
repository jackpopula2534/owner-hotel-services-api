import {
  IsNotEmpty, IsOptional, IsEnum, IsUUID, IsDateString, IsNumber,
  IsString, IsArray, ValidateNested, Min, Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export enum ApInvoiceType {
  SUPPLIER_INVOICE = 'SUPPLIER_INVOICE',
  UTILITY_BILL = 'UTILITY_BILL',
  RENT = 'RENT',
  SERVICE_CONTRACT = 'SERVICE_CONTRACT',
  CREDIT_NOTE = 'CREDIT_NOTE',
}

export class CreateApInvoiceLineDto {
  @ApiProperty({ description: 'คำอธิบายรายการ' })
  @IsNotEmpty()
  @IsString()
  description: string;

  @ApiPropertyOptional({ description: 'Item / Product ID' })
  @IsOptional()
  @IsUUID()
  itemId?: string;

  @ApiProperty({ description: 'จำนวน', example: 10 })
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Type(() => Number)
  quantity: number;

  @ApiProperty({ description: 'ราคาต่อหน่วย', example: 500.00 })
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

  @ApiPropertyOptional({ description: 'อัตรา WHT (%)', default: 0 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  @Type(() => Number)
  whtRate?: number;

  @ApiPropertyOptional({ description: 'Account ID สำหรับ GL posting' })
  @IsOptional()
  @IsUUID()
  accountId?: string;

  @ApiPropertyOptional({ description: 'Cost Center ID' })
  @IsOptional()
  @IsUUID()
  costCenterId?: string;
}

export class CreateApInvoiceDto {
  @ApiProperty({ description: 'Property ID' })
  @IsNotEmpty()
  @IsUUID()
  propertyId: string;

  @ApiProperty({ description: 'ประเภท AP Invoice', enum: ApInvoiceType })
  @IsEnum(ApInvoiceType)
  invoiceType: ApInvoiceType;

  @ApiProperty({ description: 'Supplier ID' })
  @IsNotEmpty()
  @IsUUID()
  supplierId: string;

  @ApiPropertyOptional({ description: 'Purchase Order ID' })
  @IsOptional()
  @IsUUID()
  purchaseOrderId?: string;

  @ApiPropertyOptional({ description: 'Goods Receive Note ID' })
  @IsOptional()
  @IsUUID()
  goodsReceiveId?: string;

  @ApiPropertyOptional({ description: 'เลขที่ใบแจ้งหนี้ของ Supplier' })
  @IsOptional()
  @IsString()
  supplierInvoiceNo?: string;

  @ApiProperty({ description: 'วันที่ Invoice', example: '2025-01-15' })
  @IsDateString()
  invoiceDate: string;

  @ApiProperty({ description: 'วันที่ครบกำหนดชำระ', example: '2025-02-14' })
  @IsDateString()
  dueDate: string;

  @ApiPropertyOptional({ description: 'สกุลเงิน', default: 'THB' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({ description: 'เงื่อนไขการชำระ (เช่น Net 30)' })
  @IsOptional()
  @IsString()
  paymentTerms?: string;

  @ApiPropertyOptional({ description: 'หมายเหตุ' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiProperty({ description: 'รายการในใบแจ้งหนี้', type: [CreateApInvoiceLineDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateApInvoiceLineDto)
  lines: CreateApInvoiceLineDto[];
}
