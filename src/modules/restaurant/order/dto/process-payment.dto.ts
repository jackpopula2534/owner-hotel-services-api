import { IsString, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum PaymentMethodEnum {
  CASH = 'CASH',
  CREDIT_CARD = 'CREDIT_CARD',
  DEBIT_CARD = 'DEBIT_CARD',
  QR_PAYMENT = 'QR_PAYMENT',
  ROOM_CHARGE = 'ROOM_CHARGE',
  VOUCHER = 'VOUCHER',
}

export class ProcessPaymentDto {
  @ApiProperty({ enum: PaymentMethodEnum, example: PaymentMethodEnum.CASH })
  @IsEnum(PaymentMethodEnum)
  @IsNotEmpty()
  paymentMethod: PaymentMethodEnum;

  @ApiProperty({ example: 500.0, description: 'Amount paid by guest' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Type(() => Number)
  paidAmount: number;

  @ApiPropertyOptional({ example: 0, description: 'Discount amount in THB' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsOptional()
  @Type(() => Number)
  discount?: number;

  @ApiPropertyOptional({ example: 'ROOM-101', description: 'Room number (required for ROOM_CHARGE)' })
  @IsString()
  @IsOptional()
  guestRoom?: string;

  @ApiPropertyOptional({ example: 'booking-uuid', description: 'Booking ID (for room charge validation)' })
  @IsString()
  @IsOptional()
  bookingId?: string;
}
