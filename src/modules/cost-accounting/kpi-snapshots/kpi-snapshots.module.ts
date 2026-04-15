import { Module } from '@nestjs/common';
import { PrismaModule } from '@/prisma/prisma.module';
import { KpiSnapshotsService } from './kpi-snapshots.service';
import { KpiSnapshotsController } from './kpi-snapshots.controller';
import { AddonModule } from '@/modules/addons/addon.module';

@Module({
  imports: [PrismaModule, AddonModule],
  controllers: [KpiSnapshotsController],
  providers: [KpiSnapshotsService],
  exports: [KpiSnapshotsService],
})
export class KpiSnapshotsModule {}
