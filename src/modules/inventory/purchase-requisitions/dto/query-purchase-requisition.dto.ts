import { IsOptional, IsString, IsEnum, IsISO8601, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export enum PurchaseRequisitionStatus {
  DRAFT = 'DRAFT',
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  APPROVED = 'APPROVED',
  PENDING_QUOTES = 'PENDING_QUOTES',
  QUOTES_RECEIVED = 'QUOTES_RECEIVED',
  COMPARING = 'COMPARING',
  PO_CREATED = 'PO_CREATED',
  CANCELLED = 'CANCELLED',
  CLOSED = 'CLOSED',
}

export class QueryPurchaseRequisitionDto {
  @ApiProperty({
    example: 1,
    description: 'Page number (1-based)',
    required: false,
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page must be an integer' })
  @Min(1, { message: 'page must be at least 1' })
  page?: number = 1;

  @ApiProperty({
    example: 20,
    description: 'Number of results per page (max 100)',
    required: false,
    default: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit must be an integer' })
  @Min(1, { message: 'limit must be at least 1' })
  @Max(100, { message: 'limit cannot exceed 100 per page' })
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
    enum: PurchaseRequisitionStatus,
    description: 'Filter by requisition status',
    required: false,
  })
  @IsOptional()
  @IsEnum(PurchaseRequisitionStatus)
  status?: PurchaseRequisitionStatus;

  @ApiProperty({
    example: 'HIGH',
    description: 'Filter by priority (LOW, NORMAL, HIGH, URGENT)',
    required: false,
  })
  @IsOptional()
  @IsString()
  priority?: string;

  @ApiProperty({
    example: '2026-04-01',
    description: 'Filter requisitions created on or after this date (ISO 8601)',
    required: false,
  })
  @IsOptional()
  @IsISO8601()
  startDate?: string;

  @ApiProperty({
    example: '2026-04-30',
    description: 'Filter requisitions created on or before this date (ISO 8601)',
    required: false,
  })
  @IsOptional()
  @IsISO8601()
  endDate?: string;

  @ApiProperty({
    example: 'PR-202604-0001',
    description: 'Search by PR number (partial match)',
    required: false,
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiProperty({
    example: '123e4567-e89b-12d3-a456-426614174001',
    description: 'Filter by user ID who requested the requisition',
    required: false,
  })
  @IsOptional()
  @IsString()
  requestedBy?: string;
}
