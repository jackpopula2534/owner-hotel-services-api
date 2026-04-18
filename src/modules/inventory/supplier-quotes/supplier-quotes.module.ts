import { Module } from '@nestjs/common';
import { SupplierQuotesController } from './supplier-quotes.controller';
import { SupplierQuotesService } from './supplier-quotes.service';
import { PrismaModule } from '@/prisma/prisma.module';
import { AddonModule } from '@/modules/addons/addon.module';
import { RfqsModule } from '../rfqs/rfqs.module';

@Module({
  imports: [PrismaModule, AddonModule, RfqsModule],
  controllers: [SupplierQuotesController],
  providers: [SupplierQuotesService],
  exports: [SupplierQuotesService],
})
export class SupplierQuotesModule {}
