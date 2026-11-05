import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

/** เปลี่ยนสินค้าในคลังที่เมนูขายตรงผูกอยู่ — ต้องมีเหตุผลเสมอ (เก็บลงประวัติ) */
export class RelinkInventoryDto {
  @ApiProperty({ description: 'สินค้าสำเร็จรูปตัวใหม่ในคลัง' })
  @IsString()
  @IsNotEmpty()
  inventoryItemId!: string;

  @ApiProperty({
    description: 'เหตุผลที่เปลี่ยน เช่น เปลี่ยนซัพพลายเออร์/เปลี่ยนขนาดบรรจุ',
    minLength: 3,
  })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
