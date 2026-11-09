import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreatePaymentIntentDto {
  @ApiProperty({ description: 'Invoice ID ที่ต้องการชำระ' })
  @IsNotEmpty()
  @IsString()
  invoiceId: string;

  @ApiProperty({ description: 'จำนวนเงิน (บาท)', example: 1500 })
  @IsNumber()
  @Min(1)
  amount: number;

  @ApiPropertyOptional({ description: 'currency', default: 'thb' })
  @IsOptional()
  @IsString()
  currency?: string;
}

export class ConfirmPaymentIntentDto {
  @ApiProperty({ description: 'Stripe PaymentIntent ID' })
  @IsNotEmpty()
  @IsString()
  paymentIntentId: string;
}

export class CreatePaymentIntentResponseDto {
  @ApiProperty()
  clientSecret: string;

  @ApiProperty()
  paymentIntentId: string;

  @ApiProperty()
  amount: number;

  @ApiProperty()
  currency: string;
}
