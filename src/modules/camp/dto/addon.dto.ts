import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

const ADDON_CATEGORIES = [
  'tent',
  'sleeping',
  'gear',
  'cooking',
  'firewood',
  'electric',
  'other',
] as const;

export class CreateAddonDto {
  @ApiProperty()
  @IsString()
  @MaxLength(36)
  campgroundId!: string;

  @ApiProperty({ example: 'เต็นท์ 3 คน' })
  @IsString()
  @MaxLength(150)
  name!: string;

  @ApiPropertyOptional({ enum: ADDON_CATEGORIES, default: 'other' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  category?: string;

  @ApiPropertyOptional({ example: 'เต็นท์โดมกันน้ำ พื้นที่ 3x3 ม. พร้อมฟลายชีท' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({ example: 300 })
  @IsNumber()
  @Min(0)
  pricePerUnit!: number;

  @ApiPropertyOptional({ example: 'ชิ้น', default: 'ชิ้น' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  unit?: string;

  @ApiPropertyOptional({ example: 500, description: 'ค่ามัดจำต่อหน่วย' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  deposit?: number;

  @ApiPropertyOptional({ type: [String], description: 'รายการ URL รูปภาพอุปกรณ์' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  images?: string[];

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  stockQty?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({
    description: 'Inventory item id from Inventory Module used to replenish this addon',
  })
  @IsOptional()
  @IsString()
  @MaxLength(36)
  inventoryItemId?: string;
}

export class UpdateAddonDto extends PartialType(CreateAddonDto) {}
