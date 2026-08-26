import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBooleanString, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class QueryRetailProductDto {
  @ApiPropertyOptional({ description: 'ค้นจากชื่อสินค้าหรือรหัส' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'ดูยอดเฉพาะคลังนี้' })
  @IsOptional()
  @IsString()
  warehouseId?: string;

  @ApiPropertyOptional({ description: 'true = เอาเฉพาะที่ยังไม่ได้ผูกเป็นเมนู' })
  @IsOptional()
  @IsBooleanString()
  unlinkedOnly?: string;

  @ApiPropertyOptional({ description: 'true = เอาเฉพาะที่ยังไม่ได้ตั้งราคาขาย' })
  @IsOptional()
  @IsBooleanString()
  unpricedOnly?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
