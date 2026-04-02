import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import * as QRCode from 'qrcode';
import { v4 as uuidv4 } from 'uuid';
import {
  GenerateQRCodeDto,
  QRCodeResponseDto,
  TransactionQueryDto,
  WebhookPaymentDto,
  RefundRequestDto,
  PromptPayType,
} from './dto/promptpay.dto';

@Injectable()
export class PromptPayService {
  private readonly logger = new Logger(PromptPayService.name);
  private readonly promptpayId: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {
    this.promptpayId = this.configService.get<string>('PROMPTPAY_ID', '');
    if (!this.promptpayId) {
      this.logger.warn('PROMPTPAY_ID not configured');
    }
  }

  /**
   * Generate PromptPay QR Code
   */
  async generateQRCode(dto: GenerateQRCodeDto): Promise<QRCodeResponseDto> {
    const promptpayId = this.promptpayId;

    if (!promptpayId) {
      throw new BadRequestException('PromptPay ID not configured');
    }

    // Generate unique transaction reference
    const transactionRef = this.generateTransactionRef();

    // Calculate expiry time
    const expiryMinutes = dto.expiryMinutes || 15;
    const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000);

    // Generate EMV QR code data
    const qrCodeData = this.generateEMVQRCode(promptpayId, dto.amount, transactionRef);

    // Generate QR code image as base64
    const qrCodeImage = await QRCode.toDataURL(qrCodeData, {
      width: 300,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#ffffff',
      },
    });

    // Save transaction to database
    const transaction = await this.prisma.promptPayTransaction.create({
      data: {
        transactionRef,
        tenantId: dto.tenantId,
        bookingId: dto.bookingId,
        invoiceId: dto.invoiceId,
        amount: dto.amount,
        promptpayId,
        qrCodeData,
        status: 'pending',
        expiresAt,
      },
    });

    this.logger.log(`Generated QR code for transaction: ${transactionRef}, amount: ${dto.amount}`);

    return {
      transactionRef,
      qrCodeImage,
      qrCodeData,
      amount: dto.amount,
      promptpayId: this.maskPromptPayId(promptpayId),
      expiresAt,
      status: 'pending',
    };
  }

  /**
   * Generate EMV QR Code for PromptPay
   * Based on Thailand PromptPay EMV QR Code specification
   */
  private generateEMVQRCode(promptpayId: string, amount: number, ref?: string): string {
    const data: string[] = [];

    // Payload Format Indicator (ID: 00)
    data.push(this.formatEMVField('00', '01'));

    // Point of Initiation Method (ID: 01)
    // 11 = Static, 12 = Dynamic
    data.push(this.formatEMVField('01', amount > 0 ? '12' : '11'));

    // Merchant Account Information (ID: 29 for PromptPay)
    const merchantInfo = this.buildMerchantAccountInfo(promptpayId);
    data.push(this.formatEMVField('29', merchantInfo));

    // Transaction Currency (ID: 53) - THB = 764
    data.push(this.formatEMVField('53', '764'));

    // Transaction Amount (ID: 54)
    if (amount > 0) {
      data.push(this.formatEMVField('54', amount.toFixed(2)));
    }

    // Country Code (ID: 58) - Thailand
    data.push(this.formatEMVField('58', 'TH'));

    // Merchant Name (ID: 59)
    const merchantName = this.configService.get<string>('MERCHANT_NAME', 'Hotel Services');
    data.push(this.formatEMVField('59', merchantName.substring(0, 25)));

    // Merchant City (ID: 60)
    const merchantCity = this.configService.get<string>('MERCHANT_CITY', 'Bangkok');
    data.push(this.formatEMVField('60', merchantCity.substring(0, 15)));

    // Additional Data Field Template (ID: 62) - Bill Number / Reference
    if (ref) {
      const additionalData = this.formatEMVField('05', ref.substring(0, 25)); // Bill Number
      data.push(this.formatEMVField('62', additionalData));
    }

    // Build data without CRC
    let qrData = data.join('');

    // Add CRC placeholder (ID: 63)
    qrData += '6304';

    // Calculate CRC16
    const crc = this.calculateCRC16(qrData);
    qrData += crc.toUpperCase();

    return qrData;
  }

  /**
   * Build Merchant Account Information for PromptPay
   */
  private buildMerchantAccountInfo(promptpayId: string): string {
    const data: string[] = [];

    // Application ID (00) - PromptPay AID
    data.push(this.formatEMVField('00', 'A000000677010111'));

    // Mobile Number or National ID (01 or 02)
    const cleanId = promptpayId.replace(/[^0-9]/g, '');

    if (cleanId.length === 10) {
      // Mobile number - add country code 66
      const formattedMobile = '0066' + cleanId.substring(1);
      data.push(this.formatEMVField('01', formattedMobile));
    } else if (cleanId.length === 13) {
      // National ID or Tax ID
      data.push(this.formatEMVField('02', cleanId));
    } else {
      throw new BadRequestException('Invalid PromptPay ID format');
    }

    return data.join('');
  }

  /**
   * Format EMV field: ID + Length + Value
   */
  private formatEMVField(id: string, value: string): string {
    const length = value.length.toString().padStart(2, '0');
    return `${id}${length}${value}`;
  }

  /**
   * Calculate CRC16-CCITT checksum
   */
  private calculateCRC16(data: string): string {
    let crc = 0xffff;
    const polynomial = 0x1021;

    for (let i = 0; i < data.length; i++) {
      crc ^= data.charCodeAt(i) << 8;
      for (let j = 0; j < 8; j++) {
        if (crc & 0x8000) {
          crc = ((crc << 1) ^ polynomial) & 0xffff;
        } else {
          crc = (crc << 1) & 0xffff;
        }
      }
    }

    return crc.toString(16).toUpperCase().padStart(4, '0');
  }

  /**
   * Generate unique transaction reference
   */
  private generateTransactionRef(): string {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = uuidv4().substring(0, 8).toUpperCase();
    return `PP${timestamp}${random}`;
  }

  /**
   * Mask PromptPay ID for security
   */
  private maskPromptPayId(id: string): string {
    const clean = id.replace(/[^0-9]/g, '');
    if (clean.length === 10) {
      return `${clean.substring(0, 3)}****${clean.substring(7)}`;
    } else if (clean.length === 13) {
      return `${clean.substring(0, 3)}*******${clean.substring(10)}`;
    }
    return '***';
  }

  /**
   * Check payment status (polling)
   */
  async checkPaymentStatus(transactionRef: string): Promise<any> {
    const transaction = await this.prisma.promptPayTransaction.findUnique({
      where: { transactionRef },
    });

    if (!transaction) {
      throw new NotFoundException('Transaction not found');
    }

    // Check if expired
    if (transaction.status === 'pending' && new Date() > transaction.expiresAt) {
      await this.prisma.promptPayTransaction.update({
        where: { id: transaction.id },
        data: { status: 'expired' },
      });
      return {
        transactionRef,
        status: 'expired',
        amount: transaction.amount,
        message: 'Transaction has expired',
      };
    }

    return {
      transactionRef,
      status: transaction.status,
      amount: transaction.amount,
      paidAt: transaction.paidAt,
      verifiedAt: transaction.verifiedAt,
    };
  }

  /**
   * Handle payment webhook from bank/payment provider
   */
  async handleWebhook(dto: WebhookPaymentDto): Promise<{ success: boolean; message: string }> {
    this.logger.log(`Received webhook for transaction: ${dto.transactionRef}`);

    if (!dto.transactionRef) {
      this.logger.warn('Webhook received without transaction reference');
      return { success: false, message: 'Missing transaction reference' };
    }

    const transaction = await this.prisma.promptPayTransaction.findUnique({
      where: { transactionRef: dto.transactionRef },
    });

    if (!transaction) {
      this.logger.warn(`Transaction not found: ${dto.transactionRef}`);
      return { success: false, message: 'Transaction not found' };
    }

    if (transaction.status !== 'pending') {
      this.logger.warn(`Transaction already processed: ${dto.transactionRef}`);
      return { success: false, message: 'Transaction already processed' };
    }

    // Update transaction status
    const updatedTransaction = await this.prisma.promptPayTransaction.update({
      where: { id: transaction.id },
      data: {
        status: 'paid',
        paidAt: dto.paidAt ? new Date(dto.paidAt) : new Date(),
        verificationRef: dto.bankRef,
        webhookData: dto.rawData ? JSON.parse(JSON.stringify(dto.rawData)) : null,
      },
    });

    // Update related booking/invoice status
    if (transaction.bookingId) {
      await this.updateBookingPaymentStatus(transaction.bookingId);
    }

    if (transaction.invoiceId) {
      await this.updateInvoicePaymentStatus(transaction.invoiceId, Number(transaction.amount));
    }

    // Send payment receipt email
    await this.sendPaymentReceiptEmail(updatedTransaction);

    this.logger.log(`Transaction ${dto.transactionRef} marked as paid`);
    return { success: true, message: 'Payment processed successfully' };
  }

  /**
   * Manual payment verification (for admin)
   */
  async verifyPayment(transactionRef: string, adminId: string): Promise<any> {
    const transaction = await this.prisma.promptPayTransaction.findUnique({
      where: { transactionRef },
    });

    if (!transaction) {
      throw new NotFoundException('Transaction not found');
    }

    if (transaction.status === 'verified') {
      throw new BadRequestException('Transaction already verified');
    }

    const updatedTransaction = await this.prisma.promptPayTransaction.update({
      where: { id: transaction.id },
      data: {
        status: 'verified',
        verifiedAt: new Date(),
      },
    });

    // Update related records
    if (transaction.bookingId) {
      await this.updateBookingPaymentStatus(transaction.bookingId);
    }

    if (transaction.invoiceId) {
      await this.updateInvoicePaymentStatus(transaction.invoiceId, Number(transaction.amount));
    }

    // Send receipt email
    await this.sendPaymentReceiptEmail(updatedTransaction);

    this.logger.log(`Transaction ${transactionRef} verified by admin ${adminId}`);
    return {
      transactionRef,
      status: 'verified',
      verifiedAt: updatedTransaction.verifiedAt,
    };
  }

  /**
   * Get transaction history
   */
  async getTransactions(query: TransactionQueryDto, tenantId?: string) {
    const where: any = {};

    if (tenantId) {
      where.tenantId = tenantId;
    }

    if (query.status) {
      where.status = query.status;
    }

    if (query.bookingId) {
      where.bookingId = query.bookingId;
    }

    if (query.invoiceId) {
      where.invoiceId = query.invoiceId;
    }

    if (query.startDate || query.endDate) {
      where.createdAt = {};
      if (query.startDate) {
        where.createdAt.gte = new Date(query.startDate);
      }
      if (query.endDate) {
        where.createdAt.lte = new Date(query.endDate);
      }
    }

    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 20;
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.promptPayTransaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.promptPayTransaction.count({ where }),
    ]);

    // Mask QR data for security
    const maskedData = data.map((t) => ({
      ...t,
      qrCodeData: '[MASKED]',
      promptpayId: this.maskPromptPayId(t.promptpayId),
    }));

    return {
      data: maskedData,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get daily reconciliation report
   */
  async getDailyReconciliation(date: string, tenantId?: string) {
    const startDate = new Date(date);
    startDate.setHours(0, 0, 0, 0);

    const endDate = new Date(date);
    endDate.setHours(23, 59, 59, 999);

    const where: any = {
      createdAt: {
        gte: startDate,
        lte: endDate,
      },
    };

    if (tenantId) {
      where.tenantId = tenantId;
    }

    const transactions = await this.prisma.promptPayTransaction.findMany({
      where,
      orderBy: { createdAt: 'asc' },
    });

    const summary = {
      date,
      totalTransactions: transactions.length,
      totalAmount: 0,
      paidCount: 0,
      paidAmount: 0,
      pendingCount: 0,
      pendingAmount: 0,
      expiredCount: 0,
      expiredAmount: 0,
      failedCount: 0,
      failedAmount: 0,
    };

    transactions.forEach((t) => {
      const amount = Number(t.amount);
      summary.totalAmount += amount;

      switch (t.status) {
        case 'paid':
        case 'verified':
          summary.paidCount++;
          summary.paidAmount += amount;
          break;
        case 'pending':
          summary.pendingCount++;
          summary.pendingAmount += amount;
          break;
        case 'expired':
          summary.expiredCount++;
          summary.expiredAmount += amount;
          break;
        case 'failed':
          summary.failedCount++;
          summary.failedAmount += amount;
          break;
      }
    });

    return {
      summary,
      transactions: transactions.map((t) => ({
        transactionRef: t.transactionRef,
        amount: t.amount,
        status: t.status,
        createdAt: t.createdAt,
        paidAt: t.paidAt,
      })),
    };
  }

  /**
   * Process refund request
   */
  async processRefund(dto: RefundRequestDto, adminId: string): Promise<any> {
    const transaction = await this.prisma.promptPayTransaction.findUnique({
      where: { transactionRef: dto.transactionRef },
    });

    if (!transaction) {
      throw new NotFoundException('Transaction not found');
    }

    if (!['paid', 'verified'].includes(transaction.status)) {
      throw new BadRequestException('Only paid transactions can be refunded');
    }

    const refundAmount = dto.amount || Number(transaction.amount);

    if (refundAmount > Number(transaction.amount)) {
      throw new BadRequestException('Refund amount exceeds transaction amount');
    }

    // Create refund record in payment_refunds table
    // This is a placeholder - actual implementation depends on payment gateway
    this.logger.log(`Processing refund for ${dto.transactionRef}, amount: ${refundAmount}`);

    await this.prisma.promptPayTransaction.update({
      where: { id: transaction.id },
      data: {
        status: 'refunded',
      },
    });

    return {
      transactionRef: dto.transactionRef,
      refundAmount,
      status: 'refund_initiated',
      message: 'Refund has been initiated. Please process bank transfer manually.',
    };
  }

  /**
   * Update booking payment status
   * Supports both direct bookingId and finding booking via invoice relationship
   */
  private async updateBookingPaymentStatus(bookingId?: string): Promise<void> {
    try {
      if (!bookingId) {
        this.logger.warn('No bookingId provided for booking payment status update');
        return;
      }

      await this.prisma.booking.update({
        where: { id: bookingId },
        data: { status: 'confirmed' },
      });
      this.logger.log(`Booking ${bookingId} status updated to confirmed from PromptPay payment`);
    } catch (error) {
      this.logger.error(`Failed to update booking ${bookingId}:`, error.message);
    }
  }

  /**
   * Update invoice payment status and related booking after PromptPay payment
   * Handles both subscription invoices and booking-related invoices
   */
  private async updateInvoicePaymentStatus(invoiceId: string, amount: number): Promise<void> {
    try {
      // Get invoice to check for booking_id
      const invoice = await this.prisma.invoices.findUnique({
        where: { id: invoiceId },
      });

      if (!invoice) {
        this.logger.warn(`Invoice ${invoiceId} not found for payment status update`);
        return;
      }

      // Create payment record
      const paymentNo = `PAY-${Date.now().toString(36).toUpperCase()}`;

      await this.prisma.payments.create({
        data: {
          id: uuidv4(),
          payment_no: paymentNo,
          invoice_id: invoiceId,
          amount,
          method: 'qr',
          status: 'approved',
          approved_at: new Date(),
        },
      });

      // Update invoice status
      await this.prisma.invoices.update({
        where: { id: invoiceId },
        data: { status: 'paid' },
      });

      this.logger.log(`Invoice ${invoiceId} marked as paid`);

      // If invoice is linked to a booking, update booking status to confirmed
      if (invoice.booking_id) {
        await this.updateBookingPaymentStatus(invoice.booking_id);
      }
    } catch (error) {
      this.logger.error(`Failed to update invoice ${invoiceId}:`, error.message);
    }
  }

  /**
   * Send payment receipt email
   */
  private async sendPaymentReceiptEmail(transaction: any): Promise<void> {
    try {
      // Get booking or invoice details
      let recipientEmail: string | null = null;
      let guestName = 'Customer';

      if (transaction.bookingId) {
        const booking = await this.prisma.booking.findUnique({
          where: { id: transaction.bookingId },
        });
        if (booking) {
          recipientEmail = booking.guestEmail;
          guestName = `${booking.guestFirstName} ${booking.guestLastName}`;
        }
      }

      if (recipientEmail) {
        await this.emailService.sendPaymentReceipt({
          to: recipientEmail,
          guestName,
          receiptNo: transaction.transactionRef,
          bookingId: transaction.bookingId || 'N/A',
          paymentDate: new Date().toLocaleDateString('th-TH'),
          amount: Number(transaction.amount),
          paymentMethod: 'PromptPay QR',
          tenantId: transaction.tenantId,
        });
      }
    } catch (error) {
      this.logger.error('Failed to send payment receipt email:', error.message);
    }
  }

  /**
   * Check and expire pending transactions (cron job)
   */
  async expirePendingTransactions(): Promise<number> {
    const result = await this.prisma.promptPayTransaction.updateMany({
      where: {
        status: 'pending',
        expiresAt: {
          lt: new Date(),
        },
      },
      data: {
        status: 'expired',
      },
    });

    if (result.count > 0) {
      this.logger.log(`Expired ${result.count} pending transactions`);
    }

    return result.count;
  }
}
