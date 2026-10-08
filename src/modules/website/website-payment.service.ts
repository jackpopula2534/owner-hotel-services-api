import { createHmac, timingSafeEqual } from 'crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentAccount, PromptPayTransactionStatus } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { PromptPayService } from '../../promptpay/promptpay.service';
import { StorageService, UploadableFile } from '../../common/storage/storage.service';
import { WebsitePublicService } from './website-public.service';
import { DepositPolicy, readDepositPolicy } from './website-deposit';

/** QR ของการจองหน้าเว็บมีอายุเท่านี้ — แขกยังแนบสลิปได้หลังหมดอายุ (โอนช่วงท้าย ๆ) */
export const WEBSITE_QR_EXPIRY_MINUTES = 30;
export const SLIP_MAX_BYTES = 5 * 1024 * 1024;
const SLIP_MIME = /^image\/(jpeg|png|webp)$/;

export interface WebsitePromptPayInfo {
  method: 'PROMPTPAY';
  transactionRef: string;
  /** ใช้คู่กับ transactionRef เพื่อดูสถานะ/แนบสลิป (แขกไม่มี session) */
  token: string;
  qrCodeImage: string;
  /** ยอดที่ต้องโอนตอนนี้ (มัดจำ หรือยอดเต็ม) */
  amount: number;
  /** ยอดรวมของการจอง */
  grandTotal: number;
  /** ส่วนที่เหลือชำระที่โรงแรม — 0 = โอนเต็มจำนวน */
  balanceDue: number;
  isDeposit: boolean;
  expiresAt: string;
  accountName: string | null;
  promptpayId: string;
}

export interface WebsitePaymentStatus {
  transactionRef: string;
  /** pending = รอโอน/รอตรวจ, paid/verified = โรงแรมยืนยันยอดแล้ว */
  status: PromptPayTransactionStatus;
  amount: number;
  expiresAt: string;
  slipUploaded: boolean;
  bookingStatus: string | null;
}

/**
 * ชำระเงิน PromptPay ของการจองจากหน้าเว็บโรงแรม
 *
 * - เงินเข้าบัญชี PromptPay ของโรงแรมเอง (payment_accounts ของ property) — ไม่ใช้ PROMPTPAY_ID
 *   ใน env ซึ่งเป็นบัญชีของแพลตฟอร์ม
 * - QR เป็น PromptPay ส่วนตัว ไม่มี gateway แจ้งกลับ → แขกแนบสลิป แล้วพนักงานตรวจยอดและยืนยัน
 * - หน้า public ไม่มี session: สิทธิ์ดูสถานะ/แนบสลิป = HMAC(transactionRef) ที่ส่งให้ตอนจอง
 */
@Injectable()
export class WebsitePaymentService {
  private readonly logger = new Logger(WebsitePaymentService.name);
  private readonly secret: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly promptPay: PromptPayService,
    private readonly storage: StorageService,
    private readonly publicSites: WebsitePublicService,
  ) {
    this.secret = this.config.get<string>('JWT_SECRET', '');
  }

  /** บัญชี PromptPay ที่ใช้รับเงินบนเว็บ (default ก่อน) — null = โรงแรมยังไม่เปิดรับ */
  findPromptPayAccount(propertyId: string): Promise<PaymentAccount | null> {
    return this.prisma.paymentAccount.findFirst({
      where: { propertyId, kind: 'promptpay', isActive: true, promptpayId: { not: null } },
      orderBy: [{ isDefault: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /** นโยบายมัดจำของการจองหน้าเว็บ (ยังไม่ตั้ง = โอนเต็มจำนวน) */
  async findDepositPolicy(propertyId: string): Promise<DepositPolicy> {
    const settings = await this.prisma.paymentSettings.findUnique({
      where: { propertyId },
      select: { websiteDepositType: true, websiteDepositValue: true },
    });
    return readDepositPolicy(settings);
  }

  /**
   * สร้าง QR ใบเดียวของการจอง (หนึ่งห้องหรือหลายห้อง) — ผูกกับ invoice ของห้องแรก
   * shares = ยอดที่ขอโอนของแต่ละห้อง (มัดจำหรือยอดเต็ม); ใบแจ้งหนี้ยังเป็นยอดเต็ม ส่วนที่เหลือรับที่ folio
   */
  async createPromptPayCharge(params: {
    tenantId: string;
    shares: Array<{ bookingId: string; amount: number }>;
    grandTotal: number;
    account: PaymentAccount;
  }): Promise<WebsitePromptPayInfo> {
    const invoices = await this.prisma.invoices.findMany({
      where: {
        booking_id: { in: params.shares.map((s) => s.bookingId) },
        tenant_id: params.tenantId,
      },
      select: { id: true, booking_id: true },
    });
    const invoiceOf = new Map(invoices.map((i) => [i.booking_id, i.id]));
    const primary = params.shares[0];
    const amount = Math.round(params.shares.reduce((sum, s) => sum + s.amount, 0) * 100) / 100;
    const qr = await this.promptPay.generateQRCode({
      tenantId: params.tenantId,
      bookingId: primary.bookingId,
      invoiceId: invoiceOf.get(primary.bookingId),
      amount,
      promptpayId: params.account.promptpayId ?? undefined,
      expiryMinutes: WEBSITE_QR_EXPIRY_MINUTES,
    });
    // แถว qr ที่รอตรวจของแต่ละ invoice เก็บยอดที่ขอโอนจริงของห้องนั้น — ไม่ปล่อยเป็น null
    // ซึ่งการอนุมัติจะถือว่าเป็นยอดเต็มของใบแจ้งหนี้
    for (const share of params.shares) {
      const pending = await this.findPendingPayment(invoiceOf.get(share.bookingId) ?? null);
      if (!pending) continue;
      await this.prisma.payments.update({
        where: { id: pending.id },
        data: { amount: share.amount, tenant_id: params.tenantId },
      });
    }
    return {
      method: 'PROMPTPAY',
      transactionRef: qr.transactionRef,
      token: this.sign(qr.transactionRef),
      qrCodeImage: qr.qrCodeImage,
      amount: qr.amount,
      grandTotal: params.grandTotal,
      balanceDue: Math.max(0, Math.round((params.grandTotal - qr.amount) * 100) / 100),
      isDeposit: qr.amount < params.grandTotal,
      expiresAt: new Date(qr.expiresAt).toISOString(),
      accountName: params.account.accountName,
      promptpayId: qr.promptpayId,
    };
  }

  async getStatus(slug: string, ref: string, token: string): Promise<WebsitePaymentStatus> {
    const { tx } = await this.load(slug, ref, token);
    const [booking, slip] = await Promise.all([
      tx.bookingId
        ? this.prisma.booking.findFirst({
            where: { id: tx.bookingId, tenantId: tx.tenantId },
            select: { status: true },
          })
        : null,
      tx.invoiceId
        ? this.prisma.payments.findFirst({
            where: { invoice_id: tx.invoiceId, method: 'qr', slip_url: { not: null } },
            select: { slip_url: true },
          })
        : null,
    ]);
    const expired = tx.status === 'pending' && tx.expiresAt < new Date();
    return {
      transactionRef: tx.transactionRef,
      status: expired ? 'expired' : tx.status,
      amount: Number(tx.amount),
      expiresAt: tx.expiresAt.toISOString(),
      slipUploaded: Boolean(slip?.slip_url),
      bookingStatus: booking?.status ?? null,
    };
  }

  /**
   * แขกแนบสลิป → เก็บไฟล์ + ผูกกับ payment ที่ค้าง (method qr) ของ invoice แล้วแจ้งพนักงาน
   * แนบซ้ำได้ (ทับไฟล์เดิม) จนกว่าโรงแรมจะยืนยันยอด
   */
  async uploadSlip(
    slug: string,
    ref: string,
    token: string,
    file: (UploadableFile & { size: number }) | undefined,
  ): Promise<WebsitePaymentStatus> {
    if (!file) throw new BadRequestException('กรุณาแนบรูปสลิปการโอนเงิน');
    if (!SLIP_MIME.test(file.mimetype)) {
      throw new BadRequestException('รองรับเฉพาะรูปภาพ JPG, PNG หรือ WebP');
    }
    if (file.size > SLIP_MAX_BYTES) throw new BadRequestException('ไฟล์ใหญ่เกิน 5 MB');

    const { tx, site } = await this.load(slug, ref, token);
    if (tx.status === 'paid' || tx.status === 'verified') {
      return this.getStatus(slug, ref, token);
    }
    if (tx.status !== 'pending' && tx.status !== 'expired') {
      throw new BadRequestException('รายการชำระเงินนี้ถูกยกเลิกแล้ว กรุณาติดต่อโรงแรม');
    }
    // จองหลายห้อง: QR ใบเดียวครอบทุกห้องในชุด → สลิปเดียวผูกกับแถวที่รอตรวจของทุก invoice
    const group = await this.groupOf(tx);
    const pendings = (
      await Promise.all(group.invoiceIds.map((id) => this.findPendingPayment(id)))
    ).filter((p): p is NonNullable<typeof p> => Boolean(p));
    if (!pendings.length) {
      throw new BadRequestException('ไม่พบรายการชำระเงินที่รอตรวจสอบ กรุณาติดต่อโรงแรม');
    }

    const saved = await this.storage.save({
      folder: 'payment-slips',
      file,
      prefix: `web-${tx.transactionRef}`,
    });
    for (const payment of pendings) {
      await this.prisma.payments.update({
        where: { id: payment.id },
        data: {
          slip_url: saved.path,
          tenant_id: tx.tenantId,
          // ห้องเดียว = ยอดของ QR; หลายห้องคงยอดที่แบ่งไว้ตอนสร้าง QR
          ...(group.bookings.length <= 1 ? { amount: tx.amount } : {}),
        },
      });
    }

    const lead = group.bookings[0];
    const reference = (tx.bookingId ?? '').slice(0, 8).toUpperCase();
    const rooms =
      group.bookings.length > 1
        ? ` (${group.bookings.length} ห้อง: ${group.bookings
            .map(
              (b) =>
                `#${String(b.bookingNo ?? b.id.slice(0, 8)).toUpperCase()} ฿${Number(pendings.find((p) => p.invoice_id === group.invoiceOf.get(b.id))?.amount ?? 0).toLocaleString('en-US')}`,
            )
            .join(', ')} — ยืนยันใน Guest Folio ของแต่ละห้อง)`
        : '';
    await this.publicSites.notifyStaff(site.tenantId, {
      refId: tx.bookingId ?? tx.id,
      title: 'แขกแนบสลิป PromptPay — รอตรวจยอด',
      message: `${lead ? `${lead.guestFirstName} ${lead.guestLastName} ` : ''}แนบสลิปการจอง #${reference} ยอด ฿${Number(tx.amount).toLocaleString('en-US')}${rooms} กรุณาตรวจยอดเข้าบัญชีแล้วกดยืนยันการชำระ`,
    });
    this.logger.log(`slip uploaded for ${tx.transactionRef} (booking ${tx.bookingId})`);

    return this.getStatus(slug, ref, token);
  }

  // ─── internals ───────────────────────────────────────────────────────

  private async load(slug: string, ref: string, token: string) {
    if (!this.verify(ref, token)) throw new ForbiddenException('ลิงก์ชำระเงินไม่ถูกต้อง');
    const site = await this.publicSites.findPublishedSite(slug);
    const tx = await this.prisma.promptPayTransaction.findFirst({
      where: { transactionRef: ref, tenantId: site.tenantId },
    });
    if (!tx) throw new NotFoundException('ไม่พบรายการชำระเงิน');
    return { tx, site };
  }

  /** การจองทั้งชุดของ QR นี้ (ห้องเดียวหรือหลายห้องที่มี bookingGroupId เดียวกัน) พร้อม invoice ของแต่ละห้อง */
  private async groupOf(tx: {
    tenantId: string | null;
    bookingId: string | null;
    invoiceId: string | null;
  }) {
    const select = {
      id: true,
      bookingNo: true,
      bookingGroupId: true,
      guestFirstName: true,
      guestLastName: true,
    } as const;
    const lead = tx.bookingId
      ? await this.prisma.booking.findFirst({
          where: { id: tx.bookingId, tenantId: tx.tenantId },
          select,
        })
      : null;
    const bookings = lead?.bookingGroupId
      ? await this.prisma.booking.findMany({
          where: { tenantId: tx.tenantId, bookingGroupId: lead.bookingGroupId },
          select,
          orderBy: { createdAt: 'asc' },
        })
      : lead
        ? [lead]
        : [];
    if (bookings.length <= 1) {
      return {
        bookings,
        invoiceIds: tx.invoiceId ? [tx.invoiceId] : [],
        invoiceOf: new Map(lead && tx.invoiceId ? [[lead.id, tx.invoiceId]] : []),
      };
    }
    const invoices = await this.prisma.invoices.findMany({
      where: { tenant_id: tx.tenantId, booking_id: { in: bookings.map((b) => b.id) } },
      select: { id: true, booking_id: true },
    });
    return {
      bookings,
      invoiceIds: invoices.map((i) => i.id),
      invoiceOf: new Map(invoices.map((i) => [i.booking_id ?? '', i.id])),
    };
  }

  private findPendingPayment(invoiceId: string | null) {
    if (!invoiceId) return Promise.resolve(null);
    return this.prisma.payments.findFirst({
      where: { invoice_id: invoiceId, method: 'qr', status: 'pending' },
      orderBy: { created_at: 'desc' },
    });
  }

  private sign(ref: string): string {
    if (!this.secret) throw new Error('JWT_SECRET is required to sign website payment links');
    return createHmac('sha256', this.secret)
      .update(`website-payment:${ref}`)
      .digest('base64url')
      .slice(0, 32);
  }

  private verify(ref: string, token: string): boolean {
    if (!ref || !token || !this.secret) return false;
    const a = Buffer.from(this.sign(ref));
    const b = Buffer.from(String(token));
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
