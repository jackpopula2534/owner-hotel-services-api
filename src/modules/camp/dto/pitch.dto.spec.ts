import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { BatchUpdatePositionsDto, CreatePitchDto } from './pitch.dto';

const errorsOf = <T extends object>(cls: new () => T, body: object): string[] =>
  validateSync(plainToInstance(cls, body)).map((e) => e.property);

describe('pitch DTO — rotation / footprint', () => {
  const base = { campgroundId: 'c', zoneId: 'z', code: 'A1' };

  it('accepts rotation 0..360 and footprint 0.5..100 m', () => {
    expect(errorsOf(CreatePitchDto, { ...base, rotation: 360, widthM: 0.5, depthM: 100 })).toEqual(
      [],
    );
  });

  it.each([
    ['rotation', -1],
    ['rotation', 361],
    ['widthM', 0.4],
    ['depthM', 101],
  ])('rejects %s = %s', (field, value) => {
    expect(errorsOf(CreatePitchDto, { ...base, [field]: value })).toEqual([field]);
  });

  it('validates rotation inside the batch move payload', () => {
    const errors = validateSync(
      plainToInstance(BatchUpdatePositionsDto, {
        campgroundId: 'c',
        pitches: [{ id: 'p1', posX: 0.5, posY: 0.5, rotation: 400 }],
      }),
    );
    expect(errors.map((e) => e.property)).toEqual(['pitches']);
  });
});
