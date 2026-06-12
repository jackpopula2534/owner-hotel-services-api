import {
  calcAddonTotal,
  calcLodgingTotal,
  countNights,
  countWeekendNights,
  findSeasonForDate,
  rateForNight,
  type SeasonalRate,
} from './camp-pricing';

// อ้างอิงวัน: 2026-06-12 = ศุกร์, 13 = เสาร์, 14 = อาทิตย์, 15 = จันทร์
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe('camp-pricing', () => {
  describe('countNights', () => {
    it('นับจำนวนคืนถูกต้อง', () => {
      expect(countNights(d('2026-06-12'), d('2026-06-15'))).toBe(3);
    });

    it('ขั้นต่ำ 1 คืนเสมอ (เช็คอิน=เช็คเอาท์)', () => {
      expect(countNights(d('2026-06-12'), d('2026-06-12'))).toBe(1);
    });
  });

  describe('countWeekendNights', () => {
    it('คืนศุกร์และเสาร์นับเป็น weekend', () => {
      // ศุกร์(12)→จันทร์(15): คืน 12(ศ), 13(ส), 14(อา) = weekend 2 คืน
      expect(countWeekendNights(d('2026-06-12'), d('2026-06-15'))).toBe(2);
    });

    it('กลางสัปดาห์ไม่มี weekend', () => {
      // จันทร์(15)→พุธ(17): คืน 15(จ), 16(อ) = 0
      expect(countWeekendNights(d('2026-06-15'), d('2026-06-17'))).toBe(0);
    });
  });

  describe('calcLodgingTotal', () => {
    it('ไม่มี weekendPrice → ใช้ basePrice ทุกคืน', () => {
      // 3 คืน * 800
      expect(calcLodgingTotal(800, null, d('2026-06-12'), d('2026-06-15'))).toBe(2400);
    });

    it('มี weekendPrice → คิดแยก weekend/weekday', () => {
      // 12→15: 2 คืน weekend (1200) + 1 คืน weekday (800) = 2400 + 800 = 3200
      expect(calcLodgingTotal(800, 1200, d('2026-06-12'), d('2026-06-15'))).toBe(3200);
    });

    it('weekendPrice = 0 ถือว่าไม่ตั้ง → ใช้ basePrice', () => {
      expect(calcLodgingTotal(800, 0, d('2026-06-12'), d('2026-06-15'))).toBe(2400);
    });
  });

  describe('season pricing', () => {
    const songkran: SeasonalRate[] = [
      { name: 'สงกรานต์', start: '2026-04-13', end: '2026-04-15', price: 2000 },
    ];

    it('findSeasonForDate เจอช่วงที่ครอบคลุม (รวมวันสุดท้าย)', () => {
      expect(findSeasonForDate(d('2026-04-13'), songkran)?.price).toBe(2000);
      expect(findSeasonForDate(d('2026-04-15'), songkran)?.price).toBe(2000);
      expect(findSeasonForDate(d('2026-04-16'), songkran)).toBeNull();
    });

    it('rateForNight: season ชนะ weekend และ base', () => {
      // 2026-04-13 = จันทร์ แต่เป็น season → 2000
      expect(rateForNight(d('2026-04-13'), 800, 1200, songkran)).toBe(2000);
    });

    it('rateForNight: นอก season → ใช้ weekend/base ตามปกติ', () => {
      // 2026-06-12 ศุกร์ → weekend 1200
      expect(rateForNight(d('2026-06-12'), 800, 1200, songkran)).toBe(1200);
      // 2026-06-15 จันทร์ → base 800
      expect(rateForNight(d('2026-06-15'), 800, 1200, songkran)).toBe(800);
    });

    it('calcLodgingTotal: คืนในช่วงสงกรานต์คิดราคา season', () => {
      // 13→16 เม.ย.: 3 คืน (13,14,15) ทั้งหมด season = 3 * 2000 = 6000
      expect(calcLodgingTotal(800, 1200, d('2026-04-13'), d('2026-04-16'), songkran)).toBe(6000);
    });

    it('calcLodgingTotal: ผสม season + weekday', () => {
      // 15→17 เม.ย.: คืน 15(season 2000) + 16(พฤ. base 800) = 2800
      expect(calcLodgingTotal(800, 1200, d('2026-04-15'), d('2026-04-17'), songkran)).toBe(2800);
    });

    it('calcLodgingTotal: ไม่มี season → เหมือนเดิม', () => {
      expect(calcLodgingTotal(800, null, d('2026-06-15'), d('2026-06-17'), [])).toBe(1600);
    });
  });

  describe('calcAddonTotal', () => {
    it('รวม qty * priceSnapshot', () => {
      expect(
        calcAddonTotal([
          { qty: 2, priceSnapshot: 300 },
          { qty: 1, priceSnapshot: 150 },
        ]),
      ).toBe(750);
    });

    it('ไม่มี item → 0', () => {
      expect(calcAddonTotal([])).toBe(0);
    });
  });
});
