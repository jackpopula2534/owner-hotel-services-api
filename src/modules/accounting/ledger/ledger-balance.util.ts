import { Prisma } from '@prisma/client';

/**
 * ยอดคงเหลือรายบัญชีต่อรอบบัญชี (`ledger_balances`) เป็น "แหล่งข้อมูลเดียว" ที่
 * งบทดลอง / งบกำไรขาดทุน / งบดุล อ่านจริง (ดู `LedgerService.getTrialBalance` ฯลฯ)
 * — ไม่ได้อ่านจาก `journal_entries` โดยตรง
 *
 * เดิม `JournalEntriesService.post()` เป็นที่เดียวที่อัปเดตตารางนี้ แต่โมดูลที่สร้าง
 * JE แบบ `status: 'POSTED'` ทันที (การจองห้อง, folio, night audit, ลานกางเต็นท์)
 * ไม่ได้เดินผ่าน `post()` ยอดจึงไม่เคยถูกบวกเข้า `ledger_balances` เลย
 * ผลคือหน้าบัญชีขึ้น 0 ทุกช่องทั้งที่มี JE อยู่จริงในฐานข้อมูล
 *
 * helper นี้คือ logic เดียวกับใน `post()` ที่ดึงออกมาใช้ร่วมกัน เพื่อไม่ให้ต้อง
 * copy-paste (และหลุดอีก) — ต้องเรียกภายใน transaction เดียวกับที่สร้าง JE
 */
export interface LedgerBalanceLine {
  accountId: string;
  debit: Prisma.Decimal | number;
  credit: Prisma.Decimal | number;
}

export interface LedgerBalanceScope {
  tenantId: string;
  propertyId: string;
  fiscalYear: number;
  fiscalPeriod: number;
}

export async function applyLedgerBalances(
  tx: Prisma.TransactionClient,
  scope: LedgerBalanceScope,
  lines: LedgerBalanceLine[],
): Promise<void> {
  for (const line of lines) {
    const debit = Number(line.debit);
    const credit = Number(line.credit);
    const key = { ...scope, accountId: line.accountId };

    await tx.ledgerBalance.upsert({
      where: { tenantId_propertyId_accountId_fiscalYear_fiscalPeriod: key },
      update: {
        periodDebit: { increment: debit },
        periodCredit: { increment: credit },
        closingBalance: { increment: debit - credit },
        txnCount: { increment: 1 },
      },
      create: {
        ...key,
        openingBalance: 0,
        periodDebit: debit,
        periodCredit: credit,
        closingBalance: debit - credit,
        txnCount: 1,
      },
    });
  }
}
