import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class ReservationAddonItemDto {
  @ApiProperty({ description: 'id ของ CampAddon ในคลังอุปกรณ์' })
  @IsString()
  addonId!: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  qty!: number;
}

export class CreateReservationDto {
  @ApiProperty()
  @IsString()
  @MaxLength(36)
  campgroundId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(36)
  zoneId?: string;

  @ApiProperty()
  @IsString()
  @MaxLength(36)
  pitchId!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(120)
  guestFirstName!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  guestLastName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(180)
  guestEmail?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(30)
  guestPhone?: string;

  @ApiProperty()
  @IsDateString()
  checkIn!: string;

  @ApiProperty()
  @IsDateString()
  checkOut!: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  numGuests?: number;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  numTents?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  numVehicles?: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  hasPet?: boolean;

  @ApiPropertyOptional({ type: [ReservationAddonItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReservationAddonItemDto)
  addons?: ReservationAddonItemDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateReservationDto extends PartialType(CreateReservationDto) {
  @ApiPropertyOptional({
    enum: ['pending', 'confirmed', 'checked_in', 'checked_out', 'cancelled', 'no_show'],
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  status?: string;
}
