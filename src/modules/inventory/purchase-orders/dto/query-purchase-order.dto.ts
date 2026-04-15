import { IsOptional, IsString, IsEnum, IsISO8601, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export enum PurchaseOrderStatus {
  DRAFT = 'DRAFT',
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  APPROVED = 'APPROVED',
  PARTIALLY_RECEIVED = 'PARTIALLY_RECEIVED',
  FULLY_RECEIVED = 'FULLY_RECEIVED',
  CANCELLED = 'CANCELLED',
  CLOSED = 'CLOSED',
}

export class QueryPurchaseOrderDto {
  @ApiProperty({
    example: 1,
    description: 'Page number (1-based)',
    required: false,
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page ต้องเป็นตัวเลขจำนวนเต็ม' })
  @Min(1, { message: 'page ต้องมีค่าอย่างน้อย 1' })
  page?: number = 1;

  @ApiProperty({
    example: 20,
    description: 'Number of results per page',
    required: false,
    default: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit ต้องเป็นตัวเลขจำนวนเต็ม' })
  @Min(1, { message: 'limit ต้องมีค่าอย่างน้อย 1' })
  @Max(100, { message: 'limit ต้องไม่เกิน 100 รายการต่อหน้า' })
  limit?: number = 20;

  @ApiProperty({
    example: '123e4567-e89b-12d3-a456-426614174000',
    description: 'Filter by property ID',
    required: false,
  })
  @IsOptional()
  @IsString()
  propertyId?: string;

  @ApiProperty({
    example: '123e4567-e89b-12d3-a456-426614174001',
    description: 'Filter by supplier ID',
    required: false,
  })
  @IsOptional()
  @IsString()
  supplierId?: string;

  @ApiProperty({
    enum: PurchaseOrderStatus,
    description: 'Filter by purchase order status',
    required: false,
  })
  @IsOptional()
  @IsEnum(PurchaseOrderStatus)
  status?: PurchaseOrderStatus;

  @ApiProperty({
    example: '2026-04-01',
    description: 'Filter orders created on or after this date (ISO 8601)',
    required: false,
  })
  @IsOptional()
  @IsISO8601()
  startDate?: string;

  @ApiProperty({
    example: '2026-04-30',
    description: 'Filter orders created on or before this date (ISO 8601)',
    required: false,
  })
  @IsOptional()
  @IsISO8601()
  endDate?: string;

  @ApiProperty({
    example: 'PO-202604-0001',
    description: 'Search by PO number (partial match)',
    required: false,
  })
  @IsOptional()
  @IsString()
  search?: string;
}
