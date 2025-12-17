import { IsString, IsNumber, IsEnum, IsBoolean, IsOptional } from 'class-validator';
import { FeatureType } from '../entities/feature.entity';

export class CreateFeatureDto {
  @IsString()
  code: string;

  @IsString()
  name: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsEnum(FeatureType)
  type: FeatureType;

  @IsNumber()
  @IsOptional()
  priceMonthly?: number;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}


