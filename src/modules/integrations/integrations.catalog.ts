import { ADDON_CODES, AddonCode } from '@/modules/addons/addon.service';

/**
 * Integration Hub catalog — the source of truth for which Sub-Systems can be
 * wired together. Each entry is a directed connection (source → target) that
 * produces automated behaviour, gated by the tenant's add-on entitlements.
 *
 * Runtime state (on/off per tenant) lives in the `tenant_integrations` table.
 * When a tenant has never toggled an integration, `defaultEnabled` applies —
 * so existing tenants keep today's behaviour until they explicitly opt out.
 */
export interface IntegrationDef {
  /** Stable key — also the `integrationKey` stored per tenant. */
  key: string;
  name: string;
  description: string;
  /** Which sub-system emits / triggers the connection. */
  source: { key: string; name: string };
  /** Which sub-system reacts to it. */
  target: { key: string; name: string };
  /** All of these add-ons must be active for the connection to be available. */
  requiredAddons: AddonCode[];
  /** Lucide icon name (frontend renders it). */
  icon: string;
  /** Effective value when the tenant has no explicit setting yet. */
  defaultEnabled: boolean;
  /** The domain event this connection controls (reference/documentation). */
  event: string;
}

export const INTEGRATIONS: IntegrationDef[] = [
  {
    key: 'restaurant-inventory-autodeduct',
    name: 'ตัดสต๊อกอัตโนมัติเมื่อขายอาหาร',
    description:
      'เมื่อปิดออเดอร์ร้านอาหาร (เสิร์ฟเสร็จ) ระบบจะตัดวัตถุดิบตามสูตรออกจากคลังครัวให้อัตโนมัติ ' +
      'ทำให้หน้า “สูตร · ทำได้กี่จาน” สะท้อนสต๊อกจริงทันที',
    source: { key: 'restaurant', name: 'ร้านอาหาร / ครัว' },
    target: { key: 'inventory', name: 'คลังสินค้า' },
    requiredAddons: [ADDON_CODES.RESTAURANT_MODULE, ADDON_CODES.INVENTORY_MODULE],
    icon: 'UtensilsCrossed',
    defaultEnabled: true,
    event: 'restaurant.order.completed',
  },
  {
    key: 'housekeeping-inventory-autodeduct',
    name: 'ตัดของใช้สิ้นเปลืองเมื่อทำความสะอาดห้อง',
    description:
      'เมื่อแม่บ้านปิดงานทำความสะอาด ระบบจะตัดของใช้ (amenities) ตามเทมเพลตประเภทห้องออกจากคลังให้อัตโนมัติ',
    source: { key: 'housekeeping', name: 'แม่บ้าน' },
    target: { key: 'inventory', name: 'คลังสินค้า' },
    requiredAddons: [ADDON_CODES.INVENTORY_MODULE],
    icon: 'Sparkles',
    defaultEnabled: true,
    event: 'housekeeping.task.completed',
  },
  {
    key: 'maintenance-inventory-autodeduct',
    name: 'ตัดอะไหล่เมื่อปิดงานซ่อมบำรุง',
    description:
      'เมื่อปิดงานซ่อมบำรุงที่มีการเบิกอะไหล่ ระบบจะตัดอะไหล่ที่ใช้ออกจากคลังให้อัตโนมัติ',
    source: { key: 'maintenance', name: 'ซ่อมบำรุง' },
    target: { key: 'inventory', name: 'คลังสินค้า' },
    requiredAddons: [ADDON_CODES.INVENTORY_MODULE],
    icon: 'Wrench',
    defaultEnabled: true,
    event: 'maintenance.task.completed',
  },
];

export function findIntegration(key: string): IntegrationDef | undefined {
  return INTEGRATIONS.find((i) => i.key === key);
}
