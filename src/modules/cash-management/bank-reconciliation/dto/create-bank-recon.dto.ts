import { IsNotEmpty, IsUUID, IsString, IsDateString, IsNumber, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CreateBankReconDto {
  @ApiProperty({ description: 'Property ID' })
  @IsNotEmpty() @IsUUID()
  propertyId: string;

  @ApiProperty({ description: 'Bank Account ID (FK → BankAccount)' })
  @IsNotEmpty() @IsUUID()
  bankAccountId: string;

  @ApiProperty({ description: 'งวด เช่น 2025-01', example: '2025-01' })
  @IsNotEmpty() @IsString()
  period: string;

  @ApiProperty({ description: 'วันที่ Statement', example: '2025-01-31' })
  @IsDateString()
  statementDate: string;

  @ApiProperty({ description: 'ยอด Statement จากธนาคาร', example: 150000.00 })
  @IsNumber({ maxDecimalPlaces: 2 }) @Type(() => Number)
  statementBalance: number;

  @ApiPropertyOptional({ description: 'หมายเหตุ' })
  @IsOptional() @IsString()
  notes?: string;
}
