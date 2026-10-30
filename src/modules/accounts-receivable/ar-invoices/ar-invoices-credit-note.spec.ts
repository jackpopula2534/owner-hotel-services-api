import { BadRequestException } from '@nestjs/common';
import { ArInvoicesService } from './ar-invoices.service';

/** ใบลดหนี้: Dr รายได้ + 2103 / Cr ลูกหนี้ และตัดยอดคงค้างของใบต้นทาง */
describe('ArInvoicesService credit note', () => {
  const TENANT = 't1';
  let prisma: any;
  let journal: any;
  let service: ArInvoicesService;

  const original = {
    id: 'inv1',
    tenantId: TENANT,
    propertyId: 'p1',
    invoiceNo: 'INV-202610-000002',
    invoiceType: 'CITY_LEDGER',
    status: 'ISSUED',
    guestId: null,
    bookingId: null,
    folioId: null,
    companyName: 'ACME',
    companyTaxId: '0105555000000',
    companyAddress: null,
    currency: 'THB',
    exchangeRate: 1,
    totalAmount: 1070,
    vatAmount: 70,
    paidAmount: 0,
    creditedAmount: 0,
    balance: 1070,
    refInvoiceId: null,
    lines: [
      {
        description: 'ห้องพัก',
        chargeType: 'ROOM',
        totalAmount: 1070,
        vatAmount: 70,
        netAmount: 1000,
        vatRate: 7,
        accountId: 'acc-4101',
        costCenterId: null,
      },
    ],
    receipts: [],
    guest: null,
  };

  beforeEach(() => {
    prisma = {
      arInvoice: {
        findFirst: jest.fn().mockResolvedValue(original),
        findFirstOrThrow: jest.fn().mockResolvedValue(original),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
        updateMany: jest.fn(),
        deleteMany: jest.fn(),
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            ...data,
            id: 'cn1',
            lines: data.lines.create,
          }),
        ),
      },
      documentSequence: { upsert: jest.fn().mockResolvedValue({ lastNumber: 3 }) },
      fiscalYear: { findFirst: jest.fn().mockResolvedValue(null) },
      accountChart: {
        count: jest.fn().mockResolvedValue(10),
        findFirst: jest
          .fn()
          .mockImplementation(({ where }) => Promise.resolve({ id: `acc-${where.code}`, code: where.code })),
      },
      journalEntry: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma)),
    };
    journal = {
      createAndPostAutoEntry: jest.fn().mockResolvedValue({ entryNo: 'JE-1' }),
      reverseBySource: jest.fn(),
    };
    service = new ArInvoicesService(prisma, journal);
  });

  it('ลดหนี้ 535 → Dr 4101 500 + Dr 2103 35 / Cr 1104 535 และใบต้นทางเหลือ 535', async () => {
    await service.createCreditNote('inv1', { amount: 535, reason: 'คืน 1 คืน' }, TENANT, 'u1');
    const lines = journal.createAndPostAutoEntry.mock.calls[0][1].lines;
    expect(lines).toEqual([
      expect.objectContaining({ accountId: 'acc-4101', debit: 500, credit: 0 }),
      expect.objectContaining({ accountId: 'acc-2103', debit: 35, credit: 0 }),
      expect.objectContaining({ accountId: 'acc-1104', debit: 0, credit: 535 }),
    ]);
    expect(prisma.arInvoice.update.mock.calls[0][0].data).toEqual({
      creditedAmount: 535,
      balance: 535,
      status: 'PARTIAL',
    });
    const cn = prisma.arInvoice.create.mock.calls[0][0].data;
    expect(cn).toMatchObject({
      invoiceNo: expect.stringMatching(/^CN-\d{6}-000003$/),
      invoiceType: 'CREDIT_NOTE',
      refInvoiceId: 'inv1',
      totalAmount: 535,
      vatAmount: 35,
      balance: 0,
    });
  });

  it('ลดหนี้เกินยอดคงค้าง → 400', async () => {
    await expect(
      service.createCreditNote('inv1', { amount: 1070.01, reason: 'x' }, TENANT, 'u1'),
    ).rejects.toThrow(BadRequestException);
  });

  it('ลงบัญชีไม่ผ่าน → คืนยอดใบต้นทางและลบใบลดหนี้', async () => {
    journal.createAndPostAutoEntry.mockRejectedValue(new Error('period closed'));
    await expect(
      service.createCreditNote('inv1', { amount: 100, reason: 'x' }, TENANT, 'u1'),
    ).rejects.toThrow('period closed');
    expect(prisma.arInvoice.deleteMany).toHaveBeenCalledWith({ where: { id: 'cn1', tenantId: TENANT } });
  });

  it('ยกเลิกใบลดหนี้ → กลับรายการ JE และคืนยอดใบต้นทาง', async () => {
    const cn = {
      ...original,
      id: 'cn1',
      invoiceNo: 'CN-202610-000003',
      invoiceType: 'CREDIT_NOTE',
      refInvoiceId: 'inv1',
      totalAmount: 535,
    };
    prisma.arInvoice.findFirst
      .mockResolvedValueOnce(cn)
      .mockResolvedValueOnce({ ...original, status: 'PARTIAL', creditedAmount: 535, balance: 535 });
    await service.void('cn1', TENANT, 'u1', 'ผิด');
    expect(journal.reverseBySource).toHaveBeenCalledWith(TENANT, 'AR_INVOICE', 'cn1', 'u1', expect.any(String));
    expect(prisma.arInvoice.update.mock.calls[0][0].data).toEqual({
      creditedAmount: 0,
      balance: 1070,
      status: 'ISSUED',
    });
  });

  it('ใบต้นทางที่มีใบลดหนี้ ยกเลิกไม่ได้', async () => {
    prisma.arInvoice.findFirst.mockResolvedValue({ ...original, creditedAmount: 100 });
    await expect(service.void('inv1', TENANT, 'u1')).rejects.toThrow('ใบลดหนี้');
  });

  it('สร้างใบชนิด CREDIT_NOTE ผ่าน create ตรง ๆ ไม่ได้', async () => {
    await expect(
      service.create({ invoiceType: 'CREDIT_NOTE' } as never, TENANT, 'u1'),
    ).rejects.toThrow(BadRequestException);
  });
});
