import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { AdminBillingCycleService } from './admin-billing-cycle.service';
import { bangkokToday } from '../common/billing/addon-billing';

/** ออกใบต่ออายุล่วงหน้ากี่วันก่อนสิ้นรอบ */
export const AUTO_RENEWAL_LEAD_DAYS = 7;

/**
 * ออกใบแจ้งหนี้ต่ออายุรายเดือนอัตโนมัติ 7 วันก่อน end_date — เดิมต้องให้แอดมินกดเอง
 * ค่า add-on แบบเก็บรอบบิลถัดไปจึงไม่เคยถูกเรียกเก็บ
 *
 * idempotent: renewSubscription ปฏิเสธเมื่อยังมีใบค้าง (OUTSTANDING_INVOICE_EXISTS) และเลื่อน
 * end_date ไปอีกรอบหลังออกใบ — รันซ้ำวันเดียวกันจึงไม่ออกใบซ้ำ
 * ปิดได้ด้วย AUTO_RENEWAL_INVOICES_ENABLED=false
 */
@Injectable()
export class SubscriptionAutoRenewalService {
  private readonly logger = new Logger(SubscriptionAutoRenewalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly billingCycle: AdminBillingCycleService,
    private readonly config: ConfigService,
  ) {}

  @Cron('30 1 * * *', { timeZone: 'Asia/Bangkok' })
  async issueDueRenewals(now = new Date()): Promise<{ issued: number; skipped: number }> {
    if (this.config.get<string>('AUTO_RENEWAL_INVOICES_ENABLED', 'true') === 'false') {
      return { issued: 0, skipped: 0 };
    }
    const horizon = bangkokToday(now);
    horizon.setUTCDate(horizon.getUTCDate() + AUTO_RENEWAL_LEAD_DAYS);

    const due = await this.prisma.subscriptions.findMany({
      where: {
        status: 'active',
        billing_cycle: 'monthly',
        auto_renew: 1,
        end_date: { lte: horizon },
      },
      select: { id: true, tenant_id: true },
    });

    let issued = 0;
    let skipped = 0;
    for (const sub of due) {
      try {
        await this.billingCycle.renewSubscription(sub.id, {
          periodMonths: 1,
          createInvoice: true,
          notes: 'ออกอัตโนมัติก่อนสิ้นรอบ',
        });
        issued += 1;
      } catch (err) {
        skipped += 1;
        // ใบค้างอยู่ = ปล่อยให้ dunning ตาม ไม่ใช่ข้อผิดพลาด
        if (!(err instanceof ConflictException)) {
          this.logger.error(
            `Auto renewal failed for subscription ${sub.id}: ${(err as Error).message}`,
          );
        }
      }
    }
    if (due.length) {
      this.logger.log(`Auto renewal invoices: ${issued} issued, ${skipped} skipped`);
    }
    return { issued, skipped };
  }
}
