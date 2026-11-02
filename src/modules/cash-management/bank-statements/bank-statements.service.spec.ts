import { BadRequestException } from '@nestjs/common';
import { BankStatementsService } from './bank-statements.service';
import { fingerprintLines } from './bank-statements.util';

const BANK = { id: '11111111-1111-4111-8111-111111111111', code: '1102', name: 'เงินฝากธนาคาร' };

function makePrisma() {
  const store: Record<string, any>[] = [];
  return {
    store,
    accountChart: {
      findFirst: jest.fn().mockResolvedValue(BANK),
      findMany: jest.fn().mockResolvedValue([BANK]),
    },
    arReceipt: { findFirst: jest.fn() },
    journalLine: { findFirst: jest.fn() },
    bankStatementLine: {
      findMany: jest.fn(async ({ where }: any) =>
        store.filter((r) => !where.fingerprint || where.fingerprint.in.includes(r.fingerprint)),
      ),
      findFirst: jest.fn(async ({ where }: any) => store.find((r) => r.id === where.id) ?? null),
      createMany: jest.fn(async ({ data }: any) => {
        data.forEach((d: any, i: number) =>
          store.push({
            ...d,
            id: `line-${store.length + i}`,
            status: 'UNMATCHED',
            journalLineId: null,
            arReceiptId: null,
            createdAt: new Date(),
          }),
        );
        return { count: data.length };
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        store.filter((r) => r.id === where.id).forEach((r) => Object.assign(r, data));
        return { count: 1 };
      }),
      deleteMany: jest.fn(),
    },
  };
}

const line = (amount: number, description = 'โอนเข้า') => ({
  txnDate: '2026-10-28',
  amount,
  description,
});

describe('BankStatementsService', () => {
  it('นำเข้าไฟล์เดิมซ้ำ → ไม่สร้างแถวใหม่ และคืนแถวเดิมพร้อมสถานะ', async () => {
    const prisma = makePrisma();
    const svc = new BankStatementsService(prisma as any);
    const dto = {
      propertyId: 'p',
      bankAccountId: BANK.id,
      lines: [line(5350), line(-120, 'ค่าธรรมเนียม')],
    };

    const first = await svc.import(dto as any, 't1', 'u1');
    expect(first.inserted).toBe(2);
    expect(first.lines.map((l) => l.amount)).toEqual([5350, -120]);

    const again = await svc.import(dto as any, 't1', 'u1');
    expect(again.inserted).toBe(0);
    expect(again.duplicates).toBe(2);
    expect(prisma.store).toHaveLength(2);
  });

  it('ไม่รับบัญชีที่ไม่ใช่เงินฝากธนาคาร', async () => {
    const prisma = makePrisma();
    prisma.accountChart.findFirst.mockResolvedValue(null);
    const svc = new BankStatementsService(prisma as any);
    await expect(
      svc.import({ propertyId: 'p', bankAccountId: BANK.id, lines: [line(1)] } as any, 't1', 'u1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('ผูกใบเสร็จ → MATCHED พร้อม journal line ฝั่งธนาคาร', async () => {
    const prisma = makePrisma();
    const svc = new BankStatementsService(prisma as any);
    prisma.store.push({
      id: 's1',
      bankAccountId: BANK.id,
      amount: 5350,
      balance: null,
      status: 'UNMATCHED',
      journalLineId: null,
      arReceiptId: null,
      fingerprint: fingerprintLines([line(5350)])[0],
    });
    prisma.arReceipt.findFirst.mockResolvedValue({ id: 'r1', status: 'CLEARED' });
    prisma.journalLine.findFirst.mockResolvedValue({ id: 'jl-9' });

    const res = await svc.linkReceipt('s1', 'r1', 't1');
    expect(res.status).toBe('MATCHED');
    expect(res.journalLineId).toBe('jl-9');
    expect(prisma.journalLine.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          journalEntry: expect.objectContaining({ sourceType: 'AR_RECEIPT', sourceId: 'r1' }),
        }),
      }),
    );
  });

  it('ผูกใบเสร็จกับรายการเงินออกไม่ได้', async () => {
    const prisma = makePrisma();
    prisma.store.push({
      id: 's2',
      bankAccountId: BANK.id,
      amount: -50,
      balance: null,
      status: 'UNMATCHED',
    });
    const svc = new BankStatementsService(prisma as any);
    await expect(svc.linkReceipt('s2', 'r1', 't1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('ข้ามรายการที่จับคู่แล้วไม่ได้', async () => {
    const prisma = makePrisma();
    prisma.store.push({
      id: 's3',
      bankAccountId: BANK.id,
      amount: 10,
      balance: null,
      status: 'MATCHED',
    });
    const svc = new BankStatementsService(prisma as any);
    await expect(svc.setStatus('s3', 'IGNORED', 't1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('งวดกระทบยอด: แนะนำคู่ และใช้ยอดคงเหลือสุดท้ายของ Statement', async () => {
    const prisma = makePrisma();
    prisma.bankStatementLine.findMany.mockResolvedValue([
      {
        id: 's1',
        txnDate: new Date('2026-10-02T00:00:00Z'),
        amount: 5350,
        balance: 105350,
        status: 'UNMATCHED',
        journalLineId: null,
      },
      {
        id: 's2',
        txnDate: new Date('2026-10-05T00:00:00Z'),
        amount: -120,
        balance: 105230,
        status: 'UNMATCHED',
        journalLineId: null,
      },
    ] as any);
    const svc = new BankStatementsService(prisma as any);
    const res = await svc.forReconciliation(
      't1',
      { propertyId: 'p', bankAccountId: BANK.id, period: '2026-10' },
      [
        {
          journalLineId: 'jl-1',
          entryDate: new Date('2026-10-01T00:00:00Z'),
          amount: 5350,
          cleared: false,
        },
      ],
    );
    expect(res.closingBalance).toBe(105230);
    expect(res.lines.find((l) => l.id === 's1')?.suggestedJournalLineId).toBe('jl-1');
    expect(res.lines.find((l) => l.id === 's2')?.suggestedJournalLineId).toBeNull();
    expect(res.counts.suggested).toBe(1);
  });
});
