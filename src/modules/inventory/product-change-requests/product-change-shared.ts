import { BadRequestException } from '@nestjs/common';
import {
  Prisma,
  ProductChangeLevel,
  ProductChangeRequest,
  ProductChangeRequestEvent,
  ProductChangeRequestStatus,
} from '@prisma/client';
import {
  ChangeRequestActor,
  REQUESTER_ROLES,
  REVIEWER_ROLES,
  SELF_REVIEW_ROLES,
  DIRECT_EDIT_ROLES,
} from './product-change-access';
import { FieldChange, ProcurementFieldKey, isProcurementFieldKey } from './product-change-fields';
import type { DuplicateCandidate, StockImpact } from './product-change-apply.service';
import type { ProcurementChangesDto } from './dto/create-product-request.dto';

/** SLA ฝั่งคลัง — เกินนี้ถือว่าค้าง */
export const REVIEW_SLA_HOURS = 24;

export const OPEN_STATUSES: readonly ProductChangeRequestStatus[] = ['PENDING', 'NEEDS_INFO'];

export const ITEM_BRIEF = {
  select: {
    id: true,
    sku: true,
    name: true,
    unit: true,
    isActive: true,
    category: { select: { id: true, name: true } },
  },
} as const;

export interface RequestPermissions {
  canReview: boolean;
  canCancel: boolean;
  canResubmit: boolean;
}

export interface ProductRequestRow {
  id: string;
  requestNumber: string;
  type: ProductChangeRequest['type'];
  status: ProductChangeRequestStatus;
  level: ProductChangeLevel;
  displayName: string;
  item: { id: string; sku: string; name: string } | null;
  changeSummary: string[];
  changeCount: number;
  requestedById: string;
  requestedByName: string | null;
  reviewedByName: string | null;
  createdAt: Date;
  reviewedAt: Date | null;
  effectiveDate: Date | null;
  appliedAt: Date | null;
  isOverdue: boolean;
  stock: { onHand: number; openPoCount: number } | null;
}

export interface ProductRequestDetail extends Omit<ProductChangeRequest, 'changes'> {
  changes: FieldChange[];
  displayName: string;
  item: Prisma.InventoryItemGetPayload<typeof ITEM_BRIEF> | null;
  events: ProductChangeRequestEvent[];
  impact: StockImpact | null;
  duplicates: DuplicateCandidate[];
  suggestedSku: string | null;
  supplierNames: Record<string, string>;
  categoryNames: Record<string, string>;
  isOverdue: boolean;
  permissions: RequestPermissions;
}

export interface ProductRequestSummary {
  pending: number;
  needsInfo: number;
  pendingCreate: number;
  pendingUpdate: number;
  pendingApproval: number;
  pendingAcknowledge: number;
  overdue: number;
  done: number;
  rejected: number;
}

export const asJson = (v: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;

export function isOpen(status: ProductChangeRequestStatus): boolean {
  return OPEN_STATUSES.includes(status);
}

/** ตัด key ที่เป็น undefined ทิ้ง — key ที่ไม่ได้ส่งมา = "ไม่แตะ" */
export function definedEntries(
  changes: ProcurementChangesDto,
): Partial<Record<ProcurementFieldKey, unknown>> {
  return Object.fromEntries(
    Object.entries(changes).filter(([k, v]) => v !== undefined && isProcurementFieldKey(k)),
  ) as Partial<Record<ProcurementFieldKey, unknown>>;
}

export function readChanges(raw: Prisma.JsonValue | null): FieldChange[] {
  return Array.isArray(raw) ? (raw as unknown as FieldChange[]) : [];
}

export function displayNameOf(
  req: Pick<ProductChangeRequest, 'proposed'>,
  item: { name: string } | null,
): string {
  if (item) return item.name;
  const proposed = req.proposed as { name?: unknown } | null;
  return typeof proposed?.name === 'string' ? proposed.name : '—';
}

export function isOverdue(
  request: Pick<ProductChangeRequest, 'status' | 'createdAt'>,
  now: number = Date.now(),
): boolean {
  return (
    request.status === 'PENDING' && now - request.createdAt.getTime() > REVIEW_SLA_HOURS * 3600_000
  );
}

/**
 * สิทธิ์ของผู้ใช้คนนี้ต่อคำขอนี้ — frontend ใช้ซ่อน/แสดงปุ่ม, backend ใช้บังคับจริง
 * ผู้ส่งคำขออนุมัติคำขอตัวเองไม่ได้ ยกเว้นเจ้าของ/ผู้ดูแลระบบ (โรงแรมเล็กที่ทำทุกอย่างเอง) — GM ไม่ยกเว้น
 */
export function permissionsFor(
  actor: ChangeRequestActor,
  request: Pick<ProductChangeRequest, 'status' | 'requestedById'>,
): RequestPermissions {
  const isRequester = request.requestedById === actor.userId;
  const canSelfReview = SELF_REVIEW_ROLES.has(actor.role);
  const isOwnerAdmin = DIRECT_EDIT_ROLES.has(actor.role);
  const open = isOpen(request.status);
  return {
    canReview: REVIEWER_ROLES.has(actor.role) && open && (!isRequester || canSelfReview),
    canCancel: open && (isRequester || (isOwnerAdmin && REQUESTER_ROLES.has(actor.role))),
    canResubmit: request.status === 'NEEDS_INFO' && (isRequester || isOwnerAdmin),
  };
}

/** ตัดสินรายฟิลด์ — ไม่ส่ง approvedFields = ผ่านทั้งหมด */
export function decideFields(
  changes: readonly FieldChange[],
  approvedFields?: readonly ProcurementFieldKey[],
): FieldChange[] {
  if (changes.length === 0) throw new BadRequestException('คำขอนี้ไม่มีฟิลด์ที่เปลี่ยน');
  const approved = new Set<string>(approvedFields ?? changes.map((c) => c.field));
  const unknown = [...approved].filter((f) => !changes.some((c) => c.field === f));
  if (unknown.length > 0) {
    throw new BadRequestException(`ฟิลด์ ${unknown.join(', ')} ไม่ได้อยู่ในคำขอนี้`);
  }
  if (approved.size === 0) {
    throw new BadRequestException(
      'ต้องให้ผ่านอย่างน้อย 1 ฟิลด์ — ถ้าไม่ผ่านทั้งหมดให้ใช้ "ปฏิเสธ"',
    );
  }
  return changes.map((c) => ({
    ...c,
    decision: approved.has(c.field) ? ('APPROVED' as const) : ('REJECTED' as const),
  }));
}
