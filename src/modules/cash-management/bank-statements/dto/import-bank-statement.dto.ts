import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class BankStatementLineInputDto {
  @ApiProperty({ example: '2026-10-28' })
  @IsDateString()
  txnDate: string;

  @ApiPropertyOptional({ example: '14:05' })
  @IsOptional()
  @Matches(/^\d{1,2}:\d{2}(:\d{2})?$/)
  txnTime?: string;

  @ApiProperty()
  @IsString()
  @MaxLength(300)
  description: string;

  @ApiProperty({ description: '+ เงินเข้า / − เงินออก', example: 5350 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  amount: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  balance?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  reference?: string;
}

export class ImportBankStatementDto {
  @ApiProperty()
  @IsUUID()
  propertyId: string;

  @ApiProperty({ description: 'บัญชีเงินฝากธนาคารในผังบัญชี (1102*)' })
  @IsUUID()
  bankAccountId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  fileName?: string;

  @ApiProperty({ type: [BankStatementLineInputDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => BankStatementLineInputDto)
  lines: BankStatementLineInputDto[];
}

export class LinkReceiptDto {
  @ApiProperty()
  @IsUUID()
  arReceiptId: string;
}

export class SetStatementLineStatusDto {
  @ApiProperty({ enum: ['IGNORED', 'UNMATCHED'] })
  @IsNotEmpty()
  @Matches(/^(IGNORED|UNMATCHED)$/)
  status: 'IGNORED' | 'UNMATCHED';
}

export class QueryBankStatementDto {
  @ApiProperty()
  @IsUUID()
  propertyId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  bankAccountId?: string;

  @ApiPropertyOptional({ example: '2026-10' })
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  period?: string;

  @ApiPropertyOptional({ enum: ['UNMATCHED', 'MATCHED', 'IGNORED'] })
  @IsOptional()
  @Matches(/^(UNMATCHED|MATCHED|IGNORED)$/)
  status?: 'UNMATCHED' | 'MATCHED' | 'IGNORED';

  @ApiPropertyOptional({ enum: ['IN', 'OUT'] })
  @IsOptional()
  @Matches(/^(IN|OUT)$/)
  direction?: 'IN' | 'OUT';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  importBatchId?: string;
}
