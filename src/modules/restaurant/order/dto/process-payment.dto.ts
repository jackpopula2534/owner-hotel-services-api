import { IsString, IsNotEmpty, IsNumber, IsOptional, IsEnum, Min } from 'class-validator';
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

  /**
   * เงินที่รับจากลูกค้าที่เคาน์เตอร์ — ROOM_CHARGE ส่ง 0 เพราะลิ้นชักไม่ได้เปิด
   * (ยอดไปตกที่ folio ของห้อง เก็บตอนเช็คเอาต์)
   *
   * ห้ามกลับไปใช้ @IsPositive() — เคยใช้แล้วทำให้ ROOM_CHARGE โดนตีตกตั้งแต่ชั้น DTO
   * ยิงไม่ถึง service ด้วยซ้ำ ส่วนเงินสดที่จ่าย 0 ยังโดนปฏิเสธอยู่ดีที่ service
   * เพราะเช็คว่าจ่ายครบยอดบิลไหม
   */
  @ApiProperty({ example: 500.0, description: 'Amount paid by guest (0 for ROOM_CHARGE)' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  paidAmount: number;

  @ApiPropertyOptional({ example: 0, description: 'Discount amount in THB' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsOptional()
  @Type(() => Number)
  discount?: number;

  @ApiPropertyOptional({
    example: 'ROOM-101',
    description: 'Room number (required for ROOM_CHARGE)',
  })
  @IsString()
  @IsOptional()
  guestRoom?: string;

  @ApiPropertyOptional({
    example: 'booking-uuid',
    description: 'Booking ID (for room charge validation)',
  })
  @IsString()
  @IsOptional()
  bookingId?: string;
}
