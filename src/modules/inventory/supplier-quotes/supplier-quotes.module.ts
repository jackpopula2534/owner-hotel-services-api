import { forwardRef, Module } from '@nestjs/common';
import { SupplierQuotesController } from './supplier-quotes.controller';
import { SupplierQuotesService } from './supplier-quotes.service';
import { PrismaModule } from '@/prisma/prisma.module';
import { AddonModule } from '@/modules/addons/addon.module';
import { RfqsModule } from '../rfqs/rfqs.module';

// Cycle: SupplierQuotes → Rfqs → SupplierPortal → SupplierQuotes.
// Forward-ref'd here so the module graph can initialize in any order.
@Module({
  imports: [PrismaModule, AddonModule, forwardRef(() => RfqsModule)],
  controllers: [SupplierQuotesController],
  providers: [SupplierQuotesService],
  exports: [SupplierQuotesService],
})
export class SupplierQuotesModule {}
