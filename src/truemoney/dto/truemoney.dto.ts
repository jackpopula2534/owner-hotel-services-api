import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class InitiateTrueMoneyDto {
  @ApiProperty({ description: 'Invoice ID ที่ต้องการชำระ' })
  @IsNotEmpty()
  @IsString()
  invoiceId: string;

  @ApiProperty({ description: 'จำนวนเงิน (บาท)', example: 1500 })
  @IsNumber()
  @Min(1)
  amount: number;

  @ApiPropertyOptional({ description: 'URL กลับหลังจากชำระเงิน' })
  @IsOptional()
  @IsString()
  frontendReturnUrl?: string;
}

export class TrueMoneyCallbackDto {
  /**
   * 2C2P's signed backend response — a JWS/JWT whose payload is HMAC-SHA256
   * signed with the merchant secret key. When present this is the source of
   * truth; the service verifies it and ignores any unsigned top-level fields.
   */
  @ApiPropertyOptional({ description: '2C2P signed payload (JWT) — verified server-side' })
  @IsOptional()
  @IsString()
  payload?: string;

  @ApiPropertyOptional({ description: 'Merchant order ID (unsigned fallback)' })
  @IsOptional()
  @IsString()
  merchantOrderId?: string;

  @ApiPropertyOptional({ description: 'Transaction status จาก 2C2P (unsigned fallback)' })
  @IsOptional()
  @IsString()
  respCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  respDesc?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  transRef?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  paymentToken?: string;
}
