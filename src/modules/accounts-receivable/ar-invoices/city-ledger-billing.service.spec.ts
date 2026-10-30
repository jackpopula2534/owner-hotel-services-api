import { BadRequestException } from '@nestjs/common';
import { CityLedgerBillingService } from './city-ledger-billing.service';

/** วางบิล City Ledger จากยอดโอน Folio — แยก VAT ตามสัดส่วนจริง และกันวางบิลซ้ำ */
describe('CityLedgerBillingService', () => {
  const TENANT = 't1';
  let prisma: any;
  let invoices: any;
  let service: CityLedgerBillingService;

  const payment = (id: string, amount: number, folioId = 'f1', payerName = 'บจก. ก') => ({
    id,
    amount,
    payerName,
    reference: 'TAX:0105555000000',
    paymentDate: new Date('2026-10-15T03:00:00Z'),
    folio: {
      id: folioId,
      folioNo: `FOLIO-${folioId}`,
      propertyId: 'p1',
      checkInDate: new Date('2026-10-12T00:00:00Z'),
      checkOutDate: new Date('2026-10-15T00:00:00Z'),
      booking: { room: { number: '118' } },
    },
  });

  beforeEach(() => {
    prisma = {
      folioPayment: { findMany: jest.fn() },
      arInvoiceLine: { findMany: jest.fn().mockResolvedValue([]) },
      folioCharge: {
        groupBy: jest
          .fn()
          .mockResolvedValue([{ folioId: 'f1', _sum: { vatAmount: 1648.6, totalAmount: 25200 } }]),
      },
      arInvoice: {
        create: jest
          .fn()
          .mockImplementation(({ data }) => Promise.resolve({ id: 'inv1', ...data })),
      },
    };
    invoices = { generateInvoiceNo: jest.fn().mockResolvedValue('INV-202610-000047') };
    service = new CityLedgerBillingService(prisma, invoices);
  });

  it('listUnbilled จัดกลุ่มตามบริษัท และตัดรายการที่วางบิลแล้ว', async () => {
    prisma.folioPayment.findMany.mockResolvedValue([
      payment('a', 25200),
      payment('b', 3690, 'f2'),
      payment('c', 8400, 'f3', 'บจก. ข'),
    ]);
    prisma.arInvoiceLine.findMany.mockResolvedValue([{ sourceRef: 'FOLIO_PAYMENT:b' }]);
    const groups = await service.listUnbilled(TENANT, 'p1');
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({
      companyName: 'บจก. ก',
      total: 25200,
      companyTaxId: '0105555000000',
    });
    expect(groups[0].items.map((i) => i.paymentId)).toEqual(['a']);
  });

  it('createInvoice: ร่างใบ CITY_LEDGER แยก VAT ตามสัดส่วน folio และอ้างอิง FolioPayment', async () => {
    prisma.folioPayment.findMany.mockResolvedValue([payment('a', 25200)]);
    await service.createInvoice(
      {
        propertyId: 'p1',
        companyName: 'บจก. ก',
        companyTaxId: '0105555000000',
        folioPaymentIds: ['a'],
      },
      TENANT,
      'u1',
    );
    const data = prisma.arInvoice.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      invoiceType: 'CITY_LEDGER',
      status: 'DRAFT',
      vatAmount: 1648.6,
      totalAmount: 25200,
    });
    expect(data.lines.create[0]).toMatchObject({
      sourceRef: 'FOLIO_PAYMENT:a',
      netAmount: 23551.4,
      vatAmount: 1648.6,
    });
  });

  it('วางบิลยอดที่อยู่ในใบอื่นแล้ว → 400', async () => {
    prisma.folioPayment.findMany.mockResolvedValue([payment('a', 25200)]);
    prisma.arInvoiceLine.findMany.mockResolvedValue([{ sourceRef: 'FOLIO_PAYMENT:a' }]);
    await expect(
      service.createInvoice(
        { propertyId: 'p1', companyName: 'x', folioPaymentIds: ['a'] },
        TENANT,
        'u1',
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('รายการไม่ใช่ยอด City Ledger → 400', async () => {
    prisma.folioPayment.findMany.mockResolvedValue([]);
    await expect(
      service.createInvoice(
        { propertyId: 'p1', companyName: 'x', folioPaymentIds: ['zz'] },
        TENANT,
        'u1',
      ),
    ).rejects.toThrow(BadRequestException);
  });
});
