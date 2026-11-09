import { BadRequestException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import {
  ensureDefaultAccounts,
  ensureDefaultChartOfAccounts,
} from '@/modules/accounting/chart-of-accounts/default-chart-of-accounts';

/** รหัสบัญชีมาตรฐาน (default-chart-of-accounts) ที่ระบบลงบัญชีอัตโนมัติอ้างถึง */
export const ACCOUNT_CODES = {
  CASH: '1101',
  BANK: '1102',
  AR_TRADE: '1103',
  AR_CITY_LEDGER: '1104',
  VAT_INPUT: '1106',
  INVENTORY: '1107',
  WHT_RECEIVABLE: '1109',
  AP_TRADE: '2101',
  ACCRUED_EXPENSES: '2102',
  VAT_OUTPUT: '2103',
  WHT_PAYABLE: '2104',
  DEPOSIT_RECEIVED: '2105',
  ROOM_REVENUE: '4101',
  FOOD_REVENUE: '4201',
  BEVERAGE_REVENUE: '4202',
  OTHER_REVENUE: '4309', // 4300 เป็นหัวข้อ ลงตรงไม่ได้
  SERVICE_CHARGE_REVENUE: '4305',
  SALARY_EXPENSE: '6301',
  DEPRECIATION_EXPENSE: '6305',
  OTHER_EXPENSE: '6309',
  CASH_OVER_SHORT: '6310',
} as const;

/**
 * บัญชีที่เงินเข้า/ออกตามวิธีชำระ (AccPaymentMethod)
 * - เงินสด → 1101, มัดจำที่รับไว้แล้ว → ตัด 2105, City Ledger → 1104
 * - ที่เหลือ (โอน/บัตร/QR/เช็ค/ออนไลน์) ผ่านธนาคาร → 1102
 */
export function settlementAccountCode(method: string): string {
  switch (method) {
    case 'CASH':
      return ACCOUNT_CODES.CASH;
    case 'ADVANCE':
      return ACCOUNT_CODES.DEPOSIT_RECEIVED;
    case 'CITY_LEDGER':
      return ACCOUNT_CODES.AR_CITY_LEDGER;
    default:
      return ACCOUNT_CODES.BANK;
  }
}

/**
 * แปลงรหัสบัญชี → id (seed ผังบัญชีมาตรฐานให้ก่อนถ้ายังไม่มี)
 * ขาดบัญชีไหนให้ล้มทั้งรายการ — ลงบัญชีครึ่งเดียวแย่กว่าไม่ลง
 */
export async function resolveAccountIds(
  prisma: PrismaClient,
  tenantId: string,
  codes: readonly string[],
): Promise<Map<string, string>> {
  await ensureDefaultChartOfAccounts(prisma, tenantId);
  const unique = [...new Set(codes)];
  const find = () =>
    prisma.accountChart.findMany({
      where: { tenantId, code: { in: unique }, isActive: true },
      select: { id: true, code: true },
    });
  let accounts = await find();
  if (accounts.length < unique.length) {
    // ผังเก่าที่ยังไม่มีบัญชีมาตรฐานรุ่นใหม่ — เติมให้แล้วหาซ้ำ
    const have = new Set(accounts.map((a) => a.code));
    const added = await ensureDefaultAccounts(prisma, tenantId, unique.filter((c) => !have.has(c)));
    if (added > 0) accounts = await find();
  }
  const map = new Map(accounts.map((a) => [a.code, a.id]));
  const missing = unique.filter((c) => !map.has(c));
  if (missing.length > 0) {
    throw new BadRequestException(
      `ลงบัญชีอัตโนมัติไม่ได้: ไม่พบบัญชี ${missing.join(', ')} ในผังบัญชี (หรือถูกปิดใช้งาน)`,
    );
  }
  return map;
}
