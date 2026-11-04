import { IsOptional, IsString, IsInt, IsBoolean, IsEnum, Min, Max } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { InventoryItemTypeEnum } from './create-item.dto';

export enum SortField {
  CREATED_AT = 'createdAt',
  NAME = 'name',
  SKU = 'sku',
  TOTAL_STOCK = 'totalStock',
  REORDER_POINT = 'reorderPoint',
  UPDATED_AT = 'updatedAt',
}

/** สถานะสต็อกรวม (ตามคลังที่กรอง ถ้ามี) — นิยามเดียวกับ lowStock/summary: low = 0 < คงเหลือ < จุดสั่งซื้อ */
export enum StockStatusFilter {
  OK = 'ok',
  LOW = 'low',
  OUT = 'out',
}

/**
 * query string เป็นข้อความเสมอ และ main.ts เปิด enableImplicitConversion ไว้
 * `@Type(() => Boolean)` จึงแปลง "false" เป็น true (สตริงไม่ว่าง) — ตัวกรอง "ปิดใช้งาน" เลยได้ของที่เปิดอยู่
 * แปลงเองจากค่าตัวอักษรแทน
 */
const toQueryBoolean = ({
  obj,
  key,
  value: converted,
}: {
  obj: Record<string, unknown>;
  key: string;
  value: unknown;
}): unknown => {
  // implicit conversion รันก่อน @Transform และเปลี่ยน "false" เป็น true ไปแล้ว — อ่านค่าดิบจาก obj
  const value = obj?.[key] ?? converted;
  if (value === true || value === 'true' || value === '1') return true;
  if (value === false || value === 'false' || value === '0') return false;
  return value;
};

export enum SortOrder {
  ASC = 'asc',
  DESC = 'desc',
}

export class QueryItemDto {
  @ApiPropertyOptional({ description: 'Page number', example: 1, default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number;

  @ApiPropertyOptional({ description: 'Items per page', example: 20, default: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number;

  @ApiPropertyOptional({
    description: 'Search by name or SKU',
    example: 'Tomato',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Filter by category ID', example: 'uuid' })
  @IsOptional()
  @IsString()
  categoryId?: string;

  @ApiPropertyOptional({
    description:
      'Filter by warehouse ID — returns only items stocked in this warehouse, and totalStock reflects that warehouse only',
    example: 'uuid',
  })
  @IsOptional()
  @IsString()
  warehouseId?: string;

  @ApiPropertyOptional({
    description: 'Filter by active status',
    example: true,
  })
  @IsOptional()
  @Transform(toQueryBoolean)
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'Filter by perishable status',
    example: true,
  })
  @IsOptional()
  @Transform(toQueryBoolean)
  @IsBoolean()
  isPerishable?: boolean;

  @ApiPropertyOptional({
    enum: StockStatusFilter,
    description: 'กรองตามสถานะสต็อก: ok = ปกติ, low = ต่ำกว่าจุดสั่งซื้อ, out = หมด',
  })
  @IsOptional()
  @IsEnum(StockStatusFilter)
  stockStatus?: StockStatusFilter;

  @ApiPropertyOptional({
    description: 'true = เฉพาะสินค้าที่ยังไม่ตั้งจุดสั่งซื้อ (reorderPoint = 0)',
  })
  @IsOptional()
  @Transform(toQueryBoolean)
  @IsBoolean()
  noReorderPoint?: boolean;

  @ApiPropertyOptional({ description: 'true = เฉพาะสินค้าที่ยังไม่จัดหมวดหมู่' })
  @IsOptional()
  @Transform(toQueryBoolean)
  @IsBoolean()
  uncategorized?: boolean;

  @ApiPropertyOptional({
    enum: InventoryItemTypeEnum,
    description: 'กรองเฉพาะวัตถุดิบ หรือเฉพาะของสำเร็จรูปที่ขายหน้าร้านได้',
  })
  @IsOptional()
  @IsEnum(InventoryItemTypeEnum)
  itemType?: InventoryItemTypeEnum;

  @ApiPropertyOptional({
    enum: SortField,
    default: SortField.CREATED_AT,
    description: 'Field to sort by',
  })
  @IsOptional()
  @IsEnum(SortField)
  sort?: SortField;

  @ApiPropertyOptional({
    enum: SortOrder,
    default: SortOrder.DESC,
    description: 'Sort direction',
  })
  @IsOptional()
  @IsEnum(SortOrder)
  order?: SortOrder;
}
