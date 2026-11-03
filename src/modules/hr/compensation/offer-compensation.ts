import { Compensation } from './compensation.core';

const num = (v: unknown): number => (v === null || v === undefined || v === '' ? 0 : Number(v));
const orElse = (v: unknown, fallback: number): number =>
  v === null || v === undefined || v === '' ? fallback : Number(v);

/**
 * ค่าตอบแทน 2 ชุดจากข้อเสนอจ้าง: ช่วงทดลองงาน และหลังผ่านทดลองงาน (ช่องหลังผ่านที่ว่าง = เท่าช่วงทดลองงาน)
 */
export function offerCompensation(hire: {
  offeredSalary?: unknown;
  probationPositionBonus?: unknown;
  probationAllowance?: unknown;
  postProbationSalary?: unknown;
  postProbationPositionBonus?: unknown;
  postProbationAllowance?: unknown;
}): { probation: Compensation; post: Compensation } {
  const probation: Compensation = {
    baseSalary: num(hire.offeredSalary),
    positionBonus: num(hire.probationPositionBonus),
    allowance: num(hire.probationAllowance),
  };
  return {
    probation,
    post: {
      baseSalary: orElse(hire.postProbationSalary, probation.baseSalary),
      positionBonus: orElse(hire.postProbationPositionBonus, probation.positionBonus),
      allowance: orElse(hire.postProbationAllowance, probation.allowance),
    },
  };
}
