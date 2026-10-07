import { isVisibleOnChannel, parseChannels } from '../warehouse-channel';

describe('warehouse channel visibility', () => {
  it('ungrouped warehouses stay visible everywhere (legacy behaviour)', () => {
    expect(isVisibleOnChannel(null, 'POS')).toBe(true);
    expect(isVisibleOnChannel(undefined, 'POS')).toBe(true);
  });

  it('an inactive group does not hide its warehouses', () => {
    expect(isVisibleOnChannel({ channels: [], isActive: false }, 'POS')).toBe(true);
  });

  it('an active group shows its warehouses only on the channels it lists', () => {
    expect(isVisibleOnChannel({ channels: ['POS'], isActive: true }, 'POS')).toBe(true);
    expect(isVisibleOnChannel({ channels: [], isActive: true }, 'POS')).toBe(false);
  });

  it('ignores unknown / malformed channel JSON', () => {
    expect(parseChannels(['POS', 'FOO', 1])).toEqual(['POS']);
    expect(parseChannels('POS')).toEqual([]);
    expect(isVisibleOnChannel({ channels: null, isActive: true }, 'POS')).toBe(false);
  });
});
