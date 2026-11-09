import { IsOptional, IsEnum, IsIn, IsString, IsUUID, IsInt, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { DepreciationMethodEnum, FixedAssetCategoryEnum } from './create-asset.dto';

export enum AssetStatusEnum {
  ACTIVE = 'ACTIVE',
  IDLE = 'IDLE',
  UNDER_REPAIR = 'UNDER_REPAIR',
  DISPOSED = 'DISPOSED',
  WRITTEN_OFF = 'WRITTEN_OFF',
}

export const ASSET_SORT_KEYS = ['code', 'name', 'purchaseDate', 'cost', 'bookValue'] as const;
export type AssetSortKey = (typeof ASSET_SORT_KEYS)[number];

export class QueryAssetDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() propertyId?: string;
  @ApiPropertyOptional({ enum: FixedAssetCategoryEnum })
  @IsOptional()
  @IsEnum(FixedAssetCategoryEnum)
  category?: FixedAssetCategoryEnum;
  @ApiPropertyOptional({ enum: AssetStatusEnum })
  @IsOptional()
  @IsEnum(AssetStatusEnum)
  status?: AssetStatusEnum;
  @ApiPropertyOptional({ enum: DepreciationMethodEnum })
  @IsOptional()
  @IsEnum(DepreciationMethodEnum)
  depreciationMethod?: DepreciationMethodEnum;
  @ApiPropertyOptional() @IsOptional() @IsString() search?: string;
  @ApiPropertyOptional({ enum: ASSET_SORT_KEYS, default: 'code' })
  @IsOptional()
  @IsIn(ASSET_SORT_KEYS)
  sort?: AssetSortKey;
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number;
  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number;
}
