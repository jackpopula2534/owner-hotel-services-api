import { PromptPayService } from './promptpay.service';
import { grantAddonPurchaseForInvoice } from '../modules/addon-purchases/addon-purchase-grant';

jest.mock('../modules/addon-purchases/addon-purchase-grant', () => ({
  ...jest.requireActual('../modules/addon-purchases/addon-purchase-grant'),
  grantAddonPurchaseForInvoice: jest.fn(),
}));

const grant = grantAddonPurchaseForInvoice as jest.MockedFunction<
  typeof grantAddonPurchaseForInvoice
>;

function setup(paid: number[]) {
  const prisma = {
    invoices: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'inv-1',
        tenant_id: 't1',
        amount: 845.3,
        adjusted_amount: null,
        booking_id: null,
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    payments: {
      create: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue(paid.map((amount) => ({ amount }))),
    },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma));
  const addonService = { invalidateAddonCache: jest.fn().mockResolvedValue(undefined) };
  const svc = new PromptPayService(
    { get: jest.fn() } as never,
    prisma as never,
    {} as never,
    addonService as never,
  );
  const settle = (amount: number) =>
    (
      svc as unknown as {
        updateInvoicePaymentStatus: (id: string, a: number, t: string) => Promise<void>;
      }
    ).updateInvoicePaymentStatus('inv-1', amount, 't1');
  return { prisma, addonService, settle };
}

describe('PromptPayService invoice settlement', () => {
  beforeEach(() => grant.mockReset());

  it('full payment marks the invoice paid, grants the add-on, then invalidates the cache', async () => {
    grant.mockResolvedValue({
      addonCode: 'CAMP_3D_MAP',
      periodEnd: new Date('2026-11-19'),
    } as never);
    const { prisma, addonService, settle } = setup([845.3]);
    await settle(845.3);
    expect(prisma.invoices.update).toHaveBeenCalledWith({
      where: { id: 'inv-1' },
      data: { status: 'paid' },
    });
    expect(grant).toHaveBeenCalledWith(prisma, 'inv-1', 't1');
    expect(addonService.invalidateAddonCache).toHaveBeenCalledWith('t1');
  });

  it('a low-amount QR does not close the invoice or grant anything', async () => {
    const { prisma, addonService, settle } = setup([1]);
    await settle(1);
    expect(prisma.payments.create).toHaveBeenCalled();
    expect(prisma.invoices.update).not.toHaveBeenCalled();
    expect(grant).not.toHaveBeenCalled();
    expect(addonService.invalidateAddonCache).not.toHaveBeenCalled();
  });
});
