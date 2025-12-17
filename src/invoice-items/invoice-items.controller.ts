import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
} from '@nestjs/common';
import { InvoiceItemsService } from './invoice-items.service';
import { CreateInvoiceItemDto } from './dto/create-invoice-item.dto';

@Controller('invoice-items')
export class InvoiceItemsController {
  constructor(private readonly invoiceItemsService: InvoiceItemsService) {}

  @Post()
  create(@Body() createInvoiceItemDto: CreateInvoiceItemDto) {
    return this.invoiceItemsService.create(createInvoiceItemDto);
  }

  @Get()
  findAll() {
    return this.invoiceItemsService.findAll();
  }

  @Get('invoice/:invoiceId')
  findByInvoiceId(@Param('invoiceId') invoiceId: string) {
    return this.invoiceItemsService.findByInvoiceId(invoiceId);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.invoiceItemsService.remove(id);
  }
}


