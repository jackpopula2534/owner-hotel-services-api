import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PrismaModule } from '../prisma/prisma.module';
import { InvoiceItemsService } from './invoice-items.service';
import { InvoiceItemsController } from './invoice-items.controller';
import { InvoiceItem } from './entities/invoice-item.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([InvoiceItem]),
    PrismaModule,
  ],
  controllers: [InvoiceItemsController],
  providers: [InvoiceItemsService],
  exports: [
    TypeOrmModule, // exports Repository<InvoiceItem>
    InvoiceItemsService,
  ],
})
export class InvoiceItemsModule {}
