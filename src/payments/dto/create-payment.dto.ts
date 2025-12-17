import { IsString, IsEnum, IsOptional } from 'class-validator';
import { PaymentMethod, PaymentStatus } from '../entities/payment.entity';

export class CreatePaymentDto {
  @IsString()
  invoiceId: string;

  @IsEnum(PaymentMethod)
  method: PaymentMethod;

  @IsString()
  @IsOptional()
  slipUrl?: string;

  @IsEnum(PaymentStatus)
  @IsOptional()
  status?: PaymentStatus;
}


