import { ADDON_CODES, AddonCode } from '@/modules/addons/addon.service';

/**
 * Integration Hub catalog — the source of truth for which Sub-Systems can be
 * wired together. Each entry is a directed connection (source → target) that
 * produces automated behaviour, gated by the tenant's add-on entitlements.
 *
 * Runtime state (on/off per tenant) lives in the `tenant_integrations` table.
 * When a tenant has never toggled an integration, `defaultEnabled` applies.
 * Every connection ships OFF (`defaultEnabled: false`) — integrations are
 * opt-in: a tenant must explicitly turn each one on in the Integration Hub.
 */
/** Grouping shown on the Integration Hub page — one section per group. */
export interface IntegrationGroup {
  key: string;
  name: string;
  description: string;
  /** Lucide icon name (frontend renders it). */
  icon: string;
}

export const INTEGRATION_GROUPS: IntegrationGroup[] = [
  {
    key: 'inventory',
    name: 'คลังสินค้า & สต๊อก',
    description: 'การตัด/เบิก/โอนสต๊อกอัตโนมัติระหว่างระบบปฏิบัติการกับคลังสินค้า',
    icon: 'Warehouse',
  },
  {
    key: 'accounting',
    name: 'บัญชี & ต้นทุน',
    description: 'ส่งรายการต้นทุนและรายได้เข้าระบบบัญชีต้นทุน (USALI) อัตโนมัติ',
    icon: 'Calculator',
  },
  {
    key: 'crm',
    name: 'CRM & ลูกค้า',
    description: 'ซิงก์ข้อมูลลูกค้าและทริกเกอร์แคมเปญ/Journey จากเหตุการณ์การจอง',
    icon: 'HeartHandshake',
  },
];

export interface IntegrationDef {
  /** Stable key — also the `integrationKey` stored per tenant. */
  key: string;
  name: string;
  description: string;
  /** Section on the Integration Hub page (key into INTEGRATION_GROUPS). */
  group: string;
  /** Which sub-system emits / triggers the connection. */
  source: { key: string; name: string };
  /** Which sub-system reacts to it. */
  target: { key: string; name: string };
  /** All of these add-ons must be active for the connection to be available. */
  requiredAddons: AddonCode[];
  /** Lucide icon name (frontend renders it). */
  icon: string;
  /** Effective value when the tenant has no explicit setting yet (always false — opt-in). */
  defaultEnabled: boolean;
  /** The domain event this connection controls (reference/documentation). */
  event: string;
}

export const INTEGRATIONS: IntegrationDef[] = [
  {
    key: 'restaurant-inventory-autodeduct',
    group: 'inventory',
    name: 'ตัดสต๊อกอัตโนมัติเมื่อขายอาหาร',
    description:
      'เมื่อปิดออเดอร์ร้านอาหาร (เสิร์ฟเสร็จ) ระบบจะตัดวัตถุดิบตามสูตรออกจากคลังครัวให้อัตโนมัติ ' +
      'ทำให้หน้า “สูตร · ทำได้กี่จาน” สะท้อนสต๊อกจริงทันที',
    source: { key: 'restaurant', name: 'ร้านอาหาร / ครัว' },
    target: { key: 'inventory', name: 'คลังสินค้า' },
    requiredAddons: [ADDON_CODES.RESTAURANT_MODULE, ADDON_CODES.INVENTORY_MODULE],
    icon: 'UtensilsCrossed',
    defaultEnabled: false,
    event: 'restaurant.order.completed',
  },
  {
    key: 'restaurant-inventory-requisition',
    group: 'inventory',
    name: 'สร้างใบเบิกวัตถุดิบจากสูตรอาหาร',
    description:
      'คำนวณจากสูตรอาหารว่าต้องเบิกวัตถุดิบตัวไหนกี่หน่วย แล้วสร้างเป็น "ใบเบิก" ที่แก้ไขได้ก่อนส่ง ' +
      'เมื่อกดส่ง ระบบจะโอน/เบิกของจากคลังต้นทางเข้าคลังครัวให้จริงในระบบคลังสินค้า',
    source: { key: 'restaurant', name: 'ร้านอาหาร / ครัว' },
    target: { key: 'inventory', name: 'คลังสินค้า' },
    requiredAddons: [ADDON_CODES.RESTAURANT_MODULE, ADDON_CODES.INVENTORY_MODULE],
    icon: 'ClipboardList',
    defaultEnabled: false,
    event: 'restaurant.requisition.created',
  },
  {
    key: 'housekeeping-inventory-autodeduct',
    group: 'inventory',
    name: 'ตัดของใช้สิ้นเปลืองเมื่อทำความสะอาดห้อง',
    description:
      'เมื่อแม่บ้านปิดงานทำความสะอาด ระบบจะตัดของใช้ (amenities) ตามเทมเพลตประเภทห้องออกจากคลังให้อัตโนมัติ',
    source: { key: 'housekeeping', name: 'แม่บ้าน' },
    target: { key: 'inventory', name: 'คลังสินค้า' },
    requiredAddons: [ADDON_CODES.INVENTORY_MODULE],
    icon: 'Sparkles',
    defaultEnabled: false,
    event: 'housekeeping.task.completed',
  },
  {
    key: 'maintenance-inventory-autodeduct',
    group: 'inventory',
    name: 'ตัดอะไหล่เมื่อปิดงานซ่อมบำรุง',
    description:
      'เมื่อปิดงานซ่อมบำรุงที่มีการเบิกอะไหล่ ระบบจะตัดอะไหล่ที่ใช้ออกจากคลังให้อัตโนมัติ',
    source: { key: 'maintenance', name: 'ซ่อมบำรุง' },
    target: { key: 'inventory', name: 'คลังสินค้า' },
    requiredAddons: [ADDON_CODES.INVENTORY_MODULE],
    icon: 'Wrench',
    defaultEnabled: false,
    event: 'maintenance.task.completed',
  },
  {
    key: 'camp-inventory-requisition',
    group: 'inventory',
    name: 'เบิก/โอนของจากคลังกลางไปลานแคมป์',
    description:
      'เปิดให้ลานแคมป์สร้างใบเบิก (Issue) หรือใบโอน (Transfer) ดึงของจากคลังกลางเข้าคลังย่อยของลาน ' +
      'และเติมสต๊อกอุปกรณ์เช่า/ของขายหน้าลานที่ผูกไว้ให้อัตโนมัติ',
    source: { key: 'camp', name: 'ลานกางเต็นท์' },
    target: { key: 'inventory', name: 'คลังสินค้า' },
    requiredAddons: [ADDON_CODES.CAMP_MODULE, ADDON_CODES.INVENTORY_MODULE],
    icon: 'Tent',
    defaultEnabled: false,
    event: 'camp.requisition.created',
  },
  {
    key: 'hr-inventory-onboarding',
    group: 'inventory',
    name: 'เบิกอุปกรณ์ให้พนักงานใหม่ (Onboarding)',
    description:
      'เมื่อคำขอเบิกอุปกรณ์ของพนักงานใหม่ได้รับอนุมัติครบ ระบบจะตัดสต๊อกอุปกรณ์ (ยูนิฟอร์ม/เครื่องมือ) ' +
      'ออกจากคลังให้อัตโนมัติ พร้อมเช็คของคงเหลือระหว่างทำ checklist',
    source: { key: 'hr', name: 'HR / สรรหา' },
    target: { key: 'inventory', name: 'คลังสินค้า' },
    requiredAddons: [ADDON_CODES.HR_MODULE, ADDON_CODES.INVENTORY_MODULE],
    icon: 'UserPlus',
    defaultEnabled: false,
    event: 'hr.equipment.issued',
  },
  {
    key: 'inventory-costaccounting-posting',
    group: 'accounting',
    name: 'บันทึกต้นทุนอัตโนมัติเมื่อเบิกใช้ของ',
    description:
      'ทุกครั้งที่มีการเบิกของออกจากคลัง (Goods Issue) ระบบจะบันทึกเป็นรายการต้นทุนวัตถุดิบ/วัสดุ ' +
      'เข้าศูนย์ต้นทุน (Cost Center) ของแผนกที่เบิกให้อัตโนมัติ',
    source: { key: 'inventory', name: 'คลังสินค้า' },
    target: { key: 'cost-accounting', name: 'บัญชีต้นทุน' },
    // COST_ACCOUNTING_MODULE is auto-granted by ACCOUNTING_MODULE (and held directly
    // by legacy tenants) — matches the addon check this gate replaced exactly.
    requiredAddons: [ADDON_CODES.INVENTORY_MODULE, ADDON_CODES.COST_ACCOUNTING_MODULE],
    icon: 'Calculator',
    defaultEnabled: false,
    event: 'inventory.stock_movement.created',
  },
  {
    key: 'booking-costaccounting-checkout',
    group: 'accounting',
    name: 'ส่งรายได้เข้าบัญชีต้นทุนเมื่อเช็คเอาท์',
    description:
      'เมื่อผู้เข้าพักเช็คเอาท์ ระบบจะบันทึกรายได้ห้องพัก (รวม Service Charge / VAT) ' +
      'เข้าระบบบัญชีต้นทุนให้อัตโนมัติ เพื่อใช้คำนวณกำไรต่อแผนกตามมาตรฐาน USALI',
    source: { key: 'frontdesk', name: 'ฟร้อนท์เดสก์ / การจอง' },
    target: { key: 'cost-accounting', name: 'บัญชีต้นทุน' },
    requiredAddons: [ADDON_CODES.COST_ACCOUNTING_MODULE],
    icon: 'Receipt',
    defaultEnabled: false,
    event: 'booking.checkout.completed',
  },
  {
    key: 'hr-costaccounting-recruitment',
    group: 'accounting',
    name: 'บันทึกงบสรรหา/เงินเดือนเข้าบัญชีต้นทุน',
    description:
      'เมื่องบจ้างงานได้รับอนุมัติหรือมีการจ้างพนักงานใหม่ ระบบจะบันทึกงบสรรหาและเงินเดือนที่ commit ' +
      'เข้าศูนย์ต้นทุนของแผนกให้อัตโนมัติ',
    source: { key: 'hr', name: 'HR / สรรหา' },
    target: { key: 'cost-accounting', name: 'บัญชีต้นทุน' },
    requiredAddons: [ADDON_CODES.HR_MODULE, ADDON_CODES.COST_ACCOUNTING_MODULE],
    icon: 'Briefcase',
    defaultEnabled: false,
    event: 'hr.recruitment.budget_reserved · hr.recruitment.salary_committed',
  },
  {
    key: 'booking-crm-sync',
    group: 'crm',
    name: 'ซิงก์การจองเข้า CRM อัตโนมัติ',
    description:
      'ทุกเหตุการณ์การจอง (สร้าง/เช็คอิน/เช็คเอาท์) จะอัปเดตโปรไฟล์ลูกค้า (Guest 360), ' +
      'สะสมแต้ม Loyalty และดึงลูกค้าเข้า Journey/แคมเปญที่ตั้งไว้ให้อัตโนมัติ',
    source: { key: 'frontdesk', name: 'ฟร้อนท์เดสก์ / การจอง' },
    target: { key: 'crm', name: 'ระบบ CRM' },
    requiredAddons: [ADDON_CODES.CRM_MODULE],
    icon: 'HeartHandshake',
    defaultEnabled: false,
    event: 'booking.created · booking.checked_in · booking.checked_out',
  },
];

export function findGroup(key: string): IntegrationGroup | undefined {
  return INTEGRATION_GROUPS.find((g) => g.key === key);
}

export function findIntegration(key: string): IntegrationDef | undefined {
  return INTEGRATIONS.find((i) => i.key === key);
}
