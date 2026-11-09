import { Prisma, PrismaClient } from '@prisma/client';

interface DefaultAccount {
  code: string;
  name: string;
  nameEn?: string;
  type: string;
  normalBalance: string;
  level?: string;
  isControl?: boolean;
  isHeaderOnly?: boolean;
}

// Default Thai hotel Chart of Accounts (USALI-inspired)
export const DEFAULT_ACCOUNTS: readonly DefaultAccount[] = [
  // ── สินทรัพย์ ──────────────────────────────────────────────
  {
    code: '1000',
    name: 'สินทรัพย์',
    nameEn: 'Assets',
    type: 'ASSET',
    normalBalance: 'DEBIT',
    level: 'CATEGORY',
    isHeaderOnly: true,
  },
  {
    code: '1100',
    name: 'สินทรัพย์หมุนเวียน',
    nameEn: 'Current Assets',
    type: 'ASSET',
    normalBalance: 'DEBIT',
    level: 'GROUP',
    isHeaderOnly: true,
  },
  {
    code: '1101',
    name: 'เงินสด',
    nameEn: 'Cash',
    type: 'ASSET',
    normalBalance: 'DEBIT',
    level: 'ACCOUNT',
  },
  {
    code: '1102',
    name: 'เงินฝากธนาคาร',
    nameEn: 'Bank Deposits',
    type: 'ASSET',
    normalBalance: 'DEBIT',
    level: 'ACCOUNT',
  },
  {
    code: '1103',
    name: 'ลูกหนี้การค้า',
    nameEn: 'Accounts Receivable',
    type: 'ASSET',
    normalBalance: 'DEBIT',
    level: 'ACCOUNT',
    isControl: true,
  },
  {
    code: '1104',
    name: 'ลูกหนี้ City Ledger',
    nameEn: 'City Ledger',
    type: 'ASSET',
    normalBalance: 'DEBIT',
    level: 'ACCOUNT',
  },
  {
    code: '1105',
    name: 'เงินมัดจำรับล่วงหน้า',
    nameEn: 'Advance Deposits',
    type: 'ASSET',
    normalBalance: 'DEBIT',
    level: 'ACCOUNT',
  },
  {
    code: '1106',
    name: 'ภาษีซื้อ (VAT Input)',
    nameEn: 'VAT Input Tax',
    type: 'ASSET',
    normalBalance: 'DEBIT',
    level: 'ACCOUNT',
  },
  {
    code: '1107',
    name: 'สินค้าคงเหลือ',
    nameEn: 'Inventory',
    type: 'ASSET',
    normalBalance: 'DEBIT',
    level: 'ACCOUNT',
  },
  {
    code: '1108',
    name: 'ค่าใช้จ่ายล่วงหน้า',
    nameEn: 'Prepaid Expenses',
    type: 'ASSET',
    normalBalance: 'DEBIT',
    level: 'ACCOUNT',
  },
  {
    code: '1109',
    name: 'ภาษีถูกหัก ณ ที่จ่าย',
    nameEn: 'Withholding Tax Receivable',
    type: 'ASSET',
    normalBalance: 'DEBIT',
    level: 'ACCOUNT',
  },
  {
    code: '1200',
    name: 'สินทรัพย์ไม่หมุนเวียน',
    nameEn: 'Non-Current Assets',
    type: 'ASSET',
    normalBalance: 'DEBIT',
    level: 'GROUP',
    isHeaderOnly: true,
  },
  {
    code: '1201',
    name: 'ที่ดิน',
    nameEn: 'Land',
    type: 'ASSET',
    normalBalance: 'DEBIT',
    level: 'ACCOUNT',
  },
  {
    code: '1202',
    name: 'อาคาร',
    nameEn: 'Building',
    type: 'ASSET',
    normalBalance: 'DEBIT',
    level: 'ACCOUNT',
  },
  {
    code: '1203',
    name: 'ค่าเสื่อมราคาสะสม - อาคาร',
    nameEn: 'Accum. Depreciation - Building',
    type: 'ASSET',
    normalBalance: 'CREDIT',
    level: 'ACCOUNT',
  },
  {
    code: '1204',
    name: 'เฟอร์นิเจอร์และของตกแต่ง',
    nameEn: 'Furniture & Fixtures',
    type: 'ASSET',
    normalBalance: 'DEBIT',
    level: 'ACCOUNT',
  },
  {
    code: '1205',
    name: 'ค่าเสื่อมราคาสะสม - เฟอร์นิเจอร์',
    nameEn: 'Accum. Depreciation - Furniture',
    type: 'ASSET',
    normalBalance: 'CREDIT',
    level: 'ACCOUNT',
  },
  {
    code: '1206',
    name: 'เครื่องจักรและอุปกรณ์',
    nameEn: 'Machinery & Equipment',
    type: 'ASSET',
    normalBalance: 'DEBIT',
    level: 'ACCOUNT',
  },
  {
    code: '1207',
    name: 'ค่าเสื่อมราคาสะสม - เครื่องจักร',
    nameEn: 'Accum. Depreciation - Machinery',
    type: 'ASSET',
    normalBalance: 'CREDIT',
    level: 'ACCOUNT',
  },
  {
    code: '1208',
    name: 'ยานพาหนะ',
    nameEn: 'Vehicles',
    type: 'ASSET',
    normalBalance: 'DEBIT',
    level: 'ACCOUNT',
  },
  {
    code: '1209',
    name: 'ค่าเสื่อมราคาสะสม - ยานพาหนะ',
    nameEn: 'Accum. Depreciation - Vehicles',
    type: 'ASSET',
    normalBalance: 'CREDIT',
    level: 'ACCOUNT',
  },
  // ── หนี้สิน ────────────────────────────────────────────────
  {
    code: '2000',
    name: 'หนี้สิน',
    nameEn: 'Liabilities',
    type: 'LIABILITY',
    normalBalance: 'CREDIT',
    level: 'CATEGORY',
    isHeaderOnly: true,
  },
  {
    code: '2100',
    name: 'หนี้สินหมุนเวียน',
    nameEn: 'Current Liabilities',
    type: 'LIABILITY',
    normalBalance: 'CREDIT',
    level: 'GROUP',
    isHeaderOnly: true,
  },
  {
    code: '2101',
    name: 'เจ้าหนี้การค้า',
    nameEn: 'Accounts Payable',
    type: 'LIABILITY',
    normalBalance: 'CREDIT',
    level: 'ACCOUNT',
    isControl: true,
  },
  {
    code: '2102',
    name: 'ค่าใช้จ่ายค้างจ่าย',
    nameEn: 'Accrued Expenses',
    type: 'LIABILITY',
    normalBalance: 'CREDIT',
    level: 'ACCOUNT',
  },
  {
    code: '2103',
    name: 'ภาษีขาย (VAT Output)',
    nameEn: 'VAT Output Tax',
    type: 'LIABILITY',
    normalBalance: 'CREDIT',
    level: 'ACCOUNT',
  },
  {
    code: '2104',
    name: 'ภาษีหัก ณ ที่จ่ายค้างจ่าย',
    nameEn: 'WHT Payable',
    type: 'LIABILITY',
    normalBalance: 'CREDIT',
    level: 'ACCOUNT',
  },
  {
    code: '2105',
    name: 'รายได้รับล่วงหน้า (มัดจำ)',
    nameEn: 'Deferred Revenue - Deposits',
    type: 'LIABILITY',
    normalBalance: 'CREDIT',
    level: 'ACCOUNT',
  },
  {
    code: '2106',
    name: 'เงินกู้ยืมระยะสั้น',
    nameEn: 'Short-term Loans',
    type: 'LIABILITY',
    normalBalance: 'CREDIT',
    level: 'ACCOUNT',
  },
  {
    code: '2200',
    name: 'หนี้สินไม่หมุนเวียน',
    nameEn: 'Non-Current Liabilities',
    type: 'LIABILITY',
    normalBalance: 'CREDIT',
    level: 'GROUP',
    isHeaderOnly: true,
  },
  {
    code: '2201',
    name: 'เงินกู้ยืมระยะยาว',
    nameEn: 'Long-term Loans',
    type: 'LIABILITY',
    normalBalance: 'CREDIT',
    level: 'ACCOUNT',
  },
  // ── ส่วนของเจ้าของ ─────────────────────────────────────────
  {
    code: '3000',
    name: 'ส่วนของเจ้าของ',
    nameEn: 'Equity',
    type: 'EQUITY',
    normalBalance: 'CREDIT',
    level: 'CATEGORY',
    isHeaderOnly: true,
  },
  {
    code: '3101',
    name: 'ทุนจดทะเบียน',
    nameEn: 'Registered Capital',
    type: 'EQUITY',
    normalBalance: 'CREDIT',
    level: 'ACCOUNT',
  },
  {
    code: '3102',
    name: 'กำไรสะสม',
    nameEn: 'Retained Earnings',
    type: 'EQUITY',
    normalBalance: 'CREDIT',
    level: 'ACCOUNT',
  },
  {
    code: '3103',
    name: 'กำไร(ขาดทุน)ปีปัจจุบัน',
    nameEn: 'Current Year P&L',
    type: 'EQUITY',
    normalBalance: 'CREDIT',
    level: 'ACCOUNT',
  },
  // ── รายได้ ─────────────────────────────────────────────────
  {
    code: '4000',
    name: 'รายได้',
    nameEn: 'Revenue',
    type: 'REVENUE',
    normalBalance: 'CREDIT',
    level: 'CATEGORY',
    isHeaderOnly: true,
  },
  {
    code: '4100',
    name: 'รายได้ห้องพัก',
    nameEn: 'Room Revenue',
    type: 'REVENUE',
    normalBalance: 'CREDIT',
    level: 'GROUP',
    isHeaderOnly: true,
  },
  {
    code: '4101',
    name: 'รายได้ค่าห้องพัก',
    nameEn: 'Room Rate Revenue',
    type: 'REVENUE',
    normalBalance: 'CREDIT',
    level: 'ACCOUNT',
  },
  {
    code: '4102',
    name: 'รายได้ Early Check-in / Late Check-out',
    nameEn: 'Early/Late Fee Revenue',
    type: 'REVENUE',
    normalBalance: 'CREDIT',
    level: 'ACCOUNT',
  },
  {
    code: '4103',
    name: 'รายได้ลานกางเต็นท์',
    nameEn: 'Campground Revenue',
    type: 'REVENUE',
    normalBalance: 'CREDIT',
    level: 'ACCOUNT',
  },
  {
    code: '4200',
    name: 'รายได้อาหารและเครื่องดื่ม',
    nameEn: 'F&B Revenue',
    type: 'REVENUE',
    normalBalance: 'CREDIT',
    level: 'GROUP',
    isHeaderOnly: true,
  },
  {
    code: '4201',
    name: 'รายได้อาหาร',
    nameEn: 'Food Revenue',
    type: 'REVENUE',
    normalBalance: 'CREDIT',
    level: 'ACCOUNT',
  },
  {
    code: '4202',
    name: 'รายได้เครื่องดื่ม',
    nameEn: 'Beverage Revenue',
    type: 'REVENUE',
    normalBalance: 'CREDIT',
    level: 'ACCOUNT',
  },
  {
    code: '4300',
    name: 'รายได้อื่นๆ',
    nameEn: 'Other Revenue',
    type: 'REVENUE',
    normalBalance: 'CREDIT',
    level: 'GROUP',
    isHeaderOnly: true,
  },
  {
    code: '4301',
    name: 'รายได้ Minibar',
    nameEn: 'Minibar Revenue',
    type: 'REVENUE',
    normalBalance: 'CREDIT',
    level: 'ACCOUNT',
  },
  {
    code: '4302',
    name: 'รายได้ซักรีด',
    nameEn: 'Laundry Revenue',
    type: 'REVENUE',
    normalBalance: 'CREDIT',
    level: 'ACCOUNT',
  },
  {
    code: '4303',
    name: 'รายได้สปา',
    nameEn: 'Spa Revenue',
    type: 'REVENUE',
    normalBalance: 'CREDIT',
    level: 'ACCOUNT',
  },
  {
    code: '4304',
    name: 'รายได้จอดรถ',
    nameEn: 'Parking Revenue',
    type: 'REVENUE',
    normalBalance: 'CREDIT',
    level: 'ACCOUNT',
  },
  {
    code: '4305',
    name: 'รายได้ค่าธรรมเนียมบริการ',
    nameEn: 'Service Charge Revenue',
    type: 'REVENUE',
    normalBalance: 'CREDIT',
    level: 'ACCOUNT',
  },
  {
    // 4300 เป็นหัวข้อ (ลงรายการตรงไม่ได้) — รายได้อื่นที่ระบบลงอัตโนมัติต้องมีบัญชีย่อยให้ลง
    code: '4309',
    name: 'รายได้อื่นๆ ทั่วไป',
    nameEn: 'Miscellaneous Revenue',
    type: 'REVENUE',
    normalBalance: 'CREDIT',
    level: 'ACCOUNT',
  },
  // ── ต้นทุนขาย ──────────────────────────────────────────────
  {
    code: '5000',
    name: 'ต้นทุนขาย',
    nameEn: 'Cost of Sales',
    type: 'EXPENSE',
    normalBalance: 'DEBIT',
    level: 'CATEGORY',
    isHeaderOnly: true,
  },
  {
    code: '5101',
    name: 'ต้นทุนวัตถุดิบอาหาร',
    nameEn: 'Food Cost',
    type: 'EXPENSE',
    normalBalance: 'DEBIT',
    level: 'ACCOUNT',
  },
  {
    code: '5102',
    name: 'ต้นทุนวัตถุดิบเครื่องดื่ม',
    nameEn: 'Beverage Cost',
    type: 'EXPENSE',
    normalBalance: 'DEBIT',
    level: 'ACCOUNT',
  },
  {
    code: '5103',
    name: 'ต้นทุน Minibar',
    nameEn: 'Minibar Cost',
    type: 'EXPENSE',
    normalBalance: 'DEBIT',
    level: 'ACCOUNT',
  },
  // ── ค่าใช้จ่าย ─────────────────────────────────────────────
  {
    code: '6000',
    name: 'ค่าใช้จ่ายดำเนินงาน',
    nameEn: 'Operating Expenses',
    type: 'EXPENSE',
    normalBalance: 'DEBIT',
    level: 'CATEGORY',
    isHeaderOnly: true,
  },
  {
    code: '6100',
    name: 'ค่าใช้จ่ายแผนกห้องพัก',
    nameEn: 'Rooms Department Expenses',
    type: 'EXPENSE',
    normalBalance: 'DEBIT',
    level: 'GROUP',
    isHeaderOnly: true,
  },
  {
    code: '6101',
    name: 'เงินเดือนและค่าจ้าง - ห้องพัก',
    nameEn: 'Payroll - Rooms',
    type: 'EXPENSE',
    normalBalance: 'DEBIT',
    level: 'ACCOUNT',
  },
  {
    code: '6102',
    name: 'ค่าผ้าและอุปกรณ์',
    nameEn: 'Linen & Supplies',
    type: 'EXPENSE',
    normalBalance: 'DEBIT',
    level: 'ACCOUNT',
  },
  {
    code: '6103',
    name: 'ค่าของใช้ในห้อง',
    nameEn: 'Guest Amenities',
    type: 'EXPENSE',
    normalBalance: 'DEBIT',
    level: 'ACCOUNT',
  },
  {
    code: '6200',
    name: 'ค่าใช้จ่ายแผนก F&B',
    nameEn: 'F&B Department Expenses',
    type: 'EXPENSE',
    normalBalance: 'DEBIT',
    level: 'GROUP',
    isHeaderOnly: true,
  },
  {
    code: '6201',
    name: 'เงินเดือนและค่าจ้าง - F&B',
    nameEn: 'Payroll - F&B',
    type: 'EXPENSE',
    normalBalance: 'DEBIT',
    level: 'ACCOUNT',
  },
  {
    code: '6300',
    name: 'ค่าใช้จ่ายทั่วไปและธุรการ',
    nameEn: 'General & Administrative',
    type: 'EXPENSE',
    normalBalance: 'DEBIT',
    level: 'GROUP',
    isHeaderOnly: true,
  },
  {
    code: '6301',
    name: 'เงินเดือนและค่าจ้าง - ธุรการ',
    nameEn: 'Payroll - Admin',
    type: 'EXPENSE',
    normalBalance: 'DEBIT',
    level: 'ACCOUNT',
  },
  {
    code: '6302',
    name: 'ค่าสาธารณูปโภค',
    nameEn: 'Utilities',
    type: 'EXPENSE',
    normalBalance: 'DEBIT',
    level: 'ACCOUNT',
  },
  {
    code: '6303',
    name: 'ค่าเช่า',
    nameEn: 'Rent',
    type: 'EXPENSE',
    normalBalance: 'DEBIT',
    level: 'ACCOUNT',
  },
  {
    code: '6304',
    name: 'ค่าซ่อมบำรุง',
    nameEn: 'Repairs & Maintenance',
    type: 'EXPENSE',
    normalBalance: 'DEBIT',
    level: 'ACCOUNT',
  },
  {
    code: '6305',
    name: 'ค่าเสื่อมราคา',
    nameEn: 'Depreciation',
    type: 'EXPENSE',
    normalBalance: 'DEBIT',
    level: 'ACCOUNT',
  },
  {
    code: '6306',
    name: 'ค่าประกันภัย',
    nameEn: 'Insurance',
    type: 'EXPENSE',
    normalBalance: 'DEBIT',
    level: 'ACCOUNT',
  },
  {
    code: '6307',
    name: 'ค่าการตลาดและโฆษณา',
    nameEn: 'Marketing & Advertising',
    type: 'EXPENSE',
    normalBalance: 'DEBIT',
    level: 'ACCOUNT',
  },
  {
    code: '6308',
    name: 'ค่าธรรมเนียมธนาคารและบัตรเครดิต',
    nameEn: 'Bank & Credit Card Fees',
    type: 'EXPENSE',
    normalBalance: 'DEBIT',
    level: 'ACCOUNT',
  },
  {
    code: '6309',
    name: 'ค่าใช้จ่ายอื่นๆ',
    nameEn: 'Other Expenses',
    type: 'EXPENSE',
    normalBalance: 'DEBIT',
    level: 'ACCOUNT',
  },
  {
    code: '6310',
    name: 'เงินสดขาด/เกินบัญชี',
    nameEn: 'Cash Over/Short',
    type: 'EXPENSE',
    normalBalance: 'DEBIT',
    level: 'ACCOUNT',
  },
];

type AccountChartClient = Pick<PrismaClient | Prisma.TransactionClient, 'accountChart'>;

/**
 * สร้างผังบัญชีมาตรฐานให้ tenant ถ้ายังไม่มีเลยสักบัญชี — เรียกซ้ำได้ ไม่สร้างซ้อน
 *
 * เดิมผังบัญชีเกิดได้ทางเดียวคือกดปุ่ม "สร้างผังบัญชีมาตรฐาน" ถ้าไม่มีใครกด การลงบัญชี
 * อัตโนมัติทุกจุด (เช็คเอาต์, ลานกางเต็นท์, AR/AP) จะหา 1101/4101 ไม่เจอแล้วข้ามไป
 * เงียบ ๆ สมุดรายวันจึงว่างทั้งที่มีรายได้จริง — ทุกจุดที่ลงบัญชีอัตโนมัติต้องเรียกตัวนี้ก่อน
 *
 * tenant ที่มีผังบัญชีของตัวเองอยู่แล้ว (แม้ไม่ครบ) จะไม่ถูกแตะ คืนค่า 0
 */
export async function ensureDefaultChartOfAccounts(
  prisma: AccountChartClient,
  tenantId: string,
): Promise<number> {
  const existing = await prisma.accountChart.count({ where: { tenantId } });
  if (existing > 0) return 0;

  const result = await prisma.accountChart.createMany({
    data: DEFAULT_ACCOUNTS.map((a) => toCreateInput(tenantId, a)),
    skipDuplicates: true,
  });
  return result.count;
}

/**
 * เติมบัญชีมาตรฐานที่ขาดเฉพาะรหัสที่ขอ — tenant ที่มีผังอยู่แล้วก่อนเพิ่มบัญชีมาตรฐานใหม่
 * (เช่น 4309) จะไม่ได้จาก ensureDefaultChartOfAccounts ลงบัญชีอัตโนมัติจึงล้ม
 * ไม่แตะบัญชีที่มีอยู่ (รวมที่ถูกปิดใช้งาน) — @@unique([tenantId, code]) + skipDuplicates
 */
export async function ensureDefaultAccounts(
  prisma: AccountChartClient,
  tenantId: string,
  codes: readonly string[],
): Promise<number> {
  const wanted = DEFAULT_ACCOUNTS.filter((a) => codes.includes(a.code));
  if (wanted.length === 0) return 0;
  const result = await prisma.accountChart.createMany({
    data: wanted.map((a) => toCreateInput(tenantId, a)),
    skipDuplicates: true,
  });
  return result.count;
}

function toCreateInput(tenantId: string, a: DefaultAccount): Prisma.AccountChartCreateManyInput {
  return {
    tenantId,
    code: a.code,
    name: a.name,
    nameEn: a.nameEn ?? null,
    type: a.type as Prisma.AccountChartCreateManyInput['type'],
    normalBalance: a.normalBalance as Prisma.AccountChartCreateManyInput['normalBalance'],
    level: (a.level ?? 'ACCOUNT') as Prisma.AccountChartCreateManyInput['level'],
    isControl: a.isControl ?? false,
    isHeaderOnly: a.isHeaderOnly ?? false,
    isActive: true,
    sortOrder: DEFAULT_ACCOUNTS.indexOf(a),
  };
}
