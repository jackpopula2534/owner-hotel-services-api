import { IsNotEmpty, IsString, IsOptional, IsBoolean, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum WarehouseType {
  GENERAL = 'GENERAL',
  KITCHEN = 'KITCHEN',
  HOUSEKEEPING = 'HOUSEKEEPING',
  MAINTENANCE = 'MAINTENANCE',
  MINIBAR = 'MINIBAR',
}

export class CreateWarehouseDto {
  @ApiProperty({ description: 'Warehouse name', example: 'Main Store' })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiProperty({ description: 'Unique warehouse code', example: 'WH-001' })
  @IsNotEmpty()
  @IsString()
  code: string;

  @ApiProperty({ description: 'Property ID', example: 'uuid' })
  @IsNotEmpty()
  @IsString()
  propertyId: string;

  @ApiPropertyOptional({ enum: WarehouseType, default: WarehouseType.GENERAL })
  @IsOptional()
  @IsEnum(WarehouseType)
  type?: WarehouseType;

  @ApiPropertyOptional({ description: 'Physical location description' })
  @IsOptional()
  @IsString()
  location?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
