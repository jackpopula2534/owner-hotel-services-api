import { FolioChargeType, Prisma, PrismaClient } from '@prisma/client';
import { ACCOUNT_CODES } from './posting-accounts.util';

/**
 * กติกาลงบัญชีของ Guest Ledger (บัญชีลูกหนี้แขก 1103) — ใช้ร่วมกันระหว่าง Night Audit,
 * Guest Folio และการเช็คเอาต์ เพื่อให้ "รายได้ก้อนเดียวถูกรับรู้ครั้งเดียว"
 *
 *  - รายการ charge บน folio → รับรู้รายได้ตอนปิด Night Audit (Dr 1103 / Cr 4xxx + 2103)
 *  - รับชำระ folio          → Dr เงินสด/ธนาคาร/มัดจำ/City Ledger / Cr 1103 ทันที
 *  - เช็คเอาต์การจอง         → ส่วนค่าห้องที่ Night Audit รับรู้แล้วเครดิต 1103 แทน 4101
 */

/** reference ของ FolioPayment ที่ระบบสร้างตอนเช็คเอาต์ เพื่อเคลียร์ค่าห้องบน folio บัญชี */
export const CHECKOUT_SETTLEMENT_REF = (bookingId: string): string =>
  `BOOKING-CHECKOUT:${bookingId}`;

/** รหัสบัญชีเงินสดขาด/เกิน — ไม่อยู่ในผังมาตรฐานรุ่นเก่า จึงสร้างให้เมื่อใช้ครั้งแรก */
export const CASH_OVER_SHORT_CODE = ACCOUNT_CODES.CASH_OVER_SHORT;

/** ประเภท charge → บัญชีรายได้ (ยอดก่อน VAT) — null = ไม่ใช่รายได้ ไม่ลงบัญชีรายได้ */
export const FOLIO_CHARGE_ACCOUNT: Readonly<Record<FolioChargeType, string | null>> = Object.freeze(
  {
    ROOM_CHARGE: ACCOUNT_CODES.ROOM_REVENUE,
    EXTRA_BED: ACCOUNT_CODES.ROOM_REVENUE,
    DISCOUNT: ACCOUNT_CODES.ROOM_REVENUE,
    EARLY_CHECKIN: '4102',
    LATE_CHECKOUT: '4102',
    FB_CHARGE: ACCOUNT_CODES.FOOD_REVENUE,
    SERVICE_CHARGE: ACCOUNT_CODES.SERVICE_CHARGE_REVENUE,
    SERVICE_FEE: ACCOUNT_CODES.SERVICE_CHARGE_REVENUE,
    MINIBAR: '4301',
    LAUNDRY: '4302',
    SPA: '4303',
    PARKING: '4304',
    TELEPHONE: ACCOUNT_CODES.OTHER_REVENUE,
    TRANSPORT: ACCOUNT_CODES.OTHER_REVENUE,
    DAMAGE: ACCOUNT_CODES.OTHER_REVENUE,
    ADJUSTMENT: ACCOUNT_CODES.OTHER_REVENUE,
    OTHER: ACCOUNT_CODES.OTHER_REVENUE,
    // หักมัดจำเป็นการชำระ ไม่ใช่รายได้ / TAX ลงภาษีขายทั้งก้อน
    DEPOSIT_APPLIED: null,
    TAX: ACCOUNT_CODES.VAT_OUTPUT,
  },
);

export interface GlChargeInput {
  chargeType: FolioChargeType;
  netAmount: number;
  vatAmount: number;
  totalAmount: number;
}

export interface GlLineDraft {
  code: string;
  debit: number;
  credit: number;
  description: string;
}

export interface RevenueSummaryRow {
  code: string;
  count: number;
  net: number;
  vat: number;
  total: number;
}

const round2 = (v: number): number => Math.round(v * 100) / 100;

/**
 * สรุป charge ของวัน → บรรทัด JE ที่สมดุล: Dr 1103 = ผลรวม total, Cr รายได้แยกบัญชี + Cr 2103
 * ยอดติดลบ (ส่วนลด/ปรับลด) กลายเป็นฝั่งตรงข้ามโดยอัตโนมัติ
 */
export function buildGuestLedgerLines(
  charges: readonly GlChargeInput[],
  label: string,
): { lines: GlLineDraft[]; summary: RevenueSummaryRow[]; total: number } {
  const byCode = new Map<string, RevenueSummaryRow>();
  let vatTotal = 0;
  let grand = 0;

  for (const c of charges) {
    const code = FOLIO_CHARGE_ACCOUNT[c.chargeType];
    if (code === null) continue;
    if (code === ACCOUNT_CODES.VAT_OUTPUT) {
      vatTotal += c.totalAmount;
      grand += c.totalAmount;
      continue;
    }
    const row = byCode.get(code) ?? { code, count: 0, net: 0, vat: 0, total: 0 };
    byCode.set(code, {
      code,
      count: row.count + 1,
      net: round2(row.net + c.netAmount),
      vat: round2(row.vat + c.vatAmount),
      total: round2(row.total + c.totalAmount),
    });
    vatTotal += c.vatAmount;
    grand += c.totalAmount;
  }

  const summary = [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
  const total = round2(grand);
  const vat = round2(vatTotal);
  const side = (code: string, amount: number, description: string): GlLineDraft =>
    amount >= 0
      ? { code, debit: 0, credit: amount, description }
      : { code, debit: -amount, credit: 0, description };

  const credits = [
    ...summary.map((r) => side(r.code, r.net, `${label} — รายได้ ${r.code}`)),
    ...(vat !== 0 ? [side(ACCOUNT_CODES.VAT_OUTPUT, vat, `${label} — ภาษีขาย`)] : []),
  ].filter((l) => l.debit !== 0 || l.credit !== 0);

  // ปัดเศษ: บรรทัดลูกหนี้ = ผลต่างของฝั่งเครดิตจริง กันสตางค์หลุดจากการปัดรายบรรทัด
  const creditSum = round2(credits.reduce((s, l) => s + l.credit - l.debit, 0));
  const lines: GlLineDraft[] =
    creditSum === 0
      ? []
      : [
          creditSum > 0
            ? {
                code: ACCOUNT_CODES.AR_TRADE,
                debit: creditSum,
                credit: 0,
                description: `${label} — Guest Ledger`,
              }
            : {
                code: ACCOUNT_CODES.AR_TRADE,
                debit: 0,
                credit: -creditSum,
                description: `${label} — Guest Ledger`,
              },
          ...credits,
        ];

  return { lines, summary, total };
}

type AccountChartClient = Pick<PrismaClient | Prisma.TransactionClient, 'accountChart'>;

/**
 * สร้างบัญชีเงินสดขาด/เกินให้ tenant ที่ผังบัญชีเกิดก่อนมีบัญชีนี้ (ensureDefaultChartOfAccounts
 * ไม่แตะ tenant ที่มีผังอยู่แล้ว) — ผูกใต้หมวด 6300 ถ้ามี
 */
export async function ensureCashOverShortAccount(
  prisma: AccountChartClient,
  tenantId: string,
): Promise<void> {
  const exists = await prisma.accountChart.findFirst({
    where: { tenantId, code: CASH_OVER_SHORT_CODE },
    select: { id: true },
  });
  if (exists) return;
  const parent = await prisma.accountChart.findFirst({
    where: { tenantId, code: '6300' },
    select: { id: true },
  });
  await prisma.accountChart.create({
    data: {
      tenantId,
      code: CASH_OVER_SHORT_CODE,
      name: 'เงินสดขาด/เกินบัญชี',
      nameEn: 'Cash Over/Short',
      type: 'EXPENSE',
      normalBalance: 'DEBIT',
      level: 'ACCOUNT',
      parentId: parent?.id ?? null,
      isActive: true,
    },
  });
}
