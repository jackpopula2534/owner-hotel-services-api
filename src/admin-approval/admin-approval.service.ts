import { Injectable } from '@nestjs/common';
import { PaymentsService } from '../payments/payments.service';
import { InvoicesService } from '../invoices/invoices.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { AdminsService } from '../admins/admins.service';
import { InvoiceStatus } from '../invoices/entities/invoice.entity';
import { SubscriptionStatus } from '../subscriptions/entities/subscription.entity';

@Injectable()
export class AdminApprovalService {
  constructor(
    private paymentsService: PaymentsService,
    private invoicesService: InvoicesService,
    private subscriptionsService: SubscriptionsService,
    private adminsService: AdminsService,
  ) {}

  /**
   * 6️⃣ Admin Approval Flow
   * เมื่อ Admin Approve Payment:
   * - invoice → paid
   * - subscription → active
   * - set start_date, end_date
   * - unlock features
   * - extend usage days
   * 📌 วันใช้งานต้องคำนวณจาก approve จริง
   */
  async approvePayment(
    paymentId: string,
    adminId: string,
  ): Promise<{
    payment: any;
    invoice: any;
    subscription: any;
    message: string;
  }> {
    // 1. ตรวจสอบ admin
    const admin = await this.adminsService.findOne(adminId);
    if (!admin) {
      throw new Error('Admin not found');
    }

    // 2. Approve payment
    const payment = await this.paymentsService.approvePayment(
      paymentId,
      adminId,
    );

    // 3. Update invoice status
    const invoice = await this.invoicesService.findOne(payment.invoiceId);
    if (!invoice) {
      throw new Error('Invoice not found');
    }

    // 4. Update invoice to paid
    await this.invoicesService.update(invoice.id, {
      status: InvoiceStatus.PAID,
    });

    // 5. Activate subscription
    if (invoice.subscriptionId) {
      const subscription = await this.subscriptionsService.findOne(
        invoice.subscriptionId,
      );

      if (subscription) {
        // คำนวณวันใช้งานจาก approve จริง
        const today = new Date();
        const endDate = new Date(today);
        endDate.setMonth(endDate.getMonth() + 1); // รายเดือน

        await this.subscriptionsService.update(subscription.id, {
          status: SubscriptionStatus.ACTIVE,
          startDate: today,
          endDate: endDate,
        });

        return {
          payment,
          invoice: { ...invoice, status: InvoiceStatus.PAID },
          subscription: {
            ...subscription,
            status: SubscriptionStatus.ACTIVE,
            startDate: today,
            endDate: endDate,
          },
          message: 'Payment approved and subscription activated successfully',
        };
      }
    }

    return {
      payment,
      invoice: { ...invoice, status: InvoiceStatus.PAID },
      subscription: null,
      message: 'Payment approved successfully',
    };
  }

  /**
   * Reject payment with reason
   */
  async rejectPayment(
    paymentId: string,
    adminId: string,
    reason?: string,
  ): Promise<any> {
    const admin = await this.adminsService.findOne(adminId);
    if (!admin) {
      throw new Error('Admin not found');
    }

    const payment = await this.paymentsService.rejectPayment(paymentId, adminId);

    return {
      payment,
      reason: reason || 'Payment rejected by admin',
      message: 'Payment rejected successfully',
    };
  }

  /**
   * ดึงรายการ pending payments สำหรับ admin
   */
  async getPendingPayments(): Promise<any[]> {
    const payments = await this.paymentsService.findAll();
    return payments.filter((p) => p.status === 'pending');
  }
}


