import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsInt,
  IsBoolean,
  IsEnum,
  IsObject,
  IsNumber,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsStrictBoolean } from '../../../common/decorators/strict-boolean.decorator';

export enum RestaurantTypeEnum {
  FINE_DINING = 'FINE_DINING',
  CASUAL = 'CASUAL',
  BUFFET = 'BUFFET',
  BAR = 'BAR',
  CAFE = 'CAFE',
  POOL_BAR = 'POOL_BAR',
  ROOM_SERVICE = 'ROOM_SERVICE',
}

export class CreateRestaurantDto {
  @ApiProperty({ example: 'Main Restaurant' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: '358ac78f-7f4e-4a01-bfbf-65c69d7dfe03' })
  @IsString()
  @IsOptional()
  propertyId?: string;

  @ApiPropertyOptional({ example: 'REST001' })
  @IsString()
  @IsOptional()
  code?: string;

  @ApiPropertyOptional({ enum: RestaurantTypeEnum, example: RestaurantTypeEnum.CASUAL })
  @IsEnum(RestaurantTypeEnum)
  @IsOptional()
  type?: RestaurantTypeEnum;

  @ApiPropertyOptional({ example: 'Fine dining restaurant on the rooftop' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ example: 'Ground Floor, Building A' })
  @IsString()
  @IsOptional()
  location?: string;

  @ApiPropertyOptional({ example: 80 })
  @IsInt()
  @IsOptional()
  capacity?: number;

  @ApiPropertyOptional({ example: '07:00' })
  @IsString()
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, { message: 'openTime must be HH:mm format' })
  openTime?: string;

  @ApiPropertyOptional({ example: '22:00' })
  @IsString()
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, { message: 'closeTime must be HH:mm format' })
  closeTime?: string;

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'Charge VAT on bills from this outlet. Off for a non-VAT-registered outlet.',
    example: true,
  })
  @IsStrictBoolean()
  @IsOptional()
  vatEnabled?: boolean;

  @ApiPropertyOptional({ description: 'VAT percentage', example: 7 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  @IsOptional()
  vatRate?: number;

  @ApiPropertyOptional({
    description: 'Add a service charge to bills from this outlet',
    example: true,
  })
  @IsStrictBoolean()
  @IsOptional()
  serviceChargeEnabled?: boolean;

  @ApiPropertyOptional({ description: 'Service charge percentage', example: 10 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  @IsOptional()
  serviceRate?: number;

  @ApiPropertyOptional({
    description: 'Floor plan layout data (positions, zones, grid size)',
    example: { width: 800, height: 600, gridSize: 20, zones: [] },
  })
  @IsObject()
  @IsOptional()
  layoutData?: Record<string, unknown>;
}
