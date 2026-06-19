import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const ZONE_TYPES = ['mountain_view', 'riverside', 'lawn', 'rv', 'glamping'] as const;
const PRICING_MODES = ['per_night', 'per_person'] as const;

export class SeasonalRateDto {
  @ApiPropertyOptional({ example: 'ปีใหม่' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  name?: string;

  @ApiProperty({ example: '2026-12-28', description: 'YYYY-MM-DD' })
  @IsString()
  start!: string;

  @ApiProperty({ example: '2027-01-02', description: 'YYYY-MM-DD (รวมวันสุดท้าย)' })
  @IsString()
  end!: string;

  @ApiProperty({ example: 1800 })
  @IsNumber()
  @Min(0)
  price!: number;
}

export class CreateZoneDto {
  @ApiProperty()
  @IsString()
  @MaxLength(36)
  campgroundId!: string;

  @ApiProperty({ example: 'โซนริมน้ำ A' })
  @IsString()
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({ example: 'A', description: 'รหัสนำหน้าจุดกางเต็นท์ของโซน เช่น A' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  code?: string;

  @ApiPropertyOptional({ enum: ZONE_TYPES, default: 'lawn' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  type?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ example: 800 })
  @IsNumber()
  @Min(0)
  basePrice!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  weekendPrice?: number;

  @ApiPropertyOptional({ default: 4 })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxGuests?: number;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxTents?: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  allowVehicle?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  allowPet?: boolean;

  @ApiPropertyOptional({
    enum: PRICING_MODES,
    default: 'per_night',
    description: 'per_night = คิดต่อคืน, per_person = คิดต่อคน/คืน (base/weekend/season คือราคาต่อคน)',
  })
  @IsOptional()
  @IsIn(PRICING_MODES)
  pricingMode?: string;

  @ApiPropertyOptional({ default: false, description: 'โซนนี้มีไฟฟ้าให้ใช้หรือไม่' })
  @IsOptional()
  @IsBoolean()
  hasElectricity?: boolean;

  @ApiPropertyOptional({ example: 150, description: 'ค่าไฟเพิ่ม/คืน (เมื่อ hasElectricity = true)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  electricityFee?: number;

  @ApiPropertyOptional({ default: false, description: 'อนุญาตให้ใช้แอร์เคลื่อนที่/เครื่องทำความเย็น' })
  @IsOptional()
  @IsBoolean()
  allowAircon?: boolean;

  @ApiPropertyOptional({
    example: 1000,
    description: 'จำกัดกำลังไฟสูงสุดต่อจุด (วัตต์) — 0/ไม่ส่ง = ไม่จำกัด',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  maxWatt?: number;

  @ApiPropertyOptional({
    type: [String],
    example: ['ห้ามก่อกองไฟ', 'ห้ามส่งเสียงดัง'],
    description: 'รายการข้อห้าม/กฎประจำโซน',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  restrictions?: string[];

  @ApiPropertyOptional({ example: '#22c55e' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  color?: string;

  @ApiPropertyOptional({ type: [SeasonalRateDto], description: 'ราคาช่วงเทศกาล' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SeasonalRateDto)
  seasonalRates?: SeasonalRateDto[];
}

export class UpdateZoneDto extends PartialType(CreateZoneDto) {}
