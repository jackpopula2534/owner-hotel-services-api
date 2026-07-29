import { Test, TestingModule } from '@nestjs/testing';
import { LedgerService } from './ledger.service';
import { PrismaService } from '@/prisma/prisma.service';

/**
 * งบทดลองอ่านจาก `ledger_balances` ไม่ใช่ `journal_entries` — เคยพังสองชั้นพร้อมกัน
 * 1) โมดูลที่สร้าง JE เป็น POSTED ตรงๆ ไม่เคยเขียน ledger_balances → งบขึ้น 0 ทั้งหน้า
 * 2) การแบ่งคอลัมน์เดบิต/เครดิตเช็ค normalBalance ผิด → ยอดติดลบโผล่ทั้งสองคอลัมน์
 */
describe('LedgerService', () => {
  let service: LedgerService;
  let prisma: any;

  const TENANT = 'tenant-1';
  const PROPERTY = 'prop-1';

  beforeEach(async () => {
    prisma = {
      ledgerBalance: { findMany: jest.fn().mockResolvedValue([]), upsert: jest.fn() },
      journalEntry: { findMany: jest.fn().mockResolvedValue([]) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [LedgerService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(LedgerService);
  });

  describe('getTrialBalance', () => {
    const balance = (over: Record<string, unknown>) => ({
      accountId: 'a1',
      openingBalance: 0,
      periodDebit: 0,
      periodCredit: 0,
      closingBalance: 0,
      account: { code: '1101', name: 'เงินสด', type: 'ASSET', normalBalance: 'DEBIT' },
      ...over,
    });

    it('ยอดฝั่งเครดิตต้องลงคอลัมน์เครดิตอย่างเดียว และงบต้องบาลานซ์', async () => {
      prisma.ledgerBalance.findMany.mockResolvedValue([
        balance({ periodDebit: 1980, closingBalance: 1980 }),
        balance({
          accountId: 'a2',
          periodCredit: 1980,
          closingBalance: -1980,
          account: {
            code: '4103',
            name: 'รายได้ลานกางเต็นท์',
            type: 'REVENUE',
            normalBalance: 'CREDIT',
          },
        }),
      ]);

      const tb = await service.getTrialBalance(TENANT, PROPERTY, 2026, 7);

      expect(tb.lines[0]).toMatchObject({ closingDebit: 1980, closingCredit: 0 });
      expect(tb.lines[1]).toMatchObject({ closingDebit: 0, closingCredit: 1980 });
      expect(tb.totalClosingDebit).toBe(1980);
      expect(tb.totalClosingCredit).toBe(1980);
      expect(tb.isBalanced).toBe(true);
    });

    it('บัญชีสินทรัพย์ที่ยอดติดลบต้องไปอยู่ฝั่งเครดิต ไม่ใช่โผล่ทั้งสองฝั่ง', async () => {
      prisma.ledgerBalance.findMany.mockResolvedValue([balance({ closingBalance: -500 })]);

      const tb = await service.getTrialBalance(TENANT, PROPERTY, 2026, 7);

      expect(tb.lines[0]).toMatchObject({ closingDebit: 0, closingCredit: 500 });
    });
  });

  describe('rebuildLedgerBalances', () => {
    it('รวมยอดจาก JE ที่ POSTED แล้วเขียนทับ (รันซ้ำไม่บวกซ้อน)', async () => {
      prisma.journalEntry.findMany.mockResolvedValue([
        {
          propertyId: PROPERTY,
          fiscalYear: 2026,
          fiscalPeriod: 7,
          lines: [
            { accountId: 'cash', debit: 1000, credit: 0 },
            { accountId: 'rev', debit: 0, credit: 1000 },
          ],
        },
        {
          propertyId: PROPERTY,
          fiscalYear: 2026,
          fiscalPeriod: 7,
          lines: [
            { accountId: 'cash', debit: 980, credit: 0 },
            { accountId: 'rev', debit: 0, credit: 980 },
          ],
        },
      ]);

      const res = await service.rebuildLedgerBalances(TENANT, PROPERTY);

      expect(res).toEqual({ entries: 2, balances: 2 });
      expect(prisma.ledgerBalance.upsert).toHaveBeenCalledTimes(2);

      const cash = prisma.ledgerBalance.upsert.mock.calls[0][0];
      // เขียนทับด้วยยอดรวม ไม่ใช่ { increment: ... }
      expect(cash.update).toEqual({
        periodDebit: 1980,
        periodCredit: 0,
        closingBalance: 1980,
        txnCount: 2,
      });

      const revenue = prisma.ledgerBalance.upsert.mock.calls[1][0];
      expect(revenue.update).toEqual({
        periodDebit: 0,
        periodCredit: 1980,
        closingBalance: -1980,
        txnCount: 2,
      });
    });

    it('อ่านเฉพาะ JE ที่ POSTED ของ tenant นั้น', async () => {
      await service.rebuildLedgerBalances(TENANT, PROPERTY);

      expect(prisma.journalEntry.findMany.mock.calls[0][0].where).toEqual({
        tenantId: TENANT,
        status: 'POSTED',
        propertyId: PROPERTY,
      });
    });

    it('ไม่ระบุ propertyId = ทุก property ของ tenant', async () => {
      await service.rebuildLedgerBalances(TENANT);

      expect(prisma.journalEntry.findMany.mock.calls[0][0].where).toEqual({
        tenantId: TENANT,
        status: 'POSTED',
      });
    });
  });
});
