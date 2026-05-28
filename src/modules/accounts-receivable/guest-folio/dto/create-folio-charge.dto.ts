import {
  IsNotEmpty, IsOptional, IsEnum, IsUUID, IsDateString,
  IsNumber, IsString, Min, Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export enum FolioChargeType {
  ROOM_CHARGE = 'ROOM_CHARGE',
  FB_CHARGE = 'FB_CHARGE',
  SERVICE_CHARGE = 'SERVICE_CHARGE',
  LAUNDRY = 'LAUNDRY',
  SPA = 'SPA',
  MINIBAR = 'MINIBAR',
  PARKING = 'PARKING',
  TRANSPORT = 'TRANSPORT',
  EXTRA_BED = 'EXTRA_BED',
  EARLY_CHECKIN = 'EARLY_CHECKIN',
  LATE_CHECKOUT = 'LATE_CHECKOUT',
  DAMAGE = 'DAMAGE',
  DEPOSIT_APPLIED = 'DEPOSIT_APPLIED',
  DISCOUNT = 'DISCOUNT',
  TAX = 'TAX',
  SERVICE_FEE = 'SERVICE_FEE',
  ADJUSTMENT = 'ADJUSTMENT',
  OTHER = 'OTHER',
}

export class CreateFolioChargeDto {
  @ApiProperty({ description: 'Folio ID' })
  @IsNotEmpty()
  @IsUUID()
  folioId: string;

  @ApiPropertyOptional({ description: 'วันที่ charge', example: '2025-01-15' })
  @IsOptional()
  @IsDateString()
  chargeDate?: string;

  @ApiProperty({ description: 'ประเภท charge', enum: FolioChargeType })
  @IsEnum(FolioChargeType)
  chargeType: FolioChargeType;

  @ApiProperty({ description: 'คำอธิบาย', example: 'ค่าห้องพัก Deluxe 1 คืน' })
  @IsNotEmpty()
  @IsString()
  description: string;

  @ApiProperty({ description: 'จำนวน', example: 1 })
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Type(() => Number)
  quantity: number;

  @ApiProperty({ description: 'ราคาต่อหน่วย', example: 2500.00 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  unitPrice: number;

  @ApiPropertyOptional({ description: 'อัตรา VAT (%)', default: 7, example: 7 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  @Type(() => Number)
  vatRate?: number;

  @ApiPropertyOptional({ description: 'Account ID สำหรับ GL posting' })
  @IsOptional()
  @IsUUID()
  accountId?: string;

  @ApiPropertyOptional({ description: 'Cost Center ID' })
  @IsOptional()
  @IsUUID()
  costCenterId?: string;

  @ApiPropertyOptional({ description: 'ประเภท source (BOOKING, RESTAURANT, POS, ...)' })
  @IsOptional()
  @IsString()
  sourceType?: string;

  @ApiPropertyOptional({ description: 'ID ของ source document' })
  @IsOptional()
  @IsString()
  sourceId?: string;
}
