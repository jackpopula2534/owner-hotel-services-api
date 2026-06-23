import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
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

  @ApiPropertyOptional({ type: [String], description: 'รูปจุดกางเต็นท์หลายรูป' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  images?: string[];
}

export class UpdatePitchDto extends PartialType(CreatePitchDto) {}

export class BulkCreatePitchDto {
  @ApiProperty()
  @IsString()
  @MaxLength(36)
  campgroundId!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(36)
  zoneId!: string;

  @ApiProperty({
    description: 'รายการรหัสจุดที่จะสร้าง เช่น ["A4","A5","A6"]',
    type: [String],
    example: ['A4', 'A5', 'A6'],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsString({ each: true })
  @MaxLength(30, { each: true })
  codes!: string[];

  @ApiPropertyOptional({ enum: PITCH_STATUS, default: 'available' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  status?: string;

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

export class BulkDeletePitchDto {
  @ApiProperty({ description: 'ลานที่จะลบจุดทั้งหมด' })
  @IsString()
  @MaxLength(36)
  campgroundId!: string;

  @ApiPropertyOptional({
    description: 'ถ้าระบุ จะลบเฉพาะจุดในโซนนี้ — ถ้าไม่ระบุ จะลบทุกจุดในลาน (Clear all)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(36)
  zoneId?: string;
}

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
