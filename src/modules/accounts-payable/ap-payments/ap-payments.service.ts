import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateApPaymentDto } from './dto/create-ap-payment.dto';

interface PaymentQuery {
  propertyId?: string;
  supplierId?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  limit?: number;
}

@Injectable()
export class ApPaymentsService {
  private readonly logger = new Logger(ApPaymentsService.name);

  constructor(private readonly prisma: PrismaService) {}

  private async generatePaymentNo(tenantId: string): Promise<string> {
    const now = new Date();
    const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const seq = await this.prisma.documentSequence.upsert({
      where: { tenantId_docType_yearMonth: { tenantId, docType: 'PV', yearMonth } },
      update: { lastNumber: { increment: 1 } },
      create: { tenantId, docType: 'PV', prefix: 'PV', yearMonth, lastNumber: 1 },
    });
    return `PV-${yearMonth}-${String(seq.lastNumber).padStart(6, '0')}`;
  }

  async findAll(tenantId: string, query: PaymentQuery) {
    const { page = 1, limit = 20, propertyId, supplierId, dateFrom, dateTo } = query;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { tenantId };
    if (propertyId) where.propertyId = propertyId;
    if (supplierId) where.supplierId = supplierId;
    if (dateFrom || dateTo) {
      where.paymentDate = {
        ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
        ...(dateTo ? { lte: new Date(dateTo) } : {}),
      };
    }

    const [total, data] = await Promise.all([
      this.prisma.apPayment.count({ where }),
      this.prisma.apPayment.findMany({
        where,
        include: {
          supplier: { select: { id: true, name: true } },
          allocations: {
            include: { invoice: { select: { invoiceNo: true, totalAmount: true } } },
          },
        },
        orderBy: [{ paymentDate: 'desc' }, { paymentNo: 'desc' }],
        skip,
        take: limit,
      }),
    ]);

    return { data, total, page, limit };
  }

  async create(dto: CreateApPaymentDto, tenantId: string, createdBy: string) {
    const whtAmount = dto.whtAmount ?? 0;
    const netAmount = dto.grossAmount - whtAmount;
    const paymentNo = await this.generatePaymentNo(tenantId);

    const payment = await this.prisma.$transaction(async (tx) => {
      const newPayment = await tx.apPayment.create({
        data: {
          tenantId,
          propertyId: dto.propertyId,
          paymentNo,
          supplierId: dto.supplierId,
          paymentDate: new Date(dto.paymentDate),
          method: dto.method,
          grossAmount: dto.grossAmount,
          whtAmount,
          netAmount,
          bankAccountId: dto.bankAccountId,
          reference: dto.reference,
          notes: dto.notes,
          status: 'PENDING',
          createdBy,
        },
      });

      if (dto.allocations && dto.allocations.length > 0) {
        for (const alloc of dto.allocations) {
          const invoice = await tx.apInvoice.findFirst({
            where: { id: alloc.invoiceId, tenantId },
          });
          if (!invoice) {
            throw new NotFoundException(`AP Invoice ${alloc.invoiceId} not found`);
          }
          if (['VOID', 'PENDING'].includes(invoice.status)) {
            throw new BadRequestException(
              `Cannot allocate to invoice ${invoice.invoiceNo} with status: ${invoice.status}. Invoice must be APPROVED first.`,
            );
          }

          await tx.apPaymentAllocation.create({
            data: {
              tenantId,
              paymentId: newPayment.id,
              invoiceId: alloc.invoiceId,
              amount: alloc.amount,
            },
          });

          const newPaid = Number(invoice.paidAmount) + alloc.amount;
          const newBalance = Number(invoice.netPayable) - newPaid;
          const newStatus = newBalance <= 0.01 ? 'PAID' : newPaid > 0 ? 'PARTIAL' : invoice.status;

          await tx.apInvoice.update({
            where: { id: alloc.invoiceId },
            data: {
              paidAmount: newPaid,
              balance: Math.max(0, newBalance),
              status: newStatus,
            },
          });
        }
      }

      return newPayment;
    });

    this.logger.log(`Created AP Payment ${paymentNo} for tenant ${tenantId}`);
    return payment;
  }

  async approve(id: string, tenantId: string, approvedBy: string) {
    const payment = await this.prisma.apPayment.findFirst({ where: { id, tenantId } });
    if (!payment) throw new NotFoundException(`AP Payment ${id} not found`);
    if (payment.status !== 'PENDING') {
      throw new BadRequestException(`Cannot approve payment with status: ${payment.status}`);
    }

    const updated = await this.prisma.apPayment.update({
      where: { id },
      data: { status: 'APPROVED', approvedBy, approvedAt: new Date() },
    });

    this.logger.log(`AP Payment ${payment.paymentNo} approved by ${approvedBy}`);
    return updated;
  }

  async void(id: string, tenantId: string, voidedBy: string) {
    const payment = await this.prisma.apPayment.findFirst({
      where: { id, tenantId },
      include: { allocations: true },
    });
    if (!payment) throw new NotFoundException(`AP Payment ${id} not found`);
    if (payment.status === 'VOID') {
      throw new BadRequestException('Payment is already void');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.apPayment.update({
        where: { id },
        data: { status: 'VOID', voidedBy, voidedAt: new Date() },
      });

      for (const alloc of payment.allocations) {
        const invoice = await tx.apInvoice.findUnique({ where: { id: alloc.invoiceId } });
        if (!invoice) continue;

        const newPaid = Math.max(0, Number(invoice.paidAmount) - Number(alloc.amount));
        const newBalance = Number(invoice.netPayable) - newPaid;
        const newStatus =
          invoice.status === 'VOID' ? 'VOID' : newPaid <= 0 ? 'APPROVED' : 'PARTIAL';

        await tx.apInvoice.update({
          where: { id: alloc.invoiceId },
          data: { paidAmount: newPaid, balance: newBalance, status: newStatus },
        });
      }
    });

    this.logger.log(`AP Payment ${payment.paymentNo} voided by ${voidedBy}`);
    return this.prisma.apPayment.findUnique({ where: { id } });
  }
}
