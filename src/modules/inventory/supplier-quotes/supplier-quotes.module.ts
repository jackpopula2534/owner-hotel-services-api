import { Module } from '@nestjs/common';
import { SupplierQuotesController } from './supplier-quotes.controller';
import { SupplierQuotesService } from './supplier-quotes.service';
import { PrismaModule } from '@/prisma/prisma.module';
import { AddonModule } from '@/modules/addons/addon.module';

@Module({
  imports: [PrismaModule, AddonModule],
  controllers: [SupplierQuotesController],
  providers: [SupplierQuotesService],
  exports: [SupplierQuotesService],
})
export class SupplierQuotesModule {}
