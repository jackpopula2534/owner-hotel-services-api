import {
  IsOptional,
  IsISO8601,
  IsArray,
  ValidateNested,
  IsNumber,
  IsString,
  IsEnum,
  Min,
  Max,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { DiscountMode, DiscountType } from '@/common/purchase-order/po-calculation';
import { DISCOUNT_MODES, DISCOUNT_TYPES } from './create-purchase-order.dto';

export class UpdatePurchaseOrderItemDto {
  @ApiProperty({
    example: '123e4567-e89b-12d3-a456-426614174000',
    description: 'Inventory item ID',
  })
  @IsString()
  itemId: string;

  @ApiProperty({ example: 5, description: 'Quantity to order (minimum 1)' })
  @IsNumber()
  @Min(1)
  quantity: number;

  @ApiProperty({ example: 250.5, description: 'Unit price per item' })
  @IsNumber()
  @Min(0)
  unitPrice: number;

  @ApiPropertyOptional({
    example: 10,
    description:
      'Discount value — interpreted based on discountType (percent 0-100 or absolute amount)',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  discount?: number;

  @ApiPropertyOptional({
    enum: DISCOUNT_TYPES,
    default: 'PERCENT',
    description: 'Whether discount is percentage or absolute amount',
  })
  @IsOptional()
  @IsEnum(DISCOUNT_TYPES)
  discountType?: DiscountType;

  @ApiPropertyOptional({
    example: 7,
    description: 'Tax rate percentage (0-100)',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  taxRate?: number;

  @ApiPropertyOptional({
    example: 'High-quality linens',
    description: 'Item-specific notes',
  })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdatePurchaseOrderDto {
  @ApiPropertyOptional({
    example: '2026-05-01',
    description: 'Expected delivery date (ISO 8601)',
  })
  @IsOptional()
  @IsISO8601()
  expectedDate?: string;

  @ApiPropertyOptional({
    example: 'Urgent order for kitchen supplies',
    description: 'Public notes visible to suppliers',
  })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({
    example: 'Follow up on delivery status by phone',
    description: 'Internal notes for hotel staff only',
  })
  @IsOptional()
  @IsString()
  internalNotes?: string;

  @ApiPropertyOptional({
    example: 'NET 30',
    description: 'Payment terms — overrides supplier default for this PO',
  })
  @IsOptional()
  @IsString()
  paymentTerms?: string;

  @ApiPropertyOptional({
    example: '99/9 ถนนราชดำริ แขวงลุมพินี เขตปทุมวัน กรุงเทพมหานคร 10330',
    description: 'Ship-to address for this PO',
  })
  @IsOptional()
  @IsString()
  deliveryAddress?: string;

  @ApiPropertyOptional({
    enum: DISCOUNT_MODES,
    description:
      'Discount vs VAT order. BEFORE_VAT (default) — discounts reduce VAT base. AFTER_VAT — VAT computed first, discounts applied post-tax.',
  })
  @IsOptional()
  @IsEnum(DISCOUNT_MODES)
  discountMode?: DiscountMode;

  @ApiPropertyOptional({
    example: 500,
    description: 'Header-level discount value',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  headerDiscount?: number;

  @ApiPropertyOptional({
    enum: DISCOUNT_TYPES,
    description: 'Whether headerDiscount is percentage or absolute amount',
  })
  @IsOptional()
  @IsEnum(DISCOUNT_TYPES)
  headerDiscountType?: DiscountType;

  @ApiProperty({
    type: [UpdatePurchaseOrderItemDto],
    description: 'Array of items to order (minimum 1 item). Replaces all existing items.',
    required: false,
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => UpdatePurchaseOrderItemDto)
  items?: UpdatePurchaseOrderItemDto[];
}
