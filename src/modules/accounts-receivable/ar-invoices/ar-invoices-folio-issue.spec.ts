import { ArInvoicesService } from './ar-invoices.service';

/**
 * ใบรวบยอดจาก Folio (ทุกบรรทัด sourceRef = FOLIO_PAYMENT:*) ต้องออกได้โดยไม่ลง JE
 * — รายได้รับรู้แล้วตอน Night Audit ลงซ้ำจะทำให้รายได้ขึ้นสองเท่า
 */
describe('ArInvoicesService.issue — consolidated from folio', () => {
  const make = (lines: Array<{ sourceRef: string | null; netAmount: number }>) => {
    const invoice = {
      id: 'inv-1',
      tenantId: 't1',
      propertyId: 'p1',
      invoiceNo: 'INV-1',
      invoiceType: 'CITY_LEDGER',
      status: 'DRAFT',
      companyTaxId: '0105555000000',
      issueDate: new Date('2026-10-30'),
      totalAmount: 25200,
      vatAmount: 1648.6,
      lines: lines.map((l) => ({ description: 'x', accountId: null, ...l })),
    };
    const prisma: any = {
      arInvoice: {
        findFirst: jest.fn().mockResolvedValue(invoice),
        update: jest
          .fn()
          .mockImplementation(({ data }) => Promise.resolve({ ...invoice, ...data })),
      },
      documentSettings: { findFirst: jest.fn().mockResolvedValue({ taxId: '0105555999999' }) },
      accountChart: {
        count: jest.fn().mockResolvedValue(69),
        findFirst: jest.fn(({ where }) =>
          Promise.resolve({ id: `acc-${where.code}`, code: where.code }),
        ),
      },
    };
    const journal: any = { createAndPostAutoEntry: jest.fn().mockResolvedValue({}) };
    return { service: new ArInvoicesService(prisma, journal), prisma, journal };
  };

  it('ทุกบรรทัดมาจาก Folio → ISSUED โดยไม่สร้าง JE', async () => {
    const { service, journal } = make([{ sourceRef: 'FOLIO_PAYMENT:a', netAmount: 23551.4 }]);
    const res = await service.issue('inv-1', 't1', 'u1');
    expect(journal.createAndPostAutoEntry).not.toHaveBeenCalled();
    expect(res).toMatchObject({ status: 'ISSUED', isPosted: false });
  });

  it('มีบรรทัดขายตรงปน → ลง JE ตามปกติ', async () => {
    const { service, journal } = make([
      { sourceRef: 'FOLIO_PAYMENT:a', netAmount: 20000 },
      { sourceRef: null, netAmount: 3551.4 },
    ]);
    await service.issue('inv-1', 't1', 'u1');
    expect(journal.createAndPostAutoEntry).toHaveBeenCalled();
  });
});
