import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from './email.service';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class EmailEventsService {
  private readonly logger = new Logger(EmailEventsService.name);

  constructor(
    private readonly emailService: EmailService,
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Send booking confirmation email
   */
  async onBookingCreated(booking: any): Promise<void> {
    try {
      if (!booking.guestEmail) {
        this.logger.warn(`No email for booking ${booking.id}`);
        return;
      }

      // Check email preferences
      const canSend = await this.checkEmailPreference(
        booking.guestEmail,
        'bookingConfirmation',
        booking.tenantId,
      );

      if (!canSend) {
        this.logger.log(`Guest ${booking.guestEmail} has opted out of booking emails`);
        return;
      }

      // Get property details for hotel name
      const property =
        booking.property ||
        (await this.prisma.property.findUnique({
          where: { id: booking.propertyId },
        }));

      await this.emailService.sendBookingConfirmation({
        to: booking.guestEmail,
        guestName: `${booking.guestFirstName} ${booking.guestLastName}`,
        bookingId: booking.id,
        checkInDate: this.formatDate(booking.checkIn),
        checkOutDate: this.formatDate(booking.checkOut),
        roomType: booking.room?.type || 'Standard',
        totalPrice: Number(booking.totalPrice),
        tenantId: booking.tenantId,
        hotelName: property?.name,
      });

      this.logger.log(`Booking confirmation sent for ${booking.id}`);
    } catch (error) {
      this.logger.error(`Failed to send booking confirmation for ${booking.id}:`, error.message);
    }
  }

  /**
   * Send booking cancellation email
   */
  async onBookingCancelled(booking: any, refundAmount?: number): Promise<void> {
    try {
      if (!booking.guestEmail) {
        return;
      }

      const property =
        booking.property ||
        (await this.prisma.property.findUnique({
          where: { id: booking.propertyId },
        }));

      await this.emailService.sendCancellationEmail({
        to: booking.guestEmail,
        guestName: `${booking.guestFirstName} ${booking.guestLastName}`,
        bookingId: booking.id,
        cancellationDate: this.formatDate(new Date()),
        refundAmount,
        tenantId: booking.tenantId,
        hotelName: property?.name,
      });

      this.logger.log(`Cancellation email sent for booking ${booking.id}`);
    } catch (error) {
      this.logger.error(`Failed to send cancellation email for ${booking.id}:`, error.message);
    }
  }

  /**
   * Send password reset email
   */
  async onPasswordResetRequested(email: string, token: string, userName: string): Promise<void> {
    try {
      const frontendUrl = this.configService.get('FRONTEND_URL', 'http://localhost:3000');
      const resetLink = `${frontendUrl}/reset-password?token=${token}`;

      await this.emailService.sendPasswordReset({
        to: email,
        userName,
        resetLink,
      });

      this.logger.log(`Password reset email sent to ${email}`);
    } catch (error) {
      this.logger.error(`Failed to send password reset email to ${email}:`, error.message);
    }
  }

  /**
   * Send welcome email after registration
   */
  async onUserRegistered(user: {
    email: string;
    firstName?: string;
    lastName?: string;
  }): Promise<void> {
    try {
      const frontendUrl = this.configService.get('FRONTEND_URL', 'http://localhost:3000');

      await this.emailService.sendEmail({
        to: user.email,
        subject: 'ยินดีต้อนรับสู่ Hotel Services',
        template: 'welcome' as any,
        context: {
          guestName: user.firstName || 'User',
          loginLink: `${frontendUrl}/login`,
        },
      });

      this.logger.log(`Welcome email sent to ${user.email}`);
    } catch (error) {
      this.logger.error(`Failed to send welcome email to ${user.email}:`, error.message);
    }
  }

  /**
   * Send check-in confirmation email after guest checks in
   */
  async onBookingCheckIn(booking: any): Promise<void> {
    try {
      if (!booking.guestEmail) {
        this.logger.warn(`No email for booking ${booking.id}, skipping check-in confirmation`);
        return;
      }

      // Check email preferences
      const canSend = await this.checkEmailPreference(
        booking.guestEmail,
        'checkInReminder',
        booking.tenantId,
      );

      if (!canSend) {
        this.logger.log(`Guest ${booking.guestEmail} has opted out of check-in emails`);
        return;
      }

      const property =
        booking.property ||
        (await this.prisma.property.findUnique({
          where: { id: booking.propertyId },
        }));

      await this.emailService.sendEmail({
        to: booking.guestEmail,
        subject: 'Check-in Confirmed - สถานะการเช็คอิน',
        template: 'check-in-confirmation' as any,
        context: {
          guestName: `${booking.guestFirstName} ${booking.guestLastName}`,
          bookingId: booking.id,
          roomNumber: booking.room?.number || 'N/A',
          checkInDate: this.formatDate(booking.actualCheckIn || booking.checkIn),
          checkOutDate: this.formatDate(booking.checkOut),
          tenantId: booking.tenantId,
          hotelName: property?.name,
        },
      });

      this.logger.log(`Check-in confirmation email sent for booking ${booking.id}`);
    } catch (error) {
      this.logger.error(
        `Failed to send check-in confirmation email for ${booking.id}:`,
        error.message,
      );
    }
  }

  /**
   * Send check-in reminder (1 day before)
   * Runs daily at 9:00 AM
   */
  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async sendCheckInReminders(): Promise<void> {
    this.logger.log('Running check-in reminder job...');

    try {
      // Find bookings with check-in tomorrow
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);

      const dayAfterTomorrow = new Date(tomorrow);
      dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 1);

      const bookings = await this.prisma.booking.findMany({
        where: {
          checkIn: {
            gte: tomorrow,
            lt: dayAfterTomorrow,
          },
          status: { in: ['confirmed', 'pending'] },
          guestEmail: { not: null },
        },
        include: {
          property: true,
          room: true,
        },
      });

      this.logger.log(`Found ${bookings.length} bookings for check-in reminders`);

      for (const booking of bookings) {
        // Check email preferences
        const canSend = await this.checkEmailPreference(
          booking.guestEmail!,
          'checkInReminder',
          booking.tenantId,
        );

        if (!canSend) continue;

        try {
          await this.emailService.sendCheckInReminder({
            to: booking.guestEmail!,
            guestName: `${booking.guestFirstName} ${booking.guestLastName}`,
            bookingId: booking.id,
            checkInDate: this.formatDate(booking.checkIn),
            checkInTime: '14:00', // Default check-in time
            tenantId: booking.tenantId,
            hotelName: booking.property?.name,
          });

          this.logger.log(`Check-in reminder sent for booking ${booking.id}`);
        } catch (error) {
          this.logger.error(`Failed to send check-in reminder for ${booking.id}:`, error.message);
        }
      }
    } catch (error) {
      this.logger.error('Check-in reminder job failed:', error.message);
    }
  }

  /**
   * Send subscription expiring reminder
   */
  async onSubscriptionExpiring(tenant: any, daysRemaining: number): Promise<void> {
    try {
      if (!tenant.email) return;

      await this.emailService.sendEmail({
        to: tenant.email,
        subject: `แจ้งเตือน: Subscription จะหมดอายุใน ${daysRemaining} วัน`,
        template: 'subscription-expiring' as any,
        context: {
          customerName: tenant.customer_name || tenant.name,
          daysRemaining,
          expiryDate: tenant.subscription?.end_date,
          renewLink: `${this.configService.get('FRONTEND_URL')}/dashboard/subscription`,
        },
        tenantId: tenant.id,
      });

      this.logger.log(`Subscription expiring reminder sent to ${tenant.email}`);
    } catch (error) {
      this.logger.error(`Failed to send subscription reminder:`, error.message);
    }
  }

  /**
   * Send invoice email
   */
  async onInvoiceCreated(invoice: any, tenant: any): Promise<void> {
    try {
      if (!tenant.email) return;

      const frontendUrl = this.configService.get('FRONTEND_URL', 'http://localhost:3000');

      await this.emailService.sendEmail({
        to: tenant.email,
        subject: `ใบแจ้งหนี้ ${invoice.invoice_no}`,
        template: 'invoice' as any,
        context: {
          customerName: tenant.customer_name || tenant.name,
          invoiceNo: invoice.invoice_no,
          issueDate: this.formatDate(invoice.created_at),
          dueDate: this.formatDate(invoice.due_date),
          amount: Number(invoice.amount),
          paymentLink: `${frontendUrl}/dashboard/invoices/${invoice.id}/pay`,
        },
        tenantId: tenant.id,
      });

      this.logger.log(`Invoice email sent for ${invoice.invoice_no}`);
    } catch (error) {
      this.logger.error(`Failed to send invoice email:`, error.message);
    }
  }

  /**
   * Send checkout email
   */
  async onBookingCheckout(booking: any): Promise<void> {
    try {
      if (!booking.guestEmail) {
        return;
      }

      const property =
        booking.property ||
        (await this.prisma.property.findUnique({
          where: { id: booking.propertyId },
        }));

      const stayDuration = Math.ceil(
        (new Date(booking.actualCheckOut || new Date()).getTime() -
          new Date(booking.actualCheckIn || booking.checkIn).getTime()) /
          (1000 * 60 * 60 * 24),
      );

      await this.emailService.sendEmail({
        to: booking.guestEmail,
        subject: 'Thank you for your stay!',
        template: 'checkout-confirmation' as any,
        context: {
          guestName: `${booking.guestFirstName} ${booking.guestLastName}`,
          bookingId: booking.id,
          checkOutDate: this.formatDate(booking.actualCheckOut || new Date()),
          stayDuration,
          totalAmount: Number(booking.totalPrice),
          tenantId: booking.tenantId,
          hotelName: property?.name,
        },
      });

      this.logger.log(`Checkout email sent for booking ${booking.id}`);
    } catch (error) {
      this.logger.error(`Failed to send checkout email for ${booking.id}:`, error.message);
    }
  }

  /**
   * Send review request email after checkout
   * Requests guest to leave a review of their stay
   */
  async sendReviewRequest(booking: any): Promise<void> {
    try {
      if (!booking.guestEmail) {
        this.logger.warn(`No email for booking ${booking.id}, skipping review request`);
        return;
      }

      // Check email preferences
      const canSend = await this.checkEmailPreference(
        booking.guestEmail,
        'promotionalEmails',
        booking.tenantId,
      );

      if (!canSend) {
        this.logger.log(
          `Guest ${booking.guestEmail} has opted out of promotional emails, skipping review request`,
        );
        return;
      }

      const property =
        booking.property ||
        (await this.prisma.property.findUnique({
          where: { id: booking.propertyId },
        }));

      const frontendUrl = this.configService.get('FRONTEND_URL', 'http://localhost:3000');
      const reviewLink = `${frontendUrl}/reviews/new?bookingId=${booking.id}`;

      await this.emailService.sendEmail({
        to: booking.guestEmail,
        subject: 'Share your stay experience with us',
        template: 'review-request' as any,
        context: {
          guestName: `${booking.guestFirstName} ${booking.guestLastName}`,
          bookingId: booking.id,
          hotelName: property?.name,
          reviewLink,
          checkOutDate: this.formatDate(booking.actualCheckOut || new Date()),
        },
      });

      this.logger.log(`Review request email sent for booking ${booking.id}`);
    } catch (error) {
      this.logger.error(`Failed to send review request email for ${booking.id}:`, error.message);
      // Don't throw - review request shouldn't block checkout
    }
  }

  /**
   * Send payment received email
   */
  async onPaymentReceived(params: {
    to: string;
    receiptNo?: string;
    invoiceNo?: string;
    bookingId?: string;
    amount: number;
    paymentMethod: string;
    paymentDate: Date;
    tenantId: string;
  }): Promise<void> {
    try {
      if (!params.to) return;

      // Check email preferences
      const canSend = await this.checkEmailPreference(params.to, 'paymentReceipt', params.tenantId);

      if (!canSend) {
        this.logger.log(`Recipient ${params.to} has opted out of payment receipt emails`);
        return;
      }

      await this.emailService.sendPaymentReceipt({
        to: params.to,
        guestName: 'Guest',
        receiptNo: params.receiptNo || params.invoiceNo || 'RCP-' + Date.now(),
        bookingId: params.bookingId || 'N/A',
        amount: params.amount,
        paymentMethod: params.paymentMethod,
        paymentDate: this.formatDate(params.paymentDate),
        tenantId: params.tenantId,
      });

      this.logger.log(`Payment receipt email sent to ${params.to}`);
    } catch (error) {
      this.logger.error(`Failed to send payment receipt email:`, error.message);
    }
  }

  /**
   * Check email preferences
   */
  private async checkEmailPreference(
    email: string,
    preferenceType: string,
    tenantId?: string,
  ): Promise<boolean> {
    try {
      const preference = await this.prisma.emailPreference.findFirst({
        where: {
          email,
          tenantId: tenantId || undefined,
        },
      });

      if (!preference) {
        return true; // Default to allow if no preference set
      }

      if (preference.unsubscribedAt) {
        return false; // Unsubscribed from all emails
      }

      // Check specific preference
      switch (preferenceType) {
        case 'bookingConfirmation':
          return preference.bookingConfirmation;
        case 'checkInReminder':
          return preference.checkInReminder;
        case 'checkOutReminder':
          return preference.checkOutReminder;
        case 'paymentReceipt':
          return preference.paymentReceipt;
        case 'promotionalEmails':
          return preference.promotionalEmails;
        case 'newsletter':
          return preference.newsletter;
        default:
          return true;
      }
    } catch (error) {
      // If table doesn't exist, default to allow
      return true;
    }
  }

  /**
   * Format date to Thai locale
   */
  private formatDate(date: Date | string): string {
    const d = new Date(date);
    return d.toLocaleDateString('th-TH', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }
}
