import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export enum RfqStatusFilter {
  DRAFT = 'DRAFT',
  SENT = 'SENT',
  PARTIAL_RESPONSE = 'PARTIAL_RESPONSE',
  FULLY_RESPONDED = 'FULLY_RESPONDED',
  EXPIRED = 'EXPIRED',
  CANCELLED = 'CANCELLED',
}

export class QueryRfqDto {
  @ApiProperty({ required: false, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiProperty({ required: false, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiProperty({ required: false, enum: RfqStatusFilter })
  @IsOptional()
  @IsEnum(RfqStatusFilter)
  status?: RfqStatusFilter;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  propertyId?: string;

  @ApiProperty({ required: false, description: 'ค้นหาใน rfqNumber / subject' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiProperty({ required: false, description: 'Filter by supplier id (ค้นใน recipients)' })
  @IsOptional()
  @IsString()
  supplierId?: string;

  @ApiProperty({ required: false, description: 'Filter RFQ ที่ครอบคลุม PR นี้' })
  @IsOptional()
  @IsString()
  purchaseRequisitionId?: string;
}
