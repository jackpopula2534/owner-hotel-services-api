import { IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class TransferCityLedgerDto {
  @ApiProperty({ description: 'ชื่อบริษัท/ลูกค้าองค์กรที่รับหนี้', example: 'บจก. ตัวอย่าง' })
  @IsNotEmpty()
  @IsString()
  @MaxLength(200)
  companyName: string;

  @ApiPropertyOptional({ description: 'เลขผู้เสียภาษีบริษัท', example: '0105555000000' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  companyTaxId?: string;

  @ApiPropertyOptional({ description: 'ยอดที่โอน (ไม่ระบุ = ยอดคงค้างทั้งหมด)', example: 8400 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Type(() => Number)
  amount?: number;
}
