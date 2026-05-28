import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  IsNumber,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CreateCashDrawerDto {
  @ApiProperty({ description: 'Property ID', example: 'uuid-xxx' })
  @IsNotEmpty()
  @IsUUID()
  propertyId: string;

  @ApiProperty({ description: 'ชื่อลิ้นชัก เช่น "แผนกต้อนรับ - กะเช้า"', example: 'แผนกต้อนรับ - กะเช้า' })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiProperty({ description: 'รหัสลิ้นชัก เช่น "FD-AM"', example: 'FD-AM' })
  @IsNotEmpty()
  @IsString()
  code: string;

  @ApiPropertyOptional({ description: 'ยอดเงินเปิดกะ', default: 0, example: 5000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  openingBalance?: number;
}
