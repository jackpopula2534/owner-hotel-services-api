import { IsOptional, IsEnum, IsIn, IsUUID, IsDateString, IsString, IsInt, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export enum ApInvoiceStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  PARTIAL = 'PARTIAL',
  PAID = 'PAID',
  OVERDUE = 'OVERDUE',
  DISPUTED = 'DISPUTED',
  VOID = 'VOID',
}

export class QueryApInvoiceDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() propertyId?: string;
  @ApiPropertyOptional({ enum: ApInvoiceStatus })
  @IsOptional()
  @IsEnum(ApInvoiceStatus)
  status?: ApInvoiceStatus;
  /** OPEN = อนุมัติแล้วยังค้างจ่าย, OVERDUE = ค้างจ่ายและเลยวันครบกำหนด (ทับ status) */
  @ApiPropertyOptional({ enum: ['OPEN', 'OVERDUE'] })
  @IsOptional()
  @IsIn(['OPEN', 'OVERDUE'])
  bucket?: 'OPEN' | 'OVERDUE';
  @ApiPropertyOptional() @IsOptional() @IsUUID() supplierId?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() dateFrom?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() dateTo?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() search?: string;
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number;
  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  limit?: number;
}
