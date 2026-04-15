import { Module } from '@nestjs/common';
import { AddonModule } from '@/modules/addons/addon.module';
import { PrismaModule } from '@/prisma/prisma.module';
import { StockMovementsController } from './stock-movements.controller';
import { StockMovementsService } from './stock-movements.service';

@Module({
  imports: [PrismaModule, AddonModule],
  controllers: [StockMovementsController],
  providers: [StockMovementsService],
  exports: [StockMovementsService],
})
export class StockMovementsModule {}
