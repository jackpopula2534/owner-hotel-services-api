import { IsString, IsEnum, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentMethod, PaymentStatus } from '../entities/payment.entity';

export class CreatePaymentDto {
  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'UUID of the invoice being paid',
  })
  @IsString()
  invoiceId: string;

  @ApiProperty({
    example: 'transfer',
    enum: PaymentMethod,
    description: 'Payment method: transfer | qr | cash',
  })
  @IsEnum(PaymentMethod, {
    message: `method ต้องเป็น ${Object.values(PaymentMethod).join(' | ')}`,
  })
  method: PaymentMethod;

  @ApiPropertyOptional({
    example: '/uploads/payment-slips/slip-1234567890.jpg',
    description: 'URL ของสลิปยืนยันการชำระเงิน (set automatically when uploading via multipart)',
  })
  @IsString()
  @IsOptional()
  slipUrl?: string;

  @ApiPropertyOptional({
    example: 'pending',
    enum: PaymentStatus,
    description: 'Payment status — defaults to pending',
  })
  @IsEnum(PaymentStatus)
  @IsOptional()
  status?: PaymentStatus;
}
