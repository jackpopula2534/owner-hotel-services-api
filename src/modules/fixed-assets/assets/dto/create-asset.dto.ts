import {
  IsNotEmpty,
  IsString,
  IsOptional,
  IsEnum,
  IsUUID,
  IsDateString,
  IsNumber,
  IsInt,
  Min,
  IsPositive,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export enum FixedAssetCategoryEnum {
  LAND = 'LAND',
  BUILDING = 'BUILDING',
  BUILDING_IMPROVE = 'BUILDING_IMPROVE',
  FURNITURE = 'FURNITURE',
  EQUIPMENT = 'EQUIPMENT',
  IT_EQUIPMENT = 'IT_EQUIPMENT',
  VEHICLE = 'VEHICLE',
  LINEN_UNIFORM = 'LINEN_UNIFORM',
  KITCHEN_EQUIPMENT = 'KITCHEN_EQUIPMENT',
  OTHER = 'OTHER',
}

export enum DepreciationMethodEnum {
  STRAIGHT_LINE = 'STRAIGHT_LINE',
  DECLINING_BALANCE = 'DECLINING_BALANCE',
  UNITS_OF_ACTIVITY = 'UNITS_OF_ACTIVITY',
  SUM_OF_YEARS = 'SUM_OF_YEARS',
  NO_DEPRECIATION = 'NO_DEPRECIATION',
}

export class CreateAssetDto {
  @ApiProperty() @IsNotEmpty() @IsUUID() propertyId: string;

  @ApiProperty({ description: 'รหัสสินทรัพย์ เช่น FA-001', example: 'FA-001' })
  @IsNotEmpty()
  @IsString()
  assetCode: string;

  @ApiProperty({ description: 'ชื่อสินทรัพย์', example: 'เครื่องปรับอากาศ Daikin 18000 BTU' })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;

  @ApiProperty({ enum: FixedAssetCategoryEnum })
  @IsEnum(FixedAssetCategoryEnum)
  category: FixedAssetCategoryEnum;

  @ApiPropertyOptional() @IsOptional() @IsUUID() costCenterId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() assetAccountId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() accumDeprecAccountId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() deprecExpenseAccountId?: string;

  @ApiProperty({ description: 'วันที่ซื้อ', example: '2024-01-15' })
  @IsDateString()
  purchaseDate: string;

  @ApiProperty({ description: 'ราคาซื้อ', example: 45000 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Type(() => Number)
  purchaseCost: number;

  @ApiPropertyOptional({ description: 'ค่าใช้จ่ายในการได้มาเพิ่มเติม', default: 0 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  acquisitionCost?: number;

  @ApiPropertyOptional({ description: 'มูลค่าซาก', default: 0 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  residualValue?: number;

  @ApiProperty({ description: 'อายุการใช้งาน (ปี)', example: 5 })
  @IsInt()
  @Min(1)
  @Type(() => Number)
  usefulLifeYears: number;

  @ApiProperty({ enum: DepreciationMethodEnum, default: DepreciationMethodEnum.STRAIGHT_LINE })
  @IsEnum(DepreciationMethodEnum)
  depreciationMethod: DepreciationMethodEnum;

  @ApiPropertyOptional({ description: 'อัตราค่าเสื่อม % สำหรับ Declining Balance' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  depreciationRate?: number;

  @ApiPropertyOptional() @IsOptional() @IsString() location?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() serialNo?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() responsiblePerson?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() purchaseOrderId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}
