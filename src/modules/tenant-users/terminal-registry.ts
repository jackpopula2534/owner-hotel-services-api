/**
 * TERMINAL_REGISTRY — แหล่งความจริงฝั่ง backend ว่ามีระบบย่อย (terminal) อะไรบ้าง
 * แต่ละระบบมีบทบาทอะไร สิทธิ์ย่อยอะไร และต้องมี add-on ไหนถึงจะเปิดใช้ได้
 *
 * คู่กับ `SUB_SYSTEMS` ฝั่ง frontend (lib/constants/subSystems.ts) — key ตรงกันตาม
 * docs/design/2026-09-23-tenant-users-api-contract.md
 *
 * บทบาท/สิทธิ์ของแต่ละระบบ **นำเข้า** จาก DTO ของโมดูลเดิม ไม่ได้ก๊อปมาซ้ำ:
 * โมดูลเดิม 6 ตัวยังใช้ค่าชุดเดียวกันนี้ต่อไปจนกว่าจะถูก deprecate (Phase 5)
 * ระบบที่ยังไม่มีโมดูลผู้ใช้ของตัวเอง (camp / retail / crm) นิยามบทบาทขั้นต่ำไว้ที่นี่
 */
import {
  DEFAULT_HOTEL_TERMINAL_PERMISSIONS,
  HOTEL_TERMINAL_ROLES,
} from '../hotel-terminal-users/dto/create-hotel-terminal-user.dto';
import {
  DEFAULT_ACCOUNTING_PERMISSIONS,
  ACCOUNTING_ROLES,
} from '../accounting-users/dto/create-accounting-user.dto';
import {
  DEFAULT_PROCUREMENT_LIMITS,
  DEFAULT_PROCUREMENT_PERMISSIONS,
  PROCUREMENT_ROLES,
} from '../procurement-users/dto/create-procurement-user.dto';
import {
  DEFAULT_WAREHOUSE_PERMISSIONS,
  WAREHOUSE_ROLES,
} from '../warehouse-users/dto/create-warehouse-user.dto';
import {
  DEFAULT_HR_PERMISSIONS,
  HR_ROLES,
} from '../hr-terminal-users/dto/create-hr-terminal-user.dto';
import { POS_ROLES } from '../auth/dto/create-pos-user.dto';

export const TERMINAL_KEYS = [
  'hotel-terminal',
  'camp-terminal',
  'pos',
  'procurement',
  'warehouse',
  'retail',
  'accounting',
  'crm',
  'hr',
] as const;

export type TerminalKey = (typeof TERMINAL_KEYS)[number];
export type ProductLine = 'HOTEL' | 'CAMP';

export interface TerminalRoleOption {
  value: string;
  /** Thai label */
  label: string;
}

export interface PermissionCatalogEntry {
  code: string;
  label: string;
  group: string;
}

export interface TerminalDefinition {
  key: TerminalKey;
  name: string;
  nameTh: string;
  roles: TerminalRoleOption[];
  permissionCatalog: PermissionCatalogEntry[];
  defaultPermissions: Record<string, string[]>;
  /** ค่าเริ่มต้น approvalLimit ต่อบทบาท (เฉพาะ procurement) */
  defaultApprovalLimits?: Record<string, number | null>;
  requiresAddon: string | null;
  productLine: ProductLine | null;
}

// ── Thai labels ─────────────────────────────────────────────────────────────

const ROLE_LABELS_TH: Record<string, string> = {
  // hotel-terminal
  hotel_manager: 'ผู้จัดการโรงแรม',
  front_desk: 'พนักงานต้อนรับ',
  housekeeper: 'แม่บ้าน',
  maintenance: 'ช่างซ่อมบำรุง',
  // camp-terminal
  camp_manager: 'ผู้จัดการลานกางเต็นท์',
  camp_staff: 'พนักงานลานกางเต็นท์',
  // pos
  waiter: 'พนักงานเสิร์ฟ',
  chef: 'เชฟ',
  cashier: 'แคชเชียร์',
  receptionist: 'พนักงานต้อนรับร้าน',
  bartender: 'บาร์เทนเดอร์',
  manager: 'ผู้จัดการร้าน',
  // procurement
  procurement_manager: 'ผู้จัดการจัดซื้อ',
  buyer: 'เจ้าหน้าที่จัดซื้อ',
  approver: 'ผู้อนุมัติ',
  receiver: 'ผู้รับสินค้า',
  // warehouse
  warehouse_manager: 'ผู้จัดการคลังสินค้า',
  inventory_clerk: 'เจ้าหน้าที่คลังสินค้า',
  qc_officer: 'เจ้าหน้าที่ QC',
  // retail
  retail_manager: 'ผู้จัดการร้านค้า',
  retail_cashier: 'แคชเชียร์ร้านค้า',
  // accounting
  chief_accountant: 'หัวหน้าบัญชี',
  accountant: 'นักบัญชี',
  ap_clerk: 'เจ้าหน้าที่เจ้าหนี้ (AP)',
  ar_clerk: 'เจ้าหน้าที่ลูกหนี้ (AR)',
  auditor: 'ผู้ตรวจสอบ',
  // crm
  crm_manager: 'ผู้จัดการ CRM',
  crm_agent: 'เจ้าหน้าที่ CRM',
  // hr
  hr_manager: 'ผู้จัดการฝ่ายบุคคล',
  hr_officer: 'เจ้าหน้าที่ฝ่ายบุคคล',
  payroll_officer: 'เจ้าหน้าที่เงินเดือน',
  recruiter: 'เจ้าหน้าที่สรรหา',
  hr_viewer: 'ผู้ดูข้อมูล HR',
};

/** กลุ่มสิทธิ์ (prefix ก่อนจุด) → ชื่อไทย */
const GROUP_LABELS_TH: Record<string, string> = {
  property: 'ที่พัก',
  rooms: 'ห้องพัก',
  frontdesk: 'ฟร้อนท์',
  bookings: 'การจอง',
  guests: 'ผู้เข้าพัก',
  housekeeping: 'แม่บ้าน',
  maintenance: 'ซ่อมบำรุง',
  camp: 'ลานกางเต็นท์',
  pitch: 'จุดกางเต็นท์',
  reservation: 'การจอง',
  pos: 'POS',
  order: 'ออเดอร์',
  menu: 'เมนู',
  table: 'โต๊ะ',
  kitchen: 'ครัว',
  payment: 'ชำระเงิน',
  pr: 'ใบขอซื้อ (PR)',
  rfq: 'ใบขอราคา (RFQ)',
  quote: 'ใบเสนอราคา',
  po: 'ใบสั่งซื้อ (PO)',
  supplier: 'ผู้ขาย',
  grn: 'รับสินค้า (GRN)',
  'approval-flow': 'สายอนุมัติ',
  item: 'สินค้า',
  warehouse: 'คลังสินค้า',
  gr: 'รับสินค้า (GR)',
  movement: 'เคลื่อนย้ายสต๊อก',
  qc: 'ตรวจคุณภาพ (QC)',
  lot: 'ล็อต',
  stock: 'สต๊อก',
  alert: 'แจ้งเตือน',
  forecast: 'พยากรณ์',
  retail: 'ร้านค้า',
  sale: 'การขาย',
  journal: 'สมุดรายวัน',
  ar: 'ลูกหนี้ (AR)',
  ap: 'เจ้าหนี้ (AP)',
  chart: 'ผังบัญชี',
  asset: 'สินทรัพย์',
  night_audit: 'ปิดยอดประจำวัน',
  contact: 'รายชื่อลูกค้า',
  lead: 'ลูกค้าเป้าหมาย',
  deal: 'ดีล',
  campaign: 'แคมเปญ',
  ticket: 'ตั๋วงาน',
  loyalty: 'สะสมแต้ม',
  employee: 'พนักงาน',
  attendance: 'ลงเวลา',
  leave: 'การลา',
  payroll: 'เงินเดือน',
  kpi: 'KPI',
  evaluation: 'ประเมินผล',
  report: 'รายงาน',
  user: 'ผู้ใช้',
};

const ACTION_LABELS_TH: Record<string, string> = {
  view: 'ดู',
  manage: 'จัดการ',
  create: 'สร้าง',
  approve: 'อนุมัติ',
  compare: 'เปรียบเทียบ',
  inspect: 'ตรวจสอบ',
  count: 'นับ',
  export: 'ส่งออก',
  run: 'ประมวลผล',
  refund: 'คืนเงิน',
  void: 'ยกเลิก',
  close: 'ปิด',
  send: 'ส่ง',
  checkin: 'เช็คอิน',
  checkout: 'เช็คเอาท์',
};

function humanize(token: string): string {
  return token.replace(/[-_]/g, ' ');
}

/** สร้าง label ไทยจาก code เช่น `bookings.manage` → "จัดการการจอง" */
export function permissionLabelTh(code: string): string {
  const [group, action] = code.split('.');
  const g = GROUP_LABELS_TH[group] ?? humanize(group);
  if (!action) return g;
  const a = ACTION_LABELS_TH[action] ?? humanize(action);
  return `${a}${g}`;
}

/**
 * รวบ code ทั้งหมดจาก default permissions ของทุกบทบาทมาเป็น catalog
 * (ใช้กับโมดูลที่ไม่ได้ประกาศ catalog แยก — ทุกโมดูลตอนนี้)
 */
function catalogFromDefaults(defaults: Record<string, string[]>): PermissionCatalogEntry[] {
  const seen = new Set<string>();
  const out: PermissionCatalogEntry[] = [];
  for (const codes of Object.values(defaults)) {
    for (const code of codes) {
      if (seen.has(code)) continue;
      seen.add(code);
      const group = code.split('.')[0];
      out.push({ code, label: permissionLabelTh(code), group: GROUP_LABELS_TH[group] ?? group });
    }
  }
  return out;
}

function rolesOf(values: readonly string[]): TerminalRoleOption[] {
  return values.map((value) => ({ value, label: ROLE_LABELS_TH[value] ?? humanize(value) }));
}

// ── ระบบที่ยังไม่มีโมดูลผู้ใช้ของตัวเอง: บทบาท/สิทธิ์ขั้นต่ำ ─────────────────────

export const CAMP_TERMINAL_ROLES = ['camp_manager', 'camp_staff'] as const;
export const DEFAULT_CAMP_TERMINAL_PERMISSIONS: Record<string, string[]> = {
  camp_manager: [
    'camp.view',
    'camp.manage',
    'pitch.view',
    'pitch.manage',
    'reservation.view',
    'reservation.manage',
    'reservation.checkin',
    'reservation.checkout',
    'report.view',
  ],
  camp_staff: [
    'camp.view',
    'pitch.view',
    'reservation.view',
    'reservation.checkin',
    'reservation.checkout',
  ],
};

export const DEFAULT_POS_PERMISSIONS: Record<string, string[]> = {
  manager: [
    'order.view',
    'order.create',
    'order.void',
    'order.refund',
    'menu.view',
    'menu.manage',
    'table.view',
    'table.manage',
    'kitchen.view',
    'payment.create',
    'payment.refund',
    'report.view',
    'user.manage',
  ],
  waiter: ['order.view', 'order.create', 'table.view', 'menu.view'],
  chef: ['kitchen.view', 'order.view', 'menu.view'],
  cashier: ['order.view', 'payment.create', 'payment.refund', 'report.view'],
  receptionist: ['order.view', 'table.view', 'table.manage', 'menu.view'],
  bartender: ['order.view', 'order.create', 'menu.view'],
  housekeeper: ['order.view'],
  maintenance: ['order.view'],
};

export const RETAIL_ROLES = ['retail_manager', 'retail_cashier'] as const;
export const DEFAULT_RETAIL_PERMISSIONS: Record<string, string[]> = {
  retail_manager: [
    'retail.view',
    'retail.manage',
    'sale.view',
    'sale.create',
    'sale.void',
    'sale.refund',
    'stock.view',
    'report.view',
  ],
  retail_cashier: ['retail.view', 'sale.view', 'sale.create', 'stock.view'],
};

export const CRM_ROLES = ['crm_manager', 'crm_agent'] as const;
export const DEFAULT_CRM_PERMISSIONS: Record<string, string[]> = {
  crm_manager: [
    'contact.view',
    'contact.manage',
    'lead.view',
    'lead.manage',
    'deal.view',
    'deal.manage',
    'campaign.view',
    'campaign.manage',
    'ticket.view',
    'ticket.manage',
    'loyalty.view',
    'loyalty.manage',
    'report.view',
    'report.export',
  ],
  crm_agent: [
    'contact.view',
    'contact.manage',
    'lead.view',
    'lead.manage',
    'deal.view',
    'ticket.view',
    'ticket.manage',
    'loyalty.view',
  ],
};

// ── Registry ────────────────────────────────────────────────────────────────

const define = (
  def: Omit<TerminalDefinition, 'permissionCatalog'> & {
    permissionCatalog?: PermissionCatalogEntry[];
  },
): TerminalDefinition => ({
  ...def,
  permissionCatalog: def.permissionCatalog ?? catalogFromDefaults(def.defaultPermissions),
});

export const TERMINAL_REGISTRY: Readonly<Record<TerminalKey, TerminalDefinition>> = Object.freeze({
  'hotel-terminal': define({
    key: 'hotel-terminal',
    name: 'Hotel Terminal',
    nameTh: 'ระบบจัดการโรงแรม',
    roles: rolesOf(HOTEL_TERMINAL_ROLES),
    defaultPermissions: DEFAULT_HOTEL_TERMINAL_PERMISSIONS,
    requiresAddon: null,
    productLine: 'HOTEL',
  }),
  'camp-terminal': define({
    key: 'camp-terminal',
    name: 'Camp Terminal',
    nameTh: 'ระบบลานกางเต็นท์',
    roles: rolesOf(CAMP_TERMINAL_ROLES),
    defaultPermissions: DEFAULT_CAMP_TERMINAL_PERMISSIONS,
    requiresAddon: null,
    productLine: 'CAMP',
  }),
  pos: define({
    key: 'pos',
    name: 'Restaurant POS',
    nameTh: 'Restaurant POS',
    roles: rolesOf(POS_ROLES),
    defaultPermissions: DEFAULT_POS_PERMISSIONS,
    requiresAddon: 'RESTAURANT_MODULE',
    productLine: null,
  }),
  procurement: define({
    key: 'procurement',
    name: 'Procurement',
    nameTh: 'ระบบจัดซื้อ',
    roles: rolesOf(PROCUREMENT_ROLES),
    defaultPermissions: DEFAULT_PROCUREMENT_PERMISSIONS,
    defaultApprovalLimits: DEFAULT_PROCUREMENT_LIMITS,
    requiresAddon: 'INVENTORY_MODULE',
    productLine: null,
  }),
  warehouse: define({
    key: 'warehouse',
    name: 'Warehouse',
    nameTh: 'ระบบคลังสินค้า',
    roles: rolesOf(WAREHOUSE_ROLES),
    defaultPermissions: DEFAULT_WAREHOUSE_PERMISSIONS,
    requiresAddon: 'INVENTORY_MODULE',
    productLine: null,
  }),
  retail: define({
    key: 'retail',
    name: 'Retail',
    nameTh: 'ระบบร้านค้า',
    roles: rolesOf(RETAIL_ROLES),
    defaultPermissions: DEFAULT_RETAIL_PERMISSIONS,
    requiresAddon: 'INVENTORY_MODULE',
    productLine: null,
  }),
  accounting: define({
    key: 'accounting',
    name: 'Accounting',
    nameTh: 'ระบบบัญชี',
    roles: rolesOf(ACCOUNTING_ROLES),
    defaultPermissions: DEFAULT_ACCOUNTING_PERMISSIONS,
    requiresAddon: 'ACCOUNTING_MODULE',
    productLine: null,
  }),
  crm: define({
    key: 'crm',
    name: 'CRM',
    nameTh: 'ระบบ CRM',
    roles: rolesOf(CRM_ROLES),
    defaultPermissions: DEFAULT_CRM_PERMISSIONS,
    requiresAddon: 'CRM_MODULE',
    productLine: null,
  }),
  hr: define({
    key: 'hr',
    name: 'HR',
    nameTh: 'ระบบ HR',
    roles: rolesOf(HR_ROLES),
    defaultPermissions: DEFAULT_HR_PERMISSIONS,
    requiresAddon: 'HR_MODULE',
    productLine: null,
  }),
});

export function isTerminalKey(value: unknown): value is TerminalKey {
  return typeof value === 'string' && (TERMINAL_KEYS as readonly string[]).includes(value);
}

/** คืน definition ของ terminal หรือ undefined ถ้า key ไม่รู้จัก */
export function getTerminal(key: string): TerminalDefinition | undefined {
  return isTerminalKey(key) ? TERMINAL_REGISTRY[key] : undefined;
}

/** true เมื่อ role อยู่ในรายการบทบาทของ terminal นั้น */
export function isRoleOfTerminal(key: string, role: string): boolean {
  const def = getTerminal(key);
  return !!def && def.roles.some((r) => r.value === role);
}

/** สิทธิ์เริ่มต้นของ role ใน terminal (ว่างถ้าไม่รู้จัก) */
export function defaultPermissionsFor(key: string, role: string): string[] {
  return getTerminal(key)?.defaultPermissions[role] ?? [];
}

/**
 * บทบาท "ผู้ดูแล" ฝั่ง dashboard — คนกลุ่มนี้ห้ามให้ `users.role` ถูกเขียนทับด้วย
 * บทบาทของ terminal เพราะ `@Roles()` กว่า 40 จุดอ่านฟิลด์นี้ (ดู design §7.3)
 */
export const ADMIN_LIKE_ROLES: ReadonlySet<string> = new Set([
  'tenant_admin',
  'manager',
  'MANAGER',
  'admin',
  'platform_admin',
]);

/** เจ้าของ tenant — เข้าได้ทุกระบบ แก้สิทธิ์/ระงับ/ลบผ่าน API นี้ไม่ได้ */
export const OWNER_ROLES: ReadonlySet<string> = new Set(['tenant_admin']);

/**
 * บทบาทระดับหัวหน้าของแต่ละ Terminal — ได้สิทธิ์ `main` (เข้า dashboard หลัก) ด้วย
 * พนักงานหน้างานทั่วไป (เสิร์ฟ / แม่บ้าน / คลัง / เสมียน) เข้าได้เฉพาะ Terminal ของตน
 * ตามนโยบายเดิมของ POS (`POS_ONLY_ROLES`) และจัดซื้อ (เฉพาะ procurement_manager ได้ main)
 */
export const MANAGER_LEVEL_ROLES: ReadonlySet<string> = new Set([
  'hotel_manager',
  'camp_manager',
  'restaurant_manager',
  'procurement_manager',
  'warehouse_manager',
  'retail_manager',
  'chief_accountant',
  'hr_manager',
  'crm_manager',
]);
