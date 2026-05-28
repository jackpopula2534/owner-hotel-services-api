import { IsOptional, IsEnum, IsString, IsUUID, IsInt, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { FixedAssetCategoryEnum } from './create-asset.dto';

export enum AssetStatusEnum {
  ACTIVE = 'ACTIVE',
  IDLE = 'IDLE',
  UNDER_REPAIR = 'UNDER_REPAIR',
  DISPOSED = 'DISPOSED',
  WRITTEN_OFF = 'WRITTEN_OFF',
}

export class QueryAssetDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() propertyId?: string;
  @ApiPropertyOptional({ enum: FixedAssetCategoryEnum }) @IsOptional() @IsEnum(FixedAssetCategoryEnum) category?: FixedAssetCategoryEnum;
  @ApiPropertyOptional({ enum: AssetStatusEnum }) @IsOptional() @IsEnum(AssetStatusEnum) status?: AssetStatusEnum;
  @ApiPropertyOptional() @IsOptional() @IsString() search?: string;
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @IsInt() @Min(1) @Type(() => Number) page?: number;
  @ApiPropertyOptional({ default: 20 }) @IsOptional() @IsInt() @Min(1) @Type(() => Number) limit?: number;
}
