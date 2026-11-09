import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { RetailPaymentMethod, RetailSaleChannel, RetailSaleStatus } from '@prisma/client';

/** Filters for the sales-history (ประวัติการขาย) list endpoint. */
export class QueryRetailSaleDto {
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

  @ApiPropertyOptional({ description: 'Filter by warehouse / store' })
  @IsOptional()
  @IsString()
  warehouseId?: string;

  @ApiPropertyOptional({
    enum: RetailSaleChannel,
    description: 'ช่องทางการขาย — ไม่ระบุ = เห็นทุกช่องทาง (หน้าร้าน + มินิบาร์)',
  })
  @IsOptional()
  @IsEnum(RetailSaleChannel)
  channel?: RetailSaleChannel;

  @ApiPropertyOptional({ description: 'กรองเฉพาะการจองนี้ (ใช้กับประวัติมินิบาร์รายห้อง)' })
  @IsOptional()
  @IsString()
  bookingId?: string;

  @ApiPropertyOptional({ description: 'กรองเฉพาะห้องนี้ — ยึด id ไม่ใช่เลขห้องที่เปลี่ยนได้' })
  @IsOptional()
  @IsString()
  roomId?: string;

  @ApiPropertyOptional({ enum: RetailPaymentMethod })
  @IsOptional()
  @IsEnum(RetailPaymentMethod)
  paymentMethod?: RetailPaymentMethod;

  @ApiPropertyOptional({ enum: RetailSaleStatus })
  @IsOptional()
  @IsEnum(RetailSaleStatus)
  status?: RetailSaleStatus;

  @ApiPropertyOptional({ description: 'Start of soldAt range (ISO date/datetime), inclusive' })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional({ description: 'End of soldAt range (ISO date/datetime), inclusive' })
  @IsOptional()
  @IsString()
  to?: string;

  @ApiPropertyOptional({ description: 'Search by receipt number or guest name' })
  @IsOptional()
  @IsString()
  search?: string;
}
