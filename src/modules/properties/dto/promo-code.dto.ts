import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export const PROMO_DISCOUNT_TYPES = ['percentage', 'fixed'];
const YMD = /^\d{4}-\d{2}-\d{2}$/;
/** ตัวอักษร/ตัวเลข/ขีด 3–40 ตัว (ไม่มีช่องว่าง แขกพิมพ์ได้ง่าย) */
export const PROMO_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{2,39}$/;

const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;
/** ฟิลด์ที่ส่ง null เพื่อล้างค่าได้ */
const nullable = (_: object, v: unknown) => v !== null;

export class CreatePromoCodeDto {
  @ApiProperty({ example: 'SUMMER10' })
  @Transform(upper)
  @IsString()
  @Matches(PROMO_CODE_PATTERN, {
    message: 'โค้ดต้องเป็นตัวอักษรอังกฤษ/ตัวเลข/ขีด 3–40 ตัว',
  })
  code!: string;

  @ApiPropertyOptional({ example: 'ลด 10% หน้าร้อน' })
  @IsOptional()
  @ValidateIf(nullable)
  @IsString()
  @MaxLength(255)
  description?: string | null;

  @ApiProperty({ enum: PROMO_DISCOUNT_TYPES })
  @IsIn(PROMO_DISCOUNT_TYPES)
  discountType!: string;

  @ApiProperty({ example: 10, description: '% หรือบาท ตาม discountType' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(9_999_999)
  discountValue!: number;

  @ApiPropertyOptional({ example: 1000, description: 'เพดานส่วนลด (เฉพาะแบบ %)' })
  @IsOptional()
  @ValidateIf(nullable)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(9_999_999)
  maxDiscount?: number | null;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  minNights?: number;

  @ApiPropertyOptional({ description: 'ค่าห้องขั้นต่ำก่อนหักส่วนลด' })
  @IsOptional()
  @ValidateIf(nullable)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(9_999_999)
  minAmount?: number | null;

  @ApiPropertyOptional({ example: '2026-10-01' })
  @IsOptional()
  @ValidateIf(nullable)
  @Matches(YMD, { message: 'validFrom must be YYYY-MM-DD' })
  validFrom?: string | null;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @ValidateIf(nullable)
  @Matches(YMD, { message: 'validUntil must be YYYY-MM-DD' })
  validUntil?: string | null;

  @ApiPropertyOptional({ description: 'จำนวนการจองสูงสุด (ไม่ระบุ = ไม่จำกัด)' })
  @IsOptional()
  @ValidateIf(nullable)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  usageLimit?: number | null;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdatePromoCodeDto extends PartialType(CreatePromoCodeDto) {}
