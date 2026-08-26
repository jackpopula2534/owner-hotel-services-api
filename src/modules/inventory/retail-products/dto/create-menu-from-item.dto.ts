import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/** สร้างเมนูขายหน้าร้านจากสินค้าในคลัง — ทิศทางกลับของ "ย้ายเข้าคลังกลาง" */
export class CreateMenuFromItemDto {
  @ApiProperty({ description: 'ร้านที่จะเอาสินค้านี้ไปขาย' })
  @IsString()
  @IsNotEmpty()
  restaurantId!: string;

  @ApiProperty({ description: 'หมวดเมนูปลายทาง' })
  @IsString()
  @IsNotEmpty()
  categoryId!: string;

  @ApiPropertyOptional({ description: 'ชื่อเมนู — ไม่ระบุจะใช้ชื่อสินค้า' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional({ description: 'ราคาขาย — ไม่ระบุจะใช้ราคาขายแนะนำของสินค้า' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  price?: number;
}
