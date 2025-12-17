import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Invoice } from './entities/invoice.entity';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';

@Injectable()
export class InvoicesService {
  constructor(
    @InjectRepository(Invoice)
    private invoicesRepository: Repository<Invoice>,
  ) {}

  create(createInvoiceDto: CreateInvoiceDto): Promise<Invoice> {
    const invoice = this.invoicesRepository.create(createInvoiceDto);
    return this.invoicesRepository.save(invoice);
  }

  findAll(): Promise<Invoice[]> {
    return this.invoicesRepository.find({
      relations: ['tenant', 'subscription', 'invoiceItems', 'payments'],
    });
  }

  findOne(id: string): Promise<Invoice> {
    return this.invoicesRepository.findOne({
      where: { id },
      relations: ['tenant', 'subscription', 'invoiceItems', 'payments'],
    });
  }

  findByTenantId(tenantId: string): Promise<Invoice[]> {
    return this.invoicesRepository.find({
      where: { tenantId },
      relations: ['subscription', 'invoiceItems', 'payments'],
      order: { createdAt: 'DESC' },
    });
  }

  update(id: string, updateInvoiceDto: UpdateInvoiceDto): Promise<Invoice> {
    return this.invoicesRepository.save({
      id,
      ...updateInvoiceDto,
    });
  }

  remove(id: string): Promise<void> {
    return this.invoicesRepository.delete(id).then(() => undefined);
  }
}


