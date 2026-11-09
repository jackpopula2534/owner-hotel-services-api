import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsEnum, IsInt, Min, IsDateString, IsBoolean } from 'class-validator';
import { Transform } from 'class-transformer';

export enum LotStatusFilter {
  ACTIVE = 'ACTIVE',
  QUARANTINED = 'QUARANTINED',
  EXHAUSTED = 'EXHAUSTED',
  EXPIRED = 'EXPIRED',
  DISPOSED = 'DISPOSED',
}

export class QueryLotDto {
  @ApiPropertyOptional({ description: 'Filter by Item ID' })
  @IsOptional()
  @IsString()
  itemId?: string;

  @ApiPropertyOptional({ description: 'Filter by Warehouse ID' })
  @IsOptional()
  @IsString()
  warehouseId?: string;

  @ApiPropertyOptional({ description: 'Filter by lot status', enum: LotStatusFilter })
  @IsOptional()
  @IsEnum(LotStatusFilter)
  status?: LotStatusFilter;

  @ApiPropertyOptional({ description: 'Filter lots expiring within N days' })
  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  nearExpiryDays?: number;

  @ApiPropertyOptional({ description: 'Include expired lots only' })
  @IsOptional()
  @Transform(({ value }) => value === 'true')
  @IsBoolean()
  expiredOnly?: boolean;

  @ApiPropertyOptional({ description: 'Expiry date from (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  expiryFrom?: string;

  @ApiPropertyOptional({ description: 'Expiry date to (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  expiryTo?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  limit?: number = 20;
}
