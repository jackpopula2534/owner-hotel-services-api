import {
  MENU_CATEGORY_MOCKUPS,
  sampleMenuCategoryMockups,
  shuffleAndSlice,
} from './menu-category-mockups';

describe('menu-category-mockups', () => {
  describe('shuffleAndSlice', () => {
    it('returns at most `count` items even when source is larger', () => {
      const source = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const result = shuffleAndSlice(source, 5, () => 0.5);
      expect(result).toHaveLength(5);
    });

    it('clamps to source size when count exceeds it', () => {
      const result = shuffleAndSlice([1, 2, 3], 99);
      expect(result).toHaveLength(3);
    });

    it('clamps negative counts to zero', () => {
      expect(shuffleAndSlice([1, 2, 3], -1)).toEqual([]);
    });

    it('produces a permutation (no duplicates)', () => {
      const source = [1, 2, 3, 4, 5];
      const result = shuffleAndSlice(source, 5, Math.random);
      expect(new Set(result).size).toBe(5);
      expect(result.sort()).toEqual([1, 2, 3, 4, 5]);
    });

    it('does not mutate the source array', () => {
      const source = [1, 2, 3];
      const snapshot = source.slice();
      shuffleAndSlice(source, 3, () => 0.99);
      expect(source).toEqual(snapshot);
    });
  });

  describe('sampleMenuCategoryMockups', () => {
    it('returns between 5 and 10 entries when no count is specified', () => {
      const result = sampleMenuCategoryMockups(undefined, () => 0.0);
      expect(result.length).toBeGreaterThanOrEqual(5);
      expect(result.length).toBeLessThanOrEqual(10);
    });

    it('honors a specific in-range count', () => {
      const result = sampleMenuCategoryMockups(7);
      expect(result).toHaveLength(7);
    });

    it('clamps below-range count to 5', () => {
      const result = sampleMenuCategoryMockups(2);
      expect(result).toHaveLength(5);
    });

    it('clamps above-range count to 10', () => {
      const result = sampleMenuCategoryMockups(20);
      expect(result.length).toBe(Math.min(10, MENU_CATEGORY_MOCKUPS.length));
    });

    it('every entry is from the canonical template list', () => {
      const allowed = new Set(MENU_CATEGORY_MOCKUPS.map((m) => m.name));
      const result = sampleMenuCategoryMockups(10);
      result.forEach((mockup) => expect(allowed.has(mockup.name)).toBe(true));
    });

    it('every entry exposes name, description, icon, and color', () => {
      const result = sampleMenuCategoryMockups(8);
      result.forEach((m) => {
        expect(typeof m.name).toBe('string');
        expect(m.name.length).toBeGreaterThan(0);
        expect(typeof m.description).toBe('string');
        expect(typeof m.icon).toBe('string');
        expect(m.color).toMatch(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/);
      });
    });

    it('returns no duplicates within a single sample', () => {
      const result = sampleMenuCategoryMockups(10);
      const names = result.map((m) => m.name);
      expect(new Set(names).size).toBe(names.length);
    });
  });
});
