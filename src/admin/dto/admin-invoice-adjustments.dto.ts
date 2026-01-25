import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNumber,
  IsOptional,
  IsEnum,
  IsBoolean,
  Min,
  IsInt,
} from 'class-validator';

// ============ Enums ============

export enum AdjustmentTypeDto {
  DISCOUNT = 'discount',
  CREDIT = 'credit',
  SURCHARGE = 'surcharge',
  PRORATION = 'proration',
}

// ============ Request DTOs ============

export class AdjustInvoiceDto {
  @ApiProperty({
    enum: AdjustmentTypeDto,
    description: 'Type of adjustment',
    example: 'discount',
  })
  @IsEnum(AdjustmentTypeDto)
  type: AdjustmentTypeDto;

  @ApiProperty({ description: 'Adjustment amount (positive number)', example: 500 })
  @IsNumber()
  @Min(0)
  amount: number;

  @ApiProperty({ description: 'Reason for adjustment' })
  @IsString()
  reason: string;

  @ApiPropertyOptional({ description: 'Additional notes' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ description: 'Generate Credit Memo reference', default: false })
  @IsOptional()
  @IsBoolean()
  generateCreditMemo?: boolean;
}

export class VoidInvoiceDto {
  @ApiProperty({ description: 'Reason for voiding the invoice' })
  @IsString()
  reason: string;

  @ApiPropertyOptional({ description: 'Create credit for paid amount', default: true })
  @IsOptional()
  @IsBoolean()
  createCredit?: boolean;

  @ApiPropertyOptional({ description: 'Additional notes' })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateInvoiceItemDto {
  @ApiPropertyOptional({ description: 'New quantity' })
  @IsOptional()
  @IsInt()
  @Min(0)
  quantity?: number;

  @ApiPropertyOptional({ description: 'New unit price' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  unitPrice?: number;

  @ApiPropertyOptional({ description: 'New description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'Reason for change' })
  @IsOptional()
  @IsString()
  reason?: string;
}

// ============ Response DTOs ============

export class AdjustmentItemDto {
  @ApiProperty({ example: 'uuid-1234' })
  id: string;

  @ApiProperty({ enum: ['discount', 'credit', 'surcharge', 'proration', 'void', 'refund'] })
  type: string;

  @ApiProperty({ example: 500 })
  amount: number;

  @ApiProperty({ example: 7470 })
  originalAmount: number;

  @ApiProperty({ example: 6970 })
  newAmount: number;

  @ApiPropertyOptional({ example: 'Customer loyalty discount' })
  reason?: string;

  @ApiPropertyOptional({ example: 'CM-2024-001' })
  creditMemoNo?: string;

  @ApiProperty({ example: '2024-01-25T10:30:00Z' })
  createdAt: string;

  @ApiPropertyOptional({ example: 'admin@staysync.io' })
  createdBy?: string;
}

export class InvoiceAdjustmentsListDto {
  @ApiProperty({ example: 'INV-2024-045' })
  invoiceNo: string;

  @ApiProperty({ example: 7470 })
  originalAmount: number;

  @ApiProperty({ example: 6970 })
  currentAmount: number;

  @ApiProperty({ example: -500 })
  totalAdjustment: number;

  @ApiProperty({ type: [AdjustmentItemDto] })
  adjustments: AdjustmentItemDto[];
}

export class AdjustInvoiceResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: 'Invoice adjusted successfully' })
  message: string;

  @ApiProperty()
  data: {
    invoiceNo: string;
    adjustmentType: string;
    adjustmentAmount: number;
    originalAmount: number;
    newAmount: number;
    creditMemoNo?: string;
  };
}

export class VoidInvoiceResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: 'Invoice voided successfully' })
  message: string;

  @ApiProperty()
  data: {
    invoiceNo: string;
    voidedAt: string;
    creditAmount?: number;
    creditCreated: boolean;
  };
}

export class UpdateInvoiceItemResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: 'Invoice item updated successfully' })
  message: string;

  @ApiProperty()
  data: {
    itemId: string;
    description: string;
    oldQuantity: number;
    newQuantity: number;
    oldUnitPrice: number;
    newUnitPrice: number;
    oldAmount: number;
    newAmount: number;
    invoiceTotalUpdated: number;
  };
}

// ============ Invoice Item Detail ============

export class InvoiceItemDetailDto {
  @ApiProperty({ example: 'uuid-1234' })
  id: string;

  @ApiProperty({ enum: ['plan', 'feature', 'adjustment'] })
  type: string;

  @ApiProperty({ example: 'Professional Plan - Monthly' })
  description: string;

  @ApiProperty({ example: 1 })
  quantity: number;

  @ApiProperty({ example: 4990 })
  unitPrice: number;

  @ApiProperty({ example: 4990 })
  amount: number;

  @ApiPropertyOptional({ example: 4990 })
  originalAmount?: number;

  @ApiProperty({ example: false })
  isAdjusted: boolean;
}

export class InvoiceWithItemsDto {
  @ApiProperty({ example: 'INV-2024-045' })
  invoiceNo: string;

  @ApiProperty({ example: 'โรงแรมสุขใจ' })
  hotelName: string;

  @ApiProperty({ example: 'pending' })
  status: string;

  @ApiProperty({ type: [InvoiceItemDetailDto] })
  items: InvoiceItemDetailDto[];

  @ApiProperty({ example: 7470 })
  subtotal: number;

  @ApiProperty({ example: -500 })
  totalAdjustments: number;

  @ApiProperty({ example: 6970 })
  total: number;

  @ApiProperty({ example: '2024-02-15' })
  dueDate: string;

  @ApiPropertyOptional()
  voidedAt?: string;
}
