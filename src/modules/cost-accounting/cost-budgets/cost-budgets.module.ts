import { Module } from '@nestjs/common';
import { CostBudgetsController } from './cost-budgets.controller';
import { CostBudgetsService } from './cost-budgets.service';
import { PrismaService } from '@/prisma/prisma.service';
import { AddonModule } from '@/modules/addons/addon.module';

@Module({
  imports: [AddonModule],
  controllers: [CostBudgetsController],
  providers: [CostBudgetsService, PrismaService],
  exports: [CostBudgetsService],
})
export class CostBudgetsModule {}
