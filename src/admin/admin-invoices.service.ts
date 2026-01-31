import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Invoice, InvoiceStatus } from '../invoices/entities/invoice.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { Payment, PaymentStatus } from '../payments/entities/payment.entity';
import { PrismaService } from '../prisma/prisma.service';
import {
  AdminInvoicesQueryDto,
  AdminInvoicesListResponseDto,
  AdminInvoiceListItemDto,
  AdminInvoicesSummaryDto,
  AdminInvoiceDetailDto,
  UpdateInvoiceStatusDto,
  InvoiceStatusUpdateResponseDto,
  AdminInvoiceStatusAction,
} from './dto/admin-invoices.dto';

@Injectable()
export class AdminInvoicesService {
  private readonly logger = new Logger(AdminInvoicesService.name);

  constructor(
    @InjectRepository(Invoice)
    private invoicesRepository: Repository<Invoice>,
    @InjectRepository(Tenant)
    private tenantsRepository: Repository<Tenant>,
    @InjectRepository(Payment)
    private paymentsRepository: Repository<Payment>,
    private prismaService: PrismaService,
  ) {}

  /**
   * GET /api/admin/invoices
   * Get all invoices with filtering, search, and pagination
   */
  async findAll(
    query: AdminInvoicesQueryDto,
  ): Promise<AdminInvoicesListResponseDto> {
    const { status, search, page = 1, limit = 10 } = query;
    const skip = (page - 1) * limit;

    // Build query
    const queryBuilder = this.invoicesRepository
      .createQueryBuilder('invoice')
      .leftJoinAndSelect('invoice.tenant', 'tenant')
      .leftJoinAndSelect('invoice.subscription', 'subscription')
      .leftJoinAndSelect('subscription.plan', 'plan')
      .leftJoinAndSelect('invoice.payments', 'payments');

    // Filter by status
    if (status) {
      queryBuilder.andWhere('invoice.status = :status', { status });
    }

    // Search by invoice number or hotel name
    if (search) {
      queryBuilder.andWhere(
        '(invoice.invoiceNo LIKE :search OR tenant.name LIKE :search)',
        { search: `%${search}%` },
      );
    }

    // Get total count
    const total = await queryBuilder.getCount();

    // Apply pagination and order
    queryBuilder
      .orderBy('invoice.createdAt', 'DESC')
      .skip(skip)
      .take(limit);

    const invoices = await queryBuilder.getMany();

    // Transform to response format with owner email
    const data: AdminInvoiceListItemDto[] = await Promise.all(
      invoices.map(async (invoice) => {
        // Get owner email for this tenant
        const owner = await this.prismaService.user.findFirst({
          where: {
            tenantId: invoice.tenantId,
            role: 'tenant_admin',
          },
        });

        // Build plan description with add-ons count
        const planName = invoice.subscription?.plan?.name || 'No Plan';
        const addOnsCount = await this.getAddOnsCount(
          invoice.subscription?.id,
        );
        const planDescription =
          addOnsCount > 0 ? `${planName} +${addOnsCount} add-ons` : planName;

        return {
          id: invoice.id,
          invoiceNumber: invoice.invoiceNo,
          hotelName: invoice.tenant?.name || 'N/A',
          ownerEmail: owner?.email || 'N/A',
          plan: planDescription,
          amount: Number(invoice.amount),
          status: invoice.status,
          date: invoice.createdAt.toISOString(),
        };
      }),
    );

    return {
      total,
      page,
      limit,
      data,
    };
  }

  /**
   * GET /api/admin/invoices/summary
   * Get invoices summary by status
   */
  async getSummary(): Promise<AdminInvoicesSummaryDto> {
    const [total, pending, paid, rejected] = await Promise.all([
      this.invoicesRepository.count(),
      this.invoicesRepository.count({ where: { status: InvoiceStatus.PENDING } }),
      this.invoicesRepository.count({ where: { status: InvoiceStatus.PAID } }),
      this.invoicesRepository.count({ where: { status: InvoiceStatus.REJECTED } }),
    ]);

    return {
      total,
      pending,
      paid,
      rejected,
    };
  }

  /**
   * GET /api/admin/invoices/:id
   * Get invoice detail by ID
   */
  async findOne(id: string): Promise<AdminInvoiceDetailDto> {
    const invoice = await this.invoicesRepository.findOne({
      where: { id },
      relations: [
        'tenant',
        'subscription',
        'subscription.plan',
        'invoiceItems',
        'payments',
      ],
    });

    if (!invoice) {
      throw new NotFoundException(`Invoice with ID "${id}" not found`);
    }

    // Get owner email for this tenant
    const owner = await this.prismaService.user.findFirst({
      where: {
        tenantId: invoice.tenantId,
        role: 'tenant_admin',
      },
    });

    // Build plan description with add-ons count
    const planName = invoice.subscription?.plan?.name || 'No Plan';
    const addOnsCount = await this.getAddOnsCount(invoice.subscription?.id);
    const planDescription =
      addOnsCount > 0 ? `${planName} +${addOnsCount} add-ons` : planName;

    // Get payment proof (slip URL) from the latest payment
    const latestPayment = invoice.payments
      ?.filter((p) => p.slipUrl)
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )[0];

    return {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNo,
      hotelName: invoice.tenant?.name || 'N/A',
      ownerEmail: owner?.email || 'N/A',
      plan: planDescription,
      amount: Number(invoice.amount),
      status: invoice.status,
      paymentProof: latestPayment?.slipUrl || undefined,
      issuedAt: invoice.createdAt.toISOString(),
    };
  }

  /**
   * PATCH /api/admin/invoices/:id/status
   * Update invoice status (approve/reject)
   */
  async updateStatus(
    id: string,
    dto: UpdateInvoiceStatusDto,
    adminId?: string,
  ): Promise<InvoiceStatusUpdateResponseDto> {
    const invoice = await this.invoicesRepository.findOne({
      where: { id },
      relations: ['payments'],
    });

    if (!invoice) {
      throw new NotFoundException(`Invoice with ID "${id}" not found`);
    }

    const previousStatus = invoice.status;

    // Map action to invoice status
    const newStatus =
      dto.status === AdminInvoiceStatusAction.APPROVED
        ? InvoiceStatus.PAID
        : InvoiceStatus.REJECTED;

    invoice.status = newStatus;
    await this.invoicesRepository.save(invoice);

    // If approved, also update associated pending payments
    if (dto.status === AdminInvoiceStatusAction.APPROVED) {
      const pendingPayments = invoice.payments?.filter(
        (p) => p.status === PaymentStatus.PENDING,
      );

      if (pendingPayments && pendingPayments.length > 0) {
        await Promise.all(
          pendingPayments.map(async (payment) => {
            payment.status = PaymentStatus.APPROVED;
            payment.approvedBy = adminId || null;
            payment.approvedAt = new Date();
            await this.paymentsRepository.save(payment);
          }),
        );

        this.logger.log(
          `Approved ${pendingPayments.length} payment(s) for invoice ${invoice.invoiceNo}`,
        );
      }
    }

    // If rejected, also update associated pending payments
    if (dto.status === AdminInvoiceStatusAction.REJECTED) {
      const pendingPayments = invoice.payments?.filter(
        (p) => p.status === PaymentStatus.PENDING,
      );

      if (pendingPayments && pendingPayments.length > 0) {
        await Promise.all(
          pendingPayments.map(async (payment) => {
            payment.status = PaymentStatus.REJECTED;
            payment.approvedBy = adminId || null;
            payment.approvedAt = new Date();
            await this.paymentsRepository.save(payment);
          }),
        );

        this.logger.log(
          `Rejected ${pendingPayments.length} payment(s) for invoice ${invoice.invoiceNo}`,
        );
      }
    }

    this.logger.log(
      `Invoice ${invoice.invoiceNo} status changed from ${previousStatus} to ${newStatus}${dto.reason ? ` - Reason: ${dto.reason}` : ''}`,
    );

    return {
      success: true,
      message: `Invoice status updated from ${previousStatus} to ${newStatus}`,
      newStatus,
    };
  }

  /**
   * Helper: Get add-ons count for a subscription
   */
  private async getAddOnsCount(subscriptionId?: string): Promise<number> {
    if (!subscriptionId) return 0;

    // Count subscription features (add-ons beyond plan features)
    // This is a simplified implementation - in production, you might
    // want to exclude features that are already included in the plan
    try {
      const { SubscriptionFeature } = await import(
        '../subscription-features/entities/subscription-feature.entity'
      );
      const dataSource = this.invoicesRepository.manager.connection;
      const subscriptionFeatureRepo =
        dataSource.getRepository(SubscriptionFeature);

      const count = await subscriptionFeatureRepo.count({
        where: { subscriptionId },
      });

      return count;
    } catch {
      return 0;
    }
  }
}
