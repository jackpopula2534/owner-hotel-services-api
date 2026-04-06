import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsInt,
  IsNumber,
  IsArray,
  IsUUID,
  IsBoolean,
  IsEnum,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SeasonalRateDto {
  @ApiProperty({ example: 'sr-001' })
  @IsString()
  id: string;

  @ApiProperty({ example: 'High Season' })
  @IsString()
  name: string;

  @ApiProperty({ example: '2026-04-10' })
  @IsString()
  startDate: string;

  @ApiProperty({ example: '2026-04-20' })
  @IsString()
  endDate: string;

  @ApiProperty({ enum: ['fixed', 'percent'], example: 'percent' })
  @IsEnum(['fixed', 'percent'])
  priceType: 'fixed' | 'percent';

  @ApiPropertyOptional({ example: 9000, description: 'ราคาคงที่ (ใช้เมื่อ priceType = fixed)' })
  @IsOptional()
  @IsNumber()
  price?: number;

  @ApiPropertyOptional({
    example: 20,
    description: 'เปอร์เซ็นต์ปรับราคา (ใช้เมื่อ priceType = percent)',
  })
  @IsOptional()
  @IsNumber()
  percentAdjust?: number;

  @ApiProperty({ enum: ['high', 'normal', 'low'], example: 'high' })
  @IsEnum(['high', 'normal', 'low'])
  priority: 'high' | 'normal' | 'low';

  @ApiPropertyOptional({ example: 'Songkran period' })
  @IsOptional()
  @IsString()
  note?: string;

  @ApiProperty({ example: true })
  @IsBoolean()
  isActive: boolean;
}

export class CreateRoomDto {
  @ApiPropertyOptional({
    example: 'uuid-of-property',
    description: 'Property ID (auto-resolved to default property if not provided)',
  })
  @IsUUID()
  @IsOptional()
  propertyId?: string;

  @ApiProperty({ example: '101' })
  @IsString()
  @IsNotEmpty()
  number: string;

  @ApiProperty({ example: 'standard' })
  @IsString()
  @IsNotEmpty()
  type: string;

  @ApiPropertyOptional({ example: 1 })
  @IsInt()
  @IsOptional()
  floor?: number;

  @ApiProperty({ example: 1500.0 })
  @IsNumber()
  @IsNotEmpty()
  price: number;

  @ApiPropertyOptional({ example: 'available' })
  @IsString()
  @IsOptional()
  status?: string;

  @ApiPropertyOptional({ example: 2 })
  @IsInt()
  @IsOptional()
  maxOccupancy?: number;

  @ApiPropertyOptional({ example: 'king' })
  @IsString()
  @IsOptional()
  bedType?: string;

  @ApiPropertyOptional({ example: 35 })
  @IsInt()
  @IsOptional()
  size?: number;

  @ApiPropertyOptional({ example: ['wifi', 'tv', 'ac'] })
  @IsArray()
  @IsOptional()
  amenities?: string[];

  @ApiPropertyOptional({ example: false, description: 'รองรับเตียงเสริมหรือไม่' })
  @IsBoolean()
  @IsOptional()
  extraBedAllowed?: boolean;

  @ApiPropertyOptional({ example: 1, description: 'จำนวนคนที่เสริมเตียงได้สูงสุด' })
  @IsInt()
  @IsOptional()
  extraBedLimit?: number;

  @ApiPropertyOptional({ example: 500, description: 'ราคาเตียงเสริมต่อคน/คืน (บาท)' })
  @IsNumber()
  @IsOptional()
  extraBedPrice?: number;

  @ApiPropertyOptional({ example: 'Standard single room' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({
    example: ['/uploads/rooms/room-101-1.jpg'],
    description: 'Array of image URLs stored on the server',
  })
  @IsArray()
  @IsOptional()
  images?: string[];

  // --- Dynamic Pricing Fields ---

  @ApiPropertyOptional({ example: 8530, description: 'ราคาวันหยุดสุดสัปดาห์ (เสาร์-อาทิตย์)' })
  @IsOptional()
  @IsNumber()
  weekendPrice?: number;

  @ApiPropertyOptional({ example: true, description: 'เปิดใช้ราคาวันหยุดนักขัตฤกษ์' })
  @IsOptional()
  @IsBoolean()
  holidayPriceEnabled?: boolean;

  @ApiPropertyOptional({
    enum: ['fixed', 'percent'],
    example: 'percent',
    description: 'ประเภทการคำนวณราคาวันหยุด',
  })
  @IsOptional()
  @IsEnum(['fixed', 'percent'])
  holidayPriceType?: 'fixed' | 'percent';

  @ApiPropertyOptional({ example: 8600, description: 'ราคาวันหยุดนักขัตฤกษ์ (fixed)' })
  @IsOptional()
  @IsNumber()
  holidayPrice?: number;

  @ApiPropertyOptional({ example: 20, description: 'เปอร์เซ็นต์เพิ่มราคาวันหยุดนักขัตฤกษ์' })
  @IsOptional()
  @IsNumber()
  holidayPricePercent?: number;

  @ApiPropertyOptional({ type: [SeasonalRateDto], description: 'ราคาตามช่วงเวลา (Seasonal)' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SeasonalRateDto)
  seasonalRates?: SeasonalRateDto[];

  @ApiPropertyOptional({
    example: true,
    description: 'เด็กเข้าพักฟรี ไม่คิดค่าบริการเพิ่มจากจำนวนเด็ก',
  })
  @IsOptional()
  @IsBoolean()
  childNoExtraCharge?: boolean;

  @ApiPropertyOptional({
    example: 'เด็กอายุ 1-10 ปี พักฟรีเมื่อใช้เตียงที่มีอยู่ในห้อง',
    description: 'หมายเหตุแสดงเงื่อนไขกรณีเด็กไม่คิดเงินเพิ่ม',
  })
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  childNoExtraChargeNote?: string;
}
