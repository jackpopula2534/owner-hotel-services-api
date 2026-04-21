import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { INVENTORY_QUEUE, INVENTORY_JOBS } from './inventory.queue.processor';

@Injectable()
export class InventoryQueueScheduler implements OnModuleInit {
  private readonly logger = new Logger(InventoryQueueScheduler.name);

  constructor(@InjectQueue(INVENTORY_QUEUE) private readonly inventoryQueue: Queue) {}

  async onModuleInit() {
    // Remove existing repeatable jobs before re-registering
    const repeatable = await this.inventoryQueue.getRepeatableJobs();
    for (const job of repeatable) {
      await this.inventoryQueue.removeRepeatableByKey(job.key);
    }

    // Daily 00:05 — Auto expire lots
    await this.inventoryQueue.add(
      INVENTORY_JOBS.AUTO_EXPIRE_LOTS,
      {},
      { repeat: { cron: '5 0 * * *' }, removeOnComplete: 50 },
    );

    // Daily 06:00 — Check near-expiry
    await this.inventoryQueue.add(
      INVENTORY_JOBS.CHECK_NEAR_EXPIRY,
      { daysBefore: [30, 14, 7, 1] },
      { repeat: { cron: '0 6 * * *' }, removeOnComplete: 50 },
    );

    // Every 4 hours — QC reminder
    await this.inventoryQueue.add(
      INVENTORY_JOBS.QC_REMINDER,
      {},
      { repeat: { cron: '0 */4 * * *' }, removeOnComplete: 50 },
    );

    this.logger.log('Inventory scheduled jobs registered');
  }
}
