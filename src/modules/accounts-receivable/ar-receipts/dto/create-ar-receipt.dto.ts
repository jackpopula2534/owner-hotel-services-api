import {
  IsNotEmpty, IsOptional, IsEnum, IsUUID, IsDateString, IsNumber,
  IsString, IsArray, ValidateNested, Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { AccPaymentMethod } from '../../guest-folio/dto/create-folio-payment.dto';

export class ArReceiptAllocationDto {
  @ApiProperty({ description: 'AR Invoice ID ที่ต้องการ allocate' })
  @IsNotEmpty()
  @IsUUID()
  invoiceId: string;

  @ApiProperty({ description: 'จำนวนเงินที่จัดสรร', example: 2675.00 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Type(() => Number)
  amount: number;
}

export class CreateArReceiptDto {
  @ApiProperty({ description: 'Property ID' })
  @IsNotEmpty()
  @IsUUID()
  propertyId: string;

  @ApiProperty({ description: 'วันที่รับชำระ', example: '2025-01-15' })
  @IsDateString()
  receiptDate: string;

  @ApiPropertyOptional({ description: 'Guest ID' })
  @IsOptional()
  @IsUUID()
  guestId?: string;

  @ApiPropertyOptional({ description: 'ชื่อบริษัท (กรณี City Ledger)' })
  @IsOptional()
  @IsString()
  companyName?: string;

  @ApiProperty({ description: 'วิธีชำระเงิน', enum: AccPaymentMethod })
  @IsEnum(AccPaymentMethod)
  method: AccPaymentMethod;

  @ApiProperty({ description: 'ยอดรับชำระรวม', example: 5350.00 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Type(() => Number)
  totalAmount: number;

  @ApiPropertyOptional({ description: 'เลขที่อ้างอิง (Transaction ID, cheque no.)' })
  @IsOptional()
  @IsString()
  reference?: string;

  @ApiPropertyOptional({ description: 'หมายเหตุ' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ description: 'รายการ Invoice ที่ต้องการ allocate', type: [ArReceiptAllocationDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ArReceiptAllocationDto)
  allocations?: ArReceiptAllocationDto[];
}
