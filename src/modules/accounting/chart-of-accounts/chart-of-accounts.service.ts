import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { AccountType, NormalBalance, AccountLevel } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import { QueryAccountDto } from './dto/query-account.dto';
import { ensureDefaultChartOfAccounts } from './default-chart-of-accounts';

export interface AccountWithRelations {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  nameEn: string | null;
  type: string;
  subType: string | null;
  normalBalance: string;
  level: string;
  parentId: string | null;
  isControl: boolean;
  isHeaderOnly: boolean;
  isActive: boolean;
  fsCode: string | null;
  description: string | null;
  costCenterId: string | null;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
  parent?: AccountWithRelations | null;
  children?: AccountWithRelations[];
  _count?: { children: number; journalLines: number };
}


@Injectable()
export class ChartOfAccountsService {
  private readonly logger = new Logger(ChartOfAccountsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAll(tenantId: string, query: QueryAccountDto): Promise<AccountWithRelations[]> {
    try {
      // เปิดหน้าผังบัญชีครั้งแรกของ tenant ที่ยังไม่มีบัญชีเลย → สร้างผังมาตรฐานให้ทันที
      await ensureDefaultChartOfAccounts(this.prisma, tenantId);

      const where: Record<string, unknown> = { tenantId };
      if (query.type) where.type = query.type;
      if (query.isActive !== undefined) where.isActive = query.isActive;
      if (query.search) {
        where.OR = [
          { code: { contains: query.search } },
          { name: { contains: query.search } },
          { nameEn: { contains: query.search } },
        ];
      }
      if (query.parentId !== undefined) {
        where.parentId = query.parentId === 'null' ? null : query.parentId;
      }

      const accounts = await this.prisma.accountChart.findMany({
        where,
        include: {
          _count: { select: { children: true, journalLines: true } },
          parent: { select: { id: true, code: true, name: true } },
          ...(query.tree
            ? { children: { include: { _count: { select: { children: true } } } } }
            : {}),
        },
        orderBy: [{ code: 'asc' }],
      });
      return accounts as unknown as AccountWithRelations[];
    } catch (error) {
      this.logger.error(
        'Failed to find accounts',
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  async findOne(id: string, tenantId: string): Promise<AccountWithRelations> {
    const account = await this.prisma.accountChart.findFirst({
      where: { id, tenantId },
      include: {
        parent: true,
        children: { orderBy: { code: 'asc' } },
        _count: { select: { journalLines: true } },
      },
    });
    if (!account) throw new NotFoundException(`Account ${id} not found`);
    return account as unknown as AccountWithRelations;
  }

  async create(dto: CreateAccountDto, tenantId: string): Promise<AccountWithRelations> {
    const existing = await this.prisma.accountChart.findFirst({
      where: { tenantId, code: dto.code },
    });
    if (existing) throw new ConflictException(`Account code ${dto.code} already exists`);

    if (dto.parentId) {
      const parent = await this.prisma.accountChart.findFirst({
        where: { id: dto.parentId, tenantId },
      });
      if (!parent) throw new NotFoundException(`Parent account ${dto.parentId} not found`);
    }

    const account = await this.prisma.accountChart.create({
      data: { ...dto, tenantId, isActive: true },
    });
    return account as unknown as AccountWithRelations;
  }

  async update(id: string, dto: UpdateAccountDto, tenantId: string): Promise<AccountWithRelations> {
    await this.findOne(id, tenantId);
    const updated = await this.prisma.accountChart.update({
      where: { id },
      data: { ...dto },
    });
    return updated as unknown as AccountWithRelations;
  }

  async remove(id: string, tenantId: string): Promise<void> {
    const account = await this.findOne(id, tenantId);
    const hasLines = (account._count?.journalLines ?? 0) > 0;
    if (hasLines) throw new BadRequestException('Cannot delete account with journal entries');
    const hasChildren = (account._count?.children ?? 0) > 0;
    if (hasChildren) throw new BadRequestException('Cannot delete account with sub-accounts');

    await this.prisma.accountChart.update({ where: { id }, data: { isActive: false } });
  }

  async seedDefaults(tenantId: string): Promise<{ created: number }> {
    const existing = await this.prisma.accountChart.count({ where: { tenantId } });
    if (existing > 0)
      throw new ConflictException('Chart of accounts already exists for this tenant');

    const created = await ensureDefaultChartOfAccounts(this.prisma, tenantId);
    return { created };
  }
}
