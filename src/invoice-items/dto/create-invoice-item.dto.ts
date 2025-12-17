import { IsString, IsNumber, IsEnum } from 'class-validator';
import { InvoiceItemType } from '../entities/invoice-item.entity';

export class CreateInvoiceItemDto {
  @IsString()
  invoiceId: string;

  @IsEnum(InvoiceItemType)
  type: InvoiceItemType;

  @IsString()
  refId: string;

  @IsString()
  description: string;

  @IsNumber()
  amount: number;
}


