import { Module } from '@nestjs/common';
import { AddonModule } from '@/modules/addons/addon.module';
import { PrismaModule } from '@/prisma/prisma.module';
import { RetailProductsController } from './retail-products.controller';
import { RetailProductsService } from './retail-products.service';

@Module({
  imports: [AddonModule, PrismaModule],
  controllers: [RetailProductsController],
  providers: [RetailProductsService],
  exports: [RetailProductsService],
})
export class RetailProductsModule {}
