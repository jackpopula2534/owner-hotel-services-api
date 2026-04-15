import { Module } from '@nestjs/common';
import { AddonModule } from '@/modules/addons/addon.module';
import { PrismaModule } from '@/prisma/prisma.module';
import { ReorderAlertsService } from './reorder-alerts.service';
import { ReorderAlertsController } from './reorder-alerts.controller';

@Module({
  imports: [PrismaModule, AddonModule],
  controllers: [ReorderAlertsController],
  providers: [ReorderAlertsService],
  exports: [ReorderAlertsService],
})
export class ReorderAlertsModule {}
