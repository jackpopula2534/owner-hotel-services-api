import { IsString, IsNumber, IsDateString, IsEnum, IsOptional } from 'class-validator';
import { InvoiceStatus } from '../entities/invoice.entity';

export class CreateInvoiceDto {
  @IsString()
  tenantId: string;

  @IsString()
  @IsOptional()
  subscriptionId?: string;

  @IsString()
  invoiceNo: string;

  @IsNumber()
  amount: number;

  @IsEnum(InvoiceStatus)
  @IsOptional()
  status?: InvoiceStatus;

  @IsDateString()
  dueDate: Date;
}


