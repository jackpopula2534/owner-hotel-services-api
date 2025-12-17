import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InvoiceItem } from './entities/invoice-item.entity';
import { CreateInvoiceItemDto } from './dto/create-invoice-item.dto';

@Injectable()
export class InvoiceItemsService {
  constructor(
    @InjectRepository(InvoiceItem)
    private invoiceItemsRepository: Repository<InvoiceItem>,
  ) {}

  create(createInvoiceItemDto: CreateInvoiceItemDto): Promise<InvoiceItem> {
    const invoiceItem = this.invoiceItemsRepository.create(createInvoiceItemDto);
    return this.invoiceItemsRepository.save(invoiceItem);
  }

  findAll(): Promise<InvoiceItem[]> {
    return this.invoiceItemsRepository.find({
      relations: ['invoice'],
    });
  }

  findByInvoiceId(invoiceId: string): Promise<InvoiceItem[]> {
    return this.invoiceItemsRepository.find({
      where: { invoiceId },
    });
  }

  remove(id: string): Promise<void> {
    return this.invoiceItemsRepository.delete(id).then(() => undefined);
  }
}


