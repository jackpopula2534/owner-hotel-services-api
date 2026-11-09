import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { WAREHOUSE_CHANNELS, WarehouseChannel } from '../warehouse-channel';

export class CreateWarehouseGroupDto {
  @ApiProperty({ example: 'หน้าร้าน / POS' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiProperty({ example: 'GRP-POS' })
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,40}$/, { message: 'รหัสกลุ่มใช้ได้เฉพาะ A-Z 0-9 - _ ไม่เกิน 40 ตัว' })
  code: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  @ApiProperty({ enum: WAREHOUSE_CHANNELS, isArray: true, example: ['POS'] })
  @IsArray()
  @ArrayUnique()
  @IsIn(WAREHOUSE_CHANNELS, { each: true })
  channels: WarehouseChannel[];

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'คลังที่อยู่ในกลุ่มนี้ (แทนที่ทั้งชุด)', type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('all', { each: true })
  warehouseIds?: string[];
}

export class UpdateWarehouseGroupDto extends PartialType(CreateWarehouseGroupDto) {}
