import { InvoicesService } from './invoices.service';

// ─────────────────────────────────────────────────────────────────────────────
// InvoicesService - VAT breakdown (LEGAL-02)
//
// Thai tax invoices must show subtotal + VAT + gross total. We compute in satang
// so subtotal + vat === total exactly (no float drift).
// ─────────────────────────────────────────────────────────────────────────────

describe('InvoicesService - computeVat', () => {
  const service = new InvoicesService({} as any);

  it('derives the gross total from a provided subtotal at 7%', () => {
    const r = service.computeVat({ amount: 0, subtotal: 1000, vatRate: 7 });
    expect(r).toEqual({ amount: 1070, subtotal: 1000, vatRate: 7, vatAmount: 70 });
  });

  it('back-calculates the base from a VAT-inclusive amount (default 7%)', () => {
    const r = service.computeVat({ amount: 1070 });
    expect(r.subtotal).toBe(1000);
    expect(r.vatAmount).toBe(70);
    expect(r.amount).toBe(1070);
    expect(r.vatRate).toBe(7);
  });

  it('supports VAT-exempt invoices (rate 0)', () => {
    const r = service.computeVat({ amount: 500, vatRate: 0 });
    expect(r).toEqual({ amount: 500, subtotal: 500, vatRate: 0, vatAmount: 0 });
  });

  it('guarantees subtotal + vat === total for awkward amounts', () => {
    for (const amount of [999.99, 1234.5, 4990, 0.07, 8888.81]) {
      const r = service.computeVat({ amount });
      expect(Math.round((r.subtotal + r.vatAmount) * 100) / 100).toBe(r.amount);
    }
  });
});

describe('InvoicesService - create() VAT breakdown gating (M2)', () => {
  const buildService = () => {
    const created: any = {};
    const prismaMock: any = {
      invoices: {
        // outstanding-invoice guard for subscription invoices
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(({ data }: any) => {
          Object.assign(created, data);
          return Promise.resolve({ id: 'inv-1', ...data });
        }),
      },
    };
    return { service: new InvoicesService(prismaMock), prismaMock, created };
  };

  it('writes the VAT breakdown for a subscription invoice', async () => {
    const { service, created } = buildService();

    await service.create(
      {
        tenantId: 'tenant-1',
        subscriptionId: 'sub-1',
        invoiceNo: 'INV-2026-001',
        amount: 1070,
        dueDate: '2026-06-01T00:00:00Z',
      } as any,
      { skipOutstandingCheck: true },
    );

    expect(created).toEqual(
      expect.objectContaining({ amount: 1070, subtotal: 1000, vat_rate: 7, vat_amount: 70 }),
    );
  });

  it('writes the VAT breakdown when the caller opts in via vatRate', async () => {
    const { service, created } = buildService();

    await service.create({
      tenantId: 'tenant-1',
      bookingId: 'booking-1',
      invoiceNo: 'INV-2026-002',
      amount: 1070,
      vatRate: 7,
      dueDate: '2026-06-01T00:00:00Z',
    } as any);

    expect(created).toEqual(
      expect.objectContaining({ amount: 1070, subtotal: 1000, vat_rate: 7, vat_amount: 70 }),
    );
  });

  it('does NOT stamp VAT on a booking invoice that only passes a gross amount', async () => {
    const { service, created } = buildService();

    await service.create({
      tenantId: 'tenant-1',
      bookingId: 'booking-1',
      invoiceNo: 'INV-2026-003',
      amount: 1070,
      dueDate: '2026-06-01T00:00:00Z',
    } as any);

    expect(created.amount).toBe(1070);
    expect(created.subtotal).toBeUndefined();
    expect(created.vat_rate).toBeUndefined();
    expect(created.vat_amount).toBeUndefined();
  });
});
