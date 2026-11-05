import { ForbiddenException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { APPROVAL_OWNER_ROLES, SELF_APPROVE_ROLES, type ApprovalActor } from './approval-access';

/**
 * ใครรับสินค้าเข้าคลัง (GR) และตรวจคุณภาพ (QC) ได้
 *
 * แบ่งแยกหน้าที่ (segregation of duties): ฝ่ายจัดซื้อ "สั่ง" ฝ่ายคลัง "รับ"
 * ถ้าคนเดียวทั้งสั่งและรับ จะสร้าง PO แล้วกดรับของที่ไม่ได้มาจริงได้ — บัญชีตั้งเจ้าหนี้/จ่ายตามใบรับ
 * จึงต้องให้ฝั่งคลังเป็นคนยืนยัน ส่วนจัดซื้อดูความคืบหน้าได้อย่างเดียว
 *
 * ข้อยกเว้น: "บันทึกซื้อสด" (ไปซื้อที่ตลาดเอง) มีเส้นทาง/เพดานเงินของตัวเอง ไม่ผ่านกฎนี้
 */

/** ฝั่งคลัง — ผู้รับของ/พนักงานคลังรับเข้าได้ */
const RECEIVE_ROLES: ReadonlySet<string> = new Set([
  ...APPROVAL_OWNER_ROLES,
  'warehouse_manager',
  'inventory_clerk',
  'qc_officer',
  'receiver',
]);

/** ผ่าน/ไม่ผ่าน QC (เขียนสต็อกจริง) — ผู้จัดการคลังกับเจ้าหน้าที่ QC */
const QC_ROLES: ReadonlySet<string> = new Set([
  ...APPROVAL_OWNER_ROLES,
  'warehouse_manager',
  'qc_officer',
  'receiver',
]);

export type ReceivingAction = 'receive' | 'qc';

const PERMISSION: Record<ReceivingAction, string> = { receive: 'grn.create', qc: 'qc.inspect' };
const ACTION_LABEL: Record<ReceivingAction, string> = {
  receive: 'รับสินค้าเข้าคลัง',
  qc: 'ตรวจคุณภาพ / ยืนยันรับเข้า',
};

function parse(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((p): p is string => typeof p === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * มีสิทธิ์งานรับของไหม — ตามบทบาท หรือได้รับสิทธิ์รายคน (grn.create / qc.inspect) ที่ผู้ดูแลมอบให้
 * หัวหน้าจัดซื้อ (procurement_manager) ไม่ได้สิทธิ์นี้โดยอัตโนมัติ
 */
export async function hasReceivingAccess(
  prisma: PrismaService,
  actor: ApprovalActor,
  action: ReceivingAction,
): Promise<boolean> {
  const roles = action === 'qc' ? QC_ROLES : RECEIVE_ROLES;
  if (roles.has(actor.role)) return true;
  const user = await prisma.user.findFirst({
    where: { id: actor.userId, tenantId: actor.tenantId },
    select: { procurementPermissions: true, warehousePermissions: true },
  });
  const granted = [...parse(user?.procurementPermissions), ...parse(user?.warehousePermissions)];
  return granted.includes(PERMISSION[action]);
}

/**
 * ตรวจก่อนรับของ/ผ่าน QC
 * - ต้องมีสิทธิ์งานรับของ
 * - ห้ามรับของของ PO ที่ตัวเองขอซื้อหรืออนุมัติ (เจ้าของ/แอดมินยกเว้น — โรงแรมเล็กที่ทำเองทุกขั้น)
 */
export async function assertCanReceive(
  prisma: PrismaService,
  actor: ApprovalActor,
  action: ReceivingAction,
  purchaseOrderId?: string | null,
): Promise<void> {
  if (!actor.tenantId) throw new ForbiddenException('No active tenant');
  // ระบบจัดซื้อ "ดูและติดตาม" การรับเข้าได้อย่างเดียว — ไม่ว่าบทบาท/สิทธิ์รายคนจะเป็นอะไร
  // (แม้เจ้าของกิจการที่ล็อกอินเข้าระบบจัดซื้อ ก็ต้องไปรับของ/ผ่าน QC ที่ระบบคลัง)
  if (actor.systemContext === 'procurement') {
    throw new ForbiddenException(
      `ระบบจัดซื้อดูและติดตามการรับเข้าได้อย่างเดียว — ${ACTION_LABEL[action]}ทำที่ระบบคลัง`,
    );
  }
  if (!(await hasReceivingAccess(prisma, actor, action))) {
    throw new ForbiddenException(
      `บทบาท ${actor.role} ไม่มีสิทธิ์${ACTION_LABEL[action]} — งานรับของทำที่ระบบคลัง`,
    );
  }
  if (!purchaseOrderId || SELF_APPROVE_ROLES.has(actor.role)) return;
  const po = await prisma.purchaseOrder.findFirst({
    where: { id: purchaseOrderId, tenantId: actor.tenantId },
    select: { requestedBy: true, approvedBy: true, poNumber: true },
  });
  if (po && (po.requestedBy === actor.userId || po.approvedBy === actor.userId)) {
    throw new ForbiddenException(
      `ห้าม${ACTION_LABEL[action]}ของใบสั่งซื้อ ${po.poNumber} ที่ตัวเองขอซื้อหรืออนุมัติ — ให้ผู้รับของคนอื่นยืนยัน`,
    );
  }
}

/** PO ที่ใบรับนี้ผูกอยู่ (ไม่มี = รับไม่อ้าง PO / ซื้อสด) */
export async function purchaseOrderIdOfReceive(
  prisma: PrismaService,
  tenantId: string,
  goodsReceiveId: string | null | undefined,
): Promise<string | null> {
  if (!goodsReceiveId) return null;
  const gr = await prisma.goodsReceive.findFirst({
    where: { id: goodsReceiveId, tenantId },
    select: { purchaseOrderId: true },
  });
  return gr?.purchaseOrderId ?? null;
}
