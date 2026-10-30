import { IsDateString, IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CreateCreditNoteDto {
  @ApiProperty({ description: 'ยอดลดหนี้รวม VAT (ไม่เกินยอดคงค้างของใบต้นทาง)', example: 535 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Type(() => Number)
  amount: number;

  @ApiProperty({ description: 'เหตุผลการลดหนี้ (พิมพ์บนใบลดหนี้)', example: 'คืนค่าห้อง 1 คืน' })
  @IsNotEmpty()
  @IsString()
  @MaxLength(250)
  reason: string;

  @ApiPropertyOptional({ description: 'วันที่ใบลดหนี้ (ค่าเริ่มต้น = วันนี้)' })
  @IsOptional()
  @IsDateString()
  issueDate?: string;
}
