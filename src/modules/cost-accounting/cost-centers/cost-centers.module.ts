import { Module } from '@nestjs/common';
import { CostCentersService } from './cost-centers.service';
import { CostCentersController } from './cost-centers.controller';
import { PrismaService } from '@/prisma/prisma.service';
import { AddonModule } from '@/modules/addons/addon.module';

@Module({
  imports: [AddonModule],
  controllers: [CostCentersController],
  providers: [CostCentersService, PrismaService],
  exports: [CostCentersService],
})
export class CostCentersModule {}
