import { IsString, IsEnum, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentMethod, PaymentStatus } from '../entities/payment.entity';

export class CreatePaymentDto {
  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'UUID of the invoice being paid'
  })
  @IsString()
  invoiceId: string;

  @ApiProperty({
    example: 'bank_transfer',
    description: 'Payment method (bank_transfer, credit_card, promptpay, etc)'
  })
  @IsEnum(PaymentMethod)
  method: PaymentMethod;

  @ApiPropertyOptional({
    example: 'https://example.com/payment-slip.jpg',
    description: 'URL to payment confirmation slip image'
  })
  @IsString()
  @IsOptional()
  slipUrl?: string;

  @ApiPropertyOptional({
    example: 'pending',
    description: 'Payment status (pending, completed, failed, rejected)'
  })
  @IsEnum(PaymentStatus)
  @IsOptional()
  status?: PaymentStatus;
}


