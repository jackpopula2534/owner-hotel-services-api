import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateArReceiptDto } from './dto/create-ar-receipt.dto';

interface ReceiptQuery {
  propertyId?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  limit?: number;
}

@Injectable()
export class ArReceiptsService {
  private readonly logger = new Logger(ArReceiptsService.name);

  constructor(private readonly prisma: PrismaService) {}

  private async generateReceiptNo(tenantId: string): Promise<string> {
    const now = new Date();
    const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const seq = await this.prisma.documentSequence.upsert({
      where: { tenantId_docType_yearMonth: { tenantId, docType: 'RCV', yearMonth } },
      update: { lastNumber: { increment: 1 } },
      create: { tenantId, docType: 'RCV', prefix: 'RCV', yearMonth, lastNumber: 1 },
    });
    return `RCV-${yearMonth}-${String(seq.lastNumber).padStart(6, '0')}`;
  }

  async findAll(tenantId: string, query: ReceiptQuery) {
    const { page = 1, limit = 20, propertyId, dateFrom, dateTo } = query;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { tenantId };
    if (propertyId) where.propertyId = propertyId;
    if (dateFrom || dateTo) {
      where.receiptDate = {
        ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
        ...(dateTo ? { lte: new Date(dateTo) } : {}),
      };
    }

    const [total, data] = await Promise.all([
      this.prisma.arReceipt.count({ where }),
      this.prisma.arReceipt.findMany({
        where,
        include: {
          allocations: {
            include: { invoice: { select: { invoiceNo: true, totalAmount: true } } },
          },
        },
        orderBy: [{ receiptDate: 'desc' }, { receiptNo: 'desc' }],
        skip,
        take: limit,
      }),
    ]);

    return { data, total, page, limit };
  }

  async create(dto: CreateArReceiptDto, tenantId: string, createdBy: string) {
    const receiptNo = await this.generateReceiptNo(tenantId);

    const receipt = await this.prisma.$transaction(async (tx) => {
      const newReceipt = await tx.arReceipt.create({
        data: {
          tenantId,
          propertyId: dto.propertyId,
          receiptNo,
          receiptDate: new Date(dto.receiptDate),
          guestId: dto.guestId,
          companyName: dto.companyName,
          method: dto.method,
          totalAmount: dto.totalAmount,
          reference: dto.reference,
          notes: dto.notes,
          status: 'CLEARED',
          createdBy,
        },
      });

      if (dto.allocations && dto.allocations.length > 0) {
        let allocatedTotal = 0;

        for (const alloc of dto.allocations) {
          const invoice = await tx.arInvoice.findFirst({
            where: { id: alloc.invoiceId, tenantId },
          });
          if (!invoice) {
            throw new NotFoundException(`Invoice ${alloc.invoiceId} not found`);
          }
          if (['VOID', 'DRAFT'].includes(invoice.status)) {
            throw new BadRequestException(
              `Cannot allocate to invoice ${invoice.invoiceNo} with status: ${invoice.status}`,
            );
          }

          await tx.arReceiptAllocation.create({
            data: {
              tenantId,
              receiptId: newReceipt.id,
              invoiceId: alloc.invoiceId,
              amount: alloc.amount,
            },
          });

          const newPaid = Number(invoice.paidAmount) + alloc.amount;
          const newBalance = Number(invoice.totalAmount) - newPaid;
          const newStatus =
            newBalance <= 0.01 ? 'PAID'
            : newPaid > 0 ? 'PARTIAL'
            : invoice.status;

          await tx.arInvoice.update({
            where: { id: alloc.invoiceId },
            data: {
              paidAmount: newPaid,
              balance: Math.max(0, newBalance),
              status: newStatus,
            },
          });

          allocatedTotal += alloc.amount;
        }

        if (Math.abs(allocatedTotal - dto.totalAmount) > 0.01) {
          this.logger.warn(
            `Receipt ${receiptNo}: allocated ${allocatedTotal} does not match total ${dto.totalAmount}`,
          );
        }
      }

      return newReceipt;
    });

    this.logger.log(`Created AR Receipt ${receiptNo} for tenant ${tenantId}`);
    return receipt;
  }

  async void(id: string, tenantId: string, voidedBy: string) {
    const receipt = await this.prisma.arReceipt.findFirst({
      where: { id, tenantId },
      include: { allocations: true },
    });
    if (!receipt) throw new NotFoundException(`Receipt ${id} not found`);
    if (receipt.status === 'VOID') {
      throw new BadRequestException('Receipt is already void');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.arReceipt.update({
        where: { id },
        data: { status: 'VOID', voidedBy, voidedAt: new Date() },
      });

      for (const alloc of receipt.allocations) {
        const invoice = await tx.arInvoice.findUnique({
          where: { id: alloc.invoiceId },
        });
        if (!invoice) continue;

        const newPaid = Math.max(0, Number(invoice.paidAmount) - Number(alloc.amount));
        const newBalance = Number(invoice.totalAmount) - newPaid;
        const newStatus =
          invoice.status === 'VOID' ? 'VOID'
          : newPaid <= 0 ? 'ISSUED'
          : 'PARTIAL';

        await tx.arInvoice.update({
          where: { id: alloc.invoiceId },
          data: { paidAmount: newPaid, balance: newBalance, status: newStatus },
        });
      }
    });

    this.logger.log(`AR Receipt ${receipt.receiptNo} voided by ${voidedBy}`);
    return this.prisma.arReceipt.findUnique({ where: { id } });
  }
}
