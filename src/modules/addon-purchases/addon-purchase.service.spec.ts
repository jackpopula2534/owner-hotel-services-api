import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ADDON_PURCHASE_INVOICE_PREFIX,
  AddonPurchaseService,
  addMonthsUtc,
  grantAddonPurchaseForInvoice,
} from './addon-purchase.service';

const DAY = 24 * 60 * 60 * 1000;

const catalogItem = (over: Record<string, unknown> = {}) => ({
  id: 'addon-3d',
  code: 'CAMP_3D_MAP',
  name: 'แผนผัง 3D',
  price: 790,
  billingCycle: 'monthly',
  isActive: true,
  system: 'CAMP',
  ...over,
});

const purchaseRow = (over: Record<string, unknown> = {}) => ({
  id: 'pur-1',
  tenantId: 't1',
  addonCode: 'CAMP_3D_MAP',
  invoiceId: 'inv-1',
  status: 'pending',
  months: 1,
  unitPrice: new Prisma.Decimal(790),
  periodStart: null,
  periodEnd: null,
  paidAt: null,
  createdAt: new Date('2026-10-19T00:00:00Z'),
  ...over,
});

function setup(opts: { catalog?: unknown[]; active?: unknown[] } = {}) {
  const prisma = {
    addonPurchase: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve(purchaseRow(data))),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    invoices: {
      create: jest.fn().mockResolvedValue({ id: 'inv-new' }),
      findFirst: jest.fn().mockResolvedValue(null),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    payments: { findFirst: jest.fn().mockResolvedValue(null) },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma));
  const addonService = {
    listActive: jest.fn().mockResolvedValue(opts.catalog ?? [catalogItem()]),
    assertAddonAllowedForTenant: jest.fn().mockResolvedValue(undefined),
    getActiveAddons: jest.fn().mockResolvedValue(opts.active ?? []),
  };
  const promptPay = {
    generateQRCode: jest.fn().mockResolvedValue({
      transactionRef: 'PP-REF-1',
      qrCodeImage: 'data:image/png;base64,xx',
      amount: 845.3,
      expiresAt: new Date('2026-10-19T08:15:00Z'),
    }),
  };
  return {
    svc: new AddonPurchaseService(prisma as never, addonService as never, promptPay as never),
    prisma,
    addonService,
    promptPay,
  };
}

describe('addMonthsUtc', () => {
  it.each([
    ['2026-10-19T08:30:00.000Z', 1, '2026-11-19T08:30:00.000Z'],
    ['2026-01-31T00:00:00.000Z', 1, '2026-02-28T00:00:00.000Z'],
    ['2028-01-31T00:00:00.000Z', 1, '2028-02-29T00:00:00.000Z'],
    ['2026-12-15T00:00:00.000Z', 1, '2027-01-15T00:00:00.000Z'],
    ['2026-03-31T00:00:00.000Z', 3, '2026-06-30T00:00:00.000Z'],
  ])('%s + %i month → %s', (from, months, expected) => {
    expect(addMonthsUtc(new Date(from), months).toISOString()).toBe(expected);
  });
});

describe('AddonPurchaseService.createPurchase', () => {
  it('bills a full month from the server-side catalog price plus 7% VAT', async () => {
    const { svc, prisma, addonService } = setup();

    const view = await svc.createPurchase('t1', 'u1', 'CAMP_3D_MAP');

    expect(addonService.assertAddonAllowedForTenant).toHaveBeenCalledWith('t1', 'CAMP_3D_MAP');
    const { data } = prisma.invoices.create.mock.calls[0][0];
    expect(data).toMatchObject({ tenant_id: 't1', status: 'pending' });
    expect(data.subscription_id).toBeUndefined();
    expect(Number(data.subtotal)).toBe(790);
    expect(Number(data.vat_amount)).toBe(55.3);
    expect(Number(data.amount)).toBe(845.3);
    expect(data.invoice_no.startsWith(ADDON_PURCHASE_INVOICE_PREFIX)).toBe(true);
    // @db.Date → UTC midnight, 7 days out
    expect(data.due_date.toISOString().endsWith('T00:00:00.000Z')).toBe(true);
    expect(data.invoice_items.create).toMatchObject({
      type: 'feature',
      ref_id: 'addon-3d',
      quantity: 1,
    });
    expect(prisma.addonPurchase.create.mock.calls[0][0].data).toMatchObject({
      tenantId: 't1',
      addonCode: 'CAMP_3D_MAP',
      invoiceId: 'inv-new',
      months: 1,
      createdBy: 'u1',
    });
    expect(view).toMatchObject({ status: 'pending', months: 1, unitPrice: 790 });
  });

  it.each([
    ['unknown code', [catalogItem({ code: 'OTHER' })]],
    ['free add-on', [catalogItem({ price: 0 })]],
    ['yearly add-on', [catalogItem({ billingCycle: 'yearly' })]],
  ])('refuses a %s', async (_label, catalog) => {
    const { svc, prisma } = setup({ catalog });
    await expect(svc.createPurchase('t1', 'u1', 'CAMP_3D_MAP')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.invoices.create).not.toHaveBeenCalled();
  });

  it('refuses when the plan already includes the add-on', async () => {
    const { svc, prisma } = setup({ active: [{ code: 'CAMP_3D_MAP', source: 'plan' }] });
    await expect(svc.createPurchase('t1', 'u1', 'CAMP_3D_MAP')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.invoices.create).not.toHaveBeenCalled();
  });

  it.each(['trial', 'purchase'])(
    'allows buying while the current entitlement is a %s',
    async (source) => {
      const { svc, prisma } = setup({ active: [{ code: 'CAMP_3D_MAP', source }] });
      await svc.createPurchase('t1', 'u1', 'CAMP_3D_MAP');
      expect(prisma.invoices.create).toHaveBeenCalled();
    },
  );

  it('reuses the open invoice instead of issuing a second one', async () => {
    const { svc, prisma } = setup();
    prisma.addonPurchase.findFirst.mockResolvedValue(purchaseRow());
    prisma.invoices.findFirst.mockResolvedValue({
      status: 'pending',
      due_date: new Date(Date.now() + 3 * DAY),
    });

    const view = await svc.createPurchase('t1', 'u1', 'CAMP_3D_MAP');

    expect(view.id).toBe('pur-1');
    expect(prisma.invoices.create).not.toHaveBeenCalled();
  });

  it("voids an overdue open invoice and issues a fresh one at today's price", async () => {
    const { svc, prisma } = setup();
    prisma.addonPurchase.findFirst.mockResolvedValue(purchaseRow());
    prisma.invoices.findFirst.mockResolvedValueOnce({
      status: 'pending',
      due_date: new Date(Date.now() - 2 * DAY),
    });

    await svc.createPurchase('t1', 'u1', 'CAMP_3D_MAP');

    expect(prisma.addonPurchase.updateMany).toHaveBeenCalledWith({
      where: { id: 'pur-1', tenantId: 't1', status: 'pending' },
      data: { status: 'cancelled' },
    });
    expect(prisma.invoices.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: 'inv-1', tenant_id: 't1', status: 'pending' },
      data: { status: 'voided' },
    });
    expect(prisma.invoices.create).toHaveBeenCalled();
  });
});

describe('grantAddonPurchaseForInvoice', () => {
  const now = new Date('2026-10-19T10:00:00.000Z');

  function db(pending: unknown, latestPaidEnd: Date | null, claimed = 1) {
    return {
      addonPurchase: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(pending)
          .mockResolvedValueOnce(latestPaidEnd ? { periodEnd: latestPaidEnd } : null),
        updateMany: jest.fn().mockResolvedValue({ count: claimed }),
      },
    };
  }

  it('starts a first purchase at approval time and runs one calendar month', async () => {
    const tx = db(purchaseRow(), null);
    const res = await grantAddonPurchaseForInvoice(tx as never, 'inv-1', 't1', now);
    expect(res).toEqual({
      addonCode: 'CAMP_3D_MAP',
      periodStart: now,
      periodEnd: new Date('2026-11-19T10:00:00.000Z'),
    });
    expect(tx.addonPurchase.updateMany).toHaveBeenCalledWith({
      where: { id: 'pur-1', tenantId: 't1', status: 'pending' },
      data: expect.objectContaining({ status: 'paid', paidAt: now }),
    });
  });

  it('a renewal extends from the current expiry so no paid days are lost', async () => {
    const currentEnd = new Date('2026-10-30T00:00:00.000Z');
    const res = await grantAddonPurchaseForInvoice(
      db(purchaseRow(), currentEnd) as never,
      'inv-1',
      't1',
      now,
    );
    expect(res?.periodStart).toEqual(currentEnd);
    expect(res?.periodEnd).toEqual(new Date('2026-11-30T00:00:00.000Z'));
  });

  it('a lapsed purchase restarts from approval time', async () => {
    const lapsed = new Date('2026-09-01T00:00:00.000Z');
    const res = await grantAddonPurchaseForInvoice(
      db(purchaseRow(), lapsed) as never,
      'inv-1',
      't1',
      now,
    );
    expect(res?.periodStart).toEqual(now);
  });

  it('is a no-op for invoices that are not add-on purchases, without a tenant, or already claimed', async () => {
    expect(
      await grantAddonPurchaseForInvoice(db(null, null) as never, 'inv-x', 't1', now),
    ).toBeNull();
    expect(
      await grantAddonPurchaseForInvoice(db(purchaseRow(), null) as never, 'inv-1', null, now),
    ).toBeNull();
    expect(
      await grantAddonPurchaseForInvoice(db(purchaseRow(), null, 0) as never, 'inv-1', 't1', now),
    ).toBeNull();
  });
});

describe('AddonPurchaseService.createPromptPayQr', () => {
  const future = new Date(Date.now() + 10 * DAY);

  it('creates a QR for the server-side invoice amount, scoped to the tenant', async () => {
    const { svc, prisma, promptPay } = setup();
    prisma.addonPurchase.findFirst.mockResolvedValue(purchaseRow());
    prisma.invoices.findFirst.mockResolvedValue({
      id: 'inv-1',
      amount: new Prisma.Decimal(845.3),
      status: 'pending',
      due_date: future,
    });

    const qr = await svc.createPromptPayQr('t1', 'pur-1');

    expect(prisma.addonPurchase.findFirst).toHaveBeenCalledWith({
      where: { id: 'pur-1', tenantId: 't1' },
    });
    expect(prisma.invoices.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'inv-1', tenant_id: 't1' } }),
    );
    expect(promptPay.generateQRCode).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 845.3, invoiceId: 'inv-1', tenantId: 't1' }),
    );
    expect(qr).toEqual(expect.objectContaining({ transactionRef: 'PP-REF-1', amount: 845.3 }));
  });

  it('rejects another tenant purchase (not found)', async () => {
    const { svc, promptPay } = setup();
    await expect(svc.createPromptPayQr('t2', 'pur-1')).rejects.toThrow('ไม่พบรายการซื้อ');
    expect(promptPay.generateQRCode).not.toHaveBeenCalled();
  });

  it('rejects a purchase that is already paid', async () => {
    const { svc, prisma } = setup();
    prisma.addonPurchase.findFirst.mockResolvedValue(purchaseRow({ status: 'paid' }));
    await expect(svc.createPromptPayQr('t1', 'pur-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects an overdue invoice', async () => {
    const { svc, prisma, promptPay } = setup();
    prisma.addonPurchase.findFirst.mockResolvedValue(purchaseRow());
    prisma.invoices.findFirst.mockResolvedValue({
      id: 'inv-1',
      amount: new Prisma.Decimal(845.3),
      status: 'pending',
      due_date: new Date('2020-01-01T00:00:00Z'),
    });
    await expect(svc.createPromptPayQr('t1', 'pur-1')).rejects.toBeInstanceOf(ConflictException);
    expect(promptPay.generateQRCode).not.toHaveBeenCalled();
  });
});
