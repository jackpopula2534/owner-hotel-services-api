import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class ReservationAddonItemDto {
  @ApiProperty({ description: 'id ของ CampAddon ในคลังอุปกรณ์' })
  @IsString()
  addonId!: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  qty!: number;
}

export class CreateReservationDto {
  @ApiProperty()
  @IsString()
  @MaxLength(36)
  campgroundId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(36)
  zoneId?: string;

  @ApiProperty()
  @IsString()
  @MaxLength(36)
  pitchId!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(120)
  guestFirstName!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  guestLastName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(180)
  guestEmail?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(30)
  guestPhone?: string;

  @ApiProperty()
  @IsDateString()
  checkIn!: string;

  @ApiProperty()
  @IsDateString()
  checkOut!: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  numGuests?: number;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  numTents?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  numVehicles?: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  hasPet?: boolean;

  @ApiPropertyOptional({ type: [ReservationAddonItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReservationAddonItemDto)
  addons?: ReservationAddonItemDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateReservationDto extends PartialType(CreateReservationDto) {
  @ApiPropertyOptional({
    enum: ['pending', 'confirmed', 'checked_in', 'checked_out', 'cancelled', 'no_show'],
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  status?: string;

  @ApiPropertyOptional({
    description: 'ย้ายจุดแล้วไม่คิดส่วนต่างราคา (ลานขอย้ายเอง) — ระบบใส่ส่วนลดเท่าส่วนต่างให้',
  })
  @IsOptional()
  @IsBoolean()
  waivePriceDifference?: boolean;
}

/**
 * แก้ไขอุปกรณ์เช่าของการจอง — ส่งรายการชุดใหม่ "ทั้งชุด" (replace)
 * ส่ง array ว่างเพื่อถอดอุปกรณ์ออกทั้งหมด
 */
export class UpdateReservationAddonsDto {
  @ApiProperty({
    type: [ReservationAddonItemDto],
    description: 'รายการอุปกรณ์ชุดใหม่ทั้งหมด — รายการที่ไม่ส่งมาจะถูกถอดออกและคืน stock',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReservationAddonItemDto)
  addons!: ReservationAddonItemDto[];
}

export class RecordPaymentDto {
  @ApiProperty({ description: 'จำนวนเงินที่รับชำระครั้งนี้ (บาท)', minimum: 0.01 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;

  @ApiProperty({
    description: 'ช่องทางการชำระเงิน',
    enum: ['cash', 'transfer', 'qr', 'card', 'other'],
  })
  @IsString()
  @MaxLength(30)
  method!: string;

  @ApiPropertyOptional({ description: 'เลขอ้างอิงการโอน/ธุรกรรม' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  reference?: string;

  @ApiPropertyOptional({ description: 'URL สลิปการโอนเงิน (อัปโหลดผ่าน /payment-slip ก่อน)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  slipUrl?: string;

  @ApiPropertyOptional({ description: 'หมายเหตุการชำระเงิน' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export const EXTRA_CHARGE_KINDS = ['damage', 'extra_guest', 'adjustment', 'other'] as const;
export type ExtraChargeKind = (typeof EXTRA_CHARGE_KINDS)[number];

/** ค่าใช้จ่ายเพิ่มในบิล — amount ติดลบได้เฉพาะ adjustment (ส่วนลด) */
export class AddExtraChargeDto {
  @ApiProperty({ maxLength: 120 })
  @IsString()
  @MaxLength(120)
  label!: string;

  @ApiProperty({ description: 'บาท (ติดลบ = ส่วนลด ใช้ได้กับ kind=adjustment เท่านั้น)' })
  @IsNumber({ maxDecimalPlaces: 2 })
  amount!: number;

  @ApiPropertyOptional({ enum: EXTRA_CHARGE_KINDS, default: 'other' })
  @IsOptional()
  @IsIn(EXTRA_CHARGE_KINDS as unknown as string[])
  kind?: ExtraChargeKind;
}

/** ข้อมูลเพิ่มตอนเช็คอินหน้าเคาน์เตอร์ — ไม่ส่งอะไรมาก็เช็คอินได้เหมือนเดิม */
export class CheckInReservationDto {
  @ApiPropertyOptional({ description: 'ตรวจบัตรประชาชน/พาสปอร์ตแล้ว' })
  @IsOptional()
  @IsBoolean()
  idVerified?: boolean;

  @ApiPropertyOptional({ description: 'จำนวนผู้เข้าพักจริง (คิดราคาใหม่ถ้าโซนคิดต่อคน)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  numGuests?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  numVehicles?: number;

  @ApiPropertyOptional({ maxLength: 30 })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  vehiclePlate?: string;
}

export class CheckOutReservationDto {
  @ApiPropertyOptional({ description: 'ค่าเสียหาย / อุปกรณ์ไม่คืน (บาท) — เข้าบิลก่อนปิด' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  damageFee?: number;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  damageNote?: string;

  @ApiPropertyOptional({ description: 'มอบหมายแม่บ้านทำความสะอาดจุดทันที', maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  housekeeperName?: string;
}

export const CANCEL_REASONS = ['no_show', 'guest', 'camp'] as const;
export const DEPOSIT_ACTIONS = ['keep', 'refund', 'credit'] as const;

export class CancelReservationDto {
  @ApiPropertyOptional({ enum: CANCEL_REASONS })
  @IsOptional()
  @IsIn(CANCEL_REASONS as unknown as string[])
  reason?: (typeof CANCEL_REASONS)[number];

  @ApiPropertyOptional({
    enum: DEPOSIT_ACTIONS,
    description: 'บันทึกว่าจะทำอะไรกับมัดจำ — ระบบไม่โอนเงินคืนเอง',
  })
  @IsOptional()
  @IsIn(DEPOSIT_ACTIONS as unknown as string[])
  depositAction?: (typeof DEPOSIT_ACTIONS)[number];

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
