import { InventoryLotStatus } from '@prisma/client';
import {
  itemNeedsSeedLot,
  planSeedLots,
  type SeedLotItem,
  type ExistingLot,
} from '../seed-lots.seeder';

const tea: SeedLotItem = {
  sku: 'RT-ICED-TEA',
  isPerishable: true,
  requiresLotTracking: false,
  itemType: 'FINISHED_GOOD',
  defaultShelfLifeDays: 365,
};
const keychain: SeedLotItem = {
  ...tea,
  sku: 'GIFT-KEYCHAIN',
  isPerishable: false,
  defaultShelfLifeDays: null,
};
const lot = (o: Partial<ExistingLot>): ExistingLot => ({
  id: 'l',
  lotNumber: 'L',
  remainingQty: 0,
  expiryDate: null,
  status: InventoryLotStatus.ACTIVE,
  ...o,
});

describe('seed lots', () => {
  it('consumables get lots; reusable assets do not', () => {
    expect(itemNeedsSeedLot(tea)).toBe(true);
    expect(itemNeedsSeedLot(keychain)).toBe(true);
    expect(itemNeedsSeedLot({ ...keychain, sku: 'RENT-TENT-4P', itemType: 'FINISHED_GOOD' })).toBe(
      false,
    );
    expect(itemNeedsSeedLot({ ...keychain, sku: 'TOWEL-BATH' })).toBe(false);
  });

  it('no lots yet → two lots (older one expires first) that add up to the stock', () => {
    const plan = planSeedLots(12, tea, []);
    expect(plan.create.map((p) => p.qty)).toEqual([4, 8]);
    expect(plan.create.reduce((s, p) => s + p.qty, 0)).toBe(12);
    expect(plan.create[0].expiresInDays!).toBeLessThan(plan.create[1].expiresInDays!);
  });

  it('non-perishable lots have no expiry; small stock gets a single lot', () => {
    expect(planSeedLots(2, keychain, []).create).toEqual([
      { suffix: 'A', qty: 2, receivedDaysAgo: 3, expiresInDays: null },
    ]);
  });

  it('existing lots short of the stock → top-up lot for the gap only (expired lots still count)', () => {
    const plan = planSeedLots(10, tea, [
      lot({ id: 'a', remainingQty: 4, status: InventoryLotStatus.EXPIRED }),
      lot({ id: 'b', remainingQty: 3 }),
      lot({ id: 'c', remainingQty: 0, status: InventoryLotStatus.EXHAUSTED }),
    ]);
    expect(plan.create).toEqual([expect.objectContaining({ suffix: 'T3', qty: 3 })]);
  });

  it('lots above the stock (re-seed reset the balance) → trim the newest lot first', () => {
    const plan = planSeedLots(5, tea, [
      lot({ id: 'old', remainingQty: 4, expiryDate: new Date('2026-11-10') }),
      lot({ id: 'new', remainingQty: 6, expiryDate: new Date('2027-05-01') }),
    ]);
    expect(plan.reduce).toEqual([
      { id: 'new', remainingQty: 1, status: InventoryLotStatus.ACTIVE },
    ]);
    expect(planSeedLots(10, tea, [lot({ remainingQty: 10 })])).toEqual({ create: [], reduce: [] });
  });
});
