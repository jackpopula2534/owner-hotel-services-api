import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * ถอดเมนูออกจากคลังกลาง กลับมานับในตัวเมนูเอง (ระดับ 2 → ระดับ 1)
 *
 * ทุกช่องเป็น optional — ไม่ส่งอะไรมาเลยแปลว่า "เอาของที่มีในคลังกลับมาทั้งหมด"
 * ซึ่งเป็นสิ่งที่คนกดปุ่มคาดหวัง
 */
export class DemoteFromInventoryDto {
  @ApiPropertyOptional({
    description: 'คลังต้นทางที่จะดึงของกลับ — ไม่ระบุจะใช้คลังเดียวกับที่ตอนขายไปตัด',
  })
  @IsOptional()
  @IsString()
  warehouseId?: string;

  @ApiPropertyOptional({
    description:
      'จำนวนที่ดึงกลับ — ไม่ระบุจะเอาทั้งหมดที่มีในคลัง (ถ้ามีเมนูอื่นผูกสินค้าตัวเดียวกันอยู่ ต้องระบุเอง)',
    example: 12,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  quantity?: number;

  @ApiPropertyOptional({
    description:
      'false = ตัดสายอย่างเดียว ไม่ดึงของกลับ (ของยังอยู่ในคลัง เมนูกลับไปเป็นขายไม่จำกัด)',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  returnStock?: boolean;
}
