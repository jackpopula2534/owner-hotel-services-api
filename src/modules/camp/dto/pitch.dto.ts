import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const PITCH_STATUS = ['available', 'occupied', 'cleaning', 'maintenance', 'closed'] as const;

export class CreatePitchDto {
  @ApiProperty()
  @IsString()
  @MaxLength(36)
  campgroundId!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(36)
  zoneId!: string;

  @ApiProperty({ example: 'A1' })
  @IsString()
  @MaxLength(30)
  code!: string;

  @ApiPropertyOptional({ enum: PITCH_STATUS, default: 'available' })
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

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  sizeSqm?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdatePitchDto extends PartialType(CreatePitchDto) {}

export class UpdatePitchPositionDto {
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
