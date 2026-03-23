import {
  IsString,
  IsNumber,
  IsOptional,
  IsEnum,
  IsPositive,
  Min,
  Max,
  IsUUID,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum PromptPayType {
  STATIC = 'static',
  DYNAMIC = 'dynamic',
}

export class GenerateQRCodeDto {
  @ApiProperty({ description: 'Amount to pay (in THB)' })
  @IsNumber()
  @IsPositive()
  amount: number;

  @ApiPropertyOptional({ description: 'Booking ID (if for booking payment)' })
  @IsOptional()
  @IsString()
  bookingId?: string;

  @ApiPropertyOptional({ description: 'Invoice ID (if for invoice payment)' })
  @IsOptional()
  @IsString()
  invoiceId?: string;

  @ApiPropertyOptional({
    enum: PromptPayType,
    description: 'QR type (static or dynamic)',
    default: PromptPayType.DYNAMIC,
  })
  @IsOptional()
  @IsEnum(PromptPayType)
  type?: PromptPayType;

  @ApiPropertyOptional({
    description: 'Expiry time in minutes',
    default: 15,
  })
  @IsOptional()
  @IsNumber()
  @Min(5)
  @Max(60)
  expiryMinutes?: number;

  @ApiPropertyOptional({ description: 'Tenant ID' })
  @IsOptional()
  @IsString()
  tenantId?: string;
}

export class QRCodeResponseDto {
  @ApiProperty({ description: 'Transaction reference' })
  transactionRef: string;

  @ApiProperty({ description: 'QR code as base64 image' })
  qrCodeImage: string;

  @ApiProperty({ description: 'Raw QR code data (EMV format)' })
  qrCodeData: string;

  @ApiProperty({ description: 'Amount to pay' })
  amount: number;

  @ApiProperty({ description: 'PromptPay ID used' })
  promptpayId: string;

  @ApiProperty({ description: 'Expiry timestamp' })
  expiresAt: Date;

  @ApiProperty({ description: 'Status' })
  status: string;
}

export class VerifyPaymentDto {
  @ApiProperty({ description: 'Transaction reference' })
  @IsString()
  transactionRef: string;
}

export class WebhookPaymentDto {
  @ApiPropertyOptional({ description: 'Transaction reference from payment' })
  @IsOptional()
  @IsString()
  transactionRef?: string;

  @ApiPropertyOptional({ description: 'Bank reference' })
  @IsOptional()
  @IsString()
  bankRef?: string;

  @ApiPropertyOptional({ description: 'Amount paid' })
  @IsOptional()
  @IsNumber()
  amount?: number;

  @ApiPropertyOptional({ description: 'Payment status from bank' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: 'Payment timestamp' })
  @IsOptional()
  @IsString()
  paidAt?: string;

  @ApiPropertyOptional({ description: 'Raw webhook data' })
  @IsOptional()
  rawData?: any;
}

export class TransactionQueryDto {
  @ApiPropertyOptional({ description: 'Filter by status' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: 'Start date (ISO string)' })
  @IsOptional()
  @IsString()
  startDate?: string;

  @ApiPropertyOptional({ description: 'End date (ISO string)' })
  @IsOptional()
  @IsString()
  endDate?: string;

  @ApiPropertyOptional({ description: 'Booking ID' })
  @IsOptional()
  @IsString()
  bookingId?: string;

  @ApiPropertyOptional({ description: 'Invoice ID' })
  @IsOptional()
  @IsString()
  invoiceId?: string;

  @ApiPropertyOptional({ description: 'Page number', default: 1 })
  @IsOptional()
  page?: number;

  @ApiPropertyOptional({ description: 'Items per page', default: 20 })
  @IsOptional()
  limit?: number;
}

export class RefundRequestDto {
  @ApiProperty({ description: 'Transaction reference to refund' })
  @IsString()
  transactionRef: string;

  @ApiPropertyOptional({ description: 'Partial refund amount (if not full refund)' })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  amount?: number;

  @ApiProperty({ description: 'Reason for refund' })
  @IsString()
  reason: string;

  @ApiPropertyOptional({ description: 'Bank account for refund' })
  @IsOptional()
  @IsString()
  bankAccount?: string;

  @ApiPropertyOptional({ description: 'Bank name' })
  @IsOptional()
  @IsString()
  bankName?: string;

  @ApiPropertyOptional({ description: 'Account holder name' })
  @IsOptional()
  @IsString()
  accountHolder?: string;
}
