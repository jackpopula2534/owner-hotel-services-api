import {
  IsString,
  IsOptional,
  IsISO8601,
  IsArray,
  ValidateNested,
  IsNumber,
  IsEnum,
  Min,
  Max,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { DiscountMode, DiscountType } from '@/common/purchase-order/po-calculation';

export const DISCOUNT_MODES = ['BEFORE_VAT', 'AFTER_VAT'] as const;
export const DISCOUNT_TYPES = ['PERCENT', 'AMOUNT'] as const;

export class PurchaseOrderItemDto {
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
      'Discount value — interpreted as percent (0-100) when discountType=PERCENT, or as absolute amount (in currency) when discountType=AMOUNT',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  discount?: number;

  @ApiPropertyOptional({
    enum: DISCOUNT_TYPES,
    default: 'PERCENT',
    description: 'Whether the line discount is a percentage or a fixed amount in currency',
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

export class CreatePurchaseOrderDto {
  @ApiPropertyOptional({
    example: '123e4567-e89b-12d3-a456-426614174000',
    description: 'Property ID (auto-resolved from tenant if not provided)',
  })
  @IsOptional()
  @IsString()
  propertyId?: string;

  @ApiProperty({
    example: '123e4567-e89b-12d3-a456-426614174001',
    description: 'Supplier ID',
  })
  @IsString()
  supplierId: string;

  @ApiProperty({
    example: '123e4567-e89b-12d3-a456-426614174002',
    description: 'Target warehouse ID for delivery',
  })
  @IsString()
  warehouseId: string;

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
    example: 'QT-202604-0001',
    description: 'Quotation number (เลขที่ใบเสนอราคา)',
  })
  @IsOptional()
  @IsString()
  quotationNumber?: string;

  @ApiPropertyOptional({
    example: '2026-04-10',
    description: 'Quotation date (ISO 8601)',
  })
  @IsOptional()
  @IsISO8601()
  quotationDate?: string;

  @ApiPropertyOptional({
    example: '123e4567-e89b-12d3-a456-426614174999',
    description: 'Purchase requisition ID (link to PR)',
  })
  @IsOptional()
  @IsString()
  purchaseRequisitionId?: string;

  @ApiPropertyOptional({
    example: 'NET 30',
    description:
      'Payment terms for this PO (e.g. "COD", "NET 30"). If omitted, the service falls back to Supplier.paymentTerms.',
  })
  @IsOptional()
  @IsString()
  paymentTerms?: string;

  @ApiPropertyOptional({
    example: '99/9 ถนนราชดำริ แขวงลุมพินี เขตปทุมวัน กรุงเทพมหานคร 10330',
    description:
      'Ship-to address for this PO. If omitted, the service falls back to the warehouse address, then the tenant address.',
  })
  @IsOptional()
  @IsString()
  deliveryAddress?: string;

  // ─── Discount / VAT configuration ────────────────────────────
  @ApiPropertyOptional({
    enum: DISCOUNT_MODES,
    default: 'BEFORE_VAT',
    description:
      'Discount vs VAT order. BEFORE_VAT (default) — discounts reduce VAT base. AFTER_VAT — VAT computed on gross then discounts applied post-tax.',
  })
  @IsOptional()
  @IsEnum(DISCOUNT_MODES)
  discountMode?: DiscountMode;

  @ApiPropertyOptional({
    example: 500,
    description: 'Header-level discount value (interpreted based on headerDiscountType)',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  headerDiscount?: number;

  @ApiPropertyOptional({
    enum: DISCOUNT_TYPES,
    default: 'AMOUNT',
    description: 'Whether headerDiscount is a percentage (0-100) or absolute amount',
  })
  @IsOptional()
  @IsEnum(DISCOUNT_TYPES)
  headerDiscountType?: DiscountType;

  @ApiProperty({
    type: [PurchaseOrderItemDto],
    description: 'Array of items to order (minimum 1 item)',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PurchaseOrderItemDto)
  items: PurchaseOrderItemDto[];
}
