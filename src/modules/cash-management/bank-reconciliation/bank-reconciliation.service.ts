import {
  Injectable, Logger, NotFoundException, ConflictException, BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateBankReconDto } from './dto/create-bank-recon.dto';
import { CreateReconLineDto } from './dto/create-recon-line.dto';

@Injectable()
export class BankReconciliationService {
  private readonly logger = new Logger(BankReconciliationService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    tenantId: string,
    query: { propertyId?: string; bankAccountId?: string; period?: string; status?: string; page?: number; limit?: number },
  ) {
    const { propertyId, bankAccountId, period, status, page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;
    const where: Record<string, unknown> = { tenantId };
    if (propertyId) where.propertyId = propertyId;
    if (bankAccountId) where.bankAccountId = bankAccountId;
    if (period) where.period = period;
    if (status) where.status = status;

    const [total, data] = await Promise.all([
      this.prisma.bankReconciliation.count({ where }),
      this.prisma.bankReconciliation.findMany({
        where,
        include: { _count: { select: { lines: true } } },
        orderBy: [{ period: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: limit,
      }),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: string, tenantId: string) {
    const recon = await this.prisma.bankReconciliation.findFirst({
      where: { id, tenantId },
      include: {
        lines: { orderBy: { txnDate: 'asc' } },
      },
    });
    if (!recon) throw new NotFoundException(`Bank reconciliation ${id} not found`);
    return recon;
  }

  async create(dto: CreateBankReconDto, tenantId: string, createdBy: string) {
    const existing = await this.prisma.bankReconciliation.findFirst({
      where: { tenantId, propertyId: dto.propertyId, bankAccountId: dto.bankAccountId, period: dto.period },
    });
    if (existing) throw new ConflictException(`Reconciliation for ${dto.period} already exists`);

    // ลองดึง bookBalance จาก ledger (account 1102 - เงินฝากธนาคาร)
    let bookBalance = 0;
    try {
      const [fiscalYear, fiscalMonth] = dto.period.split('-').map(Number);
      const ledger = await this.prisma.ledgerBalance.findFirst({
        where: {
          tenantId,
          propertyId: dto.propertyId,
          fiscalYear,
          fiscalPeriod: fiscalMonth,
          account: { code: { startsWith: '1102' } },
        },
      });
      if (ledger) bookBalance = Number(ledger.closingBalance);
    } catch {
      this.logger.warn('Could not fetch book balance from ledger, defaulting to 0');
    }

    const variance = dto.statementBalance - bookBalance;

    return this.prisma.bankReconciliation.create({
      data: {
        tenantId,
        propertyId: dto.propertyId,
        bankAccountId: dto.bankAccountId,
        period: dto.period,
        statementDate: new Date(dto.statementDate),
        statementBalance: dto.statementBalance,
        bookBalance,
        variance,
        status: 'OPEN',
        notes: dto.notes,
        createdBy,
      },
    });
  }

  async addLine(dto: CreateReconLineDto, tenantId: string) {
    const recon = await this.findOne(dto.reconId, tenantId);
    if (recon.status === 'APPROVED') throw new BadRequestException('Cannot add lines to approved reconciliation');

    const line = await this.prisma.bankReconLine.create({
      data: {
        reconId: dto.reconId,
        txnType: dto.txnType,
        txnDate: new Date(dto.txnDate),
        description: dto.description,
        statementAmount: dto.statementAmount ?? 0,
        bookAmount: dto.bookAmount ?? 0,
        bookRef: dto.bookRef,
        statementRef: dto.statementRef,
        notes: dto.notes,
      },
    });

    // อัปเดต status เป็น IN_PROGRESS
    await this.prisma.bankReconciliation.update({
      where: { id: dto.reconId },
      data: { status: 'IN_PROGRESS' },
    });

    return line;
  }

  async matchLine(lineId: string, tenantId: string) {
    const line = await this.prisma.bankReconLine.findFirst({
      where: { id: lineId },
      include: { reconciliation: { select: { tenantId: true } } },
    });
    if (!line) throw new NotFoundException(`Recon line ${lineId} not found`);
    if (line.reconciliation.tenantId !== tenantId) throw new NotFoundException(`Recon line ${lineId} not found`);

    return this.prisma.bankReconLine.update({
      where: { id: lineId },
      data: { isMatched: !line.isMatched, matchedAt: line.isMatched ? null : new Date() },
    });
  }

  async approve(id: string, tenantId: string, approvedBy: string) {
    const recon = await this.findOne(id, tenantId);
    if (recon.status === 'APPROVED') throw new BadRequestException('Already approved');

    const unmatchedLines = await this.prisma.bankReconLine.count({
      where: { reconId: id, isMatched: false },
    });
    if (unmatchedLines > 0) {
      throw new BadRequestException(`${unmatchedLines} unmatched line(s) remaining`);
    }

    return this.prisma.bankReconciliation.update({
      where: { id },
      data: { status: 'APPROVED', approvedBy, approvedAt: new Date() },
    });
  }

  async getSummary(id: string, tenantId: string) {
    const recon = await this.findOne(id, tenantId);
    const lines = await this.prisma.bankReconLine.findMany({ where: { reconId: id } });

    const matched = lines.filter((l) => l.isMatched);
    const unmatched = lines.filter((l) => !l.isMatched);

    return {
      id: recon.id,
      period: recon.period,
      statementBalance: Number(recon.statementBalance),
      bookBalance: Number(recon.bookBalance),
      variance: Number(recon.variance),
      status: recon.status,
      totalLines: lines.length,
      matchedLines: matched.length,
      unmatchedLines: unmatched.length,
      matchedStatementTotal: matched.reduce((s, l) => s + Number(l.statementAmount), 0),
      unmatchedItems: unmatched.map((l) => ({
        id: l.id,
        txnDate: l.txnDate,
        description: l.description,
        statementAmount: Number(l.statementAmount),
        bookAmount: Number(l.bookAmount),
      })),
    };
  }
}
