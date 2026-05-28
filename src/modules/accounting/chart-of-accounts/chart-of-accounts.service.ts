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

// Default Thai hotel Chart of Accounts (USALI-inspired)
const DEFAULT_ACCOUNTS = [
  // ── สินทรัพย์ ──────────────────────────────────────────────
  { code: '1000', name: 'สินทรัพย์', nameEn: 'Assets', type: 'ASSET', normalBalance: 'DEBIT', level: 'CATEGORY', isHeaderOnly: true },
  { code: '1100', name: 'สินทรัพย์หมุนเวียน', nameEn: 'Current Assets', type: 'ASSET', normalBalance: 'DEBIT', level: 'GROUP', isHeaderOnly: true },
  { code: '1101', name: 'เงินสด', nameEn: 'Cash', type: 'ASSET', normalBalance: 'DEBIT', level: 'ACCOUNT' },
  { code: '1102', name: 'เงินฝากธนาคาร', nameEn: 'Bank Deposits', type: 'ASSET', normalBalance: 'DEBIT', level: 'ACCOUNT' },
  { code: '1103', name: 'ลูกหนี้การค้า', nameEn: 'Accounts Receivable', type: 'ASSET', normalBalance: 'DEBIT', level: 'ACCOUNT', isControl: true },
  { code: '1104', name: 'ลูกหนี้ City Ledger', nameEn: 'City Ledger', type: 'ASSET', normalBalance: 'DEBIT', level: 'ACCOUNT' },
  { code: '1105', name: 'เงินมัดจำรับล่วงหน้า', nameEn: 'Advance Deposits', type: 'ASSET', normalBalance: 'DEBIT', level: 'ACCOUNT' },
  { code: '1106', name: 'ภาษีซื้อ (VAT Input)', nameEn: 'VAT Input Tax', type: 'ASSET', normalBalance: 'DEBIT', level: 'ACCOUNT' },
  { code: '1107', name: 'สินค้าคงเหลือ', nameEn: 'Inventory', type: 'ASSET', normalBalance: 'DEBIT', level: 'ACCOUNT' },
  { code: '1108', name: 'ค่าใช้จ่ายล่วงหน้า', nameEn: 'Prepaid Expenses', type: 'ASSET', normalBalance: 'DEBIT', level: 'ACCOUNT' },
  { code: '1200', name: 'สินทรัพย์ไม่หมุนเวียน', nameEn: 'Non-Current Assets', type: 'ASSET', normalBalance: 'DEBIT', level: 'GROUP', isHeaderOnly: true },
  { code: '1201', name: 'ที่ดิน', nameEn: 'Land', type: 'ASSET', normalBalance: 'DEBIT', level: 'ACCOUNT' },
  { code: '1202', name: 'อาคาร', nameEn: 'Building', type: 'ASSET', normalBalance: 'DEBIT', level: 'ACCOUNT' },
  { code: '1203', name: 'ค่าเสื่อมราคาสะสม - อาคาร', nameEn: 'Accum. Depreciation - Building', type: 'ASSET', normalBalance: 'CREDIT', level: 'ACCOUNT' },
  { code: '1204', name: 'เฟอร์นิเจอร์และของตกแต่ง', nameEn: 'Furniture & Fixtures', type: 'ASSET', normalBalance: 'DEBIT', level: 'ACCOUNT' },
  { code: '1205', name: 'ค่าเสื่อมราคาสะสม - เฟอร์นิเจอร์', nameEn: 'Accum. Depreciation - Furniture', type: 'ASSET', normalBalance: 'CREDIT', level: 'ACCOUNT' },
  { code: '1206', name: 'เครื่องจักรและอุปกรณ์', nameEn: 'Machinery & Equipment', type: 'ASSET', normalBalance: 'DEBIT', level: 'ACCOUNT' },
  { code: '1207', name: 'ค่าเสื่อมราคาสะสม - เครื่องจักร', nameEn: 'Accum. Depreciation - Machinery', type: 'ASSET', normalBalance: 'CREDIT', level: 'ACCOUNT' },
  { code: '1208', name: 'ยานพาหนะ', nameEn: 'Vehicles', type: 'ASSET', normalBalance: 'DEBIT', level: 'ACCOUNT' },
  { code: '1209', name: 'ค่าเสื่อมราคาสะสม - ยานพาหนะ', nameEn: 'Accum. Depreciation - Vehicles', type: 'ASSET', normalBalance: 'CREDIT', level: 'ACCOUNT' },
  // ── หนี้สิน ────────────────────────────────────────────────
  { code: '2000', name: 'หนี้สิน', nameEn: 'Liabilities', type: 'LIABILITY', normalBalance: 'CREDIT', level: 'CATEGORY', isHeaderOnly: true },
  { code: '2100', name: 'หนี้สินหมุนเวียน', nameEn: 'Current Liabilities', type: 'LIABILITY', normalBalance: 'CREDIT', level: 'GROUP', isHeaderOnly: true },
  { code: '2101', name: 'เจ้าหนี้การค้า', nameEn: 'Accounts Payable', type: 'LIABILITY', normalBalance: 'CREDIT', level: 'ACCOUNT', isControl: true },
  { code: '2102', name: 'ค่าใช้จ่ายค้างจ่าย', nameEn: 'Accrued Expenses', type: 'LIABILITY', normalBalance: 'CREDIT', level: 'ACCOUNT' },
  { code: '2103', name: 'ภาษีขาย (VAT Output)', nameEn: 'VAT Output Tax', type: 'LIABILITY', normalBalance: 'CREDIT', level: 'ACCOUNT' },
  { code: '2104', name: 'ภาษีหัก ณ ที่จ่ายค้างจ่าย', nameEn: 'WHT Payable', type: 'LIABILITY', normalBalance: 'CREDIT', level: 'ACCOUNT' },
  { code: '2105', name: 'รายได้รับล่วงหน้า (มัดจำ)', nameEn: 'Deferred Revenue - Deposits', type: 'LIABILITY', normalBalance: 'CREDIT', level: 'ACCOUNT' },
  { code: '2106', name: 'เงินกู้ยืมระยะสั้น', nameEn: 'Short-term Loans', type: 'LIABILITY', normalBalance: 'CREDIT', level: 'ACCOUNT' },
  { code: '2200', name: 'หนี้สินไม่หมุนเวียน', nameEn: 'Non-Current Liabilities', type: 'LIABILITY', normalBalance: 'CREDIT', level: 'GROUP', isHeaderOnly: true },
  { code: '2201', name: 'เงินกู้ยืมระยะยาว', nameEn: 'Long-term Loans', type: 'LIABILITY', normalBalance: 'CREDIT', level: 'ACCOUNT' },
  // ── ส่วนของเจ้าของ ─────────────────────────────────────────
  { code: '3000', name: 'ส่วนของเจ้าของ', nameEn: 'Equity', type: 'EQUITY', normalBalance: 'CREDIT', level: 'CATEGORY', isHeaderOnly: true },
  { code: '3101', name: 'ทุนจดทะเบียน', nameEn: 'Registered Capital', type: 'EQUITY', normalBalance: 'CREDIT', level: 'ACCOUNT' },
  { code: '3102', name: 'กำไรสะสม', nameEn: 'Retained Earnings', type: 'EQUITY', normalBalance: 'CREDIT', level: 'ACCOUNT' },
  { code: '3103', name: 'กำไร(ขาดทุน)ปีปัจจุบัน', nameEn: 'Current Year P&L', type: 'EQUITY', normalBalance: 'CREDIT', level: 'ACCOUNT' },
  // ── รายได้ ─────────────────────────────────────────────────
  { code: '4000', name: 'รายได้', nameEn: 'Revenue', type: 'REVENUE', normalBalance: 'CREDIT', level: 'CATEGORY', isHeaderOnly: true },
  { code: '4100', name: 'รายได้ห้องพัก', nameEn: 'Room Revenue', type: 'REVENUE', normalBalance: 'CREDIT', level: 'GROUP', isHeaderOnly: true },
  { code: '4101', name: 'รายได้ค่าห้องพัก', nameEn: 'Room Rate Revenue', type: 'REVENUE', normalBalance: 'CREDIT', level: 'ACCOUNT' },
  { code: '4102', name: 'รายได้ Early Check-in / Late Check-out', nameEn: 'Early/Late Fee Revenue', type: 'REVENUE', normalBalance: 'CREDIT', level: 'ACCOUNT' },
  { code: '4200', name: 'รายได้อาหารและเครื่องดื่ม', nameEn: 'F&B Revenue', type: 'REVENUE', normalBalance: 'CREDIT', level: 'GROUP', isHeaderOnly: true },
  { code: '4201', name: 'รายได้อาหาร', nameEn: 'Food Revenue', type: 'REVENUE', normalBalance: 'CREDIT', level: 'ACCOUNT' },
  { code: '4202', name: 'รายได้เครื่องดื่ม', nameEn: 'Beverage Revenue', type: 'REVENUE', normalBalance: 'CREDIT', level: 'ACCOUNT' },
  { code: '4300', name: 'รายได้อื่นๆ', nameEn: 'Other Revenue', type: 'REVENUE', normalBalance: 'CREDIT', level: 'GROUP', isHeaderOnly: true },
  { code: '4301', name: 'รายได้ Minibar', nameEn: 'Minibar Revenue', type: 'REVENUE', normalBalance: 'CREDIT', level: 'ACCOUNT' },
  { code: '4302', name: 'รายได้ซักรีด', nameEn: 'Laundry Revenue', type: 'REVENUE', normalBalance: 'CREDIT', level: 'ACCOUNT' },
  { code: '4303', name: 'รายได้สปา', nameEn: 'Spa Revenue', type: 'REVENUE', normalBalance: 'CREDIT', level: 'ACCOUNT' },
  { code: '4304', name: 'รายได้จอดรถ', nameEn: 'Parking Revenue', type: 'REVENUE', normalBalance: 'CREDIT', level: 'ACCOUNT' },
  { code: '4305', name: 'รายได้ค่าธรรมเนียมบริการ', nameEn: 'Service Charge Revenue', type: 'REVENUE', normalBalance: 'CREDIT', level: 'ACCOUNT' },
  // ── ต้นทุนขาย ──────────────────────────────────────────────
  { code: '5000', name: 'ต้นทุนขาย', nameEn: 'Cost of Sales', type: 'EXPENSE', normalBalance: 'DEBIT', level: 'CATEGORY', isHeaderOnly: true },
  { code: '5101', name: 'ต้นทุนวัตถุดิบอาหาร', nameEn: 'Food Cost', type: 'EXPENSE', normalBalance: 'DEBIT', level: 'ACCOUNT' },
  { code: '5102', name: 'ต้นทุนวัตถุดิบเครื่องดื่ม', nameEn: 'Beverage Cost', type: 'EXPENSE', normalBalance: 'DEBIT', level: 'ACCOUNT' },
  { code: '5103', name: 'ต้นทุน Minibar', nameEn: 'Minibar Cost', type: 'EXPENSE', normalBalance: 'DEBIT', level: 'ACCOUNT' },
  // ── ค่าใช้จ่าย ─────────────────────────────────────────────
  { code: '6000', name: 'ค่าใช้จ่ายดำเนินงาน', nameEn: 'Operating Expenses', type: 'EXPENSE', normalBalance: 'DEBIT', level: 'CATEGORY', isHeaderOnly: true },
  { code: '6100', name: 'ค่าใช้จ่ายแผนกห้องพัก', nameEn: 'Rooms Department Expenses', type: 'EXPENSE', normalBalance: 'DEBIT', level: 'GROUP', isHeaderOnly: true },
  { code: '6101', name: 'เงินเดือนและค่าจ้าง - ห้องพัก', nameEn: 'Payroll - Rooms', type: 'EXPENSE', normalBalance: 'DEBIT', level: 'ACCOUNT' },
  { code: '6102', name: 'ค่าผ้าและอุปกรณ์', nameEn: 'Linen & Supplies', type: 'EXPENSE', normalBalance: 'DEBIT', level: 'ACCOUNT' },
  { code: '6103', name: 'ค่าของใช้ในห้อง', nameEn: 'Guest Amenities', type: 'EXPENSE', normalBalance: 'DEBIT', level: 'ACCOUNT' },
  { code: '6200', name: 'ค่าใช้จ่ายแผนก F&B', nameEn: 'F&B Department Expenses', type: 'EXPENSE', normalBalance: 'DEBIT', level: 'GROUP', isHeaderOnly: true },
  { code: '6201', name: 'เงินเดือนและค่าจ้าง - F&B', nameEn: 'Payroll - F&B', type: 'EXPENSE', normalBalance: 'DEBIT', level: 'ACCOUNT' },
  { code: '6300', name: 'ค่าใช้จ่ายทั่วไปและธุรการ', nameEn: 'General & Administrative', type: 'EXPENSE', normalBalance: 'DEBIT', level: 'GROUP', isHeaderOnly: true },
  { code: '6301', name: 'เงินเดือนและค่าจ้าง - ธุรการ', nameEn: 'Payroll - Admin', type: 'EXPENSE', normalBalance: 'DEBIT', level: 'ACCOUNT' },
  { code: '6302', name: 'ค่าสาธารณูปโภค', nameEn: 'Utilities', type: 'EXPENSE', normalBalance: 'DEBIT', level: 'ACCOUNT' },
  { code: '6303', name: 'ค่าเช่า', nameEn: 'Rent', type: 'EXPENSE', normalBalance: 'DEBIT', level: 'ACCOUNT' },
  { code: '6304', name: 'ค่าซ่อมบำรุง', nameEn: 'Repairs & Maintenance', type: 'EXPENSE', normalBalance: 'DEBIT', level: 'ACCOUNT' },
  { code: '6305', name: 'ค่าเสื่อมราคา', nameEn: 'Depreciation', type: 'EXPENSE', normalBalance: 'DEBIT', level: 'ACCOUNT' },
  { code: '6306', name: 'ค่าประกันภัย', nameEn: 'Insurance', type: 'EXPENSE', normalBalance: 'DEBIT', level: 'ACCOUNT' },
  { code: '6307', name: 'ค่าการตลาดและโฆษณา', nameEn: 'Marketing & Advertising', type: 'EXPENSE', normalBalance: 'DEBIT', level: 'ACCOUNT' },
  { code: '6308', name: 'ค่าธรรมเนียมธนาคารและบัตรเครดิต', nameEn: 'Bank & Credit Card Fees', type: 'EXPENSE', normalBalance: 'DEBIT', level: 'ACCOUNT' },
  { code: '6309', name: 'ค่าใช้จ่ายอื่นๆ', nameEn: 'Other Expenses', type: 'EXPENSE', normalBalance: 'DEBIT', level: 'ACCOUNT' },
];

@Injectable()
export class ChartOfAccountsService {
  private readonly logger = new Logger(ChartOfAccountsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAll(tenantId: string, query: QueryAccountDto): Promise<AccountWithRelations[]> {
    try {
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
          ...(query.tree ? { children: { include: { _count: { select: { children: true } } } } } : {}),
        },
        orderBy: [{ code: 'asc' }],
      });
      return accounts as unknown as AccountWithRelations[];
    } catch (error) {
      this.logger.error('Failed to find accounts', error instanceof Error ? error.stack : String(error));
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
    const existing = await this.prisma.accountChart.findFirst({ where: { tenantId, code: dto.code } });
    if (existing) throw new ConflictException(`Account code ${dto.code} already exists`);

    if (dto.parentId) {
      const parent = await this.prisma.accountChart.findFirst({ where: { id: dto.parentId, tenantId } });
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
    if (existing > 0) throw new ConflictException('Chart of accounts already exists for this tenant');

    await this.prisma.accountChart.createMany({
      data: DEFAULT_ACCOUNTS.map((a, i) => ({
        tenantId,
        code: a.code,
        name: a.name,
        nameEn: a.nameEn ?? null,
        type: a.type as any,
        normalBalance: a.normalBalance as any,
        level: (a.level ?? 'ACCOUNT') as any,
        isControl: (a as { isControl?: boolean }).isControl ?? false,
        isHeaderOnly: a.isHeaderOnly ?? false,
        isActive: true,
        sortOrder: i,
      })),
      skipDuplicates: true,
    });

    return { created: DEFAULT_ACCOUNTS.length };
  }
}
