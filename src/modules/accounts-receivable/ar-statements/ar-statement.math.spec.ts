import { buildAging, buildStatement, toStatementEntries, StatementInvoiceInput } from './ar-statement.math';

/** ใบแจ้งยอดลูกค้า: ยอดยกมา / ใบลดหนี้ / รับชำระรวม WHT / อายุหนี้ */
describe('ar-statement.math', () => {
  const inv = (o: Partial<StatementInvoiceInput>): StatementInvoiceInput => ({
    id: o.invoiceNo ?? 'x',
    invoiceNo: 'INV-1',
    invoiceType: 'CITY_LEDGER',
    issueDate: '2026-09-01',
    dueDate: '2026-10-01',
    totalAmount: 0,
    balance: 0,
    status: 'ISSUED',
    ...o,
  });

  const invoices = [
    inv({ invoiceNo: 'INV-1', issueDate: '2026-08-20', dueDate: '2026-09-19', totalAmount: 10700, balance: 0, status: 'PAID' }),
    inv({ invoiceNo: 'INV-2', issueDate: '2026-10-05', dueDate: '2026-11-04', totalAmount: 5350, balance: 4350, status: 'PARTIAL' }),
    // ใบลดหนี้ (เก็บยอดลบ) อ้าง INV-2
    inv({ invoiceNo: 'CN-1', invoiceType: 'CREDIT_NOTE', issueDate: '2026-10-10', totalAmount: -1000, refInvoiceNo: 'INV-2' }),
    // ออกหลังช่วง → ไม่อยู่ใน statement
    inv({ invoiceNo: 'INV-3', issueDate: '2026-11-02', dueDate: '2026-12-02', totalAmount: 999, balance: 999 }),
  ];
  const receipts = [
    // รับ 10,400 + WHT 300 = ตัด INV-1 ครบ 10,700 (ก่อนช่วง)
    {
      id: 'r1', receiptNo: 'RCV-1', receiptDate: '2026-09-15', method: 'BANK_TRANSFER',
      totalAmount: 10400, whtAmount: 300, allocations: [{ invoiceNo: 'INV-1', amount: 10700 }],
    },
    // ไม่มีการตัดเข้าใบของลูกค้ารายนี้ → ไม่ลงรายการ
    { id: 'r2', receiptNo: 'RCV-2', receiptDate: '2026-10-12', method: 'CASH', totalAmount: 500, whtAmount: 0, allocations: [] },
  ];

  it('ยอดยกมาหักรับชำระที่รวม WHT แล้ว และใบลดหนี้ลงฝั่งเครดิต', () => {
    const entries = toStatementEntries(invoices, receipts);
    const s = buildStatement(entries, '2026-10-01', '2026-10-31');

    expect(s.openingBalance).toBe(0); // 10,700 − (10,400 + 300)
    expect(s.lines.map((l) => l.docNo)).toEqual(['INV-2', 'CN-1']);
    expect(s.lines[1]).toMatchObject({ type: 'CREDIT_NOTE', debit: 0, credit: 1000, refDocNo: 'INV-2', balance: 4350 });
    expect(s.totalDebit).toBe(5350);
    expect(s.totalCredit).toBe(1000);
    expect(s.closingBalance).toBe(4350);
  });

  it('ใบเสร็จแยกส่วนเงินรับจริงกับ WHT', () => {
    const entries = toStatementEntries(invoices, receipts);
    const rcv = entries.find((e) => e.docNo === 'RCV-1');
    expect(rcv).toMatchObject({ credit: 10700, cashAmount: 10400, whtAmount: 300, refDocNo: 'INV-1' });
    expect(entries.find((e) => e.docNo === 'RCV-2')).toBeUndefined();
  });

  it('ช่วงที่เริ่มกลางเดือนยกยอดมาจากรายการก่อนหน้า', () => {
    const s = buildStatement(toStatementEntries(invoices, receipts), '2026-09-16', '2026-12-31');
    expect(s.openingBalance).toBe(0);
    const s2 = buildStatement(toStatementEntries(invoices, receipts), '2026-09-01', '2026-09-14');
    expect(s2.openingBalance).toBe(10700);
    expect(s2.closingBalance).toBe(10700);
  });

  it('อายุหนี้ตาม dueDate ใช้ balance ปัจจุบัน ไม่นับใบลดหนี้/ใบที่ชำระครบ', () => {
    const aging = buildAging(
      [
        ...invoices,
        inv({ invoiceNo: 'OLD-1', dueDate: '2026-07-01', totalAmount: 800, balance: 800, status: 'OVERDUE' }),
        inv({ invoiceNo: 'D45', dueDate: '2026-09-15', totalAmount: 200, balance: 200 }),
        inv({ invoiceNo: 'D1', dueDate: '2026-10-29', totalAmount: 50, balance: 50 }),
      ],
      '2026-10-30',
    );
    expect(aging.buckets).toEqual({
      current: 5349, // INV-2 4,350 + INV-3 999 (ยังไม่ถึงกำหนด)
      d1_30: 50,
      d31_60: 200,
      d61_90: 0,
      d90plus: 800, // 121 วัน
      total: 6399,
    });
    expect(aging.invoices[0]).toMatchObject({ invoiceNo: 'OLD-1', daysOverdue: 121, bucket: 'd90plus' });
  });
});
