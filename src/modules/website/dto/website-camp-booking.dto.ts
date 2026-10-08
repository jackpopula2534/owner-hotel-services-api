import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  Equals,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** จำนวนรายการอุปกรณ์เช่าต่อการจองหนึ่งครั้ง */
export const MAX_CAMP_EQUIPMENT_LINES = 20;

export type CampPaymentMethod = 'PAY_AT_CAMP' | 'PROMPTPAY';

/** query string → "true"/"1" เป็น boolean */
const toBool = ({ value }: { value: unknown }): unknown =>
  value === 'true' || value === '1' ? true : value === 'false' || value === '0' ? false : value;

/** GET /public/sites/:slug/camp-availability */
export class CampAvailabilityQueryDto {
  @ApiProperty({ example: '2026-10-20' })
  @Matches(DATE_ONLY)
  checkIn: string;

  @ApiProperty({ example: '2026-10-22' })
  @Matches(DATE_ONLY)
  checkOut: string;

  @ApiProperty({ required: false, default: 2 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  guests?: number;

  @ApiProperty({ required: false, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  tents?: number;

  @ApiProperty({ required: false, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10)
  vehicles?: number;

  @ApiProperty({ required: false, default: false })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  pet?: boolean;
}

export class CampEquipmentRequestDto {
  @ApiProperty()
  @IsUUID()
  addonId: string;

  @ApiProperty({ default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  qty: number;
}

/**
 * POST /public/sites/:slug/camp-bookings — แขกจองลานเองจากหน้าเว็บ
 * ไม่มีช่องราคา/สถานะ: server คิดราคาเอง — จุดกางเลือกจากแผนที่ได้ (pitchId) ไม่งั้น server เลือกจุดว่างให้
 */
export class CreateCampBookingDto extends CampAvailabilityQueryDto {
  /** CampZone.id (key ของ roomTypes บนหน้าเว็บ) */
  @ApiProperty()
  @IsUUID()
  zoneKey: string;

  /** จุดกางที่แขกเลือกจากแผนที่ (ต้องอยู่ในโซนนี้และว่าง) — ไม่ส่ง = server เลือกจุดว่างให้ */
  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  pitchId?: string;

  @ApiProperty({ required: false, type: [CampEquipmentRequestDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_CAMP_EQUIPMENT_LINES)
  @ValidateNested({ each: true })
  @Type(() => CampEquipmentRequestDto)
  equipment?: CampEquipmentRequestDto[];

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  firstName: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  lastName: string;

  @ApiProperty()
  @IsString()
  @Matches(/^[0-9+\-() ]{6,30}$/, { message: 'กรุณาระบุเบอร์โทรที่ถูกต้อง' })
  phone: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsEmail({}, { message: 'กรุณาระบุอีเมลที่ถูกต้อง' })
  @MaxLength(160)
  email?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  /** PDPA — แขกต้องยินยอมให้ลานเก็บข้อมูลเพื่อการเข้าพัก */
  @ApiProperty()
  @IsBoolean()
  @Equals(true, { message: 'กรุณายอมรับเงื่อนไขการจองและการใช้ข้อมูลส่วนบุคคล' })
  consent: boolean;

  /** honeypot — ช่องซ่อนในฟอร์ม ต้องว่างเสมอ */
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  website?: string;

  /** PROMPTPAY = โอนผ่าน QR ของลานทันที (แนบสลิป), PAY_AT_CAMP = ชำระตอนเช็กอิน */
  @ApiProperty({ required: false, enum: ['PAY_AT_CAMP', 'PROMPTPAY'], default: 'PAY_AT_CAMP' })
  @IsOptional()
  @IsIn(['PAY_AT_CAMP', 'PROMPTPAY'])
  paymentMethod?: CampPaymentMethod;
}
