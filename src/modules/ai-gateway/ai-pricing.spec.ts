import { aiLocalDate, aiPeriodRange, computeAiCostUsd, currentAiPeriod, isPricingSet } from './ai-pricing';

describe('ai-pricing', () => {
  describe('computeAiCostUsd', () => {
    it('คิดต้นทุนจาก token ต่อล้าน + ต่อหน่วย', () => {
      const cost = computeAiCostUsd(
        { model: 'm', inputPer1M: 0.25, outputPer1M: 2, perUnit: 0.01 },
        { inputTokens: 2000, outputTokens: 500, units: 3 },
      );
      // 0.0005 + 0.001 + 0.03
      expect(cost).toBe(0.0315);
    });

    it('ราคา/ปริมาณที่ไม่ได้ตั้ง ติดลบ หรือ NaN นับเป็น 0', () => {
      expect(computeAiCostUsd(undefined, { inputTokens: 1000 })).toBe(0);
      expect(computeAiCostUsd({ model: 'm', inputPer1M: -1 }, { inputTokens: 1_000_000 })).toBe(0);
      expect(computeAiCostUsd({ model: 'm', perUnit: 1 }, { units: Number.NaN })).toBe(0);
      expect(computeAiCostUsd({ model: 'm', perUnit: 1 }, { units: null })).toBe(0);
    });

    it('ปัด 6 ตำแหน่ง', () => {
      expect(computeAiCostUsd({ model: 'm', inputPer1M: 0.1 }, { inputTokens: 1 })).toBe(0);
      expect(computeAiCostUsd({ model: 'm', inputPer1M: 1 }, { inputTokens: 1 })).toBe(0.000001);
    });
  });

  it('isPricingSet', () => {
    expect(isPricingSet(undefined)).toBe(false);
    expect(isPricingSet({ model: 'm', inputPer1M: 0, outputPer1M: 0 })).toBe(false);
    expect(isPricingSet({ model: 'm', perUnit: 0.005 })).toBe(true);
  });

  describe('period (เวลาไทย)', () => {
    it('currentAiPeriod ข้ามเดือนตามเวลาไทย', () => {
      expect(currentAiPeriod(new Date('2026-10-31T16:59:59Z'))).toBe('2026-10');
      expect(currentAiPeriod(new Date('2026-10-31T17:00:00Z'))).toBe('2026-11');
      expect(currentAiPeriod(new Date('2026-12-31T17:00:00Z'))).toBe('2027-01');
    });

    it('aiPeriodRange คืน [start,end) เป็น UTC', () => {
      const { start, end } = aiPeriodRange('2026-10');
      expect(start.toISOString()).toBe('2026-09-30T17:00:00.000Z');
      expect(end.toISOString()).toBe('2026-10-31T17:00:00.000Z');
      expect(aiPeriodRange('2026-12').end.toISOString()).toBe('2026-12-31T17:00:00.000Z');
    });

    it('aiPeriodRange ปฏิเสธรูปแบบผิด', () => {
      expect(() => aiPeriodRange('2026-13')).toThrow();
      expect(() => aiPeriodRange('2026-1')).toThrow();
      expect(() => aiPeriodRange('abc')).toThrow();
    });

    it('aiLocalDate', () => {
      expect(aiLocalDate(new Date('2026-10-18T17:30:00Z'))).toBe('2026-10-19');
    });
  });
});
