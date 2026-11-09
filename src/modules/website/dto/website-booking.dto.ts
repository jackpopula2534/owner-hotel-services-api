import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  Equals,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** GET /public/sites/:slug/availability — query string จึงต้อง @Type แปลงเป็นตัวเลข */
export type WebsitePaymentMethod = 'PAY_AT_HOTEL' | 'PROMPTPAY';

export class WebsiteAvailabilityQueryDto {
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
  @Max(20)
  adults?: number;

  @ApiProperty({ required: false, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10)
  children?: number;

  @ApiProperty({ required: false, example: 'SUMMER10', description: 'โค้ดส่วนลดของโรงแรม' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  promoCode?: string;
}

/** จองได้สูงสุดกี่ห้องต่อครั้งบนหน้าเว็บ */
export const MAX_WEBSITE_ROOMS = 5;

/** ห้องหนึ่งในการจองหลายห้อง — แต่ละห้องมีจำนวนแขกของตัวเอง */
export class WebsiteRoomRequestDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  roomType: string;

  @ApiProperty({ default: 2 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  adults: number;

  @ApiProperty({ default: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10)
  children: number;
}

/**
 * POST /public/sites/:slug/bookings — แขกจองเองจากหน้าเว็บโรงแรม
 * ไม่มีช่องราคา/ห้อง/สถานะ: server เลือกห้องและคิดราคาเองทั้งหมด
 */
export class CreateWebsiteBookingDto extends WebsiteAvailabilityQueryDto {
  /** Room.type ที่โชว์ในหน้าเว็บ (key ของ roomTypes) — ไม่ต้องส่งเมื่อส่ง rooms */
  @ApiProperty({ required: false })
  @ValidateIf((o: CreateWebsiteBookingDto) => !o.rooms?.length)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  roomType?: string;

  /**
   * จองหลายห้องในครั้งเดียว (วันเดียวกัน แขกผู้ติดต่อคนเดียว) — ได้การจองแยกต่อห้อง
   * ผูกกันด้วย bookingGroupId และโอน PromptPay ด้วย QR ใบเดียว; ส่งแล้วไม่ใช้ roomType/adults/children ด้านบน
   */
  @ApiProperty({ required: false, type: [WebsiteRoomRequestDto] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_WEBSITE_ROOMS, { message: `จองได้สูงสุด ${MAX_WEBSITE_ROOMS} ห้องต่อครั้ง` })
  @ValidateNested({ each: true })
  @Type(() => WebsiteRoomRequestDto)
  rooms?: WebsiteRoomRequestDto[];

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

  /** PDPA — แขกต้องยินยอมให้โรงแรมเก็บข้อมูลเพื่อการเข้าพัก */
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

  /** PROMPTPAY = โอนผ่าน QR ของโรงแรมทันที (ต้องแนบสลิป), PAY_AT_HOTEL = ชำระตอนเช็กอิน */
  @ApiProperty({ required: false, enum: ['PAY_AT_HOTEL', 'PROMPTPAY'], default: 'PAY_AT_HOTEL' })
  @IsOptional()
  @IsIn(['PAY_AT_HOTEL', 'PROMPTPAY'])
  paymentMethod?: WebsitePaymentMethod;
}
