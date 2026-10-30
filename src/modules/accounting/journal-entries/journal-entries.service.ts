import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import {
  CreateJournalEntryDto,
  JournalSourceTypeEnum,
} from './dto/create-journal-entry.dto';
import { QueryJournalEntryDto } from './dto/query-journal-entry.dto';
import { applyLedgerBalances } from '../ledger/ledger-balance.util';
import {
  assertPeriodOpen,
  businessDayOf,
  fiscalPeriodOf,
  nextJournalEntryNo,
} from '../ledger/journal-posting.util';

interface AutoPostJournalEntryInput {
  propertyId: string;
  entryDate: string | Date;
  description: string;
  reference?: string;
  sourceType: JournalSourceTypeEnum;
  sourceId: string;
  createdBy: string;
  lines: CreateJournalEntryDto['lines'];
}

@Injectable()
export class JournalEntriesService {
  private readonly logger = new Logger(JournalEntriesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAll(tenantId: string, query: QueryJournalEntryDto) {
    const {
      page = 1,
      limit = 20,
      propertyId,
      dateFrom,
      dateTo,
      status,
      sourceType,
      sourceId,
      search,
      accountId,
    } = query;
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
    await assertPeriodOpen(this.prisma, tenantId, dto.propertyId, entryDate);
    const { fiscalYear: year, fiscalPeriod: period } = fiscalPeriodOf(entryDate);
    const entryNo = await nextJournalEntryNo(this.prisma, tenantId, entryDate);

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

  async createAndPostAutoEntry(tenantId: string, input: AutoPostJournalEntryInput) {
    const existing = await this.prisma.journalEntry.findFirst({
      where: {
        tenantId,
        propertyId: input.propertyId,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
      },
      include: {
        lines: {
          include: {
            account: { select: { id: true, code: true, name: true, type: true } },
          },
          orderBy: { lineNo: 'asc' },
        },
      },
    });

    if (existing) {
      if (existing.status === 'DRAFT') {
        return this.post(existing.id, tenantId, input.createdBy);
      }
      return existing;
    }

    const created = await this.create(
      {
        propertyId: input.propertyId,
        // วันที่ตามปฏิทินไทย — toISOString ตรงๆ ของเวลา 00:00-06:59 น. จะได้วันก่อนหน้า
        entryDate:
          input.entryDate instanceof Date
            ? businessDayOf(input.entryDate).toISOString().split('T')[0]
            : input.entryDate,
        description: input.description,
        reference: input.reference,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        lines: input.lines,
      },
      tenantId,
      input.createdBy,
    );

    return this.post(created.id, tenantId, input.createdBy);
  }

  async post(id: string, tenantId: string, postedBy: string) {
    const entry = await this.findOne(id, tenantId);
    if (entry.status !== 'DRAFT') {
      throw new BadRequestException(`Cannot post entry with status: ${entry.status}`);
    }

    // ร่างที่ค้างไว้ก่อนปิดปีบัญชี ห้ามโพสต์ทะลุเข้าไปทีหลัง
    await assertPeriodOpen(this.prisma, tenantId, entry.propertyId, entry.entryDate);

    const updated = await this.prisma.$transaction(async (tx) => {
      const je = await tx.journalEntry.update({
        where: { id },
        data: { status: 'POSTED', postedBy, postedAt: new Date() },
      });

      await applyLedgerBalances(
        tx,
        {
          tenantId,
          propertyId: entry.propertyId,
          fiscalYear: entry.fiscalYear,
          fiscalPeriod: entry.fiscalPeriod,
        },
        entry.lines,
      );

      return je;
    });

    return updated;
  }

  /**
   * กลับรายการที่ระบบลงอัตโนมัติจากเอกสารต้นทาง (ยกเลิกใบแจ้งหนี้/ใบเสร็จ/ใบจ่าย)
   * ไม่มีรายการที่ POSTED อยู่ = ไม่ต้องทำอะไร (เอกสารยังไม่เคยลงบัญชี)
   */
  async reverseBySource(
    tenantId: string,
    sourceType: JournalSourceTypeEnum,
    sourceId: string,
    reversedBy: string,
    description: string,
  ) {
    const entry = await this.prisma.journalEntry.findFirst({
      where: { tenantId, sourceType, sourceId, status: 'POSTED' },
      select: { id: true, entryDate: true },
    });
    if (!entry) return null;
    // เอกสารลงวันที่ล่วงหน้าแล้วถูกยกเลิกวันนี้ → กลับรายการในวันของเอกสาร (ห้ามย้อนก่อนใบเดิม)
    const now = new Date();
    const reversalDate = entry.entryDate > now ? entry.entryDate : now;
    return this.reverse(entry.id, tenantId, reversedBy, description, reversalDate.toISOString());
  }

  /**
   * กลับรายการลงวันที่ `reversalDate` (ค่าเริ่มต้น = วันนี้) — ใบเดิมอาจอยู่งวดที่ปิดไปแล้ว
   * จึงต้องลงใบกลับในงวดที่ยังเปิด ห้ามย้อนวันที่ก่อนใบเดิม
   */
  async reverse(
    id: string,
    tenantId: string,
    reversedBy: string,
    description?: string,
    reversalDate?: string,
  ) {
    const entry = await this.findOne(id, tenantId);
    if (entry.status !== 'POSTED') {
      throw new BadRequestException('Can only reverse POSTED entries');
    }

    const entryDate = reversalDate ? new Date(reversalDate) : new Date();
    if (entryDate < entry.entryDate) {
      throw new BadRequestException('วันที่กลับรายการต้องไม่ก่อนวันที่ของรายการเดิม');
    }
    await assertPeriodOpen(this.prisma, tenantId, entry.propertyId, entryDate);
    const entryNo = await nextJournalEntryNo(this.prisma, tenantId, entryDate);
    const { fiscalYear: year, fiscalPeriod: period } = fiscalPeriodOf(entryDate);

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
        data: { status: 'REVERSED', reversedById: rev.id, reversedAt: new Date() },
      });

      await applyLedgerBalances(
        tx,
        { tenantId, propertyId: entry.propertyId, fiscalYear: year, fiscalPeriod: period },
        entry.lines.map((l) => ({ accountId: l.accountId, debit: l.credit, credit: l.debit })),
      );

      return rev;
    });

    return reversal;
  }
}
