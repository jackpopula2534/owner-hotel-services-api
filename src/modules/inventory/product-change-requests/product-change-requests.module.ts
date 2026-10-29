import { Module } from '@nestjs/common';
import { PrismaModule } from '@/prisma/prisma.module';
import { AddonModule } from '@/modules/addons/addon.module';
import { NotificationsModule } from '@/notifications/notifications.module';
import { ProductChangeRequestsController } from './product-change-requests.controller';
import { ProductChangeRequestsService } from './product-change-requests.service';
import { ProductChangeQueriesService } from './product-change-queries.service';
import { ProductChangeApplyService } from './product-change-apply.service';
import { ProductChangeNotifierService } from './product-change-notifier.service';
import { ProductChangeRequestsScheduler } from './product-change-requests.scheduler';

@Module({
  imports: [PrismaModule, AddonModule, NotificationsModule],
  controllers: [ProductChangeRequestsController],
  providers: [
    ProductChangeRequestsService,
    ProductChangeQueriesService,
    ProductChangeApplyService,
    ProductChangeNotifierService,
    ProductChangeRequestsScheduler,
  ],
  exports: [ProductChangeRequestsService, ProductChangeQueriesService],
})
export class ProductChangeRequestsModule {}
