import { Controller, Get, Post, Body, Param, Delete, UseGuards } from '@nestjs/common';
import { InvoiceItemsService } from './invoice-items.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CreateInvoiceItemDto } from './dto/create-invoice-item.dto';

@Controller('invoice-items')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('platform_admin')
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
