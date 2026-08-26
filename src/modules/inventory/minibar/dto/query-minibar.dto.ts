import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/** ห้องที่ชาร์จมินิบาร์ได้ — ตัวกรองเดียวกับหน้าจอ "ชาร์จเข้าห้อง" ที่อื่น */
export class QueryMinibarRoomsDto {
  @ApiPropertyOptional({ description: 'จำกัดเฉพาะสาขานี้' })
  @IsOptional()
  @IsString()
  propertyId?: string;

  @ApiPropertyOptional({ description: 'ค้นหาเลขห้องหรือชื่อแขก' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

/** สินค้าที่หยิบจากตู้มินิบาร์ได้ — อ่านยอดจากคลังมินิบาร์ของสาขานั้น */
export class QueryMinibarProductsDto {
  @ApiPropertyOptional({ description: 'สาขาของห้อง — ใช้หาคลังมินิบาร์' })
  @IsOptional()
  @IsString()
  propertyId?: string;

  @ApiPropertyOptional({ description: 'การจอง — ใช้หาสาขาให้เองเมื่อไม่ส่ง propertyId' })
  @IsOptional()
  @IsString()
  bookingId?: string;

  @ApiPropertyOptional({ description: 'ระบุคลังเองเมื่อโรงแรมไม่ได้แยกคลังมินิบาร์' })
  @IsOptional()
  @IsString()
  warehouseId?: string;

  @ApiPropertyOptional({ description: 'ค้นหาชื่อสินค้าหรือ SKU' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ description: "'true' = แสดงตัวที่ของหมดด้วย", default: 'false' })
  @IsOptional()
  @IsString()
  includeOutOfStock?: string;
}

/** ประวัติการหยิบของในห้อง — รายห้องหรือรายการจอง */
export class QueryMinibarConsumptionDto {
  @ApiPropertyOptional({ description: 'Page number (1-based)', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ description: 'Rows per page (max 100)', default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ description: 'เฉพาะการจองนี้' })
  @IsOptional()
  @IsString()
  bookingId?: string;

  @ApiPropertyOptional({ description: 'เฉพาะห้องนี้ (room id)' })
  @IsOptional()
  @IsString()
  roomId?: string;

  @ApiPropertyOptional({ description: 'ตั้งแต่วันที่ (ISO)' })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional({ description: 'ถึงวันที่ (ISO)' })
  @IsOptional()
  @IsString()
  to?: string;

  @ApiPropertyOptional({ description: 'ค้นหาเลขที่ใบเสร็จหรือชื่อแขก' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
