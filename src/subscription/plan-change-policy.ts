import { BadRequestException } from '@nestjs/common';

/**
 * Business rules for a tenant switching plans by itself (checkout upgrade +
 * self-service change-plan). Platform admins bypass them — moving a tenant
 * that signed up on the wrong product line is a support action done from the
 * admin console.
 *
 *  1. 1 account = 1 product line. HOTEL ↔ CAMP is never a plan change: the
 *     new line's modules replace the old ones and every room/booking (or
 *     pitch/reservation) becomes unreachable. A customer who wants the other
 *     line registers a new account.
 *  2. The free trial is granted once, at registration (onboarding gives every
 *     new tenant FREE / CAMP_FREE). Moving back onto a trial plan later would
 *     be a second trial, so it is rejected.
 */

/** Free-trial plan codes — one per product line, seeded by `seedPlans()`. */
export const TRIAL_PLAN_CODES: ReadonlySet<string> = new Set(['FREE', 'CAMP_FREE']);

export type PlanProductLine = 'HOTEL' | 'CAMP';

interface PlanLike {
  id?: string | null;
  code?: string | null;
  system?: string | null;
}

/** Same rule as the frontend: `system`, falling back to the CAMP code prefix. */
export function planProductLine(plan: PlanLike): PlanProductLine {
  const system = String(plan.system ?? '').toUpperCase();
  const code = String(plan.code ?? '').toUpperCase();
  return system === 'CAMP' || code.startsWith('CAMP') ? 'CAMP' : 'HOTEL';
}

export function isTrialPlan(plan: PlanLike): boolean {
  return TRIAL_PLAN_CODES.has(String(plan.code ?? '').toUpperCase());
}

export function assertPlanChangeAllowed(
  currentPlan: PlanLike,
  newPlan: PlanLike,
  options: { isPlatformAdmin?: boolean } = {},
): void {
  if (options.isPlatformAdmin) return;

  const currentLine = planProductLine(currentPlan);
  const newLine = planProductLine(newPlan);
  if (currentLine !== newLine) {
    // Flat { code, message, details } — the shape AllExceptionsFilter passes through.
    throw new BadRequestException({
      code: 'CROSS_PRODUCT_LINE',
      message:
        newLine === 'CAMP'
          ? 'บัญชีนี้ใช้ระบบโรงแรม ไม่สามารถเปลี่ยนเป็นแพ็กเกจลานกางเต็นท์ได้ — หากต้องการใช้ระบบลานกางเต็นท์ กรุณาสมัครบัญชีใหม่'
          : 'บัญชีนี้ใช้ระบบลานกางเต็นท์ ไม่สามารถเปลี่ยนเป็นแพ็กเกจโรงแรมได้ — หากต้องการใช้ระบบโรงแรม กรุณาสมัครบัญชีใหม่',
      details: { currentLine, requestedLine: newLine },
    });
  }

  const samePlan = !!currentPlan.id && currentPlan.id === newPlan.id;
  if (isTrialPlan(newPlan) && !samePlan) {
    throw new BadRequestException({
      code: 'TRIAL_ALREADY_USED',
      message: 'บัญชีนี้ใช้สิทธิ์ทดลองใช้ฟรีไปแล้ว กรุณาเลือกแพ็กเกจแบบชำระเงิน',
    });
  }
}
