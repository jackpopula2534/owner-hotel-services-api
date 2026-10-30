import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { CashDrawersService } from './cash-drawers.service';
import { CashTxnType } from './dto/create-cash-txn.dto';

/** ลิ้นชัก ↔ GL: Paid-out / รับเงินอื่น / เงินขาดเกิน ต้องลงบัญชี, เงินจาก folio ห้ามลงซ้ำ */
describe('CashDrawersService', () => {
  const TENANT = 't1';
  let prisma: any;
  let journal: any;
  let service: CashDrawersService;

  const drawer = (over: Record<string, unknown> = {}) => ({
    id: 'd1',
    tenantId: TENANT,
    propertyId: 'p1',
    code: 'FD-02',
    status: 'OPEN',
    currentBalance: 4087,
    openingBalance: 5000,
    closedBy: 'cashier',
    variance: null,
    countedAmount: null,
    ...over,
  });

  beforeEach(() => {
    prisma = {
      cashDrawer: {
        findFirst: jest.fn().mockResolvedValue(drawer()),
        findMany: jest.fn(),
        update: jest
          .fn()
          .mockImplementation(({ data }) => Promise.resolve({ ...drawer(), ...data })),
      },
      cashTransaction: {
        create: jest
          .fn()
          .mockImplementation(({ data }) => Promise.resolve({ id: 'txn1', ...data })),
      },
      fiscalYear: { findFirst: jest.fn().mockResolvedValue(null) },
      accountChart: {
        count: jest.fn().mockResolvedValue(10),
        findFirst: jest.fn().mockResolvedValue({ id: 'x' }),
        create: jest.fn(),
        findMany: jest
          .fn()
          .mockImplementation(({ where }) =>
            Promise.resolve(
              (where.code.in as string[]).map((code) => ({ id: `acc-${code}`, code })),
            ),
          ),
      },
      $transaction: jest.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma)),
    };
    journal = { createAndPostAutoEntry: jest.fn().mockResolvedValue({ entryNo: 'JE-9' }) };
    service = new CashDrawersService(prisma, journal);
  });

  describe('close', () => {
    it('ยอดไม่ตรงต้องมีหมายเหตุ', async () => {
      await expect(service.close('d1', TENANT, 'cashier', { countedAmount: 4067 })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('ปิดกะ → PENDING พร้อมผลต่าง', async () => {
      const res = await service.close('d1', TENANT, 'cashier', {
        countedAmount: 4067,
        notes: 'ทอนผิด',
        denominations: '1000x2',
      });
      expect(res).toMatchObject({ status: 'PENDING', variance: -20, countedAmount: 4067 });
      expect(journal.createAndPostAutoEntry).not.toHaveBeenCalled();
    });
  });

  describe('approveClose', () => {
    it('มีผลต่าง คนปิดกะอนุมัติเองไม่ได้', async () => {
      prisma.cashDrawer.findFirst.mockResolvedValue(drawer({ status: 'PENDING', variance: -20 }));
      await expect(service.approveClose('d1', TENANT, 'cashier')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('เงินขาด → Dr 6310 / Cr 1101 และ CLOSED', async () => {
      prisma.cashDrawer.findFirst.mockResolvedValue(
        drawer({ status: 'PENDING', variance: -20, countedAmount: 4067 }),
      );
      const res = await service.approveClose('d1', TENANT, 'supervisor');
      const [, input] = journal.createAndPostAutoEntry.mock.calls[0];
      expect(input.lines[0]).toMatchObject({ accountId: 'acc-6310', debit: 20 });
      expect(input.lines[1]).toMatchObject({ accountId: 'acc-1101', credit: 20 });
      expect(res).toMatchObject({ status: 'CLOSED', currentBalance: 4067, journalEntryNo: 'JE-9' });
    });

    it('ตรงยอด → อนุมัติเองได้ ไม่ลง JE', async () => {
      prisma.cashDrawer.findFirst.mockResolvedValue(drawer({ status: 'PENDING', variance: 0 }));
      const res = await service.approveClose('d1', TENANT, 'cashier');
      expect(journal.createAndPostAutoEntry).not.toHaveBeenCalled();
      expect(res.status).toBe('CLOSED');
    });
  });

  describe('addTransaction', () => {
    it('Paid-out → Dr 6309 / Cr 1101', async () => {
      await service.addTransaction(
        { drawerId: 'd1', txnType: CashTxnType.PAYMENT, description: 'น้ำแข็ง', amount: 350 },
        TENANT,
        'u1',
      );
      const [, input] = journal.createAndPostAutoEntry.mock.calls[0];
      expect(input.lines.map((l: { accountId: string }) => l.accountId)).toEqual([
        'acc-6309',
        'acc-1101',
      ]);
    });

    it('นำฝากธนาคาร (accountCode 1102) → Dr 1102 / Cr 1101', async () => {
      await service.addTransaction(
        {
          drawerId: 'd1',
          txnType: CashTxnType.PAYMENT,
          description: 'ฝาก',
          amount: 1000,
          accountCode: '1102',
        },
        TENANT,
        'u1',
      );
      expect(journal.createAndPostAutoEntry.mock.calls[0][1].lines[0].accountId).toBe('acc-1102');
    });

    it('เงินจาก folio ไม่ลง JE ซ้ำ', async () => {
      await service.addTransaction(
        {
          drawerId: 'd1',
          txnType: CashTxnType.RECEIPT,
          description: 'รับชำระ',
          amount: 100,
          sourceType: 'FOLIO_PAYMENT',
        },
        TENANT,
        'u1',
      );
      expect(journal.createAndPostAutoEntry).not.toHaveBeenCalled();
    });
  });

  describe('recordFolioCashReceiptWithin', () => {
    const input = {
      tenantId: TENANT,
      propertyId: 'p1',
      amount: 500,
      description: 'รับชำระ',
      folioPaymentId: 'fp1',
      createdBy: 'u1',
    };

    it('property ไม่ใช้ลิ้นชัก → ข้าม', async () => {
      prisma.cashDrawer.findMany.mockResolvedValue([]);
      await expect(service.recordFolioCashReceiptWithin(prisma, input)).resolves.toBeNull();
    });

    it('มีลิ้นชักแต่ไม่มีที่เปิด → 400', async () => {
      prisma.cashDrawer.findMany.mockResolvedValue([drawer({ status: 'CLOSED' })]);
      await expect(service.recordFolioCashReceiptWithin(prisma, input)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('ลิ้นชักเปิดลิ้นชักเดียว → บันทึกรับเงินและเพิ่มยอด', async () => {
      prisma.cashDrawer.findMany.mockResolvedValue([drawer()]);
      const res = await service.recordFolioCashReceiptWithin(prisma, input);
      expect(res?.drawerCode).toBe('FD-02');
      expect(prisma.cashDrawer.update).toHaveBeenCalledWith({
        where: { id: 'd1' },
        data: { currentBalance: 4587 },
      });
    });
  });
});
