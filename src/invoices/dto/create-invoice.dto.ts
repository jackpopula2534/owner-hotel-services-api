import {
  IsString,
  IsNumber,
  IsDateString,
  IsEnum,
  IsOptional,
  IsArray,
  IsInt,
  Min,
  Max,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { InvoiceStatus } from '../entities/invoice.entity';
import { InvoiceItemType } from '../../invoice-items/entities/invoice-item.entity';

/**
 * A single line on the invoice (plan, add-on/feature, or an adjustment such as
 * a coupon discount). `amount` is the line total and may be NEGATIVE for a
 * discount/adjustment row. These are persisted atomically with the invoice so
 * the printed tax invoice always shows the full breakdown.
 */
export class CreateInvoiceLineItemDto {
  @ApiProperty({ enum: InvoiceItemType, example: InvoiceItemType.PLAN })
  @IsEnum(InvoiceItemType)
  type: InvoiceItemType;

  @ApiProperty({ example: 'แพ็กเกจ Business (รายปี)' })
  @IsString()
  description: string;

  @ApiProperty({
    example: 25404,
    description: 'Line total in THB. Negative for discounts/adjustments (e.g. coupon).',
  })
  @IsNumber()
  amount: number;

  @ApiPropertyOptional({
    example: 25404,
    description: 'Unit price in THB. Defaults to `amount` when omitted.',
  })
  @IsNumber()
  @IsOptional()
  unitPrice?: number;

  @ApiPropertyOptional({ example: 1, default: 1 })
  @IsInt()
  @Min(1)
  @IsOptional()
  quantity?: number;

  @ApiPropertyOptional({ description: 'Optional reference id (plan id, addon code, coupon code).' })
  @IsString()
  @IsOptional()
  refId?: string;
}

export class CreateInvoiceDto {
  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'UUID of the tenant (hotel) for this invoice',
  })
  @IsString()
  tenantId: string;

  @ApiPropertyOptional({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'UUID of the subscription this invoice is for',
  })
  @IsString()
  @IsOptional()
  subscriptionId?: string;

  @ApiPropertyOptional({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'UUID of the booking this invoice is for (room reservation)',
  })
  @IsString()
  @IsOptional()
  bookingId?: string;

  @ApiProperty({
    example: 'INV-2026-001',
    description: 'Unique invoice number',
  })
  @IsString()
  invoiceNo: string;

  @ApiProperty({
    example: 4990,
    description:
      'Gross invoice amount in THB (VAT-inclusive). If `subtotal` is provided ' +
      'the total is derived from subtotal + VAT instead.',
  })
  @IsNumber()
  amount: number;

  @ApiPropertyOptional({
    example: 4663.55,
    description:
      'Pre-VAT base amount (THB). If provided, the gross total is computed as subtotal + VAT.',
  })
  @IsNumber()
  @IsOptional()
  subtotal?: number;

  @ApiPropertyOptional({
    example: 7,
    description:
      'VAT rate as a percentage. Defaults to 7 (Thai standard VAT). Use 0 for VAT-exempt.',
  })
  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  vatRate?: number;

  @ApiPropertyOptional({
    type: [CreateInvoiceLineItemDto],
    description:
      'Line items (plan, add-ons, coupon discount). Persisted atomically with the invoice ' +
      'so the printed tax invoice shows the full breakdown including discounts.',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateInvoiceLineItemDto)
  @IsOptional()
  items?: CreateInvoiceLineItemDto[];

  @ApiPropertyOptional({
    example: 'paid',
    description: 'Invoice status (pending, paid, overdue, rejected, cancelled)',
  })
  @IsEnum(InvoiceStatus)
  @IsOptional()
  status?: InvoiceStatus;

  @ApiProperty({
    example: '2026-04-01T00:00:00Z',
    description: 'Invoice due date (ISO 8601 string)',
  })
  // ต้องเป็น string — ถ้าประกาศ type เป็น Date ร่วมกับ global pipe
  // (transform:true + enableImplicitConversion:true) class-transformer จะ
  // แปลง ISO string ให้เป็น Date object ก่อน แล้ว @IsDateString จะ fail (400)
  @IsDateString()
  dueDate: string;
}
