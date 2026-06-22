import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const FACILITY_TYPE = ['restroom', 'electricity', 'shop', 'service', 'other'] as const;
const FACILITY_STATUS = ['open', 'closed', 'maintenance'] as const;

export class CreateFacilityDto {
  @ApiProperty()
  @IsString()
  @MaxLength(36)
  campgroundId!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(150)
  name!: string;

  @ApiPropertyOptional({ enum: FACILITY_TYPE, default: 'restroom' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  type?: string;

  @ApiPropertyOptional({ enum: FACILITY_STATUS, default: 'open' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  status?: string;

  @ApiPropertyOptional({ description: 'พิกัด normalized 0..1', default: 0.5 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  posX?: number;

  @ApiPropertyOptional({ description: 'พิกัด normalized 0..1', default: 0.5 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  posY?: number;

  @ApiPropertyOptional({ example: '08:00' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  openingTime?: string;

  @ApiPropertyOptional({ example: '20:00' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  closingTime?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  open24h?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateFacilityDto extends PartialType(CreateFacilityDto) {}

export class UpdateFacilityPositionDto {
  @ApiProperty({ description: 'พิกัด normalized 0..1' })
  @IsNumber()
  @Min(0)
  @Max(1)
  posX!: number;

  @ApiProperty({ description: 'พิกัด normalized 0..1' })
  @IsNumber()
  @Min(0)
  @Max(1)
  posY!: number;
}
