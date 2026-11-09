import { settleInvoice } from './ar-invoice-balance.util';

describe('settleInvoice', () => {
  const base = { status: 'ISSUED', totalAmount: 1070, paidAmount: 0, creditedAmount: 0 };

  it('ยอดคงค้าง = ยอดรวม − รับชำระ − ลดหนี้', () => {
    const r = settleInvoice({ ...base, paidAmount: 500 }, { credited: 107 });
    expect(r).toEqual({ paidAmount: 500, creditedAmount: 107, balance: 463, status: 'PARTIAL' });
  });

  it('ลดหนี้จนหมด → PAID', () => {
    expect(settleInvoice(base, { credited: 1070 }).status).toBe('PAID');
  });

  it('ยกเลิกใบเสร็จแล้วยังเหลือลดหนี้ → PARTIAL ไม่ใช่ ISSUED', () => {
    const r = settleInvoice(
      { ...base, status: 'PAID', paidAmount: 963, creditedAmount: 107 },
      { paid: -963 },
    );
    expect(r).toMatchObject({ paidAmount: 0, balance: 963, status: 'PARTIAL' });
  });

  it('คืนยอดจนไม่เหลือการตัด → กลับสถานะเดิม (OVERDUE คงไว้)', () => {
    expect(settleInvoice({ ...base, status: 'OVERDUE', paidAmount: 10 }, { paid: -10 }).status).toBe(
      'OVERDUE',
    );
    expect(settleInvoice({ ...base, status: 'PAID', paidAmount: 1070 }, { paid: -1070 }).status).toBe(
      'ISSUED',
    );
  });

  it('ใบ VOID คงสถานะ VOID', () => {
    expect(settleInvoice({ ...base, status: 'VOID' }, { paid: 0 }).status).toBe('VOID');
  });
});
