import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PrismaModule } from '../prisma/prisma.module';
import { InvoicesService } from './invoices.service';
import { InvoicesController } from './invoices.controller';
import { Invoice } from './entities/invoice.entity';
import { InvoiceAdjustment } from './entities/invoice-adjustment.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Invoice, InvoiceAdjustment]), PrismaModule],
  controllers: [InvoicesController],
  providers: [InvoicesService],
  exports: [
    TypeOrmModule, // exports Repository<Invoice> + Repository<InvoiceAdjustment>
    InvoicesService,
  ],
})
export class InvoicesModule {}
