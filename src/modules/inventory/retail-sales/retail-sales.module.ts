import { Module } from '@nestjs/common';
import { AddonModule } from '@/modules/addons/addon.module';
import { PrismaModule } from '@/prisma/prisma.module';
import { RetailSalesController } from './retail-sales.controller';
import { RetailSalesService } from './retail-sales.service';

@Module({
  imports: [AddonModule, PrismaModule],
  controllers: [RetailSalesController],
  providers: [RetailSalesService],
  exports: [RetailSalesService],
})
export class RetailSalesModule {}
