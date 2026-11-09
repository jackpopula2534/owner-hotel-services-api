import { computeTimeFees } from './time-fees';

const property = {
  standardCheckInTime: '14:00',
  standardCheckOutTime: '12:00',
  earlyCheckInEnabled: true,
  lateCheckOutEnabled: true,
  earlyCheckInFeeType: 'fixed',
  earlyCheckInFeeAmount: '300.00',
  lateCheckOutFeeType: 'percentage',
  lateCheckOutFeeAmount: 50,
};
const nights = { firstNightRate: 1500, lastNightRate: 1900 };

describe('computeTimeFees', () => {
  it('charges nothing at the standard times', () => {
    expect(computeTimeFees(property, { checkInTime: '14:00', checkOutTime: '12:00' }, nights)).toEqual({ total: 0 });
  });

  it('charges a fixed early fee and a percentage of the last night for late check-out', () => {
    const fees = computeTimeFees(property, { checkInTime: '10:00', checkOutTime: '16:00' }, nights);
    expect(fees.earlyCheckIn).toMatchObject({ feeType: 'fixed', rate: 300, amount: 300 });
    expect(fees.lateCheckOut).toMatchObject({ feeType: 'percentage', rate: 50, amount: 950 });
    expect(fees.total).toBe(1250);
  });

  it('charges nothing when the property has the option turned off', () => {
    const fees = computeTimeFees(
      { ...property, earlyCheckInEnabled: false, lateCheckOutEnabled: false },
      { checkInTime: '08:00', checkOutTime: '18:00' },
      nights,
    );
    expect(fees.total).toBe(0);
  });

  it('ignores malformed times and caps percentages at 100', () => {
    expect(computeTimeFees(property, { checkInTime: '9:00', checkOutTime: 'late' }, nights).total).toBe(0);
    const fees = computeTimeFees(
      { ...property, lateCheckOutFeeAmount: 250 },
      { checkOutTime: '20:00' },
      nights,
    );
    expect(fees.lateCheckOut?.amount).toBe(1900);
  });
});
