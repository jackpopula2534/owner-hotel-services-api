import type { PrismaService } from '@/prisma/prisma.service';

/**
 * ปิดธุรกรรม PromptPay ของการจองจากหน้าเว็บ (สถานะ verified) หลังโรงแรมยืนยันยอดโอน
 *
 * จองหลายห้อง = QR ใบเดียวแต่มีแถว payment qr รอตรวจในใบแจ้งหนี้ของแต่ละห้อง
 * → verified เมื่อยืนยันครบทุกห้องในกลุ่มแล้วเท่านั้น ไม่งั้นแขกเห็นว่า "ชำระแล้ว"
 * ทั้งที่บางห้องยังไม่ถูกตรวจ
 *
 * ใช้ร่วมกันทั้ง Guest Folio และหน้าอนุมัติการชำระ (PaymentsService.approvePayment)
 */
export async function markWebsiteQrVerified(
  prisma: Pick<PrismaService, 'booking' | 'payments' | 'promptPayTransaction'>,
  booking: { id: string; bookingGroupId: string | null },
  tenantId: string,
): Promise<void> {
  let bookingIds = [booking.id];
  if (booking.bookingGroupId) {
    const group = await prisma.booking.findMany({
      where: { tenantId, bookingGroupId: booking.bookingGroupId },
      select: { id: true },
    });
    bookingIds = group.map((b) => b.id);
    const stillPending = await prisma.payments.count({
      where: {
        method: 'qr',
        status: 'pending',
        invoices: { tenant_id: tenantId, booking_id: { in: bookingIds } },
      },
    });
    if (stillPending > 0) return;
  }
  await prisma.promptPayTransaction.updateMany({
    where: { bookingId: { in: bookingIds }, tenantId, status: { in: ['pending', 'expired'] } },
    data: { status: 'verified', verifiedAt: new Date() },
  });
}
