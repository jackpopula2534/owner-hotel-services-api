import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import type { ExtraChargeKind } from './dto/reservation.dto';

/**
 * ของที่ใช้ร่วมกันระหว่าง ReservationsService กับ CampOpsService
 * — ค่าใช้จ่ายเพิ่มในบิล (extraCharges) และบันทึกกิจกรรมหน้าลาน (CampOpsEvent)
 */

export interface ExtraCharge {
  id: string;
  label: string;
  amount: number;
  kind: ExtraChargeKind;
  at: string;
  by?: string | null;
}

const KINDS: ExtraChargeKind[] = ['damage', 'extra_guest', 'adjustment', 'other'];
const round2 = (n: number) => Math.round(n * 100) / 100;

/** อ่าน extraCharges (Json จาก DB) อย่างปลอดภัย — แถวที่รูปร่างไม่ถูกทิ้งไป */
export function parseExtraCharges(raw: unknown): ExtraCharge[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((r): ExtraCharge[] => {
    if (!r || typeof r !== 'object') return [];
    const o = r as Record<string, unknown>;
    const amount = Number(o.amount);
    if (!Number.isFinite(amount) || typeof o.label !== 'string') return [];
    const kind = KINDS.includes(o.kind as ExtraChargeKind) ? (o.kind as ExtraChargeKind) : 'other';
    return [
      {
        id: typeof o.id === 'string' ? o.id : randomUUID(),
        label: o.label,
        amount: round2(amount),
        kind,
        at: typeof o.at === 'string' ? o.at : new Date(0).toISOString(),
        by: typeof o.by === 'string' ? o.by : null,
      },
    ];
  });
}

export function extraChargesTotal(list: ExtraCharge[]): number {
  return round2(list.reduce((sum, c) => sum + c.amount, 0));
}

/**
 * ส่วนที่ไม่ใช่ค่าที่พัก — ค่าเสียหาย/อื่น ๆ ลงรายได้ OTHER
 * (คนเกิน/ส่วนลดปรับราคา ถือเป็นส่วนของค่าที่พัก)
 */
export function nonLodgingCharges(list: ExtraCharge[]): number {
  return round2(
    list.filter((c) => c.kind === 'damage' || c.kind === 'other').reduce((s, c) => s + Math.max(0, c.amount), 0),
  );
}

export function newCharge(
  input: { label: string; amount: number; kind?: ExtraChargeKind },
  by?: string | null,
): ExtraCharge {
  return {
    id: randomUUID(),
    label: input.label.trim(),
    amount: round2(input.amount),
    kind: input.kind ?? 'other',
    at: new Date().toISOString(),
    by: by ?? null,
  };
}

export const chargesJson = (list: ExtraCharge[]) =>
  (list.length ? list : Prisma.DbNull) as unknown as Prisma.InputJsonValue;

export type OpsEventType =
  | 'booking'
  | 'check_in'
  | 'check_out'
  | 'cancel'
  | 'payment'
  | 'move'
  | 'extend'
  | 'rentals'
  | 'charge'
  | 'pitch_status'
  | 'facility_status'
  | 'cleaning'
  | 'maintenance'
  | 'note';

type Tx = Prisma.TransactionClient | { campOpsEvent: Prisma.TransactionClient['campOpsEvent'] };

/** บันทึกกิจกรรม — ไม่มี tenantId (บัญชีระบบ) ข้ามเงียบ ๆ เพราะตารางนี้บังคับ tenant */
export async function logOpsEvent(
  tx: Tx,
  e: {
    tenantId?: string | null;
    campgroundId: string;
    type: OpsEventType;
    message: string;
    pitchId?: string | null;
    reservationId?: string | null;
    actorId?: string | null;
    meta?: Record<string, unknown>;
  },
): Promise<void> {
  if (!e.tenantId) return;
  await tx.campOpsEvent.create({
    data: {
      tenantId: e.tenantId,
      campgroundId: e.campgroundId,
      type: e.type,
      message: e.message.slice(0, 500),
      pitchId: e.pitchId ?? null,
      reservationId: e.reservationId ?? null,
      actorId: e.actorId ?? null,
      ...(e.meta ? { meta: e.meta as Prisma.InputJsonValue } : {}),
    },
  });
}

export const baht = (n: number | Prisma.Decimal) =>
  `${Number(n).toLocaleString('th-TH', { maximumFractionDigits: 2 })} บาท`;

export const guestName = (r: { guestFirstName: string; guestLastName?: string | null }) =>
  [r.guestFirstName, r.guestLastName].filter(Boolean).join(' ');
