import { createdAtRange } from '../created-at-range';

describe('createdAtRange', () => {
  it('ไม่มีวันที่ → ไม่กรอง', () => {
    expect(createdAtRange()).toBeUndefined();
  });

  it('มีทั้งวันเริ่มและวันสิ้นสุด → เก็บไว้ทั้งคู่ (เดิม endDate ทับ startDate)', () => {
    const f = createdAtRange('2026-11-01', '2026-11-02');
    expect(f?.gte).toEqual(new Date('2026-10-31T17:00:00.000Z'));
    expect(f?.lt).toEqual(new Date('2026-11-02T17:00:00.000Z'));
  });

  it('วันสิ้นสุดรวมเอกสารตลอดวันตามเวลาไทย', () => {
    const f = createdAtRange(undefined, '2026-11-02');
    const createdAt = new Date('2026-11-02T06:41:20.893Z'); // 13:41 น. วันที่ 2
    expect(f?.gte).toBeUndefined();
    expect(createdAt < (f?.lt as Date)).toBe(true);
  });

  it('ค่าแบบ ISO เต็มใช้ตามที่ส่งมา', () => {
    const f = createdAtRange('2026-11-01T00:00:00.000Z', '2026-11-02T12:00:00.000Z');
    expect(f).toEqual({
      gte: new Date('2026-11-01T00:00:00.000Z'),
      lte: new Date('2026-11-02T12:00:00.000Z'),
    });
  });
});
