import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { RetailPaymentMethod } from '@prisma/client';

/** One product line in a retail checkout. Price/discount are per single unit-set as entered at the POS. */
export class CreateRetailSaleLineDto {
  @ApiProperty({ description: 'InventoryItem id being sold' })
  @IsString()
  itemId: string;

  @ApiProperty({ description: 'Quantity sold', minimum: 1 })
  @IsInt()
  @Min(1)
  quantity: number;

  @ApiProperty({ description: 'Unit selling price (THB), as charged at the POS', minimum: 0 })
  @IsNumber()
  @Min(0)
  unitPrice: number;

  @ApiPropertyOptional({ description: 'Line-level discount (THB), default 0', minimum: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  lineDiscount?: number;
}

export class CreateRetailSaleDto {
  @ApiProperty({ description: 'Warehouse / store the stock is issued from' })
  @IsString()
  warehouseId: string;

  @ApiProperty({ enum: RetailPaymentMethod, description: 'Payment method' })
  @IsEnum(RetailPaymentMethod)
  paymentMethod: RetailPaymentMethod;

  @ApiProperty({ type: [CreateRetailSaleLineDto], description: 'Cart lines' })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateRetailSaleLineDto)
  lines: CreateRetailSaleLineDto[];

  @ApiPropertyOptional({ description: 'Bill-level discount applied after line discounts (THB)', minimum: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  billDiscount?: number;

  @ApiPropertyOptional({ description: 'VAT rate as a percentage, default 7', minimum: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  vatRate?: number;

  @ApiPropertyOptional({ description: 'Room number — required when paymentMethod is ROOM_CHARGE' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  roomNumber?: string;

  @ApiPropertyOptional({ description: 'Guest name — required when paymentMethod is ROOM_CHARGE' })
  @IsOptional()
  @IsString()
  @MaxLength(191)
  guestName?: string;

  @ApiPropertyOptional({ description: 'Booking id, when the room charge is tied to a known booking' })
  @IsOptional()
  @IsString()
  bookingId?: string;

  @ApiPropertyOptional({ description: 'Free-text note printed/stored on the receipt' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
