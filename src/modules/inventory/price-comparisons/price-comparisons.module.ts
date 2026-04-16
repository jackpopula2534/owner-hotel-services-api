import { Module } from '@nestjs/common';
import { PriceComparisonsController } from './price-comparisons.controller';
import { PriceComparisonsService } from './price-comparisons.service';
import { PrismaModule } from '@/prisma/prisma.module';
import { AddonModule } from '@/modules/addons/addon.module';

@Module({
  imports: [PrismaModule, AddonModule],
  controllers: [PriceComparisonsController],
  providers: [PriceComparisonsService],
  exports: [PriceComparisonsService],
})
export class PriceComparisonsModule {}
