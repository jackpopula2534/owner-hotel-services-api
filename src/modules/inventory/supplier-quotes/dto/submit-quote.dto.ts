import {
  IsOptional,
  IsString,
  IsNumber,
  IsISO8601,
  IsInt,
  Min,
  Max,
  ValidateNested,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsBoolean,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { DiscountMode, DiscountType } from '@/common/purchase-order/po-calculation';
import {
  DISCOUNT_MODES,
  DISCOUNT_TYPES,
} from '../../purchase-orders/dto/create-purchase-order.dto';

export class SubmitQuoteItemDto {
  @ApiProperty({
    example: '123e4567-e89b-12d3-a456-426614174000',
    description: 'Inventory item ID',
  })
  @IsString()
  itemId: string;

  @ApiProperty({
    example: 10,
    description: 'Quantity ordered',
  })
  @IsNumber()
  @Min(1)
  quantity: number;

  @ApiProperty({
    example: 99.99,
    description: 'Unit price',
  })
  @IsNumber()
  @Min(0)
  unitPrice: number;

  @ApiProperty({
    example: 5,
    description:
      'Discount value — percent (0-100) when discountType=PERCENT, absolute amount when discountType=AMOUNT',
    required: false,
    default: 0,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  discount?: number;

  @ApiPropertyOptional({
    enum: DISCOUNT_TYPES,
    default: 'PERCENT',
    description: 'Whether the line discount is a percentage or a fixed amount',
  })
  @IsOptional()
  @IsEnum(DISCOUNT_TYPES)
  discountType?: DiscountType;

  @ApiProperty({
    example: 7,
    description: 'Tax rate percentage (0-100)',
    required: false,
    default: 7,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  taxRate?: number;

  @ApiProperty({
    example: 5,
    description: 'Lead time in days',
    required: false,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  leadTimeDays?: number;

  @ApiProperty({
    example: 'Standard packaging included',
    description: 'Item-specific notes',
    required: false,
  })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class SubmitQuoteDto {
  @ApiProperty({
    example: 'Q-2026-04-001',
    description: 'Quote number from supplier',
    required: false,
  })
  @IsOptional()
  @IsString()
  quoteNumber?: string;

  @ApiProperty({
    example: '2026-04-15T10:30:00Z',
    description: 'Date quote was provided (ISO 8601)',
    required: false,
  })
  @IsOptional()
  @IsISO8601()
  quotedDate?: string;

  @ApiProperty({
    example: '2026-05-15T23:59:59Z',
    description: 'Date quote expires (ISO 8601)',
    required: false,
  })
  @IsOptional()
  @IsISO8601()
  validUntil?: string;

  @ApiProperty({
    example: 7,
    description: 'Delivery days',
    required: false,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  deliveryDays?: number;

  @ApiProperty({
    example: 'Net 30 days',
    description: 'Payment terms',
    required: false,
  })
  @IsOptional()
  @IsString()
  paymentTerms?: string;

  @ApiProperty({
    example: 'Free delivery for orders above 10,000 THB',
    description: 'General notes about the quote',
    required: false,
  })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiProperty({
    example: 'https://example.com/quote-file.pdf',
    description: 'URL to quote attachment',
    required: false,
  })
  @IsOptional()
  @IsString()
  attachmentUrl?: string;

  // ─── Discount / VAT configuration (parity with PurchaseOrder) ───
  @ApiPropertyOptional({
    enum: DISCOUNT_MODES,
    default: 'BEFORE_VAT',
    description: 'Discount vs VAT order (ignored when pricesIncludeVat=true)',
  })
  @IsOptional()
  @IsEnum(DISCOUNT_MODES)
  discountMode?: DiscountMode;

  @ApiPropertyOptional({
    example: 500,
    description: 'Header-level (end-of-bill) discount value',
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

  @ApiPropertyOptional({
    example: false,
    default: false,
    description: 'True when unit prices already include VAT (ราคารวม VAT แล้ว)',
  })
  @IsOptional()
  @IsBoolean()
  pricesIncludeVat?: boolean;

  @ApiProperty({
    type: [SubmitQuoteItemDto],
    description: 'Quote line items',
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'items ต้องมีอย่างน้อย 1 รายการ' })
  @ValidateNested({ each: true })
  @Type(() => SubmitQuoteItemDto)
  items: SubmitQuoteItemDto[];
}
