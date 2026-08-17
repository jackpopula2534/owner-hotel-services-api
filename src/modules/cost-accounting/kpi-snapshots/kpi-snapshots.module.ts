import { Module } from '@nestjs/common';
import { PrismaModule } from '@/prisma/prisma.module';
import { KpiSnapshotsService } from './kpi-snapshots.service';
import { KpiSnapshotsController } from './kpi-snapshots.controller';
import { AddonModule } from '@/modules/addons/addon.module';
import { RevenueModule } from '@/modules/revenue/revenue.module';

@Module({
  // ฝั่งรายได้ของ KPI อ่านจากสมุดรายได้ ฝั่งต้นทุนยังเป็นของ cost_entries
  imports: [PrismaModule, AddonModule, RevenueModule],
  controllers: [KpiSnapshotsController],
  providers: [KpiSnapshotsService],
  exports: [KpiSnapshotsService],
})
export class KpiSnapshotsModule {}
