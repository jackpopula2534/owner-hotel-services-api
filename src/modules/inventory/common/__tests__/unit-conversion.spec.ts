import { convertToStockUnit } from '../unit-conversion';

describe('convertToStockUnit', () => {
  it.each([
    [150, 'กรัม', 'KG', 0.15],
    [0.5, 'kg', 'G', 500],
    [250, 'มล.', 'L', 0.25],
    [2, 'ช้อนโต๊ะ', 'ML', 30],
    [1, 'ถ้วย', 'L', 0.24],
    [3, 'ฟอง', 'PIECE', 3],
    [24, 'ชิ้น', 'DOZEN', 2],
    [2, 'ขวด', 'BOTTLE', 2],
    [5, 'KG', 'KG', 5],
  ])('%s %s → %s = %s', (qty, from, to, expected) => {
    const r = convertToStockUnit(qty, from, to);
    expect(r.ok).toBe(true);
    expect(r.quantity).toBeCloseTo(expected, 6);
  });

  it('treats a missing recipe unit as the stock unit', () => {
    expect(convertToStockUnit(4, '', 'KG')).toEqual({ ok: true, quantity: 4 });
    expect(convertToStockUnit(4, null, 'KG')).toEqual({ ok: true, quantity: 4 });
  });

  it.each([
    ['ช้อนโต๊ะ', 'KG'], // ปริมาตร → น้ำหนัก ต้องรู้ความหนาแน่น
    ['ฟอง', 'BOX'], // ไม่รู้ว่ากล่องละกี่ฟอง
    ['กรัม', 'PIECE'],
    ['กำมือ', 'KG'], // หน่วยที่ไม่รู้จัก
  ])('refuses to guess %s → %s', (from, to) => {
    const r = convertToStockUnit(1, from, to);
    expect(r.ok).toBe(false);
    expect(r.reason).toBeTruthy();
  });
});
