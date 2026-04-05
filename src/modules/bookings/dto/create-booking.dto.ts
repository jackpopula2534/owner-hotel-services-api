import {
  Allow,
  IsString,
  IsNotEmpty,
  IsOptional,
  IsDateString,
  IsEmail,
  IsUUID,
  IsEnum,
  IsNumber,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';

export enum BookingPaymentMethod {
  CASH = 'CASH',
  PROMPTPAY = 'PROMPTPAY',
  BANK_TRANSFER = 'BANK_TRANSFER',
  PAY_AT_HOTEL = 'PAY_AT_HOTEL',
  CREDIT_CARD = 'CREDIT_CARD',
}

export class CreateBookingDto {
  @ApiProperty({ example: 'uuid-of-property' })
  @IsUUID()
  @IsNotEmpty()
  propertyId: string;

  @ApiProperty({ example: 'uuid-of-room' })
  @IsUUID()
  @IsNotEmpty()
  roomId: string;

  @ApiPropertyOptional({ example: 'uuid-of-guest' })
  @IsUUID()
  @IsOptional()
  guestId?: string;

  @ApiProperty({ example: 'John' })
  @IsString()
  @IsNotEmpty()
  guestFirstName: string;

  @ApiProperty({ example: 'Doe' })
  @IsString()
  @IsNotEmpty()
  guestLastName: string;

  @ApiPropertyOptional({ example: 'john.doe@example.com' })
  @IsEmail()
  @IsOptional()
  guestEmail?: string;

  @ApiPropertyOptional({ example: '+66-8-1234-5678' })
  @IsString()
  @IsOptional()
  guestPhone?: string;

  @ApiProperty({ example: '2026-03-01' })
  @Transform(({ value, obj }) => value ?? obj.checkInDate)
  @IsDateString()
  @IsNotEmpty()
  checkIn: string;

  @ApiProperty({ example: '2026-03-05' })
  @Transform(({ value, obj }) => value ?? obj.checkOutDate)
  @IsDateString()
  @IsNotEmpty()
  checkOut: string;

  @ApiPropertyOptional({ example: 'confirmed' })
  @IsString()
  @IsOptional()
  status?: string;

  @ApiPropertyOptional({ example: 'Late check-in requested' })
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiPropertyOptional({ example: 'uuid-of-channel' })
  @IsUUID()
  @IsOptional()
  channelId?: string;

  @ApiPropertyOptional({
    enum: BookingPaymentMethod,
    example: BookingPaymentMethod.CASH,
    description: 'วิธีชำระเงินที่ลูกค้าเลือก',
  })
  @IsEnum(BookingPaymentMethod)
  @IsOptional()
  paymentMethod?: BookingPaymentMethod;

  @ApiPropertyOptional({ example: 'pending', description: 'สถานะการชำระเงิน' })
  @IsString()
  @IsOptional()
  paymentStatus?: string;

  @ApiPropertyOptional({ example: 0, description: 'จำนวนเงินที่ชำระแล้ว' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  @Type(() => Number)
  amountPaid?: number;

  @ApiPropertyOptional({ example: 'โอนเงินแล้ว รอยืนยัน' })
  @IsString()
  @IsOptional()
  paymentNote?: string;

  @ApiPropertyOptional({ example: 'website', description: 'Frontend booking source label' })
  @Allow()
  @IsOptional()
  source?: string;

  @ApiPropertyOptional({ example: '2026-03-01', description: 'Legacy alias for checkIn' })
  @IsDateString()
  @IsOptional()
  checkInDate?: string;

  @ApiPropertyOptional({ example: '2026-03-05', description: 'Legacy alias for checkOut' })
  @IsDateString()
  @IsOptional()
  checkOutDate?: string;

  @ApiPropertyOptional({ example: 1, description: 'Frontend-only room count' })
  @Allow()
  @IsOptional()
  numberOfRooms?: number;

  @ApiPropertyOptional({ example: 2, description: 'Frontend-only guest count' })
  @Allow()
  @IsOptional()
  numberOfGuests?: number;

  @ApiPropertyOptional({ example: 2, description: 'Frontend-only adult guest count' })
  @Allow()
  @IsOptional()
  adults?: number;

  @ApiPropertyOptional({ example: 0, description: 'Frontend-only child guest count' })
  @Allow()
  @IsOptional()
  children?: number;
}
