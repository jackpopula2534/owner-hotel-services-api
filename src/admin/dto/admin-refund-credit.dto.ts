import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNumber,
  IsOptional,
  IsEnum,
  IsBoolean,
  IsDateString,
  Min,
} from 'class-validator';

// ============ Enums ============

export enum RefundMethodDto {
  ORIGINAL_METHOD = 'original_method',
  BANK_TRANSFER = 'bank_transfer',
  CREDIT = 'credit',
}

export enum CreditTypeDto {
  MANUAL = 'manual',
  REFUND = 'refund',
  PRORATION = 'proration',
  PROMOTION = 'promotion',
  CANCELLATION = 'cancellation',
}

// ============ Request DTOs ============

export class CreateRefundDto {
  @ApiProperty({ description: 'Refund amount' })
  @IsNumber()
  @Min(0.01)
  amount: number;

  @ApiProperty({ description: 'Reason for refund' })
  @IsString()
  reason: string;

  @ApiProperty({
    enum: RefundMethodDto,
    description: 'Refund method',
    default: 'credit',
  })
  @IsEnum(RefundMethodDto)
  method: RefundMethodDto;

  @ApiPropertyOptional({ description: 'Bank account number (if bank transfer)' })
  @IsOptional()
  @IsString()
  bankAccount?: string;

  @ApiPropertyOptional({ description: 'Bank name (if bank transfer)' })
  @IsOptional()
  @IsString()
  bankName?: string;

  @ApiPropertyOptional({ description: 'Account holder name (if bank transfer)' })
  @IsOptional()
  @IsString()
  accountHolder?: string;

  @ApiPropertyOptional({ description: 'Additional notes' })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateCreditDto {
  @ApiProperty({ description: 'Credit amount' })
  @IsNumber()
  @Min(0.01)
  amount: number;

  @ApiProperty({
    enum: CreditTypeDto,
    description: 'Credit type',
    default: 'manual',
  })
  @IsEnum(CreditTypeDto)
  type: CreditTypeDto;

  @ApiProperty({ description: 'Description/reason for credit' })
  @IsString()
  description: string;

  @ApiPropertyOptional({ description: 'Credit expiration date' })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @ApiPropertyOptional({ description: 'Reference type (invoice, payment, etc.)' })
  @IsOptional()
  @IsString()
  referenceType?: string;

  @ApiPropertyOptional({ description: 'Reference ID' })
  @IsOptional()
  @IsString()
  referenceId?: string;
}

export class ApplyCreditDto {
  @ApiPropertyOptional({ description: 'Specific credit ID to use (optional)' })
  @IsOptional()
  @IsString()
  creditId?: string;

  @ApiPropertyOptional({ description: 'Amount to apply (default: full invoice amount)' })
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  amount?: number;

  @ApiPropertyOptional({ description: 'Use oldest credits first', default: true })
  @IsOptional()
  @IsBoolean()
  useOldestFirst?: boolean;
}

export class ProcessRefundDto {
  @ApiProperty({ enum: ['approved', 'rejected'], description: 'Action' })
  @IsEnum(['approved', 'rejected'])
  action: 'approved' | 'rejected';

  @ApiPropertyOptional({ description: 'Reason for rejection' })
  @IsOptional()
  @IsString()
  rejectedReason?: string;

  @ApiPropertyOptional({ description: 'Notes' })
  @IsOptional()
  @IsString()
  notes?: string;
}

// ============ Response DTOs ============

export class CreditItemDto {
  @ApiProperty({ example: 'uuid-1234' })
  id: string;

  @ApiProperty({ enum: ['manual', 'refund', 'proration', 'promotion', 'cancellation'] })
  type: string;

  @ApiProperty({ enum: ['available', 'used', 'expired', 'cancelled'] })
  status: string;

  @ApiProperty({ example: 1000 })
  originalAmount: number;

  @ApiProperty({ example: 750 })
  remainingAmount: number;

  @ApiProperty({ example: 'Service credit for downtime' })
  description: string;

  @ApiPropertyOptional({ example: 'invoice' })
  referenceType?: string;

  @ApiPropertyOptional({ example: 'INV-2024-045' })
  referenceId?: string;

  @ApiPropertyOptional({ example: '2024-12-31' })
  expiresAt?: string;

  @ApiProperty({ example: '2024-01-25T10:30:00Z' })
  createdAt: string;
}

export class TenantCreditsListDto {
  @ApiProperty({ example: 'uuid-tenant' })
  tenantId: string;

  @ApiProperty({ example: 'โรงแรมสุขใจ' })
  tenantName: string;

  @ApiProperty({ example: 2500 })
  totalAvailable: number;

  @ApiProperty({ example: 5000 })
  totalUsed: number;

  @ApiProperty({ example: 7500 })
  totalEarned: number;

  @ApiProperty({ type: [CreditItemDto] })
  credits: CreditItemDto[];
}

export class RefundItemDto {
  @ApiProperty({ example: 'uuid-1234' })
  id: string;

  @ApiProperty({ example: 'REF-2024-001' })
  refundNo: string;

  @ApiProperty({ example: 'PAY-2024-045' })
  paymentNo: string;

  @ApiProperty({ example: 'INV-2024-045' })
  invoiceNo: string;

  @ApiProperty({ example: 1000 })
  amount: number;

  @ApiProperty({ enum: ['pending', 'approved', 'rejected', 'completed'] })
  status: string;

  @ApiProperty({ enum: ['original_method', 'bank_transfer', 'credit'] })
  method: string;

  @ApiProperty({ example: 'Customer request' })
  reason: string;

  @ApiPropertyOptional({ example: 'Bangkok Bank' })
  bankName?: string;

  @ApiPropertyOptional({ example: '123-456-789' })
  bankAccount?: string;

  @ApiProperty({ example: '2024-01-25T10:30:00Z' })
  createdAt: string;

  @ApiPropertyOptional({ example: '2024-01-26T10:30:00Z' })
  processedAt?: string;
}

export class CreateRefundResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: 'Refund created successfully' })
  message: string;

  @ApiProperty()
  data: {
    refundNo: string;
    paymentNo: string;
    amount: number;
    method: string;
    status: string;
    creditCreated?: boolean;
    creditId?: string;
  };
}

export class CreateCreditResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: 'Credit added successfully' })
  message: string;

  @ApiProperty()
  data: {
    creditId: string;
    amount: number;
    type: string;
    tenantName: string;
    newBalance: number;
  };
}

export class ApplyCreditResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: 'Credit applied successfully' })
  message: string;

  @ApiProperty()
  data: {
    invoiceNo: string;
    originalAmount: number;
    creditApplied: number;
    newAmount: number;
    creditsUsed: { creditId: string; amount: number }[];
    remainingCredit: number;
  };
}

export class ProcessRefundResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: 'Refund approved successfully' })
  message: string;

  @ApiProperty()
  data: {
    refundNo: string;
    status: string;
    processedAt: string;
  };
}

// ============ Summary DTOs ============

export class RefundSummaryDto {
  @ApiProperty({ example: 5 })
  totalPending: number;

  @ApiProperty({ example: 10 })
  totalApproved: number;

  @ApiProperty({ example: 2 })
  totalRejected: number;

  @ApiProperty({ example: 8 })
  totalCompleted: number;

  @ApiProperty({ example: 25000 })
  totalPendingAmount: number;

  @ApiProperty({ example: 150000 })
  totalRefundedAmount: number;
}
