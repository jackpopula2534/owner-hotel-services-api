import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { QueueMonitorService } from './queue-monitor.service';
import { QueueMonitorController } from './queue-monitor.controller';

@Module({
  imports: [
    // Re-register queue tokens so we can inject them here. The actual
    // workers live in their own modules; this is just the producer side
    // for stats / retry / remove.
    BullModule.registerQueue(
      { name: 'email' },
      { name: 'inventory' },
      { name: 'data-export' },
      { name: 'opcost-snapshot' },
    ),
  ],
  controllers: [QueueMonitorController],
  providers: [QueueMonitorService],
  exports: [QueueMonitorService],
})
export class QueueMonitorModule {}
