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

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export enum BookingPaymentMethod {
  CASH = 'CASH',
  PROMPTPAY = 'PROMPTPAY',
  BANK_TRANSFER = 'BANK_TRANSFER',
  PAY_AT_HOTEL = 'PAY_AT_HOTEL',
  CREDIT_CARD = 'CREDIT_CARD',
}

export class CreateBookingDto {
  @ApiProperty({ example: 'uuid-of-property' })
  @Transform(({ value, obj }) => value ?? obj.property?.id)
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
  @IsOptional()
  guestFirstName: string;

  @ApiProperty({ example: 'Doe' })
  @IsString()
  @IsOptional()
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
  @IsDateString()
  @IsOptional()
  checkIn: string;

  @ApiProperty({ example: '2026-03-05' })
  @IsDateString()
  @IsOptional()
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
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  @IsOptional()
  numberOfGuests?: number;

  @ApiPropertyOptional({ example: 2, description: 'Frontend-only adult guest count' })
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  @IsOptional()
  adults?: number;

  @ApiPropertyOptional({ example: 0, description: 'Frontend-only child guest count' })
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  @IsOptional()
  children?: number;

  @ApiPropertyOptional({ example: [{ date: '2026-04-13', dayName: 'Sunday', appliedRate: 4000 }], description: 'Optional booking pricing breakdown from frontend' })
  @Allow()
  @IsOptional()
  pricingBreakdown?: Record<string, any>;

  @ApiPropertyOptional({ example: ['2026-04-13'], description: 'Optional holiday dates used for pricing override' })
  @Allow()
  @IsOptional()
  holidayDates?: string[];

  @ApiPropertyOptional({ description: 'Frontend-selected property metadata' })
  @Allow()
  @IsOptional()
  property?: Record<string, any>;

  @ApiPropertyOptional({ example: ['room-type-1'], description: 'Frontend-only room type filter' })
  @Allow()
  @IsOptional()
  roomTypeIds?: string[];

  @ApiPropertyOptional({ example: 'John Doe', description: 'Frontend guest full name alias' })
  @Allow()
  @IsOptional()
  guestName?: string;

  @ApiPropertyOptional({ description: 'Frontend guest object alias' })
  @Allow()
  @IsOptional()
  guest?: Record<string, any>;

  @ApiPropertyOptional({ example: '2026-03-01', description: 'Frontend alias for checkIn' })
  @Allow()
  @IsOptional()
  startDate?: string;

  @ApiPropertyOptional({ example: '2026-03-05', description: 'Frontend alias for checkOut' })
  @Allow()
  @IsOptional()
  endDate?: string;

  @ApiPropertyOptional({ description: 'Frontend date range alias' })
  @Allow()
  @IsOptional()
  dateRange?: { from?: string; to?: string };

  @ApiPropertyOptional({ example: '14:00', description: 'Requested check-in time (HH:mm) — overrides property standard time for scheduledCheckIn' })
  @IsOptional()
  @IsString()
  checkInTime?: string;

  @ApiPropertyOptional({ example: '12:00', description: 'Requested check-out time (HH:mm) — overrides property standard time for scheduledCheckOut' })
  @IsOptional()
  @IsString()
  checkOutTime?: string;
}
