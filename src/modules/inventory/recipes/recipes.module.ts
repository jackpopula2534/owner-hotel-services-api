import { Module } from '@nestjs/common';
import { RecipesService } from './recipes.service';
import { RecipesController } from './recipes.controller';
import { PrismaModule } from '../../../prisma/prisma.module';
import { AddonModule } from '../../addons/addon.module';

@Module({
  imports: [PrismaModule, AddonModule],
  controllers: [RecipesController],
  providers: [RecipesService],
  exports: [RecipesService],
})
export class RecipesModule {}
