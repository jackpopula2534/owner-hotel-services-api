import { ApiProperty } from '@nestjs/swagger';
import {
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
} from 'class-validator';
import { INQUIRY_TYPES, InquiryType } from '../website.constants';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export class CreateWebsiteInquiryDto {
  @ApiProperty({ enum: INQUIRY_TYPES })
  @IsIn(INQUIRY_TYPES)
  type: InquiryType;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  /** ต้องมีเบอร์โทรหรืออีเมลอย่างใดอย่างหนึ่ง — ไม่งั้นโรงแรมติดต่อกลับไม่ได้ */
  @ApiProperty({ required: false })
  @ValidateIf((o: CreateWebsiteInquiryDto) => !o.email || o.phone !== undefined)
  @IsString()
  @Matches(/^[0-9+\-() ]{6,30}$/, { message: 'กรุณาระบุเบอร์โทรหรืออีเมลที่ถูกต้อง' })
  phone?: string;

  @ApiProperty({ required: false })
  @ValidateIf((o: CreateWebsiteInquiryDto) => !o.phone || !!o.email)
  @IsEmail({}, { message: 'กรุณาระบุเบอร์โทรหรืออีเมลที่ถูกต้อง' })
  @MaxLength(160)
  email?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  message?: string;

  @ApiProperty({ required: false, example: '2026-10-20' })
  @IsOptional()
  @Matches(DATE_ONLY)
  checkIn?: string;

  @ApiProperty({ required: false, example: '2026-10-22' })
  @IsOptional()
  @Matches(DATE_ONLY)
  checkOut?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  adults?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(20)
  children?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  roomType?: string;

  /** honeypot — ช่องซ่อนในฟอร์ม ต้องว่างเสมอ */
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  website?: string;
}
