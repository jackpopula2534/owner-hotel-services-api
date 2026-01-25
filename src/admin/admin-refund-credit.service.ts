import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan, MoreThan } from 'typeorm';
import { Payment, PaymentStatus } from '../payments/entities/payment.entity';
import { PaymentRefund, RefundStatus, RefundMethod } from '../payments/entities/payment-refund.entity';
import { TenantCredit, CreditType, CreditStatus } from '../tenants/entities/tenant-credit.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { Invoice, InvoiceStatus } from '../invoices/entities/invoice.entity';
import {
  CreateRefundDto,
  CreateCreditDto,
  ApplyCreditDto,
  ProcessRefundDto,
  RefundMethodDto,
  CreditTypeDto,
  TenantCreditsListDto,
  CreditItemDto,
  RefundItemDto,
  CreateRefundResponseDto,
  CreateCreditResponseDto,
  ApplyCreditResponseDto,
  ProcessRefundResponseDto,
  RefundSummaryDto,
} from './dto/admin-refund-credit.dto';

@Injectable()
export class AdminRefundCreditService {
  private readonly logger = new Logger(AdminRefundCreditService.name);

  constructor(
    @InjectRepository(Payment)
    private paymentsRepository: Repository<Payment>,
    @InjectRepository(PaymentRefund)
    private refundsRepository: Repository<PaymentRefund>,
    @InjectRepository(TenantCredit)
    private creditsRepository: Repository<TenantCredit>,
    @InjectRepository(Tenant)
    private tenantsRepository: Repository<Tenant>,
    @InjectRepository(Invoice)
    private invoicesRepository: Repository<Invoice>,
  ) {}

  // ============ REFUND OPERATIONS ============

  /**
   * POST /api/v1/admin/payments/:id/refund
   * Create a refund for a payment
   */
  async createRefund(
    paymentId: string,
    dto: CreateRefundDto,
    adminId?: string,
  ): Promise<CreateRefundResponseDto> {
    const payment = await this.paymentsRepository.findOne({
      where: { id: paymentId },
      relations: ['invoice', 'invoice.tenant'],
    });

    if (!payment) {
      throw new NotFoundException(`Payment with ID "${paymentId}" not found`);
    }

    if (payment.status !== PaymentStatus.APPROVED) {
      throw new BadRequestException('Can only refund approved payments');
    }

    const paymentAmount = Number(payment.amount || payment.invoice?.amount || 0);
    const alreadyRefunded = Number(payment.refundedAmount || 0);
    const availableForRefund = paymentAmount - alreadyRefunded;

    if (dto.amount > availableForRefund) {
      throw new BadRequestException(
        `Refund amount (${dto.amount}) exceeds available amount (${availableForRefund})`,
      );
    }

    // Validate bank details if bank transfer
    if (dto.method === RefundMethodDto.BANK_TRANSFER) {
      if (!dto.bankAccount || !dto.bankName) {
        throw new BadRequestException(
          'Bank account and bank name are required for bank transfer refund',
        );
      }
    }

    // Generate refund number
    const refundNo = `REF-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;

    // Create refund record
    const refund = this.refundsRepository.create({
      paymentId: payment.id,
      refundNo,
      amount: dto.amount,
      status: dto.method === RefundMethodDto.CREDIT ? RefundStatus.COMPLETED : RefundStatus.PENDING,
      method: dto.method as unknown as RefundMethod,
      reason: dto.reason,
      notes: dto.notes,
      bankAccount: dto.bankAccount,
      bankName: dto.bankName,
      accountHolder: dto.accountHolder,
      createdBy: adminId,
    });

    // If refund as credit, create credit record and mark as completed
    let creditId: string | undefined;
    if (dto.method === RefundMethodDto.CREDIT) {
      const credit = await this.createCreditRecord(
        payment.invoice.tenantId,
        dto.amount,
        CreditType.REFUND,
        `Refund from payment ${payment.paymentNo || payment.id}`,
        'payment',
        payment.id,
        adminId,
      );
      creditId = credit.id;
      refund.creditId = creditId;
      refund.processedAt = new Date();
      refund.processedBy = adminId;
    }

    await this.refundsRepository.save(refund);

    // Update payment refunded amount
    payment.refundedAmount = alreadyRefunded + dto.amount;
    if (payment.refundedAmount >= paymentAmount) {
      payment.status = PaymentStatus.REFUNDED;
    } else {
      payment.status = PaymentStatus.PARTIALLY_REFUNDED;
    }
    await this.paymentsRepository.save(payment);

    this.logger.log(
      `Refund ${refundNo} created for payment ${payment.paymentNo || payment.id}: ${dto.amount} via ${dto.method}`,
    );

    return {
      success: true,
      message: dto.method === RefundMethodDto.CREDIT
        ? 'Refund processed as credit successfully'
        : 'Refund request created successfully',
      data: {
        refundNo,
        paymentNo: payment.paymentNo || payment.id,
        amount: dto.amount,
        method: dto.method,
        status: refund.status,
        creditCreated: !!creditId,
        creditId,
      },
    };
  }

  /**
   * GET /api/v1/admin/refunds
   * Get all refunds with optional filtering
   */
  async getRefunds(status?: string): Promise<RefundItemDto[]> {
    const where: any = {};
    if (status) {
      where.status = status;
    }

    const refunds = await this.refundsRepository.find({
      where,
      relations: ['payment', 'payment.invoice'],
      order: { createdAt: 'DESC' },
      take: 100,
    });

    return refunds.map((r) => ({
      id: r.id,
      refundNo: r.refundNo,
      paymentNo: r.payment?.paymentNo || r.paymentId,
      invoiceNo: r.payment?.invoice?.invoiceNo || 'N/A',
      amount: Number(r.amount),
      status: r.status,
      method: r.method,
      reason: r.reason,
      bankName: r.bankName || undefined,
      bankAccount: r.bankAccount || undefined,
      createdAt: r.createdAt.toISOString(),
      processedAt: r.processedAt?.toISOString() || undefined,
    }));
  }

  /**
   * GET /api/v1/admin/refunds/summary
   * Get refund summary
   */
  async getRefundSummary(): Promise<RefundSummaryDto> {
    const pending = await this.refundsRepository.count({
      where: { status: RefundStatus.PENDING },
    });
    const approved = await this.refundsRepository.count({
      where: { status: RefundStatus.APPROVED },
    });
    const rejected = await this.refundsRepository.count({
      where: { status: RefundStatus.REJECTED },
    });
    const completed = await this.refundsRepository.count({
      where: { status: RefundStatus.COMPLETED },
    });

    const pendingAmountResult = await this.refundsRepository
      .createQueryBuilder('refund')
      .select('SUM(refund.amount)', 'total')
      .where('refund.status = :status', { status: RefundStatus.PENDING })
      .getRawOne();

    const completedAmountResult = await this.refundsRepository
      .createQueryBuilder('refund')
      .select('SUM(refund.amount)', 'total')
      .where('refund.status = :status', { status: RefundStatus.COMPLETED })
      .getRawOne();

    return {
      totalPending: pending,
      totalApproved: approved,
      totalRejected: rejected,
      totalCompleted: completed,
      totalPendingAmount: Number(pendingAmountResult?.total || 0),
      totalRefundedAmount: Number(completedAmountResult?.total || 0),
    };
  }

  /**
   * PATCH /api/v1/admin/refunds/:id/process
   * Process (approve/reject) a refund
   */
  async processRefund(
    refundId: string,
    dto: ProcessRefundDto,
    adminId?: string,
  ): Promise<ProcessRefundResponseDto> {
    const refund = await this.refundsRepository.findOne({
      where: { id: refundId },
      relations: ['payment', 'payment.invoice', 'payment.invoice.tenant'],
    });

    if (!refund) {
      throw new NotFoundException(`Refund with ID "${refundId}" not found`);
    }

    if (refund.status !== RefundStatus.PENDING) {
      throw new BadRequestException('Can only process pending refunds');
    }

    if (dto.action === 'approved') {
      refund.status = RefundStatus.APPROVED;
      refund.processedAt = new Date();
      refund.processedBy = adminId;
      refund.notes = dto.notes || refund.notes;

      // If credit method, also create credit and mark completed
      if (refund.method === RefundMethod.CREDIT) {
        const credit = await this.createCreditRecord(
          refund.payment.invoice.tenantId,
          Number(refund.amount),
          CreditType.REFUND,
          `Refund from payment ${refund.payment.paymentNo || refund.paymentId}`,
          'payment',
          refund.paymentId,
          adminId,
        );
        refund.creditId = credit.id;
        refund.status = RefundStatus.COMPLETED;
      }
    } else {
      refund.status = RefundStatus.REJECTED;
      refund.rejectedReason = dto.rejectedReason;
      refund.processedAt = new Date();
      refund.processedBy = adminId;

      // Restore payment refunded amount
      const payment = refund.payment;
      payment.refundedAmount = Number(payment.refundedAmount || 0) - Number(refund.amount);
      if (payment.refundedAmount <= 0) {
        payment.status = PaymentStatus.APPROVED;
        payment.refundedAmount = 0;
      }
      await this.paymentsRepository.save(payment);
    }

    await this.refundsRepository.save(refund);

    this.logger.log(
      `Refund ${refund.refundNo} ${dto.action}: ${refund.amount}`,
    );

    return {
      success: true,
      message: `Refund ${dto.action} successfully`,
      data: {
        refundNo: refund.refundNo,
        status: refund.status,
        processedAt: refund.processedAt.toISOString(),
      },
    };
  }

  // ============ CREDIT OPERATIONS ============

  /**
   * GET /api/v1/admin/tenants/:id/credits
   * Get all credits for a tenant
   */
  async getTenantCredits(tenantId: string): Promise<TenantCreditsListDto> {
    const tenant = await this.tenantsRepository.findOne({
      where: { id: tenantId },
    });

    if (!tenant) {
      throw new NotFoundException(`Tenant with ID "${tenantId}" not found`);
    }

    const credits = await this.creditsRepository.find({
      where: { tenantId },
      order: { createdAt: 'DESC' },
    });

    const creditItems: CreditItemDto[] = credits.map((c) => ({
      id: c.id,
      type: c.type,
      status: c.status,
      originalAmount: Number(c.originalAmount),
      remainingAmount: Number(c.remainingAmount),
      description: c.description || '',
      referenceType: c.referenceType || undefined,
      referenceId: c.referenceId || undefined,
      expiresAt: c.expiresAt?.toISOString().split('T')[0] || undefined,
      createdAt: c.createdAt.toISOString(),
    }));

    const availableCredits = credits.filter((c) => c.status === CreditStatus.AVAILABLE);
    const usedCredits = credits.filter((c) => c.status === CreditStatus.USED);

    const totalAvailable = availableCredits.reduce(
      (sum, c) => sum + Number(c.remainingAmount),
      0,
    );
    const totalUsed = usedCredits.reduce(
      (sum, c) => sum + (Number(c.originalAmount) - Number(c.remainingAmount)),
      0,
    );
    const totalEarned = credits.reduce((sum, c) => sum + Number(c.originalAmount), 0);

    return {
      tenantId,
      tenantName: tenant.name,
      totalAvailable,
      totalUsed,
      totalEarned,
      credits: creditItems,
    };
  }

  /**
   * POST /api/v1/admin/tenants/:id/credits
   * Add credit to a tenant
   */
  async addCredit(
    tenantId: string,
    dto: CreateCreditDto,
    adminId?: string,
  ): Promise<CreateCreditResponseDto> {
    const tenant = await this.tenantsRepository.findOne({
      where: { id: tenantId },
    });

    if (!tenant) {
      throw new NotFoundException(`Tenant with ID "${tenantId}" not found`);
    }

    const credit = await this.createCreditRecord(
      tenantId,
      dto.amount,
      dto.type as unknown as CreditType,
      dto.description,
      dto.referenceType,
      dto.referenceId,
      adminId,
      dto.expiresAt ? new Date(dto.expiresAt) : undefined,
    );

    // Calculate new balance
    const availableCredits = await this.creditsRepository.find({
      where: { tenantId, status: CreditStatus.AVAILABLE },
    });
    const newBalance = availableCredits.reduce(
      (sum, c) => sum + Number(c.remainingAmount),
      0,
    );

    this.logger.log(
      `Credit ${credit.id} added to tenant ${tenant.name}: ${dto.amount} (${dto.type})`,
    );

    return {
      success: true,
      message: 'Credit added successfully',
      data: {
        creditId: credit.id,
        amount: dto.amount,
        type: dto.type,
        tenantName: tenant.name,
        newBalance,
      },
    };
  }

  /**
   * POST /api/v1/admin/invoices/:id/apply-credit
   * Apply credit to an invoice
   */
  async applyCredit(
    invoiceId: string,
    dto: ApplyCreditDto,
    adminId?: string,
  ): Promise<ApplyCreditResponseDto> {
    const invoice = await this.invoicesRepository.findOne({
      where: { id: invoiceId },
      relations: ['tenant'],
    });

    if (!invoice) {
      throw new NotFoundException(`Invoice with ID "${invoiceId}" not found`);
    }

    if (invoice.status === InvoiceStatus.PAID) {
      throw new BadRequestException('Invoice is already paid');
    }

    if (invoice.status === InvoiceStatus.VOIDED) {
      throw new BadRequestException('Cannot apply credit to voided invoice');
    }

    const invoiceAmount = Number(invoice.amount);
    const amountToApply = dto.amount || invoiceAmount;

    // Get available credits
    let availableCredits: TenantCredit[];

    if (dto.creditId) {
      // Use specific credit
      const credit = await this.creditsRepository.findOne({
        where: { id: dto.creditId, status: CreditStatus.AVAILABLE },
      });
      if (!credit) {
        throw new NotFoundException(`Credit with ID "${dto.creditId}" not found or not available`);
      }
      if (credit.tenantId !== invoice.tenantId) {
        throw new BadRequestException('Credit does not belong to invoice tenant');
      }
      availableCredits = [credit];
    } else {
      // Get all available credits for tenant
      const orderField = dto.useOldestFirst !== false ? 'createdAt' : 'expiresAt';
      availableCredits = await this.creditsRepository.find({
        where: {
          tenantId: invoice.tenantId,
          status: CreditStatus.AVAILABLE,
        },
        order: { [orderField]: 'ASC' },
      });
    }

    if (availableCredits.length === 0) {
      throw new BadRequestException('No available credits for this tenant');
    }

    const totalAvailable = availableCredits.reduce(
      (sum, c) => sum + Number(c.remainingAmount),
      0,
    );

    if (totalAvailable === 0) {
      throw new BadRequestException('No available credit balance');
    }

    // Apply credits
    let remainingToApply = Math.min(amountToApply, invoiceAmount, totalAvailable);
    const creditsUsed: { creditId: string; amount: number }[] = [];

    for (const credit of availableCredits) {
      if (remainingToApply <= 0) break;

      const creditRemaining = Number(credit.remainingAmount);
      const useAmount = Math.min(remainingToApply, creditRemaining);

      credit.remainingAmount = creditRemaining - useAmount;
      if (credit.remainingAmount <= 0) {
        credit.status = CreditStatus.USED;
        credit.usedAt = new Date();
      }

      await this.creditsRepository.save(credit);
      creditsUsed.push({ creditId: credit.id, amount: useAmount });
      remainingToApply -= useAmount;
    }

    const totalApplied = creditsUsed.reduce((sum, c) => sum + c.amount, 0);

    // Update invoice
    const newAmount = invoiceAmount - totalApplied;
    if (!invoice.originalAmount) {
      invoice.originalAmount = invoiceAmount;
    }
    invoice.amount = newAmount;
    invoice.adjustedAmount = newAmount;

    if (newAmount <= 0) {
      invoice.status = InvoiceStatus.PAID;
      invoice.amount = 0;
    }

    await this.invoicesRepository.save(invoice);

    // Calculate remaining credit
    const remainingCredit = totalAvailable - totalApplied;

    this.logger.log(
      `Applied ${totalApplied} credit to invoice ${invoice.invoiceNo}. New amount: ${newAmount}`,
    );

    return {
      success: true,
      message: 'Credit applied successfully',
      data: {
        invoiceNo: invoice.invoiceNo,
        originalAmount: Number(invoice.originalAmount),
        creditApplied: totalApplied,
        newAmount,
        creditsUsed,
        remainingCredit,
      },
    };
  }

  // ============ HELPER METHODS ============

  private async createCreditRecord(
    tenantId: string,
    amount: number,
    type: CreditType,
    description: string,
    referenceType?: string,
    referenceId?: string,
    createdBy?: string,
    expiresAt?: Date,
  ): Promise<TenantCredit> {
    const credit = this.creditsRepository.create({
      tenantId,
      type,
      status: CreditStatus.AVAILABLE,
      originalAmount: amount,
      remainingAmount: amount,
      description,
      referenceType,
      referenceId,
      expiresAt,
      createdBy,
    });

    await this.creditsRepository.save(credit);
    return credit;
  }
}
