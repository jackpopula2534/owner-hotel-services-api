import { ItemUnit, ProductChangeLevel } from '@prisma/client';

/**
 * ข้อมูลสินค้าส่วนที่ "จัดซื้อเป็นเจ้าของ"
 *
 * จัดซื้อแก้ได้ แต่ทุกการเปลี่ยนต้องผ่านคลังเสมอ:
 * - ACKNOWLEDGE (รับทราบ) — ข้อมูลเชิงพาณิชย์ ไม่กระทบตัวเลขในคลัง
 * - APPROVAL (ต้องอนุมัติ) — กระทบการรับเข้า (GR) และต้นทุนต่อหน่วยนับคลัง
 *
 * ข้อมูลฝั่งคลัง (SKU, หมวด, หน่วยนับ, Min/Max, Lot/QC) ไม่อยู่ในรายการนี้
 * จัดซื้อทำได้แค่ "เสนอค่า" ตอนขอสร้างสินค้าใหม่
 */
export const PROCUREMENT_FIELD_KEYS = [
  'name',
  'description',
  'brand',
  'preferredSupplierId',
  'unitPrice',
  'minOrderQty',
  'leadDays',
  'purchaseUnit',
  'purchaseUnitFactor',
] as const;

export type ProcurementFieldKey = (typeof PROCUREMENT_FIELD_KEYS)[number];

export type FieldValue = string | number | null;

export interface ProcurementFieldDef {
  key: ProcurementFieldKey;
  label: string;
  level: ProductChangeLevel;
  kind: 'text' | 'number' | 'supplier' | 'unit';
  /** item = inventory_items, supplier = item_suppliers ของ supplier หลัก */
  target: 'item' | 'supplier';
}

export const PROCUREMENT_FIELDS: readonly ProcurementFieldDef[] = [
  { key: 'name', label: 'ชื่อสินค้า', level: 'ACKNOWLEDGE', kind: 'text', target: 'item' },
  {
    key: 'description',
    label: 'สเปก / รายละเอียด',
    level: 'ACKNOWLEDGE',
    kind: 'text',
    target: 'item',
  },
  { key: 'brand', label: 'ยี่ห้อ', level: 'ACKNOWLEDGE', kind: 'text', target: 'item' },
  {
    key: 'preferredSupplierId',
    label: 'Supplier หลัก',
    level: 'ACKNOWLEDGE',
    kind: 'supplier',
    target: 'supplier',
  },
  {
    key: 'unitPrice',
    label: 'ราคาซื้อ / หน่วยนับคลัง',
    level: 'ACKNOWLEDGE',
    kind: 'number',
    target: 'supplier',
  },
  {
    key: 'minOrderQty',
    label: 'MOQ (หน่วยซื้อ)',
    level: 'ACKNOWLEDGE',
    kind: 'number',
    target: 'supplier',
  },
  {
    key: 'leadDays',
    label: 'Lead time (วัน)',
    level: 'ACKNOWLEDGE',
    kind: 'number',
    target: 'supplier',
  },
  { key: 'purchaseUnit', label: 'หน่วยซื้อ', level: 'APPROVAL', kind: 'unit', target: 'item' },
  {
    key: 'purchaseUnitFactor',
    label: 'อัตราแปลง (หน่วยนับคลัง / หน่วยซื้อ)',
    level: 'APPROVAL',
    kind: 'number',
    target: 'item',
  },
];

const FIELD_BY_KEY: ReadonlyMap<ProcurementFieldKey, ProcurementFieldDef> = new Map(
  PROCUREMENT_FIELDS.map((f) => [f.key, f]),
);

export function getFieldDef(key: ProcurementFieldKey): ProcurementFieldDef {
  const def = FIELD_BY_KEY.get(key);
  if (!def) throw new Error(`Unknown procurement field: ${key}`);
  return def;
}

export function isProcurementFieldKey(key: string): key is ProcurementFieldKey {
  return FIELD_BY_KEY.has(key as ProcurementFieldKey);
}

export type ProcurementSnapshot = Record<ProcurementFieldKey, FieldValue>;

export type FieldDecision = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface FieldChange {
  field: ProcurementFieldKey;
  label: string;
  level: ProductChangeLevel;
  from: FieldValue;
  to: FieldValue;
  decision: FieldDecision;
}

/** '' / undefined → null, ตัด whitespace, ตัวเลขเทียบเป็นตัวเลข */
export function normalizeValue(def: ProcurementFieldDef, value: unknown): FieldValue {
  if (value === undefined || value === null) return null;
  if (def.kind === 'number') {
    if (typeof value === 'string' && value.trim() === '') return null;
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : null;
  }
  const s = String(value).trim();
  return s === '' ? null : s;
}

export function valuesEqual(def: ProcurementFieldDef, a: unknown, b: unknown): boolean {
  const na = normalizeValue(def, a);
  const nb = normalizeValue(def, b);
  if (typeof na === 'number' && typeof nb === 'number') {
    return Math.abs(na - nb) < 1e-9;
  }
  return na === nb;
}

/**
 * เทียบค่าเดิมกับค่าที่เสนอ — คืนเฉพาะฟิลด์ที่เปลี่ยนจริง
 * key ที่ไม่ได้อยู่ใน proposed = ไม่แตะ (ไม่ใช่ "ล้างค่า")
 */
export function buildChanges(
  baseline: ProcurementSnapshot,
  proposed: Partial<Record<ProcurementFieldKey, unknown>>,
): FieldChange[] {
  return PROCUREMENT_FIELDS.filter((def) => Object.prototype.hasOwnProperty.call(proposed, def.key))
    .filter((def) => !valuesEqual(def, baseline[def.key], proposed[def.key]))
    .map((def) => ({
      field: def.key,
      label: def.label,
      level: def.level,
      from: normalizeValue(def, baseline[def.key]),
      to: normalizeValue(def, proposed[def.key]),
      decision: 'PENDING' as const,
    }));
}

export function requestLevel(changes: readonly Pick<FieldChange, 'level'>[]): ProductChangeLevel {
  return changes.some((c) => c.level === 'APPROVAL') ? 'APPROVAL' : 'ACKNOWLEDGE';
}

export const ITEM_UNITS: readonly ItemUnit[] = Object.values(ItemUnit);
