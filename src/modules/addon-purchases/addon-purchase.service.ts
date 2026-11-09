import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AddonService } from '../addons/addon.service';
import { PromptPayService } from '../../promptpay/promptpay.service';
import { addMonthsUtc, utcMidnight } from '../../common/billing/addon-billing';
import { grantAddonPurchaseForInvoice } from './addon-purchase-grant';

export { addMonthsUtc, grantAddonPurchaseForInvoice };

/** ใบแจ้งหนี้ซื้อ add-on ใช้ prefix นี้เสมอ — dunning ข้ามใบพวกนี้ (ไม่จ่าย = ไม่ได้ add-on ไม่ใช่ค้างชำระ) */
export const ADDON_PURCHASE_INVOICE_PREFIX = 'INV-ADD-';
export const ADDON_PURCHASE_VAT_RATE = 7;
/** วันครบกำหนดของใบแจ้งหนี้ — เลยกำหนดแล้วกดซื้อใหม่จะยกเลิกใบเก่าแล้วออกใบใหม่ตามราคาปัจจุบัน */
export const ADDON_PURCHASE_DUE_DAYS = 7;

/** สถานะสิทธิ์ที่ซื้อแล้ว (ถาวร) — ซื้อซ้ำไม่ได้ */
const PERMANENT_SOURCES = new Set(['plan', 'subscription']);

export interface AddonPurchaseView {
  id: string;
  addonCode: string;
  status: string;
  months: number;
  unitPrice: number;
  periodStart: string | null;
  periodEnd: string | null;
  paidAt: string | null;
  createdAt: string;
  invoice: {
    id: string;
    invoiceNo: string;
    subtotal: number;
    vatRate: number;
    vatAmount: number;
    amount: number;
    status: string;
    dueDate: string;
  } | null;
  /** สลิปล่าสุดของใบแจ้งหนี้นี้ — null = ยังไม่ส่ง */
  latestPayment: { id: string; status: string; createdAt: string } | null;
}

export interface AddonPurchaseSummary {
  addonCode: string;
  /** ใบที่รอชำระอยู่ (ถ้ามี) */
  pending: AddonPurchaseView | null;
  /** วันหมดอายุของช่วงที่จ่ายแล้วล่าสุด — ต่ออายุจะเริ่มนับจากวันนี้ถ้ายังไม่หมด */
  paidUntil: string | null;
}

export interface AddonPurchaseQr {
  transactionRef: string;
  qrCodeImage: string;
  amount: number;
  expiresAt: string;
}

/** QR หมดอายุ 15 นาที — สั้นพอกันสแกนซ้ำใบเก่า ยาวพอโอนผ่านแอปธนาคาร */
const PROMPTPAY_EXPIRY_MINUTES = 15;

/** ซื้อ add-on แบบรายเดือนด้วยตัวเอง: ออกใบแจ้งหนี้ → ลูกค้าโอน+แนบสลิป → แอดมินแพลตฟอร์มอนุมัติ */
@Injectable()
export class AddonPurchaseService {
  private readonly logger = new Logger(AddonPurchaseService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly addonService: AddonService,
    private readonly promptPay: PromptPayService,
  ) {}

  /**
   * QR PromptPay ของใบที่รอชำระ — ยอดมาจากใบแจ้งหนี้เท่านั้น (ห้ามรับยอดจาก client)
   * webhook ยืนยันยอดครบ → PromptPayService ให้สิทธิ์ด้วย grantAddonPurchaseForInvoice อัตโนมัติ
   */
  async createPromptPayQr(tenantId: string, purchaseId: string): Promise<AddonPurchaseQr> {
    const purchase = await this.prisma.addonPurchase.findFirst({
      where: { id: purchaseId, tenantId },
    });
    if (!purchase) throw new NotFoundException('ไม่พบรายการซื้อ');
    if (purchase.status !== 'pending')
      throw new ConflictException('รายการนี้ชำระแล้วหรือถูกยกเลิก');
    const invoice = await this.prisma.invoices.findFirst({
      where: { id: purchase.invoiceId, tenant_id: tenantId },
      select: { id: true, amount: true, status: true, due_date: true },
    });
    if (!invoice || invoice.status !== 'pending' || invoice.due_date < utcMidnight(new Date())) {
      throw new ConflictException('ใบแจ้งหนี้หมดอายุ กรุณากดซื้อใหม่');
    }
    const qr = await this.promptPay.generateQRCode({
      amount: Number(invoice.amount),
      invoiceId: invoice.id,
      tenantId,
      expiryMinutes: PROMPTPAY_EXPIRY_MINUTES,
    });
    return {
      transactionRef: qr.transactionRef,
      qrCodeImage: qr.qrCodeImage,
      amount: Number(invoice.amount),
      expiresAt: new Date(qr.expiresAt).toISOString(),
    };
  }

  async createPurchase(
    tenantId: string,
    userId: string | null,
    addonCode: string,
  ): Promise<AddonPurchaseView> {
    const catalog = await this.addonService.listActive();
    const addon = catalog.find((a) => a.code === addonCode);
    if (!addon || !addon.isActive || !(addon.price > 0) || addon.billingCycle !== 'monthly') {
      throw new BadRequestException('add-on นี้ยังไม่เปิดขายแบบรายเดือน');
    }
    await this.addonService.assertAddonAllowedForTenant(tenantId, addonCode);

    const owned = (await this.addonService.getActiveAddons(tenantId)).find(
      (a) => a.code === addonCode,
    );
    if (owned && PERMANENT_SOURCES.has(owned.source)) {
      throw new ConflictException('แพ็กเกจของคุณรวม add-on นี้อยู่แล้ว');
    }

    const now = new Date();
    const existing = await this.prisma.addonPurchase.findFirst({
      where: { tenantId, addonCode, status: 'pending' },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) {
      const invoice = await this.prisma.invoices.findFirst({
        where: { id: existing.invoiceId, tenant_id: tenantId },
        select: { status: true, due_date: true },
      });
      const stillPayable = invoice?.status === 'pending' && invoice.due_date >= utcMidnight(now);
      if (stillPayable) return this.toView(existing);
      await this.cancelPurchase(
        existing.id,
        existing.invoiceId,
        tenantId,
        now,
        'ใบแจ้งหนี้ซื้อ add-on เลยกำหนด',
      );
    }

    const subtotal = new Prisma.Decimal(addon.price).toDecimalPlaces(2);
    const vatAmount = subtotal.mul(ADDON_PURCHASE_VAT_RATE).div(100).toDecimalPlaces(2);
    const amount = subtotal.add(vatAmount);
    const dueDate = utcMidnight(now);
    dueDate.setUTCDate(dueDate.getUTCDate() + ADDON_PURCHASE_DUE_DAYS);

    const purchase = await this.prisma.$transaction(async (tx) => {
      const invoice = await tx.invoices.create({
        data: {
          tenant_id: tenantId,
          invoice_no: invoiceNumber(now),
          amount,
          subtotal,
          vat_rate: new Prisma.Decimal(ADDON_PURCHASE_VAT_RATE),
          vat_amount: vatAmount,
          status: 'pending',
          due_date: dueDate,
          notes: `ซื้อ add-on ${addon.name} (${addon.code}) 1 เดือน — คิดเต็มเดือน`,
          invoice_items: {
            create: {
              type: 'feature',
              quantity: 1,
              unit_price: subtotal,
              amount: subtotal,
              ref_id: addon.id,
              description: `${addon.name} — รายเดือน (1 เดือน)`,
            },
          },
        },
        select: { id: true },
      });
      return tx.addonPurchase.create({
        data: {
          tenantId,
          addonCode,
          invoiceId: invoice.id,
          status: 'pending',
          months: 1,
          unitPrice: subtotal,
          createdBy: userId,
        },
      });
    });
    this.logger.log(`Add-on purchase ${purchase.id} (${addonCode}) created for tenant ${tenantId}`);
    return this.toView(purchase);
  }

  async getSummary(tenantId: string, addonCode: string): Promise<AddonPurchaseSummary> {
    const [pending, latestPaid] = await Promise.all([
      this.prisma.addonPurchase.findFirst({
        where: { tenantId, addonCode, status: 'pending' },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.addonPurchase.findFirst({
        where: { tenantId, addonCode, status: 'paid' },
        orderBy: { periodEnd: 'desc' },
        select: { periodEnd: true },
      }),
    ]);
    return {
      addonCode,
      pending: pending ? await this.toView(pending) : null,
      paidUntil: latestPaid?.periodEnd?.toISOString() ?? null,
    };
  }

  private async cancelPurchase(
    purchaseId: string,
    invoiceId: string,
    tenantId: string,
    now: Date,
    reason: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.addonPurchase.updateMany({
        where: { id: purchaseId, tenantId, status: 'pending' },
        data: { status: 'cancelled' },
      });
      await tx.invoices.updateMany({
        where: { id: invoiceId, tenant_id: tenantId, status: 'pending' },
        data: { status: 'voided', voided_at: now, voided_reason: reason },
      });
    });
  }

  private async toView(purchase: {
    id: string;
    tenantId: string;
    addonCode: string;
    invoiceId: string;
    status: string;
    months: number;
    unitPrice: Prisma.Decimal;
    periodStart: Date | null;
    periodEnd: Date | null;
    paidAt: Date | null;
    createdAt: Date;
  }): Promise<AddonPurchaseView> {
    const [invoice, payment] = await Promise.all([
      this.prisma.invoices.findFirst({
        where: { id: purchase.invoiceId, tenant_id: purchase.tenantId },
        select: {
          id: true,
          invoice_no: true,
          subtotal: true,
          vat_rate: true,
          vat_amount: true,
          amount: true,
          status: true,
          due_date: true,
        },
      }),
      this.prisma.payments.findFirst({
        where: { invoice_id: purchase.invoiceId, tenant_id: purchase.tenantId },
        orderBy: { created_at: 'desc' },
        select: { id: true, status: true, created_at: true },
      }),
    ]);
    return {
      id: purchase.id,
      addonCode: purchase.addonCode,
      status: purchase.status,
      months: purchase.months,
      unitPrice: Number(purchase.unitPrice),
      periodStart: purchase.periodStart?.toISOString() ?? null,
      periodEnd: purchase.periodEnd?.toISOString() ?? null,
      paidAt: purchase.paidAt?.toISOString() ?? null,
      createdAt: purchase.createdAt.toISOString(),
      invoice: invoice
        ? {
            id: invoice.id,
            invoiceNo: invoice.invoice_no,
            subtotal: Number(invoice.subtotal ?? 0),
            vatRate: Number(invoice.vat_rate ?? 0),
            vatAmount: Number(invoice.vat_amount ?? 0),
            amount: Number(invoice.amount),
            status: invoice.status,
            dueDate: invoice.due_date.toISOString().slice(0, 10),
          }
        : null,
      latestPayment: payment
        ? { id: payment.id, status: payment.status, createdAt: payment.created_at.toISOString() }
        : null,
    };
  }
}

function invoiceNumber(now: Date): string {
  const ymd = now.toISOString().slice(0, 10).replace(/-/g, '');
  return `${ADDON_PURCHASE_INVOICE_PREFIX}${ymd}-${randomBytes(4).toString('hex').toUpperCase()}`;
}
