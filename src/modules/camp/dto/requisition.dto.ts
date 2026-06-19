import {
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCampRequisitionItemDto {
  @ApiProperty({ description: 'Inventory item id (Inventory Module)' })
  @IsNotEmpty()
  @IsString()
  inventoryItemId: string;

  @ApiPropertyOptional({ description: 'Camp addon id to replenish (optional)' })
  @IsOptional()
  @IsString()
  addonId?: string;

  @ApiProperty({ description: 'Display name snapshot' })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiPropertyOptional({ description: 'SKU snapshot' })
  @IsOptional()
  @IsString()
  sku?: string;

  @ApiProperty({ description: 'Quantity', minimum: 1 })
  @IsInt()
  @Min(1)
  qty: number;

  @ApiPropertyOptional({ description: 'Unit cost snapshot' })
  @IsOptional()
  @IsNumber()
  unitCost?: number;
}

export class CreateCampRequisitionDto {
  @ApiProperty({ description: 'Campground id' })
  @IsNotEmpty()
  @IsString()
  campgroundId: string;

  @ApiProperty({
    description: 'issue = ใบเบิก (GOODS_ISSUE), transfer = ใบโอนเข้าคลังลาน',
    enum: ['issue', 'transfer'],
  })
  @IsIn(['issue', 'transfer'])
  type: 'issue' | 'transfer';

  @ApiProperty({ description: 'Source warehouse id (เบิก/โอนออกจากคลังนี้)' })
  @IsNotEmpty()
  @IsString()
  sourceWarehouseId: string;

  @ApiPropertyOptional({ description: 'Notes' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiProperty({ type: [CreateCampRequisitionItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateCampRequisitionItemDto)
  items: CreateCampRequisitionItemDto[];
}
