import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { CostMethod, ItemUnit } from '@prisma/client';
import { PROCUREMENT_FIELD_KEYS, type ProcurementFieldKey } from '../product-change-fields';

/** ข้อมูลฝั่งคลังที่คลังยืนยันตอนอนุมัติคำขอสร้างสินค้าใหม่ */
export class WarehouseDataDto {
  @ApiProperty({ example: 'RT-MINERAL-500' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, { message: 'SKU ใช้ได้เฉพาะ A-Z 0-9 . _ -' })
  sku: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiProperty({ enum: ItemUnit, example: 'BOTTLE' })
  @IsEnum(ItemUnit)
  unit: ItemUnit;

  @ApiPropertyOptional({ example: 48 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minStock?: number;

  @ApiPropertyOptional({ example: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxStock?: number;

  @ApiPropertyOptional({ example: 72 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  reorderPoint?: number;

  @ApiPropertyOptional({ example: 120 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  reorderQty?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isPerishable?: boolean;

  @ApiPropertyOptional({ example: 365 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  defaultShelfLifeDays?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  requiresLotTracking?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  requiresQC?: boolean;

  @ApiPropertyOptional({ enum: CostMethod })
  @IsOptional()
  @IsEnum(CostMethod)
  costMethod?: CostMethod;
}

export class ApproveRequestDto {
  @ApiPropertyOptional({ type: WarehouseDataDto, description: 'บังคับสำหรับคำขอสร้างสินค้าใหม่' })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => WarehouseDataDto)
  warehouseData?: WarehouseDataDto;

  @ApiPropertyOptional({
    description: 'คำขอแก้ไข: ฟิลด์ที่ผ่าน (ไม่ส่ง = ผ่านทุกฟิลด์) ที่เหลือถือว่าไม่ผ่าน',
    example: ['unitPrice', 'leadDays'],
  })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(PROCUREMENT_FIELD_KEYS, { each: true })
  approvedFields?: ProcurementFieldKey[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class ReviewNoteDto {
  @ApiProperty({ example: 'ขอรูปสินค้า / สเปกเพิ่ม' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  note: string;
}

export class RejectRequestDto extends ReviewNoteDto {
  @ApiPropertyOptional({ description: 'ปฏิเสธเพราะซ้ำกับสินค้าเดิม — ให้จัดซื้อใช้ตัวนี้แทน' })
  @IsOptional()
  @IsUUID()
  duplicateOfItemId?: string;
}

export class CancelRequestDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
