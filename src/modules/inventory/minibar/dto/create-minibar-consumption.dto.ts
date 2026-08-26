import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * หนึ่งบรรทัด = สินค้าหนึ่งอย่างที่หายไปจากตู้
 *
 * ตั้งใจไม่มีช่องราคา — ราคามินิบาร์ตั้งไว้ที่ตัวสินค้าอยู่แล้ว ถ้าให้หน้าจอส่งราคามาเอง
 * แขกสองห้องที่หยิบของอย่างเดียวกันจะโดนคิดคนละราคาโดยไม่มีใครเห็น
 */
export class CreateMinibarConsumptionLineDto {
  @ApiProperty({ description: 'inventory item id ของสินค้าในตู้' })
  @IsString()
  @IsNotEmpty()
  itemId!: string;

  @ApiProperty({ description: 'จำนวนที่หยิบไป', minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity!: number;
}

export class CreateMinibarConsumptionDto {
  @ApiProperty({ description: 'การจองที่จะรับผิดชอบค่าใช้จ่ายนี้' })
  @IsString()
  @IsNotEmpty()
  bookingId!: string;

  @ApiPropertyOptional({ description: 'ระบุคลังต้นทางเอง เมื่อไม่ได้แยกคลังมินิบาร์ไว้' })
  @IsOptional()
  @IsString()
  warehouseId?: string;

  @ApiProperty({ type: [CreateMinibarConsumptionLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateMinibarConsumptionLineDto)
  lines!: CreateMinibarConsumptionLineDto[];

  @ApiPropertyOptional({ description: 'อัตรา VAT (%)', default: 7 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  vatRate?: number;

  @ApiPropertyOptional({ description: 'หมายเหตุ เช่น พบตอนทำความสะอาดรอบเช้า' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
