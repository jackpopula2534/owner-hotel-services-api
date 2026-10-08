import { isInvoiceSettled } from './invoice-settlement';

describe('isInvoiceSettled', () => {
  const invoice = { amount: '3177.90', adjusted_amount: null };

  it('stays open after a deposit only', () => {
    expect(isInvoiceSettled(invoice, [{ amount: '953.37' }])).toBe(false);
  });

  it('settles once the deposit and the balance cover the total', () => {
    expect(isInvoiceSettled(invoice, [{ amount: '953.37' }, { amount: 2224.53 }])).toBe(true);
  });

  it('uses the adjusted (checkout) total when present', () => {
    expect(isInvoiceSettled({ amount: 3177.9, adjusted_amount: 3500 }, [{ amount: 3177.9 }])).toBe(false);
  });

  it('treats a legacy payment without an amount as paying in full', () => {
    expect(isInvoiceSettled(invoice, [{ amount: null }])).toBe(true);
  });
});
