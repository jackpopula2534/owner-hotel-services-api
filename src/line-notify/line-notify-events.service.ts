import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { LineNotifyService } from './line-notify.service';
import { LineNotifyEventType } from './dto/line-notify.dto';

@Injectable()
export class LineNotifyEventsService {
  private readonly logger = new Logger(LineNotifyEventsService.name);

  constructor(
    private readonly lineNotifyService: LineNotifyService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Send booking created notification
   */
  async onBookingCreated(
    tenantId: string,
    bookingData: {
      bookingNumber: string;
      guestName: string;
      roomType: string;
      checkIn: Date;
      checkOut: Date;
      totalAmount: number;
    },
  ): Promise<void> {
    const message = this.formatBookingMessage('🔔 การจองใหม่ / New Booking', bookingData);

    await this.lineNotifyService.sendEventNotification(
      tenantId,
      LineNotifyEventType.BOOKING_CREATED,
      message,
    );
  }

  /**
   * Send booking confirmed notification
   */
  async onBookingConfirmed(
    tenantId: string,
    bookingData: {
      bookingNumber: string;
      guestName: string;
      roomType: string;
      checkIn: Date;
      checkOut: Date;
      totalAmount: number;
    },
  ): Promise<void> {
    const message = this.formatBookingMessage('✅ ยืนยันการจอง / Booking Confirmed', bookingData);

    await this.lineNotifyService.sendEventNotification(
      tenantId,
      LineNotifyEventType.BOOKING_CONFIRMED,
      message,
    );
  }

  /**
   * Send booking cancelled notification
   */
  async onBookingCancelled(
    tenantId: string,
    bookingData: {
      bookingNumber: string;
      guestName: string;
      roomType: string;
      checkIn: Date;
      checkOut: Date;
      reason?: string;
    },
  ): Promise<void> {
    const checkInStr = this.formatDate(bookingData.checkIn);
    const checkOutStr = this.formatDate(bookingData.checkOut);

    let message = `
❌ ยกเลิกการจอง / Booking Cancelled

📋 เลขที่จอง: ${bookingData.bookingNumber}
👤 ชื่อผู้เข้าพัก: ${bookingData.guestName}
🛏️ ประเภทห้อง: ${bookingData.roomType}
📅 วันที่: ${checkInStr} - ${checkOutStr}`;

    if (bookingData.reason) {
      message += `\n📝 เหตุผล: ${bookingData.reason}`;
    }

    await this.lineNotifyService.sendEventNotification(
      tenantId,
      LineNotifyEventType.BOOKING_CANCELLED,
      message,
    );
  }

  /**
   * Send check-in notification
   */
  async onCheckIn(
    tenantId: string,
    data: {
      bookingNumber: string;
      guestName: string;
      roomNumber: string;
      checkOutDate: Date;
    },
  ): Promise<void> {
    const checkOutStr = this.formatDate(data.checkOutDate);

    const message = `
🏨 เช็คอิน / Check-In

📋 เลขที่จอง: ${data.bookingNumber}
👤 ชื่อผู้เข้าพัก: ${data.guestName}
🚪 ห้อง: ${data.roomNumber}
📅 วันเช็คเอาท์: ${checkOutStr}`;

    await this.lineNotifyService.sendEventNotification(
      tenantId,
      LineNotifyEventType.BOOKING_CHECKIN,
      message,
    );
  }

  /**
   * Send check-out notification
   */
  async onCheckOut(
    tenantId: string,
    data: {
      bookingNumber: string;
      guestName: string;
      roomNumber: string;
      totalAmount: number;
    },
  ): Promise<void> {
    const message = `
👋 เช็คเอาท์ / Check-Out

📋 เลขที่จอง: ${data.bookingNumber}
👤 ชื่อผู้เข้าพัก: ${data.guestName}
🚪 ห้อง: ${data.roomNumber}
💰 ยอดรวม: ฿${data.totalAmount.toLocaleString()}`;

    await this.lineNotifyService.sendEventNotification(
      tenantId,
      LineNotifyEventType.BOOKING_CHECKOUT,
      message,
    );
  }

  /**
   * Send payment received notification
   */
  async onPaymentReceived(
    tenantId: string,
    data: {
      bookingNumber: string;
      amount: number;
      paymentMethod: string;
      transactionId?: string;
    },
  ): Promise<void> {
    const message = `
💳 ได้รับชำระเงิน / Payment Received

📋 เลขที่จอง: ${data.bookingNumber}
💰 จำนวนเงิน: ฿${data.amount.toLocaleString()}
💳 ช่องทาง: ${data.paymentMethod}
${data.transactionId ? `🔢 Transaction ID: ${data.transactionId}` : ''}`;

    await this.lineNotifyService.sendEventNotification(
      tenantId,
      LineNotifyEventType.PAYMENT_RECEIVED,
      message,
    );
  }

  /**
   * Send payment failed notification
   */
  async onPaymentFailed(
    tenantId: string,
    data: {
      bookingNumber: string;
      amount: number;
      reason?: string;
    },
  ): Promise<void> {
    const message = `
⚠️ ชำระเงินไม่สำเร็จ / Payment Failed

📋 เลขที่จอง: ${data.bookingNumber}
💰 จำนวนเงิน: ฿${data.amount.toLocaleString()}
${data.reason ? `📝 เหตุผล: ${data.reason}` : ''}`;

    await this.lineNotifyService.sendEventNotification(
      tenantId,
      LineNotifyEventType.PAYMENT_FAILED,
      message,
    );
  }

  /**
   * Send new review notification
   */
  async onNewReview(
    tenantId: string,
    data: {
      guestName: string;
      rating: number;
      comment: string;
      propertyName?: string;
    },
  ): Promise<void> {
    const stars = '⭐'.repeat(data.rating);

    const message = `
📝 รีวิวใหม่ / New Review

👤 จาก: ${data.guestName}
${data.propertyName ? `🏨 ${data.propertyName}` : ''}
${stars} (${data.rating}/5)
💬 "${data.comment.substring(0, 200)}${data.comment.length > 200 ? '...' : ''}"`;

    await this.lineNotifyService.sendEventNotification(
      tenantId,
      LineNotifyEventType.NEW_REVIEW,
      message,
    );
  }

  /**
   * Send system alert notification
   */
  async onSystemAlert(
    tenantId: string,
    data: {
      title: string;
      message: string;
      severity: 'info' | 'warning' | 'error';
    },
  ): Promise<void> {
    const emoji = data.severity === 'error' ? '🚨' : data.severity === 'warning' ? '⚠️' : 'ℹ️';

    const message = `
${emoji} ${data.title}

${data.message}`;

    await this.lineNotifyService.sendEventNotification(
      tenantId,
      LineNotifyEventType.SYSTEM_ALERT,
      message,
    );
  }

  /**
   * Daily summary cron job - runs at 20:00 every day
   */
  @Cron(CronExpression.EVERY_DAY_AT_8PM)
  async sendDailySummary(): Promise<void> {
    this.logger.log('Starting daily summary notifications');

    const tenants = await this.prisma.tenants.findMany({
      where: { status: 'active' },
      select: { id: true, name: true },
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    for (const tenant of tenants) {
      try {
        // Get today's statistics
        const [todayBookings, todayCheckIns, todayCheckOuts, todayRevenue, tomorrowCheckIns] =
          await Promise.all([
            this.prisma.booking.count({
              where: {
                tenantId: tenant.id,
                createdAt: { gte: today, lt: tomorrow },
              },
            }),
            this.prisma.booking.count({
              where: {
                tenantId: tenant.id,
                checkIn: { gte: today, lt: tomorrow },
                status: 'checked_in',
              },
            }),
            this.prisma.booking.count({
              where: {
                tenantId: tenant.id,
                checkOut: { gte: today, lt: tomorrow },
                status: 'checked_out',
              },
            }),
            this.prisma.payments.aggregate({
              where: {
                tenant_id: tenant.id,
                created_at: { gte: today, lt: tomorrow },
                status: 'approved',
              },
              _sum: { amount: true },
            }),
            this.prisma.booking.count({
              where: {
                tenantId: tenant.id,
                checkIn: { gte: tomorrow, lt: new Date(tomorrow.getTime() + 86400000) },
                status: { in: ['confirmed', 'pending'] },
              },
            }),
          ]);

        const revenue = todayRevenue._sum.amount || 0;

        const message = `
📊 สรุปประจำวัน / Daily Summary
📅 ${this.formatDate(today)}

🏨 ${tenant.name}

📝 การจองใหม่วันนี้: ${todayBookings}
🏨 เช็คอินวันนี้: ${todayCheckIns}
👋 เช็คเอาท์วันนี้: ${todayCheckOuts}
💰 รายได้วันนี้: ฿${Number(revenue).toLocaleString()}

📅 เช็คอินพรุ่งนี้: ${tomorrowCheckIns}`;

        await this.lineNotifyService.sendEventNotification(
          tenant.id,
          LineNotifyEventType.DAILY_SUMMARY,
          message,
        );
      } catch (error) {
        this.logger.error(`Failed to send daily summary for tenant ${tenant.id}: ${error.message}`);
      }
    }

    this.logger.log('Daily summary notifications completed');
  }

  // ─── Staff Call Notifications ────────────────────────────────────────────────

  /**
   * Send notification when a customer or POS staff creates a staff call
   */
  async onStaffCallCreated(
    tenantId: string,
    data: {
      tableNumber: string;
      zone?: string | null;
      callType: string;
      message?: string | null;
      customerName?: string | null;
      source: string;
    },
  ): Promise<void> {
    const callTypeLabels: Record<string, string> = {
      SERVICE: 'บริการทั่วไป',
      PAYMENT: 'ชำระเงิน / เก็บเงิน',
      WATER: 'เติมน้ำ',
      ASSISTANCE: 'ขอความช่วยเหลือ',
      CLEANUP: 'ทำความสะอาดโต๊ะ',
      CUSTOM: 'อื่นๆ',
    };

    const sourceLabel = data.source === 'CUSTOMER' ? 'ลูกค้า' : 'พนักงาน POS';
    const typeLabel = callTypeLabels[data.callType] ?? data.callType;
    const zoneText = data.zone ? ` (${data.zone})` : '';

    let message = `
🔔 เรียกพนักงาน / Staff Call

📍 โต๊ะ: ${data.tableNumber}${zoneText}
📋 ประเภท: ${typeLabel}
👤 เรียกโดย: ${sourceLabel}`;

    if (data.customerName) {
      message += `\n🏷️ ชื่อลูกค้า: ${data.customerName}`;
    }

    if (data.message) {
      message += `\n💬 ข้อความ: ${data.message}`;
    }

    await this.lineNotifyService.sendEventNotification(
      tenantId,
      LineNotifyEventType.SYSTEM_ALERT, // Reuse SYSTEM_ALERT for staff calls
      message,
    );
  }

  /**
   * Helper to format booking message
   */
  private formatBookingMessage(
    title: string,
    data: {
      bookingNumber: string;
      guestName: string;
      roomType: string;
      checkIn: Date;
      checkOut: Date;
      totalAmount?: number;
    },
  ): string {
    const checkInStr = this.formatDate(data.checkIn);
    const checkOutStr = this.formatDate(data.checkOut);

    let message = `
${title}

📋 เลขที่จอง: ${data.bookingNumber}
👤 ชื่อผู้เข้าพัก: ${data.guestName}
🛏️ ประเภทห้อง: ${data.roomType}
📅 วันที่เข้าพัก: ${checkInStr} - ${checkOutStr}`;

    if (data.totalAmount) {
      message += `\n💰 ยอดรวม: ฿${data.totalAmount.toLocaleString()}`;
    }

    return message;
  }

  /**
   * Helper to format date in Thai format
   */
  private formatDate(date: Date): string {
    return date.toLocaleDateString('th-TH', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }
}
