import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

/**
 * ยิงบาร์โค้ดที่หน้าขาย — คนละเรื่องกับ `SearchItemDto`
 *
 * ช่องค้นหาเอาไว้ให้คนอ่านแล้วเลือกเอง จะคืนมาสิบรายการก็ไม่เป็นไร
 * แต่การยิงบาร์โค้ดคือ "ของชิ้นนี้ชิ้นเดียว" แล้วเข้าตะกร้าทันทีโดยไม่มีใครอ่านซ้ำ
 * ถ้าตอบแบบใกล้เคียงได้เมื่อไหร่ แขกจะโดนคิดเงินของผิดตัวแบบเงียบ ๆ
 * ที่นี่จึงเทียบเท่ากันเป๊ะเท่านั้น
 */
export class ScanBarcodeDto {
  @ApiProperty({
    description: 'บาร์โค้ดที่อ่านได้จากเครื่องยิงหรือกล้อง — เทียบแบบตรงตัวเท่านั้น',
    example: '8850001000011',
    minLength: 3,
    maxLength: 64,
  })
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(3, { message: 'บาร์โค้ดสั้นเกินไป' })
  @MaxLength(64)
  code!: string;

  @ApiPropertyOptional({
    description: 'คลังที่กำลังขายอยู่ — ใส่มาแล้วจะได้ยอดคงเหลือของคลังนั้นติดมาด้วย',
    example: 'uuid',
  })
  @IsOptional()
  @IsString()
  warehouseId?: string;
}
