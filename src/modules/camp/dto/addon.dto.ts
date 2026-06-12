import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

const ADDON_CATEGORIES = [
  'tent',
  'sleeping',
  'gear',
  'cooking',
  'firewood',
  'electric',
  'other',
] as const;

export class CreateAddonDto {
  @ApiProperty()
  @IsString()
  @MaxLength(36)
  campgroundId!: string;

  @ApiProperty({ example: 'เต็นท์ 3 คน' })
  @IsString()
  @MaxLength(150)
  name!: string;

  @ApiPropertyOptional({ enum: ADDON_CATEGORIES, default: 'other' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  category?: string;

  @ApiProperty({ example: 300 })
  @IsNumber()
  @Min(0)
  pricePerUnit!: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  stockQty?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateAddonDto extends PartialType(CreateAddonDto) {}
