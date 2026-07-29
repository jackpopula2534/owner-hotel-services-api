import { Test, TestingModule } from '@nestjs/testing';
import { CampAccountingService } from './camp-accounting.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * เดิมการรับชำระของลานไม่สร้าง JournalEntry เลย หน้าบัญชีจึงเป็น 0 ทุกช่อง
 * spec ชุดนี้คุมทั้งการลงบัญชี, การกันซ้ำ และการ skip แบบ graceful (ห้ามทำให้รับเงินล้ม)
 */
describe('CampAccountingService', () => {
  let service: CampAccountingService;
  let prisma: any;

  const TENANT = 'tenant-1';
  const ACCOUNTS = [
    { id: 'acc-cash', code: '1101' },
    { id: 'acc-camp', code: '4103' },
    { id: 'acc-room', code: '4101' },
  ];

  const payment = {
    tenantId: TENANT,
    reservationId: 'res-1',
    reservationNo: 'CMP-20260720-4598',
    amount: 1980,
    paymentSeq: 1,
  };

  beforeEach(async () => {
    prisma = {
      journalEntry: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'je-1' }),
        count: jest.fn().mockResolvedValue(0),
      },
      property: { findFirst: jest.fn().mockResolvedValue({ id: 'prop-1' }) },
      accountChart: { findMany: jest.fn().mockResolvedValue(ACCOUNTS) },
      documentSequence: { upsert: jest.fn().mockResolvedValue({ lastNumber: 7 }) },
      campReservation: { findMany: jest.fn().mockResolvedValue([]) },
      // JE กับ ledger_balances ต้องเขียนใน transaction เดียวกัน — mock ให้รัน callback
      // ด้วย prisma ตัวเดียวกัน จะได้ยังตรวจ journalEntry.create ได้เหมือนเดิม
      ledgerBalance: { upsert: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn((cb: any) => cb(prisma)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [CampAccountingService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(CampAccountingService);
  });

  describe('postPaymentJournal', () => {
    it('ลง DR เงินสด / CR รายได้ลานกางเต็นท์ ด้วยยอดที่รับ และเดบิต=เครดิต', async () => {
      await service.postPaymentJournal(payment);

      const data = prisma.journalEntry.create.mock.calls[0][0].data;
      expect(data.sourceType).toBe('CAMP_PAYMENT');
      expect(data.sourceId).toBe('res-1');
      expect(data.totalDebit).toBe(1980);
      expect(data.totalCredit).toBe(1980);
      expect(data.status).toBe('POSTED');

      const lines = data.lines.create;
      expect(lines).toEqual([
        expect.objectContaining({ accountId: 'acc-cash', debit: 1980, credit: 0 }),
        expect.objectContaining({ accountId: 'acc-camp', debit: 0, credit: 1980 }),
      ]);
    });

    it('อัปเดต ledger_balances ด้วย ไม่งั้นงบทดลองจะขึ้น 0 ทั้งที่มี JE', async () => {
      await service.postPaymentJournal(payment);

      expect(prisma.ledgerBalance.upsert).toHaveBeenCalledTimes(2);
      const cash = prisma.ledgerBalance.upsert.mock.calls[0][0];
      expect(cash.create).toEqual(
        expect.objectContaining({ accountId: 'acc-cash', periodDebit: 1980, periodCredit: 0 }),
      );
      const revenue = prisma.ledgerBalance.upsert.mock.calls[1][0];
      expect(revenue.create).toEqual(
        expect.objectContaining({ accountId: 'acc-camp', periodDebit: 0, periodCredit: 1980 }),
      );
    });

    it('แยก JE ของแต่ละงวดด้วย reference (payments เป็น JSON ไม่มี id ต่อรายการ)', async () => {
      await service.postPaymentJournal({ ...payment, paymentSeq: 2 });

      expect(prisma.journalEntry.create.mock.calls[0][0].data.reference).toBe(
        'CMP-20260720-4598#2',
      );
    });

    it('ไม่สร้างซ้ำถ้ามี JE ของงวดนั้นแล้ว', async () => {
      prisma.journalEntry.findFirst.mockResolvedValue({ id: 'je-existing' });

      await service.postPaymentJournal(payment);

      expect(prisma.journalEntry.create).not.toHaveBeenCalled();
    });

    it('fallback ไปบัญชี 4101 ถ้า tenant seed ผังบัญชีก่อนที่จะมี 4103', async () => {
      prisma.accountChart.findMany.mockResolvedValue([
        { id: 'acc-cash', code: '1101' },
        { id: 'acc-room', code: '4101' },
      ]);

      await service.postPaymentJournal(payment);

      expect(prisma.journalEntry.create.mock.calls[0][0].data.lines.create[1].accountId).toBe(
        'acc-room',
      );
    });

    it('ข้ามแบบเงียบถ้ายังไม่ได้ seed ผังบัญชี (ห้ามทำให้การรับเงินล้ม)', async () => {
      prisma.accountChart.findMany.mockResolvedValue([]);

      await expect(service.postPaymentJournal(payment)).resolves.toBeUndefined();
      expect(prisma.journalEntry.create).not.toHaveBeenCalled();
    });

    it('ข้ามถ้า tenant ไม่มี property (JournalEntry.propertyId เป็น required)', async () => {
      prisma.property.findFirst.mockResolvedValue(null);

      await service.postPaymentJournal(payment);

      expect(prisma.journalEntry.create).not.toHaveBeenCalled();
    });

    it('ไม่ลงบัญชีเมื่อยอดเป็น 0 หรือติดลบ', async () => {
      await service.postPaymentJournal({ ...payment, amount: 0 });

      expect(prisma.journalEntry.create).not.toHaveBeenCalled();
    });
  });

  describe('backfillJournals', () => {
    it('สร้าง JE ย้อนหลังหนึ่งรายการต่อหนึ่งงวดใน payments JSON', async () => {
      prisma.campReservation.findMany.mockResolvedValue([
        {
          id: 'res-1',
          reservationNo: 'CMP-1',
          amountPaid: 1980,
          payments: [
            { at: '2026-07-18T03:00:00.000Z', amount: 1000 },
            { at: '2026-07-20T03:00:00.000Z', amount: 980 },
          ],
        },
      ]);

      const res = await service.backfillJournals(TENANT);

      expect(res).toEqual({ processed: 2, created: 2, skipped: 0, errors: 0 });
      expect(prisma.journalEntry.create).toHaveBeenCalledTimes(2);
      const amounts = prisma.journalEntry.create.mock.calls.map((c: any) => c[0].data.totalDebit);
      expect(amounts).toEqual([1000, 980]);
    });

    it('การจองเก่าที่ไม่มีประวัติ payments แต่มี amountPaid ลงเป็นงวดเดียว', async () => {
      prisma.campReservation.findMany.mockResolvedValue([
        { id: 'res-2', reservationNo: 'CMP-2', amountPaid: 500, payments: null },
      ]);

      const res = await service.backfillJournals(TENANT);

      expect(res.created).toBe(1);
      expect(prisma.journalEntry.create.mock.calls[0][0].data.totalDebit).toBe(500);
    });

    it('ข้ามการจองที่ยังไม่ได้จ่ายเลย', async () => {
      prisma.campReservation.findMany.mockResolvedValue([
        { id: 'res-3', reservationNo: 'CMP-3', amountPaid: 0, payments: [] },
      ]);

      const res = await service.backfillJournals(TENANT);

      expect(res).toEqual({ processed: 0, created: 0, skipped: 1, errors: 0 });
      expect(prisma.journalEntry.create).not.toHaveBeenCalled();
    });

    it('นับเป็น skipped ถ้ามี JE อยู่แล้ว (รันซ้ำต้องไม่สร้างซ้อน)', async () => {
      prisma.campReservation.findMany.mockResolvedValue([
        { id: 'res-1', reservationNo: 'CMP-1', amountPaid: 1980, payments: [{ amount: 1980 }] },
      ]);
      prisma.journalEntry.count.mockResolvedValue(1);
      prisma.journalEntry.findFirst.mockResolvedValue({ id: 'je-existing' });

      const res = await service.backfillJournals(TENANT);

      expect(res).toEqual({ processed: 1, created: 0, skipped: 1, errors: 0 });
      expect(prisma.journalEntry.create).not.toHaveBeenCalled();
    });

    it('รับแถวที่ tenantId เป็น null ได้ แต่ต้องเป็นลานของ tenant นี้ (ไม่ fail open)', async () => {
      await service.backfillJournals(TENANT);

      expect(prisma.campReservation.findMany.mock.calls[0][0].where.OR).toEqual([
        { tenantId: TENANT },
        { tenantId: null, campground: { tenantId: TENANT } },
      ]);
    });

    it('ไม่ทำอะไรเลยถ้าไม่มี tenantId', async () => {
      const res = await service.backfillJournals(undefined);

      expect(res).toEqual({ processed: 0, created: 0, skipped: 0, errors: 0 });
      expect(prisma.campReservation.findMany).not.toHaveBeenCalled();
    });
  });
});
