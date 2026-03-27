import { IsString, IsNumber, IsDateString, IsEnum, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { InvoiceStatus } from '../entities/invoice.entity';

export class CreateInvoiceDto {
  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'UUID of the tenant (hotel) for this invoice',
  })
  @IsString()
  tenantId: string;

  @ApiPropertyOptional({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'UUID of the subscription this invoice is for',
  })
  @IsString()
  @IsOptional()
  subscriptionId?: string;

  @ApiProperty({
    example: 'INV-2026-001',
    description: 'Unique invoice number',
  })
  @IsString()
  invoiceNo: string;

  @ApiProperty({
    example: 4990,
    description: 'Invoice amount in Thai Baht (THB)',
  })
  @IsNumber()
  amount: number;

  @ApiPropertyOptional({
    example: 'paid',
    description: 'Invoice status (pending, paid, overdue, rejected, cancelled)',
  })
  @IsEnum(InvoiceStatus)
  @IsOptional()
  status?: InvoiceStatus;

  @ApiProperty({
    example: '2026-04-01T00:00:00Z',
    description: 'Invoice due date',
  })
  @IsDateString()
  dueDate: Date;
}
