import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { InventoryItemType, ItemUnit } from '@prisma/client';

/** ค่าฝั่งคลังที่จัดซื้อ "เสนอ" — คลังยืนยันหรือแก้ตอนอนุมัติ */
export class SuggestedWarehouseDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ enum: ItemUnit, example: 'BOTTLE' })
  @IsOptional()
  @IsEnum(ItemUnit)
  unit?: ItemUnit;

  @ApiPropertyOptional({ example: 48 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minStock?: number;

  @ApiPropertyOptional({ example: 240 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxStock?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isPerishable?: boolean;
}

/** ข้อมูลสินค้า + การจัดซื้อ ที่จัดซื้อกรอกตอนขอสร้างสินค้าใหม่ */
export class NewItemProposalDto {
  @ApiProperty({ example: 'น้ำแร่ธรรมชาติ 500ml' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(191)
  name: string;

  @ApiPropertyOptional({ example: '500 ml / ขวด PET' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(191)
  brand?: string;

  @ApiPropertyOptional({ example: '8850001000011' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  barcode?: string;

  @ApiPropertyOptional({ enum: InventoryItemType })
  @IsOptional()
  @IsEnum(InventoryItemType)
  itemType?: InventoryItemType;

  @ApiPropertyOptional({ description: 'Supplier หลัก' })
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @ApiPropertyOptional({
    example: 5.5,
    description:
      'ราคาซื้อต่อหน่วยนับคลัง (เหมือน item_suppliers.unitPrice เดิม — PO/reorder ใช้ค่านี้ตรงๆ)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  unitPrice?: number;

  @ApiPropertyOptional({ enum: ItemUnit, example: 'BOX' })
  @IsOptional()
  @IsEnum(ItemUnit)
  purchaseUnit?: ItemUnit;

  @ApiPropertyOptional({ example: 24, description: '1 หน่วยซื้อ = N หน่วยนับคลัง' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  purchaseUnitFactor?: number;

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minOrderQty?: number;

  @ApiPropertyOptional({ example: 3 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  leadDays?: number;
}

export class CreateNewItemRequestDto {
  @ApiProperty({ type: NewItemProposalDto })
  @IsObject()
  @ValidateNested()
  @Type(() => NewItemProposalDto)
  proposal: NewItemProposalDto;

  @ApiPropertyOptional({ type: SuggestedWarehouseDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => SuggestedWarehouseDto)
  suggestedWarehouse?: SuggestedWarehouseDto;

  @ApiPropertyOptional({ example: 'ห้องพักชั้น Deluxe เปลี่ยนเป็นน้ำแร่' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;

  @ApiPropertyOptional({ example: 'PR-202610-0031' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  prReference?: string;

  @ApiPropertyOptional({ example: '2026-11-05' })
  @IsOptional()
  @IsDateString()
  neededBy?: string;
}

/**
 * ค่าใหม่ของข้อมูลฝั่งจัดซื้อ — ส่งมาเฉพาะฟิลด์ที่ต้องการเปลี่ยน
 * ส่ง null = ล้างค่า, ไม่ส่ง = ไม่แตะ
 */
export class ProcurementChangesDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(191)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(191)
  brand?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  preferredSupplierId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  unitPrice?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minOrderQty?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  leadDays?: number | null;

  @ApiPropertyOptional({ enum: ItemUnit })
  @IsOptional()
  @IsEnum(ItemUnit)
  purchaseUnit?: ItemUnit | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  purchaseUnitFactor?: number | null;
}

export class CreateItemUpdateRequestDto {
  @ApiProperty()
  @IsUUID()
  itemId: string;

  @ApiProperty({ type: ProcurementChangesDto })
  @IsObject()
  @ValidateNested()
  @Type(() => ProcurementChangesDto)
  changes: ProcurementChangesDto;

  @ApiProperty({ example: 'Supplier เดิมขึ้นราคา' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  reason: string;

  @ApiPropertyOptional({
    example: '2026-11-01',
    description: 'วันที่ให้ค่าใหม่มีผล (ว่าง = มีผลทันทีที่คลังอนุมัติ)',
  })
  @IsOptional()
  @IsDateString()
  effectiveDate?: string;
}

/** ส่งคำขอกลับไปใหม่หลังคลัง "ขอข้อมูลเพิ่ม" — ใช้ชนิดเดียวกับตอนสร้าง */
export class ResubmitRequestDto {
  @ApiPropertyOptional({ type: NewItemProposalDto, description: 'CREATE เท่านั้น' })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => NewItemProposalDto)
  proposal?: NewItemProposalDto;

  @ApiPropertyOptional({ type: SuggestedWarehouseDto, description: 'CREATE เท่านั้น' })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => SuggestedWarehouseDto)
  suggestedWarehouse?: SuggestedWarehouseDto;

  @ApiPropertyOptional({ type: ProcurementChangesDto, description: 'UPDATE เท่านั้น' })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ProcurementChangesDto)
  changes?: ProcurementChangesDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  effectiveDate?: string;

  @ApiPropertyOptional({ description: 'ข้อความตอบคลัง' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
