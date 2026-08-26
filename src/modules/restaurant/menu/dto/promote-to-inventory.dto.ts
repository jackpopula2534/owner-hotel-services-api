import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

/** หน่วยนับที่ระบบคลังรองรับ — ต้องตรงกับ enum ItemUnit ใน Prisma */
export enum PromoteItemUnitEnum {
  PIECE = 'PIECE',
  BOX = 'BOX',
  PACK = 'PACK',
  KG = 'KG',
  G = 'G',
  L = 'L',
  ML = 'ML',
  BOTTLE = 'BOTTLE',
  CAN = 'CAN',
  BAG = 'BAG',
  ROLL = 'ROLL',
  SET = 'SET',
  PAIR = 'PAIR',
  SHEET = 'SHEET',
  METER = 'METER',
  DOZEN = 'DOZEN',
}

/**
 * ย้ายเมนูที่นับสต๊อกเอง เข้าไปให้คลังกลางเป็นเจ้าของยอด
 * ทุกช่องเป็น optional — ไม่ส่งอะไรมาเลยระบบเดาให้ได้ทั้งหมด
 */
export class PromoteToInventoryDto {
  @ApiPropertyOptional({ description: 'คลังปลายทาง — ไม่ระบุจะใช้คลังของร้าน แล้วไล่ครัว/คลังตั้งต้น' })
  @IsOptional()
  @IsString()
  warehouseId?: string;

  @ApiPropertyOptional({ description: 'รหัสสินค้า — ไม่ระบุจะออกให้อัตโนมัติเป็น RTL-YYYYMM-NNNN' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  sku?: string;

  @ApiPropertyOptional({ description: 'หมวดสินค้าในระบบคลัง' })
  @IsOptional()
  @IsString()
  categoryId?: string;

  @ApiPropertyOptional({ enum: PromoteItemUnitEnum, default: PromoteItemUnitEnum.PIECE })
  @IsOptional()
  @IsEnum(PromoteItemUnitEnum)
  unit?: PromoteItemUnitEnum;
}
