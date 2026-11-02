import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ApprovalAttachment, ApprovalChain, ApproverRole, currentStep } from '../../common/types/approval-chain';

/**
 * ประวัติการอนุมัติของคำขอกำลังพล — append-only
 * approvalChain/budgetChain ถูกสร้างใหม่ทุกครั้งที่ยื่นใหม่ เหตุผลที่ถูกส่งกลับ + ไฟล์แนบจึงต้องเก็บแยกที่นี่
 */
export type ApprovalHistoryStage = 'request' | 'budget';
export type ApprovalHistoryAction =
  | 'submitted'
  | 'resubmitted'
  | 'approved'
  | 'returned'
  | 'rejected'
  | 'cancelled';

export interface ApprovalHistoryEntry {
  id: string;
  stage: ApprovalHistoryStage;
  action: ApprovalHistoryAction;
  /** รอบการยื่นของ stage นั้น (1 = ยื่นครั้งแรก) */
  round: number;
  role: ApproverRole | null;
  level: number | null;
  userId: string;
  note: string | null;
  attachments: ApprovalAttachment[];
  at: string;
}

/** โฟลเดอร์ไฟล์แนบของคำขอ — key ทุกไฟล์ต้องขึ้นต้นด้วย path นี้ */
export function attachmentFolder(tenantId: string, requestId: string): string {
  return `hr-recruitment/${tenantId}/${requestId}`;
}

/**
 * กันแนบไฟล์ของคำขออื่น/tenant อื่น หรือ URL ภายนอก:
 * key ต้องอยู่ในโฟลเดอร์ของคำขอนี้ และ url ต้องชี้ไปที่ key นั้น
 */
export function assertOwnAttachments(
  list: ApprovalAttachment[] | undefined,
  tenantId: string,
  requestId: string,
): ApprovalAttachment[] {
  if (!list?.length) return [];
  const prefix = `${attachmentFolder(tenantId, requestId)}/`;
  return list.map((a) => {
    const valid =
      a.key.startsWith(prefix) &&
      !a.key.includes('..') &&
      a.url.endsWith(`/${a.key}`) &&
      (a.url.startsWith('/uploads/') || /^https?:\/\//.test(a.url));
    if (!valid) throw new BadRequestException(`ไฟล์แนบ "${a.name}" ไม่ใช่ไฟล์ของคำขอนี้`);
    return { name: a.name, url: a.url, key: a.key, size: a.size, mimeType: a.mimeType };
  });
}

export function readHistory(raw: unknown): ApprovalHistoryEntry[] {
  return Array.isArray(raw) ? (raw as ApprovalHistoryEntry[]) : [];
}

/** รอบปัจจุบันของ stage = จำนวนครั้งที่ยื่น */
export function currentRound(history: ApprovalHistoryEntry[], stage: ApprovalHistoryStage): number {
  return history.filter((h) => h.stage === stage && (h.action === 'submitted' || h.action === 'resubmitted')).length;
}

interface EntryInput {
  stage: ApprovalHistoryStage;
  action: ApprovalHistoryAction;
  userId: string;
  note?: string | null;
  attachments?: ApprovalAttachment[];
  /** chain ก่อนตัดสิน — ใช้ระบุ role/level ของขั้นที่ถูกตัดสิน */
  chainBefore?: ApprovalChain | null;
}

export function appendHistory(raw: unknown, input: EntryInput): ApprovalHistoryEntry[] {
  const history = readHistory(raw);
  const step = input.chainBefore ? currentStep(input.chainBefore) : null;
  const isSubmit = input.action === 'submitted' || input.action === 'resubmitted';
  const round = currentRound(history, input.stage) + (isSubmit ? 1 : 0);
  return [
    ...history,
    {
      id: randomUUID(),
      stage: input.stage,
      action: input.action,
      round: Math.max(round, 1),
      role: step?.role ?? null,
      level: step?.level ?? null,
      userId: input.userId,
      note: input.note?.trim() || null,
      attachments: input.attachments ?? [],
      at: new Date().toISOString(),
    },
  ];
}
