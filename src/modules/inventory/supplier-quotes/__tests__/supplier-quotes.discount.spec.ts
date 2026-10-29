import { Test } from '@nestjs/testing';
import { SupplierQuotesService } from '../supplier-quotes.service';
import { PrismaService } from '@/prisma/prisma.service';
import { RfqsService } from '../../rfqs/rfqs.service';
import type { SubmitQuoteDto } from '../dto';

describe('SupplierQuotesService — discount parity with PO', () => {
  let service: SupplierQuotesService;
  const update = jest.fn();
  const prisma = {
    supplierQuote: { findFirst: jest.fn() },
    inventoryItem: { findMany: jest.fn() },
    $transaction: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma.supplierQuote.findFirst.mockResolvedValue({
      id: 'q1',
      tenantId: 't1',
      status: 'RECEIVED',
      receivedAt: new Date(),
      requestForQuotationId: null,
    });
    prisma.inventoryItem.findMany.mockImplementation(
      ({ where }: { where: { id: { in: string[] } } }) =>
        Promise.resolve(where.id.in.map((id) => ({ id }))),
    );
    update.mockImplementation(({ data }) => Promise.resolve({ id: 'q1', ...data }));
    prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
      fn({ supplierQuoteItem: { deleteMany: jest.fn() }, supplierQuote: { update } }),
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        SupplierQuotesService,
        { provide: PrismaService, useValue: prisma },
        { provide: RfqsService, useValue: { markResponseReceived: jest.fn() } },
      ],
    }).compile();
    service = moduleRef.get(SupplierQuotesService);
  });

  const baseDto: SubmitQuoteDto = {
    items: [
      { itemId: 'i1', quantity: 24, unitPrice: 818.88, discount: 3, taxRate: 7 },
      { itemId: 'i2', quantity: 47, unitPrice: 514.8, discount: 0, taxRate: 7 },
    ],
  };

  it('keeps legacy totals when no header discount is given', async () => {
    await service.updateQuote('q1', baseDto, 't1');
    const data = update.mock.calls[0][0].data;
    expect(data.subtotal).toBeCloseTo(43259.13, 2);
    expect(data.taxAmount).toBeCloseTo(3028.14, 2);
    expect(data.totalAmount).toBeCloseTo(46287.27, 2);
    expect(data.discountMode).toBe('BEFORE_VAT');
    expect(data.headerDiscount).toBe(0);
    expect(data.pricesIncludeVat).toBe(false);
  });

  it('applies header discount and persists its config', async () => {
    await service.updateQuote(
      'q1',
      { ...baseDto, headerDiscount: 259.13, headerDiscountType: 'AMOUNT' },
      't1',
    );
    const data = update.mock.calls[0][0].data;
    expect(data.subtotal).toBeCloseTo(43000, 2);
    expect(data.taxAmount).toBeCloseTo(3010, 2);
    expect(data.totalAmount).toBeCloseTo(46010, 2);
    expect(data.discountAmount).toBeCloseTo(589.59 + 259.13, 2);
    expect(data.headerDiscount).toBe(259.13);
  });

  it('supports fixed-amount line discounts', async () => {
    await service.updateQuote(
      'q1',
      {
        items: [
          {
            itemId: 'i1',
            quantity: 2,
            unitPrice: 100,
            discount: 50,
            discountType: 'AMOUNT',
            taxRate: 7,
          },
        ],
      },
      't1',
    );
    const data = update.mock.calls[0][0].data;
    const item = data.items.createMany.data[0];
    expect(item.discountType).toBe('AMOUNT');
    expect(data.subtotal).toBe(150);
    expect(data.totalAmount).toBe(160.5);
  });

  it('backs VAT out when prices include VAT (no double VAT)', async () => {
    await service.updateQuote(
      'q1',
      {
        items: [{ itemId: 'i1', quantity: 1, unitPrice: 107, taxRate: 7 }],
        pricesIncludeVat: true,
      },
      't1',
    );
    const data = update.mock.calls[0][0].data;
    expect(data.totalAmount).toBe(107);
    expect(data.taxAmount).toBe(7);
    expect(data.subtotal).toBe(100);
  });

  it('respects explicit 0% tax rate (previously coerced to 7%)', async () => {
    await service.updateQuote(
      'q1',
      { items: [{ itemId: 'i1', quantity: 1, unitPrice: 100, taxRate: 0 }] },
      't1',
    );
    const data = update.mock.calls[0][0].data;
    expect(data.taxAmount).toBe(0);
    expect(data.totalAmount).toBe(100);
  });
});
