import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  IsNumber,
  IsEnum,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export enum CashTxnType {
  RECEIPT = 'RECEIPT',
  PAYMENT = 'PAYMENT',
  TRANSFER = 'TRANSFER',
  ADJUSTMENT = 'ADJUSTMENT',
  OPENING = 'OPENING',
  CLOSING = 'CLOSING',
}

export class CreateCashTxnDto {
  @ApiProperty({ description: 'Cash Drawer ID', example: 'uuid-xxx' })
  @IsNotEmpty()
  @IsUUID()
  drawerId: string;

  @ApiProperty({ description: 'ประเภทรายการ', enum: CashTxnType })
  @IsNotEmpty()
  @IsEnum(CashTxnType)
  txnType: CashTxnType;

  @ApiProperty({ description: 'คำอธิบายรายการ', example: 'รับชำระค่าห้องพัก' })
  @IsNotEmpty()
  @IsString()
  description: string;

  @ApiProperty({ description: 'จำนวนเงิน (ต้องมากกว่า 0)', example: 1500 })
  @IsNotEmpty()
  @IsNumber()
  @Min(0.01)
  @Type(() => Number)
  amount: number;

  @ApiPropertyOptional({ description: 'ลิ้นชักปลายทาง (กรณี TRANSFER)', example: 'uuid-yyy' })
  @IsOptional()
  @IsUUID()
  toDrawerId?: string;

  @ApiPropertyOptional({ description: 'ประเภทต้นทาง เช่น "FOLIO", "INVOICE"', example: 'FOLIO' })
  @IsOptional()
  @IsString()
  sourceType?: string;

  @ApiPropertyOptional({ description: 'ID ต้นทาง', example: 'uuid-folio' })
  @IsOptional()
  @IsString()
  sourceId?: string;

  @ApiPropertyOptional({ description: 'เลขที่อ้างอิง', example: 'INV-202505-000001' })
  @IsOptional()
  @IsString()
  reference?: string;
}
