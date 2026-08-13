import { Module } from '@nestjs/common';
import { RecipesService } from './recipes.service';
import { RecipeReadinessService } from './recipe-readiness.service';
import { RecipeLinkingService } from './recipe-linking.service';
import { RecipeRequisitionService } from './recipe-requisition.service';
import { MaterialRequisitionService } from './material-requisition.service';
import { MaterialRequisitionListener } from './material-requisition.listener';
import { RecipesController } from './recipes.controller';
import { PrismaModule } from '../../../prisma/prisma.module';
import { AddonModule } from '../../addons/addon.module';
import { IntegrationsModule } from '../../integrations/integrations.module';
import { StockMovementsModule } from '../stock-movements/stock-movements.module';
import { InventoryPricingModule } from '../pricing/pricing.module';
import { NotificationsModule } from '../../../notifications/notifications.module';

@Module({
  // Requisitions turn recipes into real stock movements, and only when the
  // Integration Hub switch for it is on — hence both extra imports. Notifications
  // are how a requisition waiting on a purchase order announces itself once the
  // goods receipt lands.
  imports: [
    PrismaModule,
    AddonModule,
    IntegrationsModule,
    StockMovementsModule,
    NotificationsModule,
    InventoryPricingModule,
  ],
  controllers: [RecipesController],
  providers: [
    RecipesService,
    RecipeReadinessService,
    RecipeLinkingService,
    RecipeRequisitionService,
    MaterialRequisitionService,
    MaterialRequisitionListener,
  ],
  exports: [
    RecipesService,
    RecipeReadinessService,
    RecipeLinkingService,
    RecipeRequisitionService,
    MaterialRequisitionService,
  ],
})
export class RecipesModule {}
