import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export const HOLIDAY_CATEGORIES = ['government', 'religious', 'royal', 'custom'];
const YMD = /^\d{4}-\d{2}-\d{2}$/;

export class CustomHolidayDto {
  @ApiProperty({ example: '2026-12-24' })
  @Matches(YMD, { message: 'date must be YYYY-MM-DD' })
  date!: string;

  @ApiPropertyOptional({ example: '2026-12-26', description: 'วันสุดท้ายของช่วง (รวม)' })
  @IsOptional()
  @Matches(YMD, { message: 'endDate must be YYYY-MM-DD' })
  endDate?: string;

  @ApiProperty({ example: 'คริสต์มาส' })
  @IsString()
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({ enum: HOLIDAY_CATEGORIES, default: 'custom' })
  @IsOptional()
  @IsIn(HOLIDAY_CATEGORIES)
  category?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  repeatYearly?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;
}

/** แทนที่การตั้งค่าวันหยุดทั้งหมดของ property ในครั้งเดียว */
export class ReplaceHolidaysDto {
  @ApiProperty({ type: [String], description: 'วันหยุดราชการที่โรงแรมปิด (ไม่คิดราคาวันหยุด)' })
  @IsArray()
  @ArrayMaxSize(200)
  @Matches(YMD, { each: true, message: 'disabledDefaultDates must be YYYY-MM-DD' })
  disabledDefaultDates!: string[];

  @ApiProperty({ type: [CustomHolidayDto] })
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => CustomHolidayDto)
  customHolidays!: CustomHolidayDto[];
}
