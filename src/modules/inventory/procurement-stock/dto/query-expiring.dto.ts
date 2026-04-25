import { IsOptional, IsString, IsEnum, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Filter buckets for expiring lots — drives which date window the service uses.
 */
export enum LotExpiryFilter {
  /** expiryDate is between today and (today + days) */
  NEAR = 'NEAR',
  /** expiryDate already passed AND the lot still has remaining qty */
  EXPIRED = 'EXPIRED',
  /** Both NEAR and EXPIRED, useful for the "all hot lots" combined view */
  BOTH = 'BOTH',
}

export class QueryLotExpiringDto {
  @ApiProperty({ example: 30, required: false, default: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  days?: number = 30;

  @ApiProperty({
    enum: LotExpiryFilter,
    description: 'Which bucket to return. NEAR = expiring soon, EXPIRED = already past expiry',
    required: false,
    default: LotExpiryFilter.NEAR,
  })
  @IsOptional()
  @IsEnum(LotExpiryFilter)
  filter?: LotExpiryFilter = LotExpiryFilter.NEAR;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  warehouseId?: string;
}
