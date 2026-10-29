import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ProductChangeRequestsService } from './product-change-requests.service';

/** ใช้ค่าใหม่ของคำขอแก้ไขสินค้าที่อนุมัติแล้วเมื่อถึงวันมีผล */
@Injectable()
export class ProductChangeRequestsScheduler {
  private readonly logger = new Logger(ProductChangeRequestsScheduler.name);
  private running = false;

  constructor(private readonly service: ProductChangeRequestsService) {}

  @Cron(CronExpression.EVERY_10_MINUTES, { name: 'product-change-requests-apply-due' })
  async applyDue(): Promise<void> {
    // กันรอบซ้อนในโปรเซสเดียวกัน ถ้ารอบก่อนยังไม่จบ
    if (this.running) return;
    this.running = true;
    try {
      const applied = await this.service.applyDueUpdates();
      if (applied > 0) this.logger.log(`Applied ${applied} scheduled product change request(s)`);
    } catch (error) {
      this.logger.error(
        `applyDue failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.running = false;
    }
  }
}
