import { BadRequestException } from '@nestjs/common';
import { GuestFolioService } from './guest-folio.service';
import { AccPaymentMethod } from './dto/create-folio-payment.dto';

/** Guest Folio ↔ GL: รับชำระตัดลูกหนี้แขก 1103, เงินสดเข้าลิ้นชัก, โอน City Ledger → 1104 */
describe('GuestFolioService (accounting)', () => {
  const TENANT = 't1';
  let prisma: any;
  let journal: any;
  let cashDrawers: any;
  let service: GuestFolioService;

  const folio = (over: Record<string, unknown> = {}) => ({
    id: 'f1',
    tenantId: TENANT,
    propertyId: 'p1',
    folioNo: 'FOLIO-1',
    status: 'OPEN',
    balance: 2737,
    ...over,
  });

  beforeEach(() => {
    prisma = {
      guestFolio: {
        findFirst: jest.fn().mockResolvedValue(folio()),
        update: jest.fn().mockResolvedValue(folio({ balance: 0 })),
      },
      folioPayment: {
        create: jest
          .fn()
          .mockImplementation(({ data }) =>
            Promise.resolve({ id: 'pay1', paymentDate: new Date('2026-10-29T10:00:00Z'), ...data }),
          ),
      },
      fiscalYear: { findFirst: jest.fn().mockResolvedValue(null) },
      accountChart: {
        count: jest.fn().mockResolvedValue(10),
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
    journal = { createAndPostAutoEntry: jest.fn().mockResolvedValue({ entryNo: 'JE-5' }) };
    cashDrawers = {
      recordFolioCashReceiptWithin: jest.fn().mockResolvedValue({ drawerCode: 'FD-02' }),
    };
    service = new GuestFolioService(prisma, journal, cashDrawers);
  });

  it('รับเงินสด → Dr 1101 / Cr 1103 และเข้าลิ้นชัก', async () => {
    const res = await service.addPayment(
      { folioId: 'f1', method: AccPaymentMethod.CASH, amount: 2737 },
      TENANT,
      'u1',
    );
    const [, input] = journal.createAndPostAutoEntry.mock.calls[0];
    expect(input).toMatchObject({ sourceType: 'AR_RECEIPT', sourceId: 'pay1' });
    expect(input.lines[0]).toMatchObject({ accountId: 'acc-1101', debit: 2737 });
    expect(input.lines[1]).toMatchObject({ accountId: 'acc-1103', credit: 2737 });
    expect(cashDrawers.recordFolioCashReceiptWithin).toHaveBeenCalled();
    expect(res).toMatchObject({ journalEntryNo: 'JE-5', cashDrawerCode: 'FD-02' });
  });

  it('บัตรเครดิต → Dr 1102 ไม่แตะลิ้นชัก', async () => {
    await service.addPayment(
      { folioId: 'f1', method: AccPaymentMethod.CREDIT_CARD, amount: 1000 },
      TENANT,
      'u1',
    );
    expect(journal.createAndPostAutoEntry.mock.calls[0][1].lines[0].accountId).toBe('acc-1102');
    expect(cashDrawers.recordFolioCashReceiptWithin).not.toHaveBeenCalled();
  });

  it('folio PENDING จ่ายครบ → ปิด folio', async () => {
    prisma.guestFolio.findFirst.mockResolvedValue(folio({ status: 'PENDING' }));
    await service.addPayment(
      { folioId: 'f1', method: AccPaymentMethod.BANK_TRANSFER, amount: 2737 },
      TENANT,
      'u1',
    );
    expect(prisma.guestFolio.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'CLOSED' }) }),
    );
  });

  it('โอน City Ledger → Dr 1104 / Cr 1103 เต็มยอดค้าง', async () => {
    await service.transferToCityLedger('f1', { companyName: 'บจก. ก' }, TENANT, 'u1');
    const [, input] = journal.createAndPostAutoEntry.mock.calls[0];
    expect(input.lines[0]).toMatchObject({ accountId: 'acc-1104', debit: 2737 });
  });

  it('โอนเกินยอดค้าง → 400', async () => {
    await expect(
      service.transferToCityLedger('f1', { companyName: 'x', amount: 5000 }, TENANT, 'u1'),
    ).rejects.toThrow(BadRequestException);
  });

  it('folio ที่ปิดแล้วรับชำระไม่ได้', async () => {
    prisma.guestFolio.findFirst.mockResolvedValue(folio({ status: 'CLOSED' }));
    await expect(
      service.addPayment({ folioId: 'f1', method: AccPaymentMethod.CASH, amount: 1 }, TENANT, 'u1'),
    ).rejects.toThrow(BadRequestException);
  });
});
