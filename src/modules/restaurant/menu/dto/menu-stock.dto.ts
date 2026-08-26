import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { MenuStockMovementType } from '@prisma/client';

/**
 * บันทึกรายการเข้า-ออกสต๊อกของเมนูที่นับสต๊อกเอง (โหมด LOCAL)
 * ใช้เฉพาะ tenant ที่ไม่ได้ซื้อ INVENTORY_MODULE — ถ้าผูกคลังกลางแล้วต้องเดินผ่านระบบคลัง
 */
export class MenuStockMovementDto {
  @ApiProperty({
    enum: MenuStockMovementType,
    example: 'RECEIVE',
    description:
      'OPENING = ยอดยกมา · RECEIVE = รับของเข้า · ADJUST = ปรับยอดตามที่นับได้จริง · ' +
      'WASTE = ตัดของเสีย · RETURN = คืนของ (SALE ระบบสร้างเองตอนปิดบิล)',
  })
  @IsEnum(MenuStockMovementType)
  type: MenuStockMovementType;

  @ApiProperty({
    example: 24,
    description:
      'จำนวน (ไม่ติดลบ) — ทุกชนิดหมายถึง "จำนวนที่เคลื่อนไหว" ยกเว้น ADJUST ' +
      'ที่หมายถึง "ยอดคงเหลือที่นับได้จริง" ระบบจะคิดส่วนต่างให้เอง',
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  quantity: number;

  @ApiPropertyOptional({ example: 12.5, description: 'ต้นทุนต่อหน่วยของล็อตนี้' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  unitCost?: number;

  @ApiPropertyOptional({ example: 'รับจากซัพพลายเออร์ รอบเช้า' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
