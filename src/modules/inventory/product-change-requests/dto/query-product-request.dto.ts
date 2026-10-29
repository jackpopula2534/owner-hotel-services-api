import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  ProductChangeLevel,
  ProductChangeRequestStatus,
  ProductChangeRequestType,
} from '@prisma/client';

export class QueryProductRequestDto {
  @ApiPropertyOptional({ enum: ProductChangeRequestStatus })
  @IsOptional()
  @IsEnum(ProductChangeRequestStatus)
  status?: ProductChangeRequestStatus;

  @ApiPropertyOptional({ description: 'สถานะ "ปิดแล้ว" = APPROVED + ACKNOWLEDGED', example: true })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  done?: boolean;

  @ApiPropertyOptional({ enum: ProductChangeRequestType })
  @IsOptional()
  @IsEnum(ProductChangeRequestType)
  type?: ProductChangeRequestType;

  @ApiPropertyOptional({ enum: ProductChangeLevel })
  @IsOptional()
  @IsEnum(ProductChangeLevel)
  level?: ProductChangeLevel;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  itemId?: string;

  @ApiPropertyOptional({ description: 'เฉพาะคำขอที่ฉันส่ง' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  mine?: boolean;

  @ApiPropertyOptional({ description: 'เลขคำขอ / ชื่อสินค้า / SKU' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ example: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class DuplicateCheckDto {
  @ApiPropertyOptional({ example: 'น้ำแร่ธรรมชาติ 500ml' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(191)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  barcode?: string;
}

export class SuggestSkuDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoryId?: string;
}
