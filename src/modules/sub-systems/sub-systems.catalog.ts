import { ADDON_CODES } from '../addons/addon.service';
import type { SubSystemCardMeta } from '../addons/dto/create-addon.dto';

/**
 * Sub-System (Terminal) catalog.
 *
 * Source of truth at runtime = the `add_ons` table:
 *   - add-on rows flagged `is_sub_system = 1` carry their card metadata in
 *     `sub_system_meta` (JSON). SubSystemsService reads them via the DB.
 *
 * This file holds two things:
 *   1) CORE_SUB_SYSTEMS — terminals that are NOT add-ons (always available),
 *      e.g. the Hotel Management Terminal.
 *   2) SUB_SYSTEM_ADDON_META — seed content: which cards each add-on exposes.
 *      The seeder writes this into add_ons.sub_system_meta. One add-on may
 *      expose several cards (e.g. Restaurant → POS + Kitchen Display).
 */

export interface SubSystemCard extends SubSystemCardMeta {
  name: string;
  description: string;
  icon: string;
  /** Add-on that unlocks this card (null = core terminal). */
  requiredAddon: string | null;
  available: boolean;
  status: 'ready' | 'locked';
}

/** Core terminals (no add-on required) — always shown as available. */
export const CORE_SUB_SYSTEMS: SubSystemCard[] = [
  {
    key: 'hotel-terminal',
    name: 'ระบบจัดการโรงแรม',
    subtitle: 'Hotel Management Terminal',
    description:
      'Terminal สำหรับพนักงานโรงแรม — โรงแรมของฉัน · จัดการห้องพัก · ฟร้อนท์เดสก์ · การจอง · ผู้เข้าพัก · แม่บ้าน/ซ่อมบำรุง',
    tags: ['โรงแรมของฉัน', 'จัดการห้องพัก', 'ฟร้อนท์เดสก์', 'การจอง', 'ผู้เข้าพัก', 'แม่บ้าน/ซ่อมบำรุง'],
    icon: 'Building2',
    color: 'violet',
    badge: 'ใหม่',
    launchPath: '/hotel-terminal',
    launchEndpoint: '/auth/hotel-terminal-launch',
    loginEndpoint: '/auth/hotel-terminal/login',
    requiredAddon: null,
    available: true,
    status: 'ready',
    displayOrder: 0,
  },
];

/**
 * Seed content: add-on code → cards it exposes on the Sub Systems page.
 * The seeder serialises each array into add_ons.sub_system_meta.
 */
export const SUB_SYSTEM_ADDON_META: Record<string, SubSystemCardMeta[]> = {
  [ADDON_CODES.RESTAURANT_MODULE]: [
    {
      key: 'restaurant-pos',
      name: 'Restaurant POS',
      subtitle: 'Restaurant POS',
      description:
        'ระบบ Point of Sale สำหรับพนักงานร้านอาหาร — รับออเดอร์ · จัดการโต๊ะ · ส่งครัว · ชำระเงิน',
      tags: ['รับออเดอร์', 'จัดการโต๊ะ', 'Kitchen Display', 'ชำระเงิน', 'สรุปยอด'],
      icon: 'UtensilsCrossed',
      color: 'orange',
      launchPath: '/pos',
      launchEndpoint: '/auth/pos-launch',
      loginEndpoint: '/auth/pos/login',
      displayOrder: 110,
    },
    {
      key: 'kitchen-display',
      name: 'Kitchen Display',
      subtitle: 'Kitchen Display System',
      description: 'หน้าจอครัว (KDS) สำหรับพ่อครัวและพนักงานครัว — แสดงออเดอร์เรียลไทม์',
      tags: ['ออเดอร์ Realtime', 'Station ครัว', 'Check-in พนักงาน', 'สถิติวันนี้'],
      icon: 'ChefHat',
      color: 'amber',
      launchPath: '/kitchen',
      launchEndpoint: '/auth/pos-launch',
      loginEndpoint: '/auth/pos/login',
      displayOrder: 120,
    },
  ],
  [ADDON_CODES.INVENTORY_MODULE]: [
    {
      key: 'procurement',
      name: 'ระบบจัดซื้อ',
      subtitle: 'Procurement Terminal',
      description: 'Terminal สำหรับทีมจัดซื้อ — สร้าง PR · ส่ง RFQ · อนุมัติ PO · รับสินค้า · QC',
      tags: ['ใบขอซื้อ (PR)', 'RFQ / เทียบราคา', 'อนุมัติ PO', 'รับสินค้า (GR)', 'QC ตรวจสอบ'],
      icon: 'ShoppingCart',
      color: 'indigo',
      badge: 'ใหม่',
      launchPath: '/procurement',
      launchEndpoint: '/auth/purchasing-launch',
      loginEndpoint: '/auth/purchasing/login',
      displayOrder: 210,
    },
    {
      key: 'warehouse',
      name: 'ระบบคลังสินค้า',
      subtitle: 'Warehouse Terminal',
      description:
        'Terminal สำหรับทีมคลัง — รับสินค้า (GR) · QC คุณภาพ · นับสต็อก · จัดการ Lots · พยากรณ์ความต้องการ',
      tags: ['ภาพรวมคลัง', 'รายการสินค้า', 'รับสินค้า (GR)', 'รับ/เบิก', 'QC คุณภาพ', 'Lots & นับสต็อก', 'พยากรณ์'],
      icon: 'Warehouse',
      color: 'teal',
      badge: 'ใหม่',
      launchPath: '/warehouse',
      launchEndpoint: '/auth/warehouse-launch',
      loginEndpoint: '/auth/warehouse/login',
      displayOrder: 220,
    },
  ],
  [ADDON_CODES.ACCOUNTING_MODULE]: [
    {
      key: 'accounting',
      name: 'ระบบบัญชี',
      subtitle: 'Accounting Terminal',
      description:
        'Terminal สำหรับทีมบัญชี — ผังบัญชี · สมุดรายวัน · ลูกหนี้/เจ้าหนี้ · งบการเงิน · Night Audit',
      tags: ['ผังบัญชี', 'สมุดรายวัน', 'ลูกหนี้/เจ้าหนี้', 'งบการเงิน', 'Night Audit'],
      icon: 'Calculator',
      color: 'blue',
      badge: 'ใหม่',
      launchPath: '/accounting',
      launchEndpoint: '/auth/accounting-launch',
      loginEndpoint: '/auth/accounting/login',
      displayOrder: 310,
    },
  ],
  [ADDON_CODES.CRM_MODULE]: [
    {
      key: 'crm',
      name: 'ระบบ CRM',
      subtitle: 'CRM Terminal',
      description:
        'Terminal สำหรับทีม CRM — Guest 360 · Campaign · Sales Pipeline · Service Desk · Loyalty',
      tags: ['Guest 360', 'แคมเปญ', 'Sales Pipeline', 'Service Desk', 'Loyalty', 'NPS / CSAT'],
      icon: 'HeartHandshake',
      color: 'green',
      badge: 'ใหม่',
      launchPath: '/crm',
      launchEndpoint: '/auth/crm-launch',
      loginEndpoint: '/auth/crm/login',
      displayOrder: 410,
    },
  ],
  [ADDON_CODES.HR_MODULE]: [
    {
      key: 'hr',
      name: 'ระบบ HR',
      subtitle: 'HR Terminal',
      description:
        'Terminal สำหรับทีม HR — ข้อมูลพนักงาน · เงินเดือน · การลา · ประเมินผล (KPI) · เอกสารราชการ',
      tags: ['ข้อมูลพนักงาน', 'เงินเดือน', 'การลา', 'ประเมินผล', 'KPI', 'ภงด.1 / สปส.'],
      icon: 'Briefcase',
      color: 'rose',
      badge: 'ใหม่',
      launchPath: '/hr',
      launchEndpoint: '/auth/hr-launch',
      loginEndpoint: '/auth/hr/login',
      displayOrder: 510,
    },
  ],
};
