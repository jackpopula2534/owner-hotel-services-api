import { IsString, IsNumber, IsEnum, IsOptional, IsInt, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { InvoiceItemType } from '../entities/invoice-item.entity';

export class CreateInvoiceItemDto {
  @ApiProperty()
  @IsString()
  invoiceId: string;

  @ApiProperty({ enum: InvoiceItemType })
  @IsEnum(InvoiceItemType)
  type: InvoiceItemType;

  @ApiProperty({ description: 'Line total in THB. Negative for discounts/adjustments.' })
  @IsNumber()
  amount: number;

  @ApiProperty()
  @IsString()
  description: string;

  @ApiPropertyOptional({ description: 'Unit price in THB. Defaults to `amount` when omitted.' })
  @IsNumber()
  @IsOptional()
  unitPrice?: number;

  @ApiPropertyOptional({ default: 1 })
  @IsInt()
  @Min(1)
  @IsOptional()
  quantity?: number;

  @ApiPropertyOptional({ description: 'Optional reference id (plan id, addon code, coupon code).' })
  @IsString()
  @IsOptional()
  refId?: string;
}
