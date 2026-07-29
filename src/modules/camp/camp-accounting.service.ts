import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { applyLedgerBalances } from '../accounting/ledger/ledger-balance.util';

/**
 * CampAccountingService — ลงบัญชีรายได้ลานกางเต็นท์
 *
 * เดิม `recordPayment` เขียนแค่ตาราง camp_reservations อย่างเดียว ไม่มี JournalEntry เลย
 * หน้าบัญชีจึงเป็น 0 ทุกช่องแม้จะรับเงินแล้ว บริการนี้ปิดช่องว่างนั้น
 *
 * รูปแบบรายการ (cash basis — ลงตอนเงินเข้า เหมือนที่ฝั่งโรงแรมลงตอน checkout):
 * - DR เงินสด 1101            = ยอดที่รับ
 * - CR รายได้ลานกางเต็นท์ 4103 = ยอดที่รับ  (fallback 4101 ถ้า tenant ยังไม่มี 4103)
 *
 * ถ้า Chart of Accounts ยังไม่ได้ seed หรือ tenant ไม่มี property เลย → skip แบบ graceful
 * ห้ามทำให้การรับชำระของลานล้ม (ผู้ใช้กดรับเงินต้องสำเร็จเสมอ)
 */
@Injectable()
export class CampAccountingService {
  private readonly logger = new Logger(CampAccountingService.name);

  /** บัญชีเงินสด — ถ้าไม่มีก็ลงบัญชีไม่ได้เลย */
  private static readonly CASH_CODE = '1101';
  /** รายได้ลานกางเต็นท์ (เพิ่มใหม่) */
  private static readonly CAMP_REVENUE_CODE = '4103';
  /**
   * tenant ที่ seed ผังบัญชีไปก่อนที่จะมี 4103 จะยังไม่มีบัญชีนี้
   * ลงที่ "รายได้ค่าห้องพัก" แทนดีกว่าไม่ลงเลย (ยอดรวมยังถูก แค่แยกประเภทหยาบกว่า)
   */
  private static readonly FALLBACK_REVENUE_CODE = '4101';

  constructor(private readonly prisma: PrismaService) {}

  /**
   * เรียกหลังบันทึกการรับชำระสำเร็จแล้วเท่านั้น (หลัง commit)
   *
   * @param paymentSeq ลำดับที่ของการชำระในรายการนี้ (1 = ครั้งแรก) ใช้แยก JE ของแต่ละงวด
   *                   เพราะ camp เก็บประวัติการชำระเป็น JSON ไม่มี id ต่อรายการ
   */
  async postPaymentJournal(params: {
    tenantId: string;
    reservationId: string;
    reservationNo?: string | null;
    amount: number;
    paymentSeq: number;
    paidAt?: Date;
  }): Promise<void> {
    const { tenantId, reservationId, reservationNo, amount, paymentSeq } = params;
    const label = reservationNo ?? reservationId.slice(0, 8);
    const reference = `${label}#${paymentSeq}`;

    if (amount <= 0) return;

    // กันซ้ำ — เรียกซ้ำ (retry / backfill) ต้องไม่สร้าง JE ซ้อน
    const existing = await this.prisma.journalEntry.findFirst({
      where: { tenantId, sourceType: 'CAMP_PAYMENT', sourceId: reservationId, reference },
      select: { id: true },
    });
    if (existing) {
      this.logger.debug(`Camp journal already exists for ${reference}, skipped`);
      return;
    }

    // JournalEntry.propertyId เป็น required แต่ Campground ไม่มี propertyId
    // จึงผูกกับ property หลักของ tenant (isDefault ก่อน ไม่งั้นตัวที่สร้างก่อนสุด)
    const property = await this.prisma.property.findFirst({
      where: { tenantId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      select: { id: true },
    });
    if (!property) {
      this.logger.debug(`Camp journal skipped for ${reference}: tenant has no property`);
      return;
    }

    const accounts = await this.prisma.accountChart.findMany({
      where: {
        tenantId,
        code: {
          in: [
            CampAccountingService.CASH_CODE,
            CampAccountingService.CAMP_REVENUE_CODE,
            CampAccountingService.FALLBACK_REVENUE_CODE,
          ],
        },
      },
      select: { id: true, code: true },
    });
    const accountMap = new Map(accounts.map((a) => [a.code, a.id]));

    const cashId = accountMap.get(CampAccountingService.CASH_CODE);
    const revenueId =
      accountMap.get(CampAccountingService.CAMP_REVENUE_CODE) ??
      accountMap.get(CampAccountingService.FALLBACK_REVENUE_CODE);

    if (!cashId || !revenueId) {
      this.logger.debug(
        `Camp journal skipped for ${reference}: Chart of Accounts not seeded for tenant`,
      );
      return;
    }

    const entryDate = params.paidAt ?? new Date();
    const yearMonth = `${entryDate.getFullYear()}${String(entryDate.getMonth() + 1).padStart(2, '0')}`;
    const seq = await this.prisma.documentSequence.upsert({
      where: { tenantId_docType_yearMonth: { tenantId, docType: 'JE', yearMonth } },
      update: { lastNumber: { increment: 1 } },
      create: { tenantId, docType: 'JE', prefix: 'JE', yearMonth, lastNumber: 1 },
    });
    const entryNo = `JE-${yearMonth}-${String(seq.lastNumber).padStart(6, '0')}`;

    const description = `รับชำระลานกางเต็นท์ ${label}`;

    const fiscalPeriod = entryDate.getMonth() + 1;
    const fiscalYear = entryDate.getFullYear();
    const lines = [
      { accountId: cashId, lineNo: 1, description, debit: amount, credit: 0 },
      { accountId: revenueId, lineNo: 2, description, debit: 0, credit: amount },
    ];

    // สร้าง JE พร้อมอัปเดต ledger_balances ใน transaction เดียว — งบทดลอง/งบกำไรขาดทุน
    // อ่านจาก ledger_balances ไม่ได้อ่าน journal_entries ถ้าไม่บวกยอดตรงนี้ หน้าบัญชีจะขึ้น 0
    await this.prisma.$transaction(async (tx) => {
      await tx.journalEntry.create({
        data: {
          tenantId,
          propertyId: property.id,
          entryNo,
          entryDate,
          description,
          reference,
          sourceType: 'CAMP_PAYMENT',
          sourceId: reservationId,
          status: 'POSTED',
          fiscalPeriod,
          fiscalYear,
          totalDebit: amount,
          totalCredit: amount,
          createdBy: 'system',
          lines: { create: lines },
        },
      });

      await applyLedgerBalances(
        tx,
        { tenantId, propertyId: property.id, fiscalYear, fiscalPeriod },
        lines,
      );
    });

    this.logger.log(`Journal entry ${entryNo} created for camp payment ${reference}: ${amount} THB`);
  }

  /**
   * สร้าง JE ย้อนหลังให้การชำระของลานที่เกิดก่อนมีระบบนี้
   * อ่านประวัติจากคอลัมน์ JSON `payments` ของแต่ละการจอง
   *
   * การจองเก่าที่มี amountPaid แต่ไม่มีประวัติใน `payments` จะถูกลงเป็นรายการเดียว (seq 1)
   */
  async backfillJournals(
    tenantId?: string,
  ): Promise<{ processed: number; created: number; skipped: number; errors: number }> {
    if (!tenantId) {
      return { processed: 0, created: 0, skipped: 0, errors: 0 };
    }

    const reservations = await this.prisma.campReservation.findMany({
      where: {
        status: { in: ['confirmed', 'checked_in', 'checked_out'] },
        // tenantId เป็น nullable — รับแถวเก่าที่ไม่มีค่า โดยบังคับว่าลานต้องเป็นของ tenant นี้
        OR: [{ tenantId }, { tenantId: null, campground: { tenantId } }],
      },
      select: {
        id: true,
        reservationNo: true,
        amountPaid: true,
        payments: true,
      },
    });

    let created = 0;
    let skipped = 0;
    let errors = 0;
    let processed = 0;

    for (const reservation of reservations) {
      const installments = this.toInstallments(reservation.payments, reservation.amountPaid);
      if (installments.length === 0) {
        skipped++;
        continue;
      }

      for (let i = 0; i < installments.length; i++) {
        processed++;
        try {
          const before = await this.prisma.journalEntry.count({
            where: {
              tenantId,
              sourceType: 'CAMP_PAYMENT',
              sourceId: reservation.id,
              reference: `${reservation.reservationNo ?? reservation.id.slice(0, 8)}#${i + 1}`,
            },
          });

          await this.postPaymentJournal({
            tenantId,
            reservationId: reservation.id,
            reservationNo: reservation.reservationNo,
            amount: installments[i].amount,
            paymentSeq: i + 1,
            paidAt: installments[i].at,
          });

          if (before > 0) skipped++;
          else created++;
        } catch (err: unknown) {
          errors++;
          this.logger.error(
            `Camp backfill failed for ${reservation.id}#${i + 1}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
    }

    this.logger.log(
      `Camp backfill complete: ${processed} processed, ${created} created, ${skipped} skipped, ${errors} errors`,
    );
    return { processed, created, skipped, errors };
  }

  /**
   * แปลงคอลัมน์ JSON `payments` เป็นรายการงวดที่ลงบัญชีได้
   * ถ้าไม่มีประวัติแต่มี amountPaid > 0 (ข้อมูลเก่า) ให้ถือเป็นงวดเดียว
   */
  private toInstallments(
    payments: unknown,
    amountPaid: unknown,
  ): Array<{ amount: number; at?: Date }> {
    if (Array.isArray(payments) && payments.length > 0) {
      return payments
        .map((p) => {
          const record = p as { amount?: unknown; at?: unknown };
          const amount = Number(record?.amount ?? 0);
          const at = typeof record?.at === 'string' ? new Date(record.at) : undefined;
          return { amount, at: at && !isNaN(at.getTime()) ? at : undefined };
        })
        .filter((p) => p.amount > 0);
    }

    const total = Number(amountPaid ?? 0);
    return total > 0 ? [{ amount: total }] : [];
  }
}
