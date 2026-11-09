import { allocateProRata } from '../revenue-allocation.util';

const sum = (values: number[]) => Math.round(values.reduce((a, b) => a + b, 0) * 100) / 100;

describe('allocateProRata', () => {
  it('แบ่งตามสัดส่วนของตุ้มน้ำหนัก', () => {
    expect(allocateProRata(100, [1, 3])).toEqual([25, 75]);
  });

  it('ไม่ทำเงินหายเมื่อสัดส่วนหารไม่ลงตัว', () => {
    // 10 บาทหารสามทางเท่า ๆ กัน = 3.33 × 3 = 9.99 ถ้าปัดแยกกัน — 1 สตางค์ที่หาย
    // ทุกใบคือยอดที่กระทบไม่มีวันตรง เศษต้องถูกยกให้บรรทัดใดบรรทัดหนึ่ง
    const parts = allocateProRata(10, [1, 1, 1]);
    expect(sum(parts)).toBe(10);
    expect(parts).toEqual([3.34, 3.33, 3.33]);
  });

  it('ยกเศษให้บรรทัดที่ตุ้มน้ำหนักมากที่สุด (ผิดเป็นเปอร์เซ็นต์น้อยที่สุด)', () => {
    const parts = allocateProRata(10, [1, 98, 1]);
    expect(sum(parts)).toBe(10);
    expect(parts[1]).toBeGreaterThan(parts[0]);
    expect(parts[1]).toBeGreaterThan(parts[2]);
  });

  it('ให้ผลเดิมทุกครั้งเมื่อตุ้มน้ำหนักเท่ากัน (idempotency ของสมุดต้องพึ่งได้)', () => {
    const first = allocateProRata(10, [5, 5, 5]);
    const second = allocateProRata(10, [5, 5, 5]);
    expect(first).toEqual(second);
    expect(sum(first)).toBe(10);
  });

  it('ยอดศูนย์ได้ศูนย์ทุกบรรทัด', () => {
    expect(allocateProRata(0, [10, 20])).toEqual([0, 0]);
  });

  it('ตุ้มน้ำหนักศูนย์หมดแต่ยังมีเงิน — กองไว้บรรทัดแรก ไม่ทำเงินหาย', () => {
    expect(allocateProRata(57, [0, 0])).toEqual([57, 0]);
  });

  it('ไม่มีบรรทัดให้แบ่ง', () => {
    expect(allocateProRata(100, [])).toEqual([]);
  });

  it('ปฏิเสธตุ้มน้ำหนักติดลบแทนที่จะแบ่งเงินย้อนทาง', () => {
    expect(() => allocateProRata(100, [5, -1])).toThrow(/ติดลบ/);
  });

  it('ผลรวมตรงเป๊ะทุกกรณีบนชุดตัวเลขจริงของบิลร้านอาหาร', () => {
    const cases: [number, number[]][] = [
      [37.45, [120, 300, 55]],
      [0.01, [1, 1, 1, 1]],
      [999.99, [333.33, 333.33, 333.34]],
      [7, [100]],
      [12.34, [0, 500, 0.01]],
    ];
    for (const [amount, weights] of cases) {
      expect(sum(allocateProRata(amount, weights))).toBe(Math.round(amount * 100) / 100);
    }
  });
});
