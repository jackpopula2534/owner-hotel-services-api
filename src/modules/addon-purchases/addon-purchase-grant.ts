import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { addMonthsUtc } from '../../common/billing/addon-billing';

// แยกไฟล์จาก AddonPurchaseService: PaymentsService / PromptPayService เรียกได้โดยไม่วน import

type Db = Prisma.TransactionClient | PrismaService;

/**
 * ให้สิทธิ์ add-on ของใบแจ้งหนี้ที่เพิ่งอนุมัติการชำระ — เรียกใน transaction เดียวกับ
 * PaymentsService.approvePayment / webhook PromptPay ถ้าล้มทั้งการอนุมัติจะ rollback
 *
 * คิดเต็มเดือน: เริ่มนับจากวันหมดอายุเดิมถ้ายังไม่หมด (ต่ออายุไม่เสียวัน) ไม่งั้นนับจากตอนอนุมัติ
 * idempotent: claim แถว pending → paid ด้วย updateMany ได้ครั้งเดียว
 */
export async function grantAddonPurchaseForInvoice(
  db: Db,
  invoiceId: string,
  tenantId: string | null,
  now: Date = new Date(),
): Promise<{ addonCode: string; periodStart: Date; periodEnd: Date } | null> {
  if (!tenantId) return null;
  const purchase = await db.addonPurchase.findFirst({
    where: { invoiceId, tenantId, status: 'pending' },
  });
  if (!purchase) return null;

  const latest = await db.addonPurchase.findFirst({
    where: { tenantId, addonCode: purchase.addonCode, status: 'paid' },
    orderBy: { periodEnd: 'desc' },
    select: { periodEnd: true },
  });
  const periodStart =
    latest?.periodEnd && latest.periodEnd > now ? new Date(latest.periodEnd) : now;
  const periodEnd = addMonthsUtc(periodStart, purchase.months);

  const claim = await db.addonPurchase.updateMany({
    where: { id: purchase.id, tenantId, status: 'pending' },
    data: { status: 'paid', periodStart, periodEnd, paidAt: now },
  });
  if (claim.count === 0) return null;
  return { addonCode: purchase.addonCode, periodStart, periodEnd };
}
