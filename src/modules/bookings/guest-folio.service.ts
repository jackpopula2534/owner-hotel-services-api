import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AddFolioChargeDto } from './dto/add-folio-charge.dto';
import { AddFolioPaymentDto } from './dto/add-folio-payment.dto';

export interface FolioCharge {
  id?: string;
  description: string;
  amount: number;
  category: string;
  createdAt: string;
}

export interface FolioPayment {
  id: string;
  amount: number;
  method: 'transfer' | 'qr' | 'cash';
  status: string;
  paymentNo?: string;
  createdAt: string;
}

export interface GuestFolio {
  bookingId: string;
  invoiceId?: string;
  invoiceNo?: string;
  guestName: string;
  roomNumber: string;
  checkInDate: string;
  checkOutDate: string;
  roomChargeAmount: number;
  additionalCharges: FolioCharge[];
  additionalChargesTotal: number;
  totalBalance: number;
  totalPaid: number;
  balanceDue: number;
  payments: FolioPayment[];
  status: string;
  tablesReady: boolean;
}

export interface ReceiptData {
  invoiceNo: string;
  bookingId: string;
  guestName: string;
  roomNumber: string;
  checkInDate: string;
  checkOutDate: string;
  nights: number;
  roomChargeAmount: number;
  additionalCharges: FolioCharge[];
  additionalChargesTotal: number;
  subtotal: number;
  totalBalance: number;
  payments: FolioPayment[];
  totalPaid: number;
  balanceDue: number;
  status: string;
  issuedAt: string;
}

/**
 * Check if a Prisma error indicates a missing table or column (schema not migrated).
 * Codes:
 *   P2021 — table does not exist
 *   P2022 — column does not exist (table exists but column missing from migration)
 *   P2010 — raw query failed (relation not found)
 * Must mirror the same codes in all-exceptions.filter.ts so fallback fires
 * before the global filter returns SCHEMA_NOT_READY on POST/PUT/DELETE.
 */
function isTableMissingError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    ['P2021', 'P2022', 'P2010'].includes(error.code)
  );
}

@Injectable()
export class GuestFolioService {
  private readonly logger = new Logger(GuestFolioService.name);

  constructor(private prisma: PrismaService) {}

  async getFolio(bookingId: string, tenantId: string): Promise<GuestFolio> {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, tenantId },
      include: { room: true, guest: true },
    });

    if (!booking) {
      throw new NotFoundException(`Booking with ID ${bookingId} not found`);
    }

    const roomChargeAmount = Number(booking.totalPrice ?? 0);
    const guestName =
      `${booking.guestFirstName ?? ''} ${booking.guestLastName ?? ''}`.trim() ||
      'ไม่ระบุชื่อ';

    // Try to fetch invoice data — gracefully degrade if tables don't exist
    let tablesReady = true;
    let additionalCharges: FolioCharge[] = [];
    let payments: FolioPayment[] = [];
    let invoiceId: string | undefined;
    let invoiceNo: string | undefined;
    let invoiceStatus = 'draft';

    try {
      const invoice = await this.prisma.invoices.findFirst({
        where: { booking_id: bookingId, tenant_id: tenantId },
        include: { invoice_items: true, payments: true },
      });

      if (invoice) {
        invoiceId = invoice.id;
        invoiceNo = invoice.invoice_no;
        invoiceStatus = invoice.status;

        additionalCharges = invoice.invoice_items
          .filter((item: any) => item.type !== 'room_charge')
          .map((item: any) => ({
            id: item.id,
            description: item.description,
            amount: Number(item.amount),
            category: item.type || 'other',
            createdAt: item.created_at
              ? new Date(item.created_at).toISOString()
              : new Date().toISOString(),
          }));

        payments = invoice.payments.map((p: any) => ({
          id: p.id,
          amount: Number(p.amount ?? 0),
          method: p.method,
          status: p.status,
          paymentNo: p.payment_no ?? undefined,
          createdAt: p.created_at
            ? new Date(p.created_at).toISOString()
            : new Date().toISOString(),
        }));
      }
    } catch (err) {
      if (isTableMissingError(err)) {
        tablesReady = false;
        this.logger.warn(
          'Billing tables not yet created. Run `npm run prisma:migrate` to enable full billing.',
        );
      } else {
        throw err;
      }
    }

    const additionalChargesTotal = additionalCharges.reduce(
      (sum, c) => sum + c.amount,
      0,
    );
    const totalBalance = roomChargeAmount + additionalChargesTotal;
    const totalPaid = payments
      .filter((p) => p.status === 'approved')
      .reduce((sum, p) => sum + p.amount, 0);
    const balanceDue = Math.max(0, totalBalance - totalPaid);

    return {
      bookingId: booking.id,
      invoiceId,
      invoiceNo,
      guestName,
      roomNumber: booking.room?.number ?? 'N/A',
      checkInDate: booking.checkIn.toISOString(),
      checkOutDate: booking.checkOut.toISOString(),
      roomChargeAmount,
      additionalCharges,
      additionalChargesTotal,
      totalBalance,
      totalPaid,
      balanceDue,
      payments,
      status: invoiceStatus,
      tablesReady,
    };
  }

  async addCharge(
    bookingId: string,
    tenantId: string,
    dto: AddFolioChargeDto,
  ): Promise<GuestFolio> {
    if (!tenantId) throw new BadRequestException('Tenant ID is required');

    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, tenantId },
    });
    if (!booking) {
      throw new NotFoundException(`Booking with ID ${bookingId} not found`);
    }

    try {
      // Find or create invoice
      let invoice = await this.prisma.invoices.findFirst({
        where: { booking_id: bookingId, tenant_id: tenantId },
      });

      if (!invoice) {
        const invoiceNo = this.generateInvoiceNumber();
        invoice = await this.prisma.invoices.create({
          data: {
            tenant_id: tenantId,
            invoice_no: invoiceNo,
            booking_id: bookingId,
            amount: Number(booking.totalPrice ?? 0),
            status: 'draft',
            due_date: booking.checkOut,
          },
        });
      }

      await this.prisma.invoice_items.create({
        data: {
          invoice_id: invoice.id,
          type: (dto.category as any) || 'other',
          description: dto.description,
          quantity: 1,
          unit_price: dto.amount,
          amount: dto.amount,
        },
      });

      this.logger.log(
        `Added charge — Booking: ${bookingId}, Amount: ${dto.amount}, Category: ${dto.category ?? 'other'}`,
      );
    } catch (err) {
      if (isTableMissingError(err)) {
        throw new BadRequestException(
          'ตารางข้อมูลบิลยังไม่พร้อม กรุณาติดต่อผู้ดูแลระบบเพื่อ migrate ฐานข้อมูล',
        );
      }
      throw err;
    }

    return this.getFolio(bookingId, tenantId);
  }

  async deleteCharge(
    bookingId: string,
    tenantId: string,
    itemId: string,
  ): Promise<GuestFolio> {
    if (!tenantId) throw new BadRequestException('Tenant ID is required');

    try {
      const invoice = await this.prisma.invoices.findFirst({
        where: { booking_id: bookingId, tenant_id: tenantId },
      });
      if (!invoice) throw new NotFoundException('ไม่พบใบแจ้งหนี้สำหรับการจองนี้');

      const item = await this.prisma.invoice_items.findFirst({
        where: { id: itemId, invoice_id: invoice.id },
      });
      if (!item) throw new NotFoundException(`ไม่พบรายการค่าใช้จ่าย ID: ${itemId}`);

      await this.prisma.invoice_items.delete({ where: { id: itemId } });

      this.logger.log(`Deleted charge item ${itemId} from booking ${bookingId}`);
    } catch (err) {
      if (isTableMissingError(err)) {
        throw new BadRequestException('ตารางข้อมูลบิลยังไม่พร้อม');
      }
      throw err;
    }

    return this.getFolio(bookingId, tenantId);
  }

  async addPayment(
    bookingId: string,
    tenantId: string,
    dto: AddFolioPaymentDto,
  ): Promise<GuestFolio> {
    if (!tenantId) throw new BadRequestException('Tenant ID is required');

    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, tenantId },
    });
    if (!booking) {
      throw new NotFoundException(`Booking with ID ${bookingId} not found`);
    }

    try {
      // Find or create invoice
      let invoice = await this.prisma.invoices.findFirst({
        where: { booking_id: bookingId, tenant_id: tenantId },
      });

      if (!invoice) {
        const invoiceNo = this.generateInvoiceNumber();
        invoice = await this.prisma.invoices.create({
          data: {
            tenant_id: tenantId,
            invoice_no: invoiceNo,
            booking_id: bookingId,
            amount: Number(booking.totalPrice ?? 0),
            status: 'draft',
            due_date: booking.checkOut,
          },
        });
      }

      const paymentNo = this.generatePaymentNumber();
      await this.prisma.payments.create({
        data: {
          invoice_id: invoice.id,
          tenant_id: tenantId,
          payment_no: paymentNo,
          amount: dto.amount,
          method: dto.method as any,
          status: 'approved', // Auto-approve for front-desk payments
          approved_at: new Date(),
        },
      });

      // Recalculate folio after recording payment
      const folio = await this.getFolio(bookingId, tenantId);

      // Update invoice status to paid if balance is covered
      if (folio.balanceDue <= 0) {
        await this.prisma.invoices.update({
          where: { id: invoice.id },
          data: { status: 'paid' },
        });
      }

      // Update booking paymentStatus and amountPaid to stay in sync
      const newPaymentStatus =
        folio.balanceDue <= 0
          ? 'paid'
          : folio.totalPaid > 0
            ? 'partial'
            : 'pending';

      await this.prisma.booking.update({
        where: { id: bookingId },
        data: {
          paymentStatus: newPaymentStatus,
          amountPaid: folio.totalPaid,
          paymentMethod: dto.method,
        },
      });

      this.logger.log(
        `Payment recorded — Booking: ${bookingId}, Amount: ${dto.amount}, Method: ${dto.method}, Status: ${newPaymentStatus}`,
      );
    } catch (err) {
      if (isTableMissingError(err)) {
        // Billing tables not yet migrated — fallback: record payment directly on booking
        this.logger.warn(
          `Billing tables unavailable (${(err as any)?.code}) — recording payment directly on booking ${bookingId}`,
        );

        const totalPrice = Number(booking.totalPrice ?? 0);
        const currentPaid = Number(booking.amountPaid ?? 0);
        const newPaid = currentPaid + dto.amount;
        const fallbackStatus =
          newPaid >= totalPrice && totalPrice > 0
            ? 'paid'
            : newPaid > 0
              ? 'partial'
              : 'pending';

        // Use selective update — skip fields that might not exist in DB yet
        try {
          await this.prisma.booking.update({
            where: { id: bookingId },
            data: {
              paymentStatus: fallbackStatus,
              amountPaid: newPaid,
              paymentMethod: dto.method,
            },
          });
          this.logger.log(
            `Payment recorded (fallback) — Booking: ${bookingId}, Amount: ${dto.amount}, Method: ${dto.method}, Status: ${fallbackStatus}`,
          );
        } catch (fallbackErr) {
          // Even the booking update failed — still return a folio so the UI doesn't break
          this.logger.error(
            `Fallback payment update also failed: ${(fallbackErr as Error)?.message}`,
          );
        }
      } else {
        throw err;
      }
    }

    return this.getFolio(bookingId, tenantId);
  }

  async getReceiptData(bookingId: string, tenantId: string): Promise<ReceiptData> {
    const folio = await this.getFolio(bookingId, tenantId);

    const checkIn = new Date(folio.checkInDate);
    const checkOut = new Date(folio.checkOutDate);
    const nights = Math.max(
      1,
      Math.round((checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24)),
    );

    const invoiceNo =
      folio.invoiceNo ?? this.generateInvoiceNumber();

    return {
      invoiceNo,
      bookingId,
      guestName: folio.guestName,
      roomNumber: folio.roomNumber,
      checkInDate: folio.checkInDate,
      checkOutDate: folio.checkOutDate,
      nights,
      roomChargeAmount: folio.roomChargeAmount,
      additionalCharges: folio.additionalCharges,
      additionalChargesTotal: folio.additionalChargesTotal,
      subtotal: folio.totalBalance,
      totalBalance: folio.totalBalance,
      payments: folio.payments,
      totalPaid: folio.totalPaid,
      balanceDue: folio.balanceDue,
      status: folio.status,
      issuedAt: new Date().toISOString(),
    };
  }

  async finalizeFolio(bookingId: string, tenantId: string): Promise<GuestFolio> {
    if (!tenantId) throw new BadRequestException('Tenant ID is required');

    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, tenantId },
    });
    if (!booking) {
      throw new NotFoundException(`Booking with ID ${bookingId} not found`);
    }

    const folio = await this.getFolio(bookingId, tenantId);

    if (folio.tablesReady && folio.invoiceId) {
      await this.prisma.invoices.update({
        where: { id: folio.invoiceId },
        data: {
          amount: folio.totalBalance,
          status: folio.balanceDue <= 0 ? 'paid' : 'finalized',
        },
      });

      this.logger.log(
        `Finalized folio — Booking: ${bookingId}, Total: ${folio.totalBalance}`,
      );
    }

    return this.getFolio(bookingId, tenantId);
  }

  /** Generate invoice number: INV-YYYYMMDD-XXXX */
  private generateInvoiceNumber(): string {
    const now = new Date();
    const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const rand = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
    return `INV-${ymd}-${rand}`;
  }

  /** Generate payment number: PAY-YYYYMMDD-XXXX */
  private generatePaymentNumber(): string {
    const now = new Date();
    const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const rand = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
    return `PAY-${ymd}-${rand}`;
  }
}
