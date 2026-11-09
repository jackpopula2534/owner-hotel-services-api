import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateCampgroundDto {
  @ApiProperty({ example: 'ลานกางเต็นท์ริมธาร' })
  @IsString()
  @MaxLength(180)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  address?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  latitude?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  longitude?: number;

  @ApiPropertyOptional({ description: 'URL รูปแปลนพื้นที่ (background แผนผัง 2D)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  mapImageUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  mapWidth?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  mapHeight?: number;

  @ApiPropertyOptional({
    type: [String],
    description: 'คลังรูปภาพของลาน (array ของ URL)',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  images?: string[];

  @ApiPropertyOptional({ enum: ['active', 'inactive'], default: 'active' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  status?: string;

  @ApiPropertyOptional({ example: '14:00' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  checkInTime?: string;

  @ApiPropertyOptional({ example: '12:00' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  checkOutTime?: string;
}

export class UpdateCampgroundDto extends PartialType(CreateCampgroundDto) {}

export class UploadMapDto {
  @ApiProperty()
  @IsString()
  @MaxLength(500)
  mapImageUrl!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  mapWidth?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  mapHeight?: number;
}

export interface CampUser {
  tenantId?: string;
}

export interface AllowBoolean {
  allowVehicle?: boolean;
  allowPet?: boolean;
}
