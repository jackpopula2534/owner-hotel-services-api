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
import { ACCOUNT_CODES } from '../ledger/posting-accounts.util';

/** บัญชีที่ระบบลงอัตโนมัติอ้างถึงด้วยรหัส — ปิดใช้งานแล้วเอกสารทั้งระบบลงบัญชีไม่ได้ */
const SYSTEM_ACCOUNT_CODES = new Set<string>(Object.values(ACCOUNT_CODES));

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
  /** บัญชีที่ระบบลงอัตโนมัติ ปิดใช้งานไม่ได้ */
  isSystem?: boolean;
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
      return accounts.map((a) => ({
        ...a,
        isSystem: SYSTEM_ACCOUNT_CODES.has(a.code),
      })) as unknown as AccountWithRelations[];
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
        _count: { select: { journalLines: true, children: true } },
      },
    });
    if (!account) throw new NotFoundException('ไม่พบบัญชีในผังบัญชี');
    return { ...account, isSystem: SYSTEM_ACCOUNT_CODES.has(account.code) } as unknown as AccountWithRelations;
  }

  async create(dto: CreateAccountDto, tenantId: string): Promise<AccountWithRelations> {
    const existing = await this.prisma.accountChart.findFirst({
      where: { tenantId, code: dto.code },
    });
    if (existing) throw new ConflictException(`รหัสบัญชี ${dto.code} มีอยู่แล้ว`);

    if (dto.parentId) await this.assertValidParent(tenantId, dto.parentId, null, dto.type);

    const account = await this.prisma.accountChart.create({
      data: { ...dto, tenantId, isActive: true },
    });
    return account as unknown as AccountWithRelations;
  }

  async update(id: string, dto: UpdateAccountDto, tenantId: string): Promise<AccountWithRelations> {
    const account = await this.findOne(id, tenantId);
    const used = (account._count?.journalLines ?? 0) > 0;

    if (used && dto.type !== undefined && dto.type !== account.type) {
      throw new BadRequestException('บัญชีที่มีรายการแล้วเปลี่ยนประเภทไม่ได้ — สร้างบัญชีใหม่แล้วโอนยอดแทน');
    }
    if (used && dto.normalBalance !== undefined && dto.normalBalance !== account.normalBalance) {
      throw new BadRequestException('บัญชีที่มีรายการแล้วเปลี่ยนด้านยอดปกติไม่ได้');
    }
    if (used && dto.isHeaderOnly === true && !account.isHeaderOnly) {
      throw new BadRequestException('บัญชีที่มีรายการแล้วตั้งเป็นบัญชีหัวข้อไม่ได้');
    }
    if (dto.parentId) {
      await this.assertValidParent(tenantId, dto.parentId, id, dto.type ?? account.type);
    }
    if (dto.isActive === false && account.isActive) {
      await this.assertCanDeactivate(account, tenantId);
    }

    const { parentId, ...rest } = dto;
    const updated = await this.prisma.accountChart.update({
      where: { id },
      data: {
        ...rest,
        // ส่ง null มา = ย้ายไปเป็นบัญชีระดับบนสุด
        ...(parentId !== undefined ? { parentId: parentId || null } : {}),
      },
    });
    return { ...updated, isSystem: SYSTEM_ACCOUNT_CODES.has(updated.code) } as unknown as AccountWithRelations;
  }

  async remove(id: string, tenantId: string): Promise<void> {
    const account = await this.findOne(id, tenantId);
    if (!account.isActive) return;
    await this.assertCanDeactivate(account, tenantId);
    await this.prisma.accountChart.update({ where: { id }, data: { isActive: false } });
  }

  /** ปิดใช้งานได้เมื่อไม่ใช่บัญชีระบบ ไม่มีบัญชีย่อยที่ยังใช้งาน และยอดคงเหลือเป็น 0 */
  private async assertCanDeactivate(account: AccountWithRelations, tenantId: string) {
    if (SYSTEM_ACCOUNT_CODES.has(account.code)) {
      throw new BadRequestException(`บัญชี ${account.code} เป็นบัญชีที่ระบบลงอัตโนมัติ ปิดใช้งานไม่ได้`);
    }
    const activeChildren = await this.prisma.accountChart.count({
      where: { tenantId, parentId: account.id, isActive: true },
    });
    if (activeChildren > 0) {
      throw new BadRequestException(`ยังมีบัญชีย่อยที่ใช้งานอยู่ ${activeChildren} บัญชี — ปิดบัญชีย่อยก่อน`);
    }
    const sums = await this.prisma.journalLine.aggregate({
      where: {
        accountId: account.id,
        journalEntry: { tenantId, status: { in: ['POSTED', 'REVERSED'] } },
      },
      _sum: { debit: true, credit: true },
    });
    const balance = Number(sums._sum.debit ?? 0) - Number(sums._sum.credit ?? 0);
    if (Math.abs(balance) >= 0.005) {
      throw new BadRequestException(
        `บัญชียังมียอดคงเหลือ ${balance.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท — โอนยอดออกให้เป็น 0 ก่อนปิดใช้งาน`,
      );
    }
    const drafts = await this.prisma.journalLine.count({
      where: { accountId: account.id, journalEntry: { tenantId, status: 'DRAFT' } },
    });
    if (drafts > 0) {
      throw new BadRequestException(`มีรายการร่าง ${drafts} บรรทัดที่ใช้บัญชีนี้ — ลงบัญชีหรือลบร่างก่อน`);
    }
  }

  /** บัญชีแม่ต้องอยู่ใน tenant เดียวกัน ประเภทเดียวกัน และไม่ใช่ตัวเองหรือบัญชีลูกหลาน */
  private async assertValidParent(tenantId: string, parentId: string, selfId: string | null, type: string) {
    const parent = await this.prisma.accountChart.findFirst({ where: { id: parentId, tenantId } });
    if (!parent) throw new NotFoundException('ไม่พบบัญชีแม่');
    if (parent.type !== type) throw new BadRequestException('บัญชีแม่ต้องเป็นประเภทเดียวกัน');
    if (!selfId) return;
    let cursor: string | null = parent.id;
    for (let depth = 0; cursor && depth < 20; depth++) {
      if (cursor === selfId) throw new BadRequestException('ตั้งบัญชีลูกของตัวเองเป็นบัญชีแม่ไม่ได้');
      const next: { parentId: string | null } | null = await this.prisma.accountChart.findFirst({
        where: { id: cursor, tenantId },
        select: { parentId: true },
      });
      cursor = next?.parentId ?? null;
    }
  }

  async seedDefaults(tenantId: string): Promise<{ created: number }> {
    const existing = await this.prisma.accountChart.count({ where: { tenantId } });
    if (existing > 0)
      throw new ConflictException('มีผังบัญชีอยู่แล้ว');

    const created = await ensureDefaultChartOfAccounts(this.prisma, tenantId);
    return { created };
  }
}
