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
  @ApiProperty({ description: 'Merchant order ID' })
  merchantOrderId: string;

  @ApiProperty({ description: 'Transaction status จาก 2C2P' })
  respCode: string;

  @ApiPropertyOptional()
  respDesc?: string;

  @ApiPropertyOptional()
  transRef?: string;

  @ApiPropertyOptional()
  paymentToken?: string;
}
