import { IsOptional, IsString, IsEnum, IsBoolean, IsInt, Min, Max } from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Subset of PurchaseOrderStatus that is meaningful for the receiving
 * pipeline view. DRAFT / PENDING_APPROVAL POs are excluded by default
 * because they cannot be received against.
 */
export enum PurchaseOrderTrackingStatus {
  APPROVED = 'APPROVED',
  PARTIALLY_RECEIVED = 'PARTIALLY_RECEIVED',
  FULLY_RECEIVED = 'FULLY_RECEIVED',
  CLOSED = 'CLOSED',
}

/**
 * Query DTO for `GET /inventory/purchase-orders/tracking`.
 * Designed for the procurement-side Receiving Pipeline view (Sprint 1).
 */
export class QueryPurchaseOrderTrackingDto {
  @ApiProperty({ example: 1, required: false, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiProperty({ example: 20, required: false, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiProperty({
    enum: PurchaseOrderTrackingStatus,
    description:
      'Filter by single tracking status. Omit to get all post-approval statuses (APPROVED, PARTIALLY_RECEIVED, FULLY_RECEIVED, CLOSED).',
    required: false,
  })
  @IsOptional()
  @IsEnum(PurchaseOrderTrackingStatus)
  status?: PurchaseOrderTrackingStatus;

  @ApiProperty({
    description: 'Show only POs whose expectedDate has passed and are not fully received',
    required: false,
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  overdue?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  supplierId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  warehouseId?: string;

  @ApiProperty({
    description: 'Search by PO number (partial match)',
    required: false,
  })
  @IsOptional()
  @IsString()
  search?: string;
}
