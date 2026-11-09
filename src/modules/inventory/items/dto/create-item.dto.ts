import {
  IsNotEmpty,
  IsString,
  IsOptional,
  IsInt,
  IsNumber,
  IsEnum,
  IsBoolean,
  Min,
  IsUrl,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export enum ItemUnitEnum {
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

export enum CostMethodEnum {
  FIFO = 'FIFO',
  WEIGHTED_AVG = 'WEIGHTED_AVG',
}

/** วัตถุดิบที่ต้องแปรรูป vs ของสำเร็จรูปที่หยิบขายได้เลย */
export enum InventoryItemTypeEnum {
  RAW_MATERIAL = 'RAW_MATERIAL',
  FINISHED_GOOD = 'FINISHED_GOOD',
}

export class CreateItemDto {
  @ApiProperty({ description: 'Stock Keeping Unit (unique per tenant)', example: 'SKU-001' })
  @IsNotEmpty()
  @IsString()
  sku: string;

  @ApiProperty({ description: 'Item name', example: 'Tomato Fresh' })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiPropertyOptional({ description: 'Item description', example: 'Fresh red tomatoes' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'Category ID', example: 'uuid' })
  @IsOptional()
  @IsString()
  categoryId?: string;

  @ApiPropertyOptional({ enum: ItemUnitEnum, default: ItemUnitEnum.PIECE })
  @IsOptional()
  @IsEnum(ItemUnitEnum)
  unit?: ItemUnitEnum;

  @ApiPropertyOptional({ enum: CostMethodEnum, default: CostMethodEnum.WEIGHTED_AVG })
  @IsOptional()
  @IsEnum(CostMethodEnum)
  costMethod?: CostMethodEnum;

  @ApiPropertyOptional({
    enum: InventoryItemTypeEnum,
    default: InventoryItemTypeEnum.RAW_MATERIAL,
    description: 'FINISHED_GOOD = ขายหน้าร้านได้ ผูกเป็นเมนูได้',
  })
  @IsOptional()
  @IsEnum(InventoryItemTypeEnum)
  itemType?: InventoryItemTypeEnum;

  @ApiPropertyOptional({
    description: 'ราคาขายแนะนำต่อหน่วย (ใช้ตั้งราคาเมนูและคิดกำไรต่อชิ้น)',
    example: 20,
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  sellingPrice?: number;

  @ApiPropertyOptional({
    description: 'Reorder point (minimum quantity before alert)',
    example: 10,
    default: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  reorderPoint?: number;

  @ApiPropertyOptional({
    description: 'Suggested reorder quantity',
    example: 50,
    default: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  reorderQty?: number;

  @ApiPropertyOptional({ description: 'Maximum stock level', example: 200 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  maxStock?: number;

  @ApiPropertyOptional({
    description: 'Minimum stock level',
    example: 5,
    default: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  minStock?: number;

  @ApiPropertyOptional({ description: 'Barcode', example: '1234567890123' })
  @IsOptional()
  @IsString()
  barcode?: string;

  @ApiPropertyOptional({ description: 'Brand name', example: 'Fresh Farm Co.' })
  @IsOptional()
  @IsString()
  brand?: string;

  @ApiPropertyOptional({ description: 'Item image URL' })
  @IsOptional()
  @IsUrl()
  imageUrl?: string;

  @ApiPropertyOptional({
    description: 'Whether item is perishable',
    example: true,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isPerishable?: boolean;

  @ApiPropertyOptional({
    description: 'Default shelf life in days (for perishable items)',
    example: 7,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  defaultShelfLifeDays?: number;
}
