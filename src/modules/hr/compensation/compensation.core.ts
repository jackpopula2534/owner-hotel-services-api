import { businessDateOf, toBangkokDate } from '../../../common/utils/bangkok-day.util';

// ─── ประวัติค่าตอบแทน — logic ล้วน ใช้ได้ทั้งใน service ปกติและใน prisma.$transaction ──

export type CompensationChangeType =
  | 'HIRE'
  | 'PROBATION_PASS'
  | 'MANUAL_ADJUST'
  | 'PROMOTION'
  | 'CORRECTION'
  | 'IMPORT';
export type CompensationSource = 'system' | 'user';
export type CompensationStatus = 'pending' | 'scheduled' | 'applied' | 'cancelled';

export interface Compensation {
  baseSalary: number;
  positionBonus: number;
  allowance: number;
}

/** client ที่ใช้ได้ทั้ง PrismaService และ tx ใน $transaction */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- โมเดลใหม่ยังไม่อยู่ใน client ที่ generate แล้วจนกว่าจะรัน prisma generate
export type Db = any;

const num = (v: unknown): number => (v === null || v === undefined || v === '' ? 0 : Number(v));

export const toCompensation = (row: {
  baseSalary?: unknown;
  positionBonus?: unknown;
  allowance?: unknown;
}): Compensation => ({
  baseSalary: num(row.baseSalary),
  positionBonus: num(row.positionBonus),
  allowance: num(row.allowance),
});

export const sameCompensation = (a: Compensation, b: Compensation): boolean =>
  a.baseSalary === b.baseSalary &&
  a.positionBonus === b.positionBonus &&
  a.allowance === b.allowance;

export const totalOf = (c: Compensation): number => c.baseSalary + c.positionBonus + c.allowance;

/**
 * ต้นรอบเงินเดือนถัดไป = วันแรกของเดือนถัดไปตามเวลาไทย (การตัดสินใจข้อ ข — ไม่คิดแบ่งสัดส่วน)
 * คืนค่าเป็น business date (UTC midnight) สำหรับคอลัมน์ @db.Date
 */
export function nextPayrollCycleStart(at: Date): Date {
  const [y, m] = toBangkokDate(at).split('-').map(Number);
  const next = new Date(Date.UTC(y, m, 1)); // m เป็น 1-based → index m = เดือนถัดไป
  return businessDateOf(next.toISOString().slice(0, 10));
}

/** วันนี้ตามเวลาไทยในรูป business date */
export const todayBusinessDate = (now: Date = new Date()): Date =>
  businessDateOf(toBangkokDate(now));

/**
 * ค่าตอบแทนที่มีผล ณ วันที่ `asOf` — แถวล่าสุดที่ scheduled/applied และ effectiveDate ≤ asOf
 * ไม่มีประวัติเลย → ใช้ค่าปัจจุบันบน Employee (ข้อมูลก่อนมีระบบประวัติ)
 */
export async function resolveCompensationAsOf(
  db: Db,
  tenantId: string,
  employeeId: string,
  asOf: Date,
  fallback?: { baseSalary?: unknown; positionBonus?: unknown; allowance?: unknown },
): Promise<Compensation & { changeId: string | null }> {
  const row = await db.hrCompensationChange.findFirst({
    where: {
      tenantId,
      employeeId,
      status: { in: ['scheduled', 'applied'] },
      effectiveDate: { not: null, lte: asOf },
    },
    orderBy: [{ effectiveDate: 'desc' }, { createdAt: 'desc' }],
  });
  if (row) return { ...toCompensation(row), changeId: row.id };
  if (fallback) return { ...toCompensation(fallback), changeId: null };
  const emp = await db.employee.findFirst({
    where: { id: employeeId, tenantId },
    select: { baseSalary: true, positionBonus: true, allowance: true },
  });
  return { ...toCompensation(emp ?? {}), changeId: null };
}

export interface RecordChangeInput {
  tenantId: string;
  employeeId: string;
  effectiveDate: Date | null;
  compensation: Compensation;
  changeType: CompensationChangeType;
  source: CompensationSource;
  actorUserId?: string | null;
  reason?: string | null;
  refType?: string | null;
  refId?: string | null;
  /** ค่าก่อนปรับ — ไม่ส่ง = อ่านค่าที่มีผล ณ วันที่มีผล (หรือค่าปัจจุบัน) */
  previous?: Compensation | null;
  now?: Date;
}

/**
 * บันทึกการเปลี่ยนค่าตอบแทน 1 แถว
 * - ไม่มีวันที่มีผล → pending (เช่น รอผ่านทดลองงาน)
 * - วันที่มีผล ≤ วันนี้ → applied ทันที + อัปเดตค่าปัจจุบันบน Employee
 * - อนาคต → scheduled (งานรายวันจะ apply ให้เมื่อถึงวัน)
 */
export async function recordCompensationChange(db: Db, input: RecordChangeInput) {
  const now = input.now ?? new Date();
  const today = todayBusinessDate(now);
  const previous =
    input.previous !== undefined
      ? input.previous
      : await resolveCompensationAsOf(
          db,
          input.tenantId,
          input.employeeId,
          input.effectiveDate ?? today,
        );
  const due = input.effectiveDate !== null && input.effectiveDate.getTime() <= today.getTime();
  const status: CompensationStatus =
    input.effectiveDate === null ? 'pending' : due ? 'applied' : 'scheduled';

  const row = await db.hrCompensationChange.create({
    data: {
      tenantId: input.tenantId,
      employeeId: input.employeeId,
      effectiveDate: input.effectiveDate,
      baseSalary: input.compensation.baseSalary,
      positionBonus: input.compensation.positionBonus,
      allowance: input.compensation.allowance,
      previous: previous
        ? {
            baseSalary: previous.baseSalary,
            positionBonus: previous.positionBonus,
            allowance: previous.allowance,
          }
        : null,
      changeType: input.changeType,
      source: input.source,
      actorUserId: input.actorUserId ?? null,
      reason: input.reason ?? null,
      refType: input.refType ?? null,
      refId: input.refId ?? null,
      status,
      appliedAt: status === 'applied' ? now : null,
    },
  });
  if (status === 'applied') await syncEmployeeCurrent(db, input.tenantId, input.employeeId, today);
  return row;
}

/** ตั้งค่าปัจจุบันบน Employee = ค่าที่มีผล ณ วันนี้ (ใช้แสดงผล/ระบบเก่าที่ยังอ่านจาก Employee) */
export async function syncEmployeeCurrent(
  db: Db,
  tenantId: string,
  employeeId: string,
  today: Date,
) {
  const current = await db.hrCompensationChange.findFirst({
    where: {
      tenantId,
      employeeId,
      status: { in: ['scheduled', 'applied'] },
      effectiveDate: { not: null, lte: today },
    },
    orderBy: [{ effectiveDate: 'desc' }, { createdAt: 'desc' }],
  });
  if (!current) return;
  await db.employee.update({
    where: { id: employeeId },
    data: {
      baseSalary: current.baseSalary,
      positionBonus: current.positionBonus,
      allowance: current.allowance,
    },
  });
}

/**
 * ผ่านทดลองงาน → แถว PROBATION_PASS ที่รออยู่ได้วันที่มีผล = ต้นรอบเงินเดือนถัดไป
 * override = HR แก้ตัวเลขตอนตัดสิน (source user + เหตุผล) — ไม่มีแถวรอ แต่มี override → สร้างใหม่
 * คืน null เมื่อไม่มีอะไรต้องปรับ
 */
export async function scheduleProbationPass(
  db: Db,
  args: {
    tenantId: string;
    employeeId: string;
    decidedAt: Date;
    actorUserId: string;
    override?: (Compensation & { reason: string }) | null;
    refId?: string | null;
  },
) {
  const effectiveDate = nextPayrollCycleStart(args.decidedAt);
  const pending = await db.hrCompensationChange.findFirst({
    where: {
      tenantId: args.tenantId,
      employeeId: args.employeeId,
      changeType: 'PROBATION_PASS',
      status: 'pending',
    },
    orderBy: { createdAt: 'desc' },
  });

  if (!pending && !args.override) return null;

  const compensation = args.override
    ? {
        baseSalary: args.override.baseSalary,
        positionBonus: args.override.positionBonus,
        allowance: args.override.allowance,
      }
    : toCompensation(pending);

  if (pending) {
    // แถวที่รออยู่เป็นข้อตกลงตอนเสนอจ้าง — ปิดแถวเดิมแล้วบันทึกแถวที่มีวันที่มีผล (ประวัติไม่ถูกแก้ทับ)
    await db.hrCompensationChange.update({
      where: { id: pending.id },
      data: { status: 'cancelled', cancelledAt: new Date(), cancelledBy: args.actorUserId },
    });
  }
  return recordCompensationChange(db, {
    tenantId: args.tenantId,
    employeeId: args.employeeId,
    effectiveDate,
    compensation,
    changeType: 'PROBATION_PASS',
    source: args.override ? 'user' : 'system',
    actorUserId: args.actorUserId,
    reason: args.override ? args.override.reason : 'ผ่านทดลองงาน — ปรับตามข้อเสนอจ้างอัตโนมัติ',
    refType: 'probation_round',
    refId: args.refId ?? pending?.refId ?? null,
  });
}

/** ไม่ผ่านทดลองงาน → ยกเลิกแถว PROBATION_PASS ที่รออยู่ */
export async function cancelPendingProbationPass(
  db: Db,
  tenantId: string,
  employeeId: string,
  actorUserId: string,
) {
  return db.hrCompensationChange.updateMany({
    where: { tenantId, employeeId, changeType: 'PROBATION_PASS', status: 'pending' },
    data: { status: 'cancelled', cancelledAt: new Date(), cancelledBy: actorUserId },
  });
}
