import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { InvoiceStatus } from '../../invoices/entities/invoice.entity';

// ============ Query DTOs ============

export class AdminInvoicesQueryDto {
  @ApiPropertyOptional({
    description: 'Filter by invoice status',
    enum: InvoiceStatus,
  })
  @IsOptional()
  @IsEnum(InvoiceStatus)
  status?: InvoiceStatus;

  @ApiPropertyOptional({
    description: 'Search by invoice number, hotel name, or owner email',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Page number', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Items per page', default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 10;
}

// ============ Request DTOs ============

export enum AdminInvoiceStatusAction {
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

export class UpdateInvoiceStatusDto {
  @ApiProperty({
    description: 'New status for the invoice (approved or rejected)',
    enum: AdminInvoiceStatusAction,
    example: AdminInvoiceStatusAction.APPROVED,
  })
  @IsEnum(AdminInvoiceStatusAction)
  status: AdminInvoiceStatusAction;

  @ApiPropertyOptional({ description: 'Reason for rejection (if rejected)' })
  @IsOptional()
  @IsString()
  reason?: string;
}

// ============ Response DTOs ============

export class AdminInvoiceListItemDto {
  @ApiProperty({ example: 'INV-2024-045' })
  invoiceNumber: string;

  @ApiProperty({ example: 'โรงแรมสุขใจ' })
  hotelName: string;

  @ApiProperty({ example: 'somchai@email.com' })
  ownerEmail: string;

  @ApiProperty({ example: 'Professional +2 add-ons' })
  plan: string;

  @ApiProperty({ example: 7993 })
  amount: number;

  @ApiProperty({ enum: InvoiceStatus, example: InvoiceStatus.PENDING })
  status: InvoiceStatus;

  @ApiProperty({ example: '2024-01-10T14:30:00Z' })
  date: string;
}

export class AdminInvoicesListResponseDto {
  @ApiProperty({ example: 5 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 10 })
  limit: number;

  @ApiProperty({ type: [AdminInvoiceListItemDto] })
  data: AdminInvoiceListItemDto[];
}

export class AdminInvoicesSummaryDto {
  @ApiProperty({ example: 5 })
  total: number;

  @ApiProperty({ example: 3 })
  pending: number;

  @ApiProperty({ example: 1 })
  paid: number;

  @ApiProperty({ example: 1 })
  rejected: number;
}

export class AdminInvoiceDetailDto {
  @ApiProperty({ example: 'INV-2024-045' })
  invoiceNumber: string;

  @ApiProperty({ example: 'โรงแรมสุขใจ' })
  hotelName: string;

  @ApiProperty({ example: 'somchai@email.com' })
  ownerEmail: string;

  @ApiProperty({ example: 'Professional +2 add-ons' })
  plan: string;

  @ApiProperty({ example: 7993 })
  amount: number;

  @ApiProperty({ enum: InvoiceStatus, example: InvoiceStatus.PENDING })
  status: InvoiceStatus;

  @ApiPropertyOptional({
    example: 'https://cdn.staysync.io/payments/inv-2024-045.png',
  })
  paymentProof?: string;

  @ApiProperty({ example: '2024-01-10T14:30:00Z' })
  issuedAt: string;
}

export class InvoiceStatusUpdateResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: 'Invoice status updated successfully' })
  message: string;

  @ApiProperty({ enum: InvoiceStatus })
  newStatus: InvoiceStatus;
}
