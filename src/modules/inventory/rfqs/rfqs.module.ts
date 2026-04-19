import { forwardRef, Module } from '@nestjs/common';
import { RfqsController } from './rfqs.controller';
import { RfqsService } from './rfqs.service';
import { PrismaModule } from '@/prisma/prisma.module';
import { EmailModule } from '@/email/email.module';
import { AddonModule } from '@/modules/addons/addon.module';
import { SupplierPortalModule } from '../supplier-portal/supplier-portal.module';

@Module({
  imports: [
    PrismaModule,
    AddonModule,
    EmailModule,
    // forwardRef: SupplierPortalModule → SupplierQuotesModule → RfqsModule
    // closes back to SupplierPortal. The cycle is broken on this edge.
    forwardRef(() => SupplierPortalModule),
  ],
  controllers: [RfqsController],
  providers: [RfqsService],
  exports: [RfqsService],
})
export class RfqsModule {}
