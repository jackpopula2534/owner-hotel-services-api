import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
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
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** One menu the kitchen wants to be able to cook, and how many plates of it. */
export class RequisitionTargetDto {
  @ApiProperty({ description: 'Menu item ID that owns the recipe' })
  @IsNotEmpty()
  @IsString()
  menuItemId: string;

  @ApiProperty({ description: 'จำนวนจานที่ต้องการทำได้', minimum: 1 })
  @IsInt()
  @Min(1)
  plates: number;
}

export class PlanRecipeRequisitionDto {
  @ApiPropertyOptional({ description: 'จำกัดเมนูเฉพาะร้านนี้' })
  @IsOptional()
  @IsString()
  restaurantId?: string;

  @ApiPropertyOptional({
    description: 'คลังต้นทางที่จะเบิก — เว้นว่างให้ระบบเลือกคลังหลักให้',
  })
  @IsOptional()
  @IsString()
  sourceWarehouseId?: string;

  @ApiProperty({ type: [RequisitionTargetDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => RequisitionTargetDto)
  targets: RequisitionTargetDto[];
}

/**
 * A line the user kept after editing the draft.
 *
 * `quantity` is an integer because `StockMovement.quantity` is — the plan
 * endpoint already rounds the fractional requirement up for exactly this reason.
 */
export class RequisitionLineDto {
  @ApiProperty({ description: 'Inventory item ID' })
  @IsNotEmpty()
  @IsString()
  itemId: string;

  @ApiProperty({ description: 'จำนวนที่เบิกจริง (จำนวนเต็ม)', minimum: 1 })
  @IsInt()
  @Min(1)
  quantity: number;

  @ApiPropertyOptional({
    description:
      'ปริมาณจริงตามสูตร (ทศนิยมได้) — เก็บไว้ในเอกสารเพื่อให้ยังเห็นว่าปัดขึ้นจากเท่าไร',
    minimum: 0,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  requiredQty?: number;
}

export class SubmitRecipeRequisitionDto {
  @ApiPropertyOptional({
    description:
      'issue = ส่งเข้าระบบคลังทันที (ของต้องพอ) · reserve = พักใบเบิกไว้รอของเข้า',
    enum: ['issue', 'reserve'],
    default: 'issue',
  })
  @IsOptional()
  @IsIn(['issue', 'reserve'])
  action?: 'issue' | 'reserve';

  @ApiPropertyOptional({
    description: 'reserve เท่านั้น — เปิดใบขอซื้อให้จัดซื้อสำหรับส่วนที่ขาดด้วย',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  createPurchaseRequisition?: boolean;

  @ApiPropertyOptional({ description: 'วันที่ต้องการของ (ใช้กับใบขอซื้อ)' })
  @IsOptional()
  @IsDateString()
  requiredDate?: string;

  @ApiProperty({
    description:
      'transfer = โอนจากคลังต้นทางเข้าคลังครัว · issue = ตัดออกจากคลังต้นทางเลย (ไม่มีคลังครัวแยก)',
    enum: ['transfer', 'issue'],
  })
  @IsIn(['transfer', 'issue'])
  mode: 'transfer' | 'issue';

  @ApiProperty({ description: 'คลังต้นทางที่เบิกของออก' })
  @IsNotEmpty()
  @IsString()
  sourceWarehouseId: string;

  @ApiPropertyOptional({ description: 'คลังครัวปลายทาง — จำเป็นเมื่อ mode = transfer' })
  @IsOptional()
  @IsString()
  toWarehouseId?: string;

  @ApiPropertyOptional({ description: 'ร้านที่เบิกให้ (ใช้ประกอบหมายเหตุ)' })
  @IsOptional()
  @IsString()
  restaurantId?: string;

  @ApiPropertyOptional({ description: 'หมายเหตุใบเบิก' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @ApiProperty({ type: [RequisitionLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => RequisitionLineDto)
  lines: RequisitionLineDto[];
}

export class ListMaterialRequisitionsDto {
  @ApiPropertyOptional({
    description:
      'กรองตามสถานะ — เว้นว่าง = เฉพาะใบที่ยังค้างอยู่ (รอของ + พร้อมเบิก), ALL = รวมประวัติทั้งหมด',
    enum: ['WAITING_STOCK', 'READY', 'ISSUED', 'CANCELLED', 'ALL'],
  })
  @IsOptional()
  @IsIn(['WAITING_STOCK', 'READY', 'ISSUED', 'CANCELLED', 'ALL'])
  status?: 'WAITING_STOCK' | 'READY' | 'ISSUED' | 'CANCELLED' | 'ALL';

  @ApiPropertyOptional({ description: 'จำกัดเฉพาะร้านนี้' })
  @IsOptional()
  @IsString()
  restaurantId?: string;

  @ApiPropertyOptional({ description: 'ค้นหาจากเลขใบเบิก หรือเลขใบขอซื้อที่ผูกไว้' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ description: 'จำนวนใบสูงสุดที่คืน (1–100)', default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class CancelMaterialRequisitionDto {
  @ApiPropertyOptional({ description: 'เหตุผลที่ยกเลิก' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
