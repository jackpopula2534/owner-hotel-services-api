import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { ItemPriceEstimateService } from './item-price-estimate.service';

/**
 * Price references shared by anything that raises a purchase document. Kept in
 * its own module so the kitchen and procurement sides cannot drift into two
 * different ideas of what an item is worth.
 */
@Module({
  imports: [PrismaModule],
  providers: [ItemPriceEstimateService],
  exports: [ItemPriceEstimateService],
})
export class InventoryPricingModule {}
