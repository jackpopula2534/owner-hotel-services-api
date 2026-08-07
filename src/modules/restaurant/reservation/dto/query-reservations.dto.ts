import { IsDateString, IsEnum, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { ReservationStatusEnum } from './update-reservation.dto';

/**
 * How the list is ordered. `schedule` walks the service day forwards (the floor
 * view); `recent` puts the newest booking first, which is what a "everything we
 * have taken" list needs so a just-created booking is never buried.
 */
export enum ReservationSortEnum {
  SCHEDULE = 'schedule',
  RECENT = 'recent',
}

export class QueryReservationsDto {
  @ApiPropertyOptional({ example: '2026-04-15', description: 'Exact day (YYYY-MM-DD)' })
  @IsDateString()
  @IsOptional()
  date?: string;

  @ApiPropertyOptional({
    example: '2026-04-01',
    description: 'Range start (inclusive). Ignored when `date` is given.',
  })
  @IsDateString()
  @IsOptional()
  from?: string;

  @ApiPropertyOptional({
    example: '2026-04-30',
    description: 'Range end (inclusive). Ignored when `date` is given.',
  })
  @IsDateString()
  @IsOptional()
  to?: string;

  @ApiPropertyOptional({ enum: ReservationStatusEnum })
  @IsEnum(ReservationStatusEnum)
  @IsOptional()
  status?: ReservationStatusEnum;

  @ApiPropertyOptional({ enum: ReservationSortEnum, default: ReservationSortEnum.SCHEDULE })
  @IsIn(Object.values(ReservationSortEnum))
  @IsOptional()
  sort?: ReservationSortEnum;

  @ApiPropertyOptional({ type: Number, default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number;

  @ApiPropertyOptional({ type: Number, default: 20, maximum: 500 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  @IsOptional()
  limit?: number;
}
