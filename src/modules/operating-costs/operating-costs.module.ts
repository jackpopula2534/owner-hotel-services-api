import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { PrismaModule } from '../../prisma/prisma.module';
import { OperatingCostsController } from './operating-costs.controller';
import { OperatingCostsService } from './operating-costs.service';
import { SnapshotProcessor } from './snapshot/snapshot.processor';
import { SnapshotScheduler } from './snapshot/snapshot.scheduler';
import { OPCOST_SNAPSHOT_QUEUE } from './snapshot/snapshot.constants';

@Module({
  imports: [
    PrismaModule,
    BullModule.registerQueue({
      name: OPCOST_SNAPSHOT_QUEUE,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 10_000 },
        removeOnComplete: 30,
        removeOnFail: 10,
      },
    }),
  ],
  controllers: [OperatingCostsController],
  providers: [OperatingCostsService, SnapshotProcessor, SnapshotScheduler],
  exports: [OperatingCostsService, SnapshotScheduler],
})
export class OperatingCostsModule {}
