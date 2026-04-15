import { Module } from '@nestjs/common';
import { PrismaModule } from '@/prisma/prisma.module';
import { KpiSnapshotsModule } from '../kpi-snapshots/kpi-snapshots.module';
import { DashboardWidgetsService } from './dashboard-widgets.service';
import { DashboardWidgetsController } from './dashboard-widgets.controller';
import { AddonModule } from '@/modules/addons/addon.module';

@Module({
  imports: [PrismaModule, KpiSnapshotsModule, AddonModule],
  controllers: [DashboardWidgetsController],
  providers: [DashboardWidgetsService],
  exports: [DashboardWidgetsService],
})
export class DashboardWidgetsModule {}
