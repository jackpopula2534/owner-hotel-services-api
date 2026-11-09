import { Module } from '@nestjs/common';
import { PriceComparisonsController } from './price-comparisons.controller';
import { PriceComparisonsService } from './price-comparisons.service';
import { PrismaModule } from '@/prisma/prisma.module';
import { AddonModule } from '@/modules/addons/addon.module';
import { NotificationsModule } from '@/notifications/notifications.module';

// AuditLogModule is registered as @Global() so AuditLogService is auto-injectable.
@Module({
  imports: [PrismaModule, AddonModule, NotificationsModule],
  controllers: [PriceComparisonsController],
  providers: [PriceComparisonsService],
  exports: [PriceComparisonsService],
})
export class PriceComparisonsModule {}
