/**
 * แปลงปริมาณจาก "หน่วยในสูตร" (ข้อความอิสระ เช่น กรัม / มล. / ช้อนโต๊ะ / ฟอง)
 * ไปเป็น "หน่วยที่คลังเก็บสต็อก" (ItemUnit enum ของ InventoryItem)
 *
 * ทำไมต้องมี: ยอดในคลังเก็บตามหน่วยของสินค้า ถ้าเอาเลขในสูตรไปหักตรง ๆ
 * ข้าว 150 กรัม จะกลายเป็นหัก 150 กิโลจากสินค้าที่เก็บเป็น KG
 *
 * กติกา:
 *   • ไม่ระบุหน่วยในสูตร → ถือว่าเป็นหน่วยเดียวกับคลัง
 *   • มิติเดียวกันแปลงได้ (น้ำหนัก g↔kg, ปริมาตร ml↔l/ช้อน/ถ้วย, จำนวน ชิ้น↔โหล)
 *   • ข้ามมิติหรือบรรจุภัณฑ์ที่ไม่รู้ขนาด (ฟอง → กล่อง, ช้อน → กิโล) แปลงไม่ได้
 *     → คืน ok:false ให้คนเรียกตัดสินใจ (ข้าม + เตือน) ห้ามเดา
 */

type Dimension = 'mass' | 'volume' | 'count' | 'package';

interface UnitDef {
  dim: Dimension;
  /** ตัวคูณไปหน่วยฐานของมิติ (g / ml / ชิ้น); package ไม่มีหน่วยฐาน */
  factor: number;
  /** ชื่อบรรจุภัณฑ์ — ใช้เทียบเฉพาะ package กับ package ชื่อเดียวกัน */
  pkg?: string;
}

const MASS: Record<string, number> = { mg: 0.001, g: 1, kg: 1000 };
const VOLUME: Record<string, number> = { ml: 1, l: 1000, tsp: 5, tbsp: 15, cup: 240 };

/** ItemUnit enum → นิยาม */
const ITEM_UNITS: Record<string, UnitDef> = {
  G: { dim: 'mass', factor: MASS.g },
  KG: { dim: 'mass', factor: MASS.kg },
  ML: { dim: 'volume', factor: VOLUME.ml },
  L: { dim: 'volume', factor: VOLUME.l },
  PIECE: { dim: 'count', factor: 1 },
  DOZEN: { dim: 'count', factor: 12 },
  PAIR: { dim: 'count', factor: 2 },
  BOX: { dim: 'package', factor: 1, pkg: 'box' },
  PACK: { dim: 'package', factor: 1, pkg: 'pack' },
  BOTTLE: { dim: 'package', factor: 1, pkg: 'bottle' },
  CAN: { dim: 'package', factor: 1, pkg: 'can' },
  BAG: { dim: 'package', factor: 1, pkg: 'bag' },
  ROLL: { dim: 'package', factor: 1, pkg: 'roll' },
  SET: { dim: 'package', factor: 1, pkg: 'set' },
  SHEET: { dim: 'package', factor: 1, pkg: 'sheet' },
  METER: { dim: 'package', factor: 1, pkg: 'meter' },
};

/** ชื่อเรียกในสูตร (ไทย/อังกฤษ) → นิยาม */
const ALIASES: Array<[string[], UnitDef]> = [
  [['mg', 'มิลลิกรัม', 'มก.', 'มก'], { dim: 'mass', factor: MASS.mg }],
  [['g', 'gr', 'gram', 'grams', 'กรัม', 'ก.', 'กรัม.'], { dim: 'mass', factor: MASS.g }],
  [
    ['kg', 'kgs', 'kilo', 'kilogram', 'kilograms', 'กก.', 'กก', 'กิโล', 'กิโลกรัม'],
    { dim: 'mass', factor: MASS.kg },
  ],
  [['ml', 'cc', 'มล.', 'มล', 'มิลลิลิตร', 'ซีซี'], { dim: 'volume', factor: VOLUME.ml }],
  [
    ['l', 'lt', 'ltr', 'liter', 'litre', 'liters', 'litres', 'ลิตร', 'ล.'],
    { dim: 'volume', factor: VOLUME.l },
  ],
  [['tsp', 'teaspoon', 'ช้อนชา', 'ชช.', 'ชช'], { dim: 'volume', factor: VOLUME.tsp }],
  [['tbsp', 'tablespoon', 'ช้อนโต๊ะ', 'ชต.', 'ชต'], { dim: 'volume', factor: VOLUME.tbsp }],
  [['cup', 'cups', 'ถ้วย', 'ถ้วยตวง'], { dim: 'volume', factor: VOLUME.cup }],
  [
    [
      'piece',
      'pieces',
      'pc',
      'pcs',
      'ea',
      'each',
      'unit',
      'ชิ้น',
      'อัน',
      'ลูก',
      'ผล',
      'ฟอง',
      'ตัว',
      'หัว',
      'กลีบ',
      'เม็ด',
      'ใบ',
      'ต้น',
      'ก้อน',
    ],
    { dim: 'count', factor: 1 },
  ],
  [['dozen', 'โหล'], { dim: 'count', factor: 12 }],
  [['pair', 'คู่'], { dim: 'count', factor: 2 }],
  [['box', 'กล่อง', 'ลัง'], { dim: 'package', factor: 1, pkg: 'box' }],
  [['pack', 'แพ็ค', 'แพค', 'ห่อ', 'ซอง'], { dim: 'package', factor: 1, pkg: 'pack' }],
  [['bottle', 'ขวด'], { dim: 'package', factor: 1, pkg: 'bottle' }],
  [['can', 'กระป๋อง'], { dim: 'package', factor: 1, pkg: 'can' }],
  [['bag', 'ถุง'], { dim: 'package', factor: 1, pkg: 'bag' }],
  [['roll', 'ม้วน'], { dim: 'package', factor: 1, pkg: 'roll' }],
  [['set', 'ชุด'], { dim: 'package', factor: 1, pkg: 'set' }],
  [['sheet', 'แผ่น'], { dim: 'package', factor: 1, pkg: 'sheet' }],
  [['meter', 'metre', 'm', 'เมตร'], { dim: 'package', factor: 1, pkg: 'meter' }],
];

const ALIAS_MAP = new Map<string, UnitDef>();
for (const [names, def] of ALIASES) for (const n of names) ALIAS_MAP.set(n, def);

function normalize(unit: string | null | undefined): string {
  return (unit ?? '').trim().toLowerCase().replace(/\s+/g, '');
}

function lookup(unit: string | null | undefined): UnitDef | null {
  const raw = (unit ?? '').trim();
  if (!raw) return null;
  return ITEM_UNITS[raw.toUpperCase()] ?? ALIAS_MAP.get(normalize(raw)) ?? null;
}

export interface UnitConversion {
  ok: boolean;
  /** ปริมาณในหน่วยของคลัง (ok=false → ค่าเดิม ห้ามเอาไปใช้ตัดสต็อก) */
  quantity: number;
  reason?: string;
}

export function convertToStockUnit(
  quantity: number,
  recipeUnit: string | null | undefined,
  stockUnit: string | null | undefined,
): UnitConversion {
  const from = (recipeUnit ?? '').trim();
  const to = (stockUnit ?? '').trim();
  if (!from || !to) return { ok: true, quantity };
  if (normalize(from) === normalize(to)) return { ok: true, quantity };

  const src = lookup(from);
  const dst = lookup(to);
  if (!src || !dst) {
    return { ok: false, quantity, reason: `ไม่รู้จักหน่วย "${!src ? from : to}"` };
  }
  if (src.dim === 'package' || dst.dim === 'package') {
    if (src.dim === dst.dim && src.pkg === dst.pkg) return { ok: true, quantity };
    return { ok: false, quantity, reason: `แปลง "${from}" เป็น "${to}" ไม่ได้ (ไม่รู้ขนาดบรรจุ)` };
  }
  if (src.dim !== dst.dim) {
    return { ok: false, quantity, reason: `แปลง "${from}" เป็น "${to}" ไม่ได้ (คนละชนิดหน่วย)` };
  }
  return { ok: true, quantity: (quantity * src.factor) / dst.factor };
}

/** ปัดทศนิยมกันเศษ binary float (0.1 + 0.2) — ใช้ก่อน floor/ceil เสมอ */
export function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
