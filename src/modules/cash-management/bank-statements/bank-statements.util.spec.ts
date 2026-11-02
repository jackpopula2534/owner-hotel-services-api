import { fingerprintLines, suggestBookMatches } from './bank-statements.util';

describe('fingerprintLines', () => {
  const row = { txnDate: '2026-10-28', amount: 5350, description: 'โอนเข้า ABC', reference: null };

  it('ไฟล์เดิมได้ลายนิ้วมือเดิม (นำเข้าซ้ำแล้วกันได้)', () => {
    expect(fingerprintLines([row])).toEqual(
      fingerprintLines([{ ...row, description: '  โอนเข้า   abc ' }]),
    );
  });

  it('แถวเหมือนกันทุกช่องในไฟล์เดียวไม่ถูกรวมเป็นแถวเดียว', () => {
    const [a, b] = fingerprintLines([row, row]);
    expect(a).not.toBe(b);
  });

  it('ยอดต่างกันได้ลายนิ้วมือต่างกัน', () => {
    expect(fingerprintLines([row])[0]).not.toBe(fingerprintLines([{ ...row, amount: 5351 }])[0]);
  });
});

describe('suggestBookMatches', () => {
  const book = [
    { journalLineId: 'jl-1', entryDate: '2026-10-27', amount: 5350, cleared: false },
    { journalLineId: 'jl-2', entryDate: '2026-10-29', amount: 5350, cleared: false },
    { journalLineId: 'jl-3', entryDate: '2026-10-29', amount: -1200, cleared: false },
    { journalLineId: 'jl-4', entryDate: '2026-10-29', amount: 900, cleared: true },
  ];

  it('ใช้ journal line ที่ผูกไว้จากหน้ารับชำระก่อน', () => {
    const m = suggestBookMatches(
      [{ id: 's1', txnDate: '2026-10-28', amount: 5350, journalLineId: 'jl-2' }],
      book,
    );
    expect(m.get('s1')).toBe('jl-2');
  });

  it('ยอดเท่ากัน เลือกวันที่ใกล้สุด และใช้รายการสมุดบัญชีได้ครั้งเดียว', () => {
    const m = suggestBookMatches(
      [
        { id: 's1', txnDate: '2026-10-27', amount: 5350, journalLineId: null },
        { id: 's2', txnDate: '2026-10-28', amount: 5350, journalLineId: null },
        { id: 's3', txnDate: '2026-10-30', amount: -1200, journalLineId: null },
      ],
      book,
    );
    expect(m.get('s1')).toBe('jl-1');
    expect(m.get('s2')).toBe('jl-2');
    expect(m.get('s3')).toBe('jl-3');
  });

  it('ไม่แนะนำรายการที่ติ๊กแล้ว หรือห่างเกินกำหนด', () => {
    const m = suggestBookMatches(
      [
        { id: 's1', txnDate: '2026-10-29', amount: 900, journalLineId: null },
        { id: 's2', txnDate: '2026-12-01', amount: 5350, journalLineId: null },
      ],
      book,
    );
    expect(m.size).toBe(0);
  });
});
