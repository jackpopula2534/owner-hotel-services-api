import { Module } from '@nestjs/common';
import { CostTypesService } from './cost-types.service';
import { CostTypesController } from './cost-types.controller';
import { PrismaService } from '@/prisma/prisma.service';
import { AddonModule } from '@/modules/addons/addon.module';

@Module({
  imports: [AddonModule],
  controllers: [CostTypesController],
  providers: [CostTypesService, PrismaService],
  exports: [CostTypesService],
})
export class CostTypesModule {}
