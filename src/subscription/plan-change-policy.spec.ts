import { BadRequestException } from '@nestjs/common';
import { assertPlanChangeAllowed, isTrialPlan, planProductLine } from './plan-change-policy';

const HOTEL_TRIAL = { id: 'p-free', code: 'FREE', system: 'HOTEL' };
const HOTEL_PAID = { id: 'p-pro', code: 'PROFESSIONAL', system: 'HOTEL' };
const HOTEL_STARTER = { id: 'p-starter', code: 'STARTER', system: 'HOTEL' };
const CAMP_TRIAL = { id: 'p-camp-free', code: 'CAMP_FREE', system: 'CAMP' };
const CAMP_PAID = { id: 'p-camp', code: 'CAMP', system: 'CAMP' };

const errorCode = (fn: () => void): string | undefined => {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(BadRequestException);
    return ((err as BadRequestException).getResponse() as { code?: string }).code;
  }
  return undefined;
};

describe('plan-change-policy', () => {
  it('derives the product line from system, falling back to the CAMP code prefix', () => {
    expect(planProductLine(CAMP_PAID)).toBe('CAMP');
    expect(planProductLine({ code: 'CAMP_PLUS', system: null })).toBe('CAMP');
    expect(planProductLine(HOTEL_PAID)).toBe('HOTEL');
    expect(planProductLine({})).toBe('HOTEL');
  });

  it('recognises both free-trial plans', () => {
    expect(isTrialPlan(HOTEL_TRIAL)).toBe(true);
    expect(isTrialPlan(CAMP_TRIAL)).toBe(true);
    expect(isTrialPlan(CAMP_PAID)).toBe(false);
  });

  it('allows a paid change within the same product line', () => {
    expect(() => assertPlanChangeAllowed(HOTEL_TRIAL, HOTEL_PAID)).not.toThrow();
    expect(() => assertPlanChangeAllowed(HOTEL_PAID, HOTEL_STARTER)).not.toThrow();
    expect(() => assertPlanChangeAllowed(CAMP_TRIAL, CAMP_PAID)).not.toThrow();
  });

  it('rejects HOTEL → CAMP and CAMP → HOTEL with CROSS_PRODUCT_LINE', () => {
    expect(errorCode(() => assertPlanChangeAllowed(HOTEL_PAID, CAMP_PAID))).toBe(
      'CROSS_PRODUCT_LINE',
    );
    expect(errorCode(() => assertPlanChangeAllowed(CAMP_TRIAL, HOTEL_PAID))).toBe(
      'CROSS_PRODUCT_LINE',
    );
  });

  it('rejects moving back onto a trial plan with TRIAL_ALREADY_USED', () => {
    expect(errorCode(() => assertPlanChangeAllowed(HOTEL_PAID, HOTEL_TRIAL))).toBe(
      'TRIAL_ALREADY_USED',
    );
  });

  it('treats re-selecting the current trial plan as a no-op, not a second trial', () => {
    expect(() => assertPlanChangeAllowed(HOTEL_TRIAL, HOTEL_TRIAL)).not.toThrow();
  });

  it('lets a platform admin move a tenant across lines (support fix for a wrong sign-up)', () => {
    expect(() =>
      assertPlanChangeAllowed(HOTEL_TRIAL, CAMP_PAID, { isPlatformAdmin: true }),
    ).not.toThrow();
  });
});
