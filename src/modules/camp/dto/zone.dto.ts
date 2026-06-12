import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const ZONE_TYPES = ['mountain_view', 'riverside', 'lawn', 'rv', 'glamping'] as const;

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
