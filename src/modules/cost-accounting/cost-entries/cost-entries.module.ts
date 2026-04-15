import { Module } from '@nestjs/common';
import { CostEntriesController } from './cost-entries.controller';
import { CostEntriesService } from './cost-entries.service';
import { PrismaService } from '@/prisma/prisma.service';
import { AddonModule } from '@/modules/addons/addon.module';

@Module({
  imports: [AddonModule],
  controllers: [CostEntriesController],
  providers: [CostEntriesService, PrismaService],
  exports: [CostEntriesService],
})
export class CostEntriesModule {}
