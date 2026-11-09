import { Module } from '@nestjs/common';
import { KitchenController } from './kitchen.controller';
import { KitchenService } from './kitchen.service';
import { KitchenGateway } from './kitchen.gateway';
import { PrismaModule } from '../../../prisma/prisma.module';
import { AddonModule } from '../../addons/addon.module';
import { MenuModule } from '../menu/menu.module';
import { RecipesModule } from '../../inventory/recipes/recipes.module';

@Module({
  // RecipesModule: plate counts for the recipe drawer (readiness)
  imports: [PrismaModule, AddonModule, MenuModule, RecipesModule],
  controllers: [KitchenController],
  providers: [KitchenService, KitchenGateway],
  exports: [KitchenService, KitchenGateway],
})
export class KitchenModule {}
