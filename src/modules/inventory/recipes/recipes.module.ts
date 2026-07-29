import { Module } from '@nestjs/common';
import { RecipesService } from './recipes.service';
import { RecipeReadinessService } from './recipe-readiness.service';
import { RecipeLinkingService } from './recipe-linking.service';
import { RecipesController } from './recipes.controller';
import { PrismaModule } from '../../../prisma/prisma.module';
import { AddonModule } from '../../addons/addon.module';

@Module({
  imports: [PrismaModule, AddonModule],
  controllers: [RecipesController],
  providers: [RecipesService, RecipeReadinessService, RecipeLinkingService],
  exports: [RecipesService, RecipeReadinessService, RecipeLinkingService],
})
export class RecipesModule {}
