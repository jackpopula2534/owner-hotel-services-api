import { ForbiddenException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';

/**
 * ใครอนุมัติเอกสารคลัง/จัดซื้อได้ (PR, PO, ตรวจนับสต็อก)
 *
 * ก่อนหน้านี้ endpoint approve เช็คแค่ login + add-on → buyer/receiver ยิง API อนุมัติ PO
 * ของตัวเองได้ ตอนนี้ server เป็นคนตัดสิน ส่วน UI แค่ซ่อนปุ่มตามผลเดียวกัน
 *
 * เช็คแบบ exact match (ไม่ใช้ลำดับขั้นของ RolesGuard) เหมือน product-change-access
 */
export const APPROVAL_OWNER_ROLES: ReadonlySet<string> = new Set([
  'platform_admin',
  'admin',
  'tenant_admin',
  'owner',
  'manager',
]);

/**
 * อนุมัติเอกสารที่ตัวเองสร้างได้ — เฉพาะเจ้าของกิจการ/แอดมิน (โรงแรมเล็กที่เจ้าของทำเองทุกขั้น)
 * `manager` (GM) อนุมัติของคนอื่นได้ แต่ของตัวเองต้องให้เจ้าของอนุมัติ — แยกอำนาจผู้ขอกับผู้อนุมัติ
 */
export const SELF_APPROVE_ROLES: ReadonlySet<string> = new Set([
  'platform_admin',
  'admin',
  'tenant_admin',
  'owner',
]);

/** หัวหน้าจัดซื้อมีทุกสิทธิ์ของระบบจัดซื้อ (ตรงกับ hasPermission ฝั่ง frontend) */
const PROCUREMENT_SUPER_ROLE = 'procurement_manager';

/** ตรวจนับเป็นงานฝั่งคลัง — ผู้จัดการคลังอนุมัติแล้วปรับยอดสต็อก */
export const STOCK_COUNT_APPROVER_ROLES: ReadonlySet<string> = new Set([
  ...APPROVAL_OWNER_ROLES,
  'warehouse_manager',
]);

export type ProcurementApprovePermission = 'pr.approve' | 'po.approve';

export interface ApprovalActor {
  userId: string;
  tenantId: string;
  role: string;
}

const DOC_LABEL: Record<ProcurementApprovePermission, string> = {
  'pr.approve': 'ใบขอซื้อ (PR)',
  'po.approve': 'ใบสั่งซื้อ (PO)',
};

function assertTenant(actor: ApprovalActor): void {
  if (!actor.tenantId) {
    throw new ForbiddenException('No active tenant');
  }
}

function parsePermissions(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * มีสิทธิ์อนุมัติเอกสารจัดซื้อชนิดนี้ไหม (ยังไม่สนว่าใครเป็นคนสร้าง)
 * สิทธิ์รายคนอ่านสดจาก users.procurementPermissions — ถอนสิทธิ์แล้วมีผลทันที ไม่ต้องรอ token หมด
 */
export async function hasProcurementApproval(
  prisma: PrismaService,
  actor: ApprovalActor,
  permission: ProcurementApprovePermission,
): Promise<boolean> {
  if (APPROVAL_OWNER_ROLES.has(actor.role) || actor.role === PROCUREMENT_SUPER_ROLE) {
    return true;
  }
  const user = await prisma.user.findFirst({
    where: { id: actor.userId, tenantId: actor.tenantId },
    select: { procurementPermissions: true },
  });
  return parsePermissions(user?.procurementPermissions).includes(permission);
}

/**
 * อนุมัติ PR/PO: ต้องมีสิทธิ์ และห้ามอนุมัติเอกสารที่ตัวเองสร้าง
 * (ยกเว้น SELF_APPROVE_ROLES)
 */
export async function assertCanApproveProcurement(
  prisma: PrismaService,
  actor: ApprovalActor,
  permission: ProcurementApprovePermission,
  requestedBy: string,
): Promise<void> {
  assertTenant(actor);
  if (!(await hasProcurementApproval(prisma, actor, permission))) {
    throw new ForbiddenException(`บทบาท ${actor.role} ไม่มีสิทธิ์อนุมัติ${DOC_LABEL[permission]}`);
  }
  if (requestedBy === actor.userId && !SELF_APPROVE_ROLES.has(actor.role)) {
    throw new ForbiddenException(`ห้ามอนุมัติ${DOC_LABEL[permission]}ที่ตัวเองสร้าง`);
  }
}

/**
 * ยกเลิก/ไม่อนุมัติ PR/PO: ผู้สร้างยกเลิกของตัวเองได้เสมอ
 * คนอื่นต้องมีสิทธิ์อนุมัติเอกสารชนิดนั้น (การปฏิเสธคือการตัดสินแทนผู้อนุมัติ)
 */
export async function assertCanCancelProcurement(
  prisma: PrismaService,
  actor: ApprovalActor,
  permission: ProcurementApprovePermission,
  requestedBy: string,
): Promise<void> {
  assertTenant(actor);
  if (requestedBy === actor.userId) return;
  if (!(await hasProcurementApproval(prisma, actor, permission))) {
    throw new ForbiddenException(
      `ยกเลิก${DOC_LABEL[permission]}ของคนอื่นได้เฉพาะผู้มีสิทธิ์อนุมัติเท่านั้น`,
    );
  }
}

export function assertCanApproveStockCount(actor: ApprovalActor): void {
  assertTenant(actor);
  if (!STOCK_COUNT_APPROVER_ROLES.has(actor.role)) {
    throw new ForbiddenException(`บทบาท ${actor.role} ไม่มีสิทธิ์อนุมัติผลตรวจนับสต็อก`);
  }
}
