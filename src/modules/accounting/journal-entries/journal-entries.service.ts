import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateJournalEntryDto } from './dto/create-journal-entry.dto';
import { QueryJournalEntryDto } from './dto/query-journal-entry.dto';

@Injectable()
export class JournalEntriesService {
  private readonly logger = new Logger(JournalEntriesService.name);

  constructor(private readonly prisma: PrismaService) {}

  private async generateEntryNo(tenantId: string): Promise<string> {
    const now = new Date();
    const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const seq = await this.prisma.documentSequence.upsert({
      where: { tenantId_docType_yearMonth: { tenantId, docType: 'JE', yearMonth } },
      update: { lastNumber: { increment: 1 } },
      create: { tenantId, docType: 'JE', prefix: 'JE', yearMonth, lastNumber: 1 },
    });
    return `JE-${yearMonth}-${String(seq.lastNumber).padStart(6, '0')}`;
  }

  private getFiscalPeriod(date: Date): { year: number; period: number } {
    return { year: date.getFullYear(), period: date.getMonth() + 1 };
  }

  async findAll(tenantId: string, query: QueryJournalEntryDto) {
    const { page = 1, limit = 20, propertyId, dateFrom, dateTo, status, sourceType, sourceId, search, accountId } = query;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { tenantId };
    if (propertyId) where.propertyId = propertyId;
    if (status) where.status = status;
    if (sourceType) where.sourceType = sourceType;
    if (sourceId) where.sourceId = sourceId;
    if (dateFrom || dateTo) {
      where.entryDate = {
        ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
        ...(dateTo ? { lte: new Date(dateTo) } : {}),
      };
    }
    if (search) {
      where.OR = [
        { entryNo: { contains: search } },
        { description: { contains: search } },
        { reference: { contains: search } },
      ];
    }
    if (accountId) {
      where.lines = { some: { accountId } };
    }

    const [total, data] = await Promise.all([
      this.prisma.journalEntry.count({ where }),
      this.prisma.journalEntry.findMany({
        where,
        include: {
          lines: {
            include: { account: { select: { code: true, name: true } } },
            orderBy: { lineNo: 'asc' },
          },
        },
        orderBy: [{ entryDate: 'desc' }, { entryNo: 'desc' }],
        skip,
        take: limit,
      }),
    ]);

    return { data, total, page, limit };
  }

  async findOne(id: string, tenantId: string) {
    const entry = await this.prisma.journalEntry.findFirst({
      where: { id, tenantId },
      include: {
        lines: {
          include: {
            account: { select: { id: true, code: true, name: true, type: true } },
          },
          orderBy: { lineNo: 'asc' },
        },
      },
    });
    if (!entry) throw new NotFoundException(`Journal entry ${id} not found`);
    return entry;
  }

  async create(dto: CreateJournalEntryDto, tenantId: string, createdBy: string) {
    // Validate double-entry: debit = credit
    const totalDebit = dto.lines.reduce((s, l) => s + (l.debit ?? 0), 0);
    const totalCredit = dto.lines.reduce((s, l) => s + (l.credit ?? 0), 0);
    const diff = Math.abs(totalDebit - totalCredit);
    if (diff > 0.01) {
      throw new BadRequestException(
        `Journal entry is not balanced: Debit ${totalDebit.toFixed(2)} ≠ Credit ${totalCredit.toFixed(2)}`,
      );
    }
    if (dto.lines.length < 2) {
      throw new BadRequestException('Journal entry must have at least 2 lines');
    }

    // Validate all accounts exist
    const accountIds = [...new Set(dto.lines.map((l) => l.accountId))];
    const accounts = await this.prisma.accountChart.findMany({
      where: { id: { in: accountIds }, tenantId, isActive: true },
    });
    if (accounts.length !== accountIds.length) {
      const foundIds = new Set(accounts.map((a) => a.id));
      const missing = accountIds.filter((id) => !foundIds.has(id));
      throw new BadRequestException(`Account(s) not found or inactive: ${missing.join(', ')}`);
    }

    // Check for header-only accounts
    const headerOnlyUsed = accounts.filter((a) => a.isHeaderOnly);
    if (headerOnlyUsed.length > 0) {
      throw new BadRequestException(
        `Cannot post to header-only account(s): ${headerOnlyUsed.map((a) => a.code).join(', ')}`,
      );
    }

    const entryDate = new Date(dto.entryDate);
    const { year, period } = this.getFiscalPeriod(entryDate);
    const entryNo = await this.generateEntryNo(tenantId);

    const entry = await this.prisma.$transaction(async (tx) => {
      const je = await tx.journalEntry.create({
        data: {
          tenantId,
          propertyId: dto.propertyId,
          entryNo,
          entryDate,
          description: dto.description,
          reference: dto.reference,
          sourceType: dto.sourceType ?? 'MANUAL',
          sourceId: dto.sourceId,
          status: 'DRAFT',
          fiscalYear: year,
          fiscalPeriod: period,
          totalDebit,
          totalCredit,
          createdBy,
          lines: {
            create: dto.lines.map((line) => ({
              accountId: line.accountId,
              lineNo: line.lineNo,
              description: line.description,
              debit: line.debit,
              credit: line.credit,
              costCenterId: line.costCenterId,
              subRef: line.subRef,
            })),
          },
        },
        include: { lines: { include: { account: { select: { code: true, name: true } } } } },
      });
      return je;
    });

    return entry;
  }

  async post(id: string, tenantId: string, postedBy: string) {
    const entry = await this.findOne(id, tenantId);
    if (entry.status !== 'DRAFT') {
      throw new BadRequestException(`Cannot post entry with status: ${entry.status}`);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const je = await tx.journalEntry.update({
        where: { id },
        data: { status: 'POSTED', postedBy, postedAt: new Date() },
      });

      // Update LedgerBalance for each line
      for (const line of entry.lines) {
        const { fiscalYear, fiscalPeriod } = entry;
        const key = {
          tenantId,
          propertyId: entry.propertyId,
          accountId: line.accountId,
          fiscalYear,
          fiscalPeriod,
        };

        await tx.ledgerBalance.upsert({
          where: {
            tenantId_propertyId_accountId_fiscalYear_fiscalPeriod: key,
          },
          update: {
            periodDebit: { increment: Number(line.debit) },
            periodCredit: { increment: Number(line.credit) },
            closingBalance: { increment: Number(line.debit) - Number(line.credit) },
            txnCount: { increment: 1 },
          },
          create: {
            ...key,
            openingBalance: 0,
            periodDebit: Number(line.debit),
            periodCredit: Number(line.credit),
            closingBalance: Number(line.debit) - Number(line.credit),
            txnCount: 1,
          },
        });
      }

      return je;
    });

    return updated;
  }

  async reverse(id: string, tenantId: string, reversedBy: string, description?: string) {
    const entry = await this.findOne(id, tenantId);
    if (entry.status !== 'POSTED') {
      throw new BadRequestException('Can only reverse POSTED entries');
    }

    const entryNo = await this.generateEntryNo(tenantId);
    const entryDate = new Date();
    const { year, period } = this.getFiscalPeriod(entryDate);

    const reversal = await this.prisma.$transaction(async (tx) => {
      // Create reversal entry (swap debit/credit)
      const rev = await tx.journalEntry.create({
        data: {
          tenantId,
          propertyId: entry.propertyId,
          entryNo,
          entryDate,
          description: description ?? `Reversal of ${entry.entryNo}`,
          reference: entry.entryNo,
          sourceType: 'ADJUSTMENT',
          status: 'POSTED',
          fiscalYear: year,
          fiscalPeriod: period,
          totalDebit: entry.totalCredit,
          totalCredit: entry.totalDebit,
          reversedById: id,
          createdBy: reversedBy,
          postedBy: reversedBy,
          postedAt: new Date(),
          lines: {
            create: entry.lines.map((l, i) => ({
              accountId: l.accountId,
              lineNo: i + 1,
              description: `Reversal: ${l.description ?? ''}`,
              debit: l.credit,
              credit: l.debit,
              costCenterId: l.costCenterId,
            })),
          },
        },
      });

      // Mark original as reversed
      await tx.journalEntry.update({
        where: { id },
        data: { status: 'REVERSED', reversedAt: new Date() },
      });

      // Update LedgerBalance for reversal lines
      for (const line of entry.lines) {
        const key = {
          tenantId,
          propertyId: entry.propertyId,
          accountId: line.accountId,
          fiscalYear: year,
          fiscalPeriod: period,
        };
        await tx.ledgerBalance.upsert({
          where: { tenantId_propertyId_accountId_fiscalYear_fiscalPeriod: key },
          update: {
            periodDebit: { increment: Number(line.credit) },
            periodCredit: { increment: Number(line.debit) },
            closingBalance: { increment: Number(line.credit) - Number(line.debit) },
            txnCount: { increment: 1 },
          },
          create: {
            ...key,
            openingBalance: 0,
            periodDebit: Number(line.credit),
            periodCredit: Number(line.debit),
            closingBalance: Number(line.credit) - Number(line.debit),
            txnCount: 1,
          },
        });
      }

      return rev;
    });

    return reversal;
  }
}
