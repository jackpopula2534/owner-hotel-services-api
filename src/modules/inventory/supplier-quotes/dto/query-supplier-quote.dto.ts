import { IsOptional, IsString, IsEnum, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export enum SupplierQuoteStatus {
  REQUESTED = 'REQUESTED',
  RECEIVED = 'RECEIVED',
  SELECTED = 'SELECTED',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED',
}

export class QuerySupplierQuoteDto {
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
    example: '123e4567-e89b-12d3-a456-426614174001',
    description: 'Filter by supplier ID',
    required: false,
  })
  @IsOptional()
  @IsString()
  supplierId?: string;

  @ApiProperty({
    example: '123e4567-e89b-12d3-a456-426614174002',
    description: 'Filter by purchase requisition ID',
    required: false,
  })
  @IsOptional()
  @IsString()
  purchaseRequisitionId?: string;

  @ApiProperty({
    enum: SupplierQuoteStatus,
    description: 'Filter by quote status',
    required: false,
  })
  @IsOptional()
  @IsEnum(SupplierQuoteStatus)
  status?: SupplierQuoteStatus;
}
