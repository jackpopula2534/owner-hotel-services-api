import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class VoidRetailSaleDto {
  @ApiProperty({ description: 'เหตุผลการยกเลิกใบเสร็จ (บันทึกไว้ตรวจสอบย้อนหลัง)', example: 'คิดเงินผิด ลูกค้าขอยกเลิก' })
  @IsString()
  @MinLength(3, { message: 'เหตุผลการยกเลิกต้องมีอย่างน้อย 3 ตัวอักษร' })
  @MaxLength(500)
  reason!: string;
}
