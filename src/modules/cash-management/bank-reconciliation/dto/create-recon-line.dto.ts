import { IsNotEmpty, IsUUID, IsString, IsDateString, IsNumber, IsOptional, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export enum ReconTxnType {
  DEPOSIT = 'DEPOSIT',
  WITHDRAWAL = 'WITHDRAWAL',
  TRANSFER = 'TRANSFER',
  FEE = 'FEE',
  INTEREST = 'INTEREST',
  OTHER = 'OTHER',
}

export class CreateReconLineDto {
  @ApiProperty({ description: 'Reconciliation ID' })
  @IsNotEmpty() @IsUUID()
  reconId: string;

  @ApiProperty({ description: 'ประเภทรายการ', enum: ReconTxnType })
  @IsEnum(ReconTxnType)
  txnType: ReconTxnType;

  @ApiProperty({ description: 'วันที่รายการ', example: '2025-01-15' })
  @IsDateString()
  txnDate: string;

  @ApiProperty({ description: 'คำอธิบาย' })
  @IsNotEmpty() @IsString()
  description: string;

  @ApiPropertyOptional({ description: 'ยอดจาก Bank Statement', default: 0 })
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Type(() => Number)
  statementAmount?: number;

  @ApiPropertyOptional({ description: 'ยอดในสมุดบัญชี', default: 0 })
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Type(() => Number)
  bookAmount?: number;

  @ApiPropertyOptional({ description: 'อ้างอิงรายการในระบบ (JournalEntryId ฯลฯ)' })
  @IsOptional() @IsString()
  bookRef?: string;

  @ApiPropertyOptional({ description: 'อ้างอิง Statement จากธนาคาร' })
  @IsOptional() @IsString()
  statementRef?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  notes?: string;
}
