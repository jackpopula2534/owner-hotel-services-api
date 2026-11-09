import { BadRequestException } from '@nestjs/common';
import { ArReceiptAllocationService } from './ar-receipt-allocation.service';

/** จัดสรรเงินรับล่วงหน้าภายหลัง: Dr 2105 / Cr 1103|1104 และถอยกลับเมื่อลงบัญชีไม่ผ่าน */
describe('ArReceiptAllocationService.allocate', () => {
  const TENANT = 't1';
  let prisma: any;
  let journal: any;
  let service: ArReceiptAllocationService;

  const receipt = {
    id: 'r1',
    tenantId: TENANT,
    propertyId: 'p1',
    receiptNo: 'RCV-1',
    status: 'CLEARED',
    totalAmount: 5000,
    whtAmount: 0,
    allocations: [],
  };
  const invoice = {
    id: 'i1',
    invoiceNo: 'INV-44',
    invoiceType: 'CITY_LEDGER',
    propertyId: 'p1',
    status: 'OVERDUE',
    totalAmount: 12840,
    paidAmount: 0,
    balance: 12840,
  };

  beforeEach(() => {
    prisma = {
      arReceipt: { findFirst: jest.fn().mockResolvedValue(receipt) },
      arInvoice: {
        findMany: jest.fn().mockResolvedValue([invoice]),
        findFirstOrThrow: jest.fn().mockResolvedValue(invoice),
        update: jest.fn(),
      },
      arReceiptAllocation: {
        create: jest.fn().mockResolvedValue({ id: 'a1' }),
        deleteMany: jest.fn(),
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
      journalEntry: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma)),
    };
    journal = { createAndPostAutoEntry: jest.fn().mockResolvedValue({ entryNo: 'JE-9' }) };
    service = new ArReceiptAllocationService(prisma, journal);
  });

  it('จัดสรรเข้าใบ City Ledger → Dr 2105 / Cr 1104 และใบเป็น PARTIAL', async () => {
    jest.spyOn(service, 'findOne').mockResolvedValue({} as never);
    await service.allocate(
      'r1',
      { allocations: [{ invoiceId: 'i1', amount: 5000 }] },
      TENANT,
      'u1',
    );
    const lines = journal.createAndPostAutoEntry.mock.calls[0][1].lines;
    expect(lines[0]).toMatchObject({ accountId: 'acc-2105', debit: 5000 });
    expect(lines[1]).toMatchObject({ accountId: 'acc-1104', credit: 5000 });
    expect(prisma.arInvoice.update.mock.calls[0][0].data).toMatchObject({
      paidAmount: 5000,
      status: 'PARTIAL',
    });
    expect(journal.createAndPostAutoEntry.mock.calls[0][1].sourceId).toMatch(/^r1:alloc:/);
  });

  it('จัดสรรเกินเงินที่เหลือ → 400', async () => {
    await expect(
      service.allocate('r1', { allocations: [{ invoiceId: 'i1', amount: 6000 }] }, TENANT, 'u1'),
    ).rejects.toThrow(BadRequestException);
  });

  it('ใบเสร็จที่มีภาษีถูกหัก → จัดสรรได้ถึงยอดรับ + ภาษี', async () => {
    jest.spyOn(service, 'findOne').mockResolvedValue({} as never);
    prisma.arReceipt.findFirst.mockResolvedValue({ ...receipt, totalAmount: 4850, whtAmount: 150 });
    await service.allocate(
      'r1',
      { allocations: [{ invoiceId: 'i1', amount: 5000 }] },
      TENANT,
      'u1',
    );
    expect(journal.createAndPostAutoEntry.mock.calls[0][1].lines[0]).toMatchObject({
      accountId: 'acc-2105',
      debit: 5000,
    });
    await expect(
      service.allocate('r1', { allocations: [{ invoiceId: 'i1', amount: 5000.5 }] }, TENANT, 'u1'),
    ).rejects.toThrow(BadRequestException);
  });

  it('ใบเสร็จที่ยกเลิกแล้วจัดสรรไม่ได้', async () => {
    prisma.arReceipt.findFirst.mockResolvedValue({ ...receipt, status: 'VOID' });
    await expect(
      service.allocate('r1', { allocations: [{ invoiceId: 'i1', amount: 100 }] }, TENANT, 'u1'),
    ).rejects.toThrow(BadRequestException);
  });

  it('ลงบัญชีไม่ผ่าน → ถอยการจัดสรรและคืนยอดใบแจ้งหนี้', async () => {
    journal.createAndPostAutoEntry.mockRejectedValue(new Error('period closed'));
    await expect(
      service.allocate('r1', { allocations: [{ invoiceId: 'i1', amount: 1000 }] }, TENANT, 'u1'),
    ).rejects.toThrow('period closed');
    expect(prisma.arReceiptAllocation.deleteMany).toHaveBeenCalled();
    expect(prisma.arInvoice.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: { paidAmount: 0, balance: 12840, status: 'OVERDUE' } }),
    );
  });
});
