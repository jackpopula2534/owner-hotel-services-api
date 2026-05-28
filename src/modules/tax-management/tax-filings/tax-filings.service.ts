import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateTaxFilingDto, TaxFilingType } from './dto/create-tax-filing.dto';

interface FilingQuery {
  propertyId?: string;
  filingType?: TaxFilingType;
  period?: string;
  status?: string;
  page?: number;
  limit?: number;
}

@Injectable()
export class TaxFilingsService {
  private readonly logger = new Logger(TaxFilingsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAll(tenantId: string, query: FilingQuery) {
    const { page = 1, limit = 20, propertyId, filingType, period, status } = query;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { tenantId };
    if (propertyId) where.propertyId = propertyId;
    if (filingType) where.filingType = filingType;
    if (period) where.period = period;
    if (status) where.status = status;

    const [total, data] = await Promise.all([
      this.prisma.taxFiling.count({ where }),
      this.prisma.taxFiling.findMany({
        where,
        include: { lines: true },
        orderBy: [{ taxYear: 'desc' }, { taxMonth: 'desc' }, { filingType: 'asc' }],
        skip,
        take: limit,
      }),
    ]);

    return { data, total, page, limit };
  }

  async findOne(id: string, tenantId: string) {
    const filing = await this.prisma.taxFiling.findFirst({
      where: { id, tenantId },
      include: { lines: true },
    });
    if (!filing) throw new NotFoundException(`Tax filing ${id} not found`);
    return filing;
  }

  async create(dto: CreateTaxFilingDto, tenantId: string, createdBy: string) {
    const totalBase = (dto.lines ?? []).reduce((s, l) => s + l.baseAmount, 0);
    const totalTax = (dto.lines ?? []).reduce((s, l) => s + l.taxAmount, 0);

    const filing = await this.prisma.$transaction(async (tx) => {
      return tx.taxFiling.create({
        data: {
          tenantId,
          propertyId: dto.propertyId,
          filingType: dto.filingType,
          period: dto.period,
          taxYear: dto.taxYear,
          taxMonth: dto.taxMonth,
          dueDate: new Date(dto.dueDate),
          status: 'DRAFT',
          totalBase,
          totalTax,
          notes: dto.notes,
          createdBy,
          lines: dto.lines && dto.lines.length > 0
            ? {
                create: dto.lines.map((line, i) => ({
                  lineNo: i + 1,
                  description: line.description,
                  docRef: line.docRef,
                  baseAmount: line.baseAmount,
                  taxRate: line.taxRate,
                  taxAmount: line.taxAmount,
                })),
              }
            : undefined,
        },
        include: { lines: true },
      });
    });

    this.logger.log(`Created Tax Filing ${dto.filingType} ${dto.period} for tenant ${tenantId}`);
    return filing;
  }

  async submit(id: string, tenantId: string, filedBy: string) {
    const filing = await this.findOne(id, tenantId);
    if (!['DRAFT', 'READY'].includes(filing.status)) {
      throw new BadRequestException(`Cannot submit filing with status: ${filing.status}`);
    }

    const updated = await this.prisma.taxFiling.update({
      where: { id },
      data: { status: 'FILED', filedBy, filedAt: new Date() },
    });

    this.logger.log(`Tax Filing ${filing.filingType} ${filing.period} submitted by ${filedBy}`);
    return updated;
  }

  async markPaid(id: string, tenantId: string, paidBy: string) {
    const filing = await this.findOne(id, tenantId);
    if (filing.status !== 'FILED') {
      throw new BadRequestException(`Cannot mark as paid: filing status is ${filing.status}`);
    }

    const updated = await this.prisma.taxFiling.update({
      where: { id },
      data: { status: 'PAID', paidBy, paidAt: new Date() },
    });

    this.logger.log(`Tax Filing ${filing.filingType} ${filing.period} marked as paid by ${paidBy}`);
    return updated;
  }

  async generateVatPP30(tenantId: string, propertyId: string, period: string) {
    // period format: 'YYYY-MM'
    const [yearStr, monthStr] = period.split('-');
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);

    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59);

    // Aggregate Output VAT from AR Invoices in this period
    const arInvoices = await this.prisma.arInvoice.findMany({
      where: {
        tenantId,
        propertyId,
        issueDate: { gte: startDate, lte: endDate },
        status: { notIn: ['VOID', 'DRAFT'] },
      },
      select: { invoiceNo: true, subtotal: true, vatAmount: true, totalAmount: true },
    });

    const outputVatBase = arInvoices.reduce((s, inv) => s + Number(inv.subtotal), 0);
    const outputVat = arInvoices.reduce((s, inv) => s + Number(inv.vatAmount), 0);

    // Aggregate Input VAT from AP Invoices in this period
    const apInvoices = await this.prisma.apInvoice.findMany({
      where: {
        tenantId,
        propertyId,
        invoiceDate: { gte: startDate, lte: endDate },
        status: { notIn: ['VOID', 'PENDING'] },
      },
      select: { invoiceNo: true, subtotal: true, vatAmount: true },
    });

    const inputVatBase = apInvoices.reduce((s, inv) => s + Number(inv.subtotal), 0);
    const inputVat = apInvoices.reduce((s, inv) => s + Number(inv.vatAmount), 0);

    const vatPayable = outputVat - inputVat;

    // Due date: 15th of following month (or 23rd if filed online)
    const dueDate = new Date(year, month, 15);

    const lines = [
      {
        lineNo: 1,
        description: `Output VAT - Sales (${arInvoices.length} invoices)`,
        docRef: `AR-${period}`,
        baseAmount: outputVatBase,
        taxRate: 7,
        taxAmount: outputVat,
      },
      {
        lineNo: 2,
        description: `Input VAT - Purchases (${apInvoices.length} invoices)`,
        docRef: `AP-${period}`,
        baseAmount: inputVatBase,
        taxRate: 7,
        taxAmount: inputVat,
      },
    ];

    const filing = await this.prisma.$transaction(async (tx) => {
      return tx.taxFiling.create({
        data: {
          tenantId,
          propertyId,
          filingType: 'VAT_PP30',
          period,
          taxYear: year,
          taxMonth: month,
          dueDate,
          status: 'READY',
          totalBase: outputVatBase,
          totalTax: vatPayable,
          notes: `Auto-generated ภ.พ.30 for ${period}. Output VAT: ${outputVat.toFixed(2)}, Input VAT: ${inputVat.toFixed(2)}, Net Payable: ${vatPayable.toFixed(2)}`,
          createdBy: 'SYSTEM',
          lines: { create: lines },
        },
        include: { lines: true },
      });
    });

    this.logger.log(`Generated VAT PP30 for ${period}, propertyId ${propertyId}: payable ${vatPayable.toFixed(2)} THB`);
    return {
      filing,
      summary: {
        period,
        outputVatBase,
        outputVat,
        inputVatBase,
        inputVat,
        vatPayable,
        arInvoiceCount: arInvoices.length,
        apInvoiceCount: apInvoices.length,
      },
    };
  }
}
