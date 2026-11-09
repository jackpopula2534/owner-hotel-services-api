import { buildGuestLedgerLines, FOLIO_CHARGE_ACCOUNT } from './folio-gl.util';

describe('folio-gl.util · buildGuestLedgerLines', () => {
  const sum = (lines: { debit: number; credit: number }[], k: 'debit' | 'credit') =>
    Math.round(lines.reduce((s, l) => s + l[k], 0) * 100) / 100;

  it('สรุป charge เป็น Dr 1103 / Cr รายได้แยกบัญชี + Cr 2103 และสมดุล', () => {
    const { lines, summary, total } = buildGuestLedgerLines(
      [
        { chargeType: 'ROOM_CHARGE', netAmount: 2450, vatAmount: 171.5, totalAmount: 2621.5 },
        { chargeType: 'ROOM_CHARGE', netAmount: 2450, vatAmount: 171.5, totalAmount: 2621.5 },
        { chargeType: 'FB_CHARGE', netAmount: 1250, vatAmount: 87.5, totalAmount: 1337.5 },
        { chargeType: 'MINIBAR', netAmount: 320, vatAmount: 22.4, totalAmount: 342.4 },
      ],
      'NA',
    );

    expect(total).toBe(6922.9);
    expect(lines[0]).toMatchObject({ code: '1103', debit: 6922.9, credit: 0 });
    expect(lines.find((l) => l.code === '4101')).toMatchObject({ credit: 4900 });
    expect(lines.find((l) => l.code === '4201')).toMatchObject({ credit: 1250 });
    expect(lines.find((l) => l.code === '4301')).toMatchObject({ credit: 320 });
    expect(lines.find((l) => l.code === '2103')).toMatchObject({ credit: 452.9 });
    expect(sum(lines, 'debit')).toBe(sum(lines, 'credit'));
    expect(summary.find((r) => r.code === '4101')).toMatchObject({ count: 2, net: 4900 });
  });

  it('ยอดติดลบ (กลับรายการ/ส่วนลด) พลิกฝั่งเดบิต-เครดิต', () => {
    const { lines } = buildGuestLedgerLines(
      [{ chargeType: 'ROOM_CHARGE', netAmount: -2450, vatAmount: -171.5, totalAmount: -2621.5 }],
      'reverse',
    );
    expect(lines.find((l) => l.code === '1103')).toMatchObject({ debit: 0, credit: 2621.5 });
    expect(lines.find((l) => l.code === '4101')).toMatchObject({ debit: 2450, credit: 0 });
    expect(lines.find((l) => l.code === '2103')).toMatchObject({ debit: 171.5, credit: 0 });
  });

  it('หักมัดจำไม่ใช่รายได้ — ไม่สร้างบรรทัด', () => {
    const { lines } = buildGuestLedgerLines(
      [{ chargeType: 'DEPOSIT_APPLIED', netAmount: 1000, vatAmount: 0, totalAmount: 1000 }],
      'x',
    );
    expect(lines).toEqual([]);
    expect(FOLIO_CHARGE_ACCOUNT.DEPOSIT_APPLIED).toBeNull();
  });

  it('ไม่มี charge → ไม่มีบรรทัด', () => {
    expect(buildGuestLedgerLines([], 'x').lines).toEqual([]);
  });
});
