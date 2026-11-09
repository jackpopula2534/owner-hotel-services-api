/**
 * โครงของฉาก 3D ลาน (Campground.map3dConfig) — add-on CAMP_3D_MAP
 *
 * พิกัดทุกจุดเป็น normalized 0..1 แบบเดียวกับ posX/posY ของ pitch
 * (x ไปทางขวา, y ลงล่าง, จุดกำเนิดมุมซ้ายบนของรูปแปลน) ขนาดจริงอยู่ที่ scale
 */

export type Point = [number, number];

export type GroundMode = 'drape' | 'procedural';
export type TerrainPreset = 'flat' | 'gentle' | 'hilly' | 'valley';
export type WaterKind = 'lake' | 'pond' | 'river';
export type RoadSurface = 'asphalt' | 'gravel' | 'dirt';
export type AreaKind = 'pitch' | 'parking' | 'field' | 'beach' | 'building';
export type PropType =
  | 'restroom'
  | 'dome'
  | 'bridge'
  | 'building'
  | 'tent'
  | 'custom'
  // ของตกแต่งฉากที่วางเองได้ (เครื่องมือออกแบบเอง/เทมเพลต ไม่ผ่าน AI)
  | 'cabin'
  | 'caravan'
  | 'car'
  | 'lamp'
  | 'campfire'
  | 'dock'
  | 'tree'
  | 'picnic';
/** ที่มาของรูปทรง — sam = ตัดขอบละเอียดด้วย SAM, vision = จุดคร่าว ๆ จาก AI อ่านภาพ, manual = ผู้ใช้วาด */
export type GeometrySource = 'sam' | 'vision' | 'manual';

interface Map3dItemBase {
  id: string;
  label?: string;
  /** ความมั่นใจของ AI 0..1 (manual = ไม่มี) */
  confidence?: number;
  source?: GeometrySource;
}

export interface Map3dWater extends Map3dItemBase {
  kind: WaterKind;
  polygon: Point[];
}

export interface Map3dRiver extends Map3dItemBase {
  polyline: Point[];
  widthM: number;
}

export interface Map3dRoad extends Map3dItemBase {
  polyline: Point[];
  widthM: number;
  surface: RoadSurface;
}

export interface Map3dForest extends Map3dItemBase {
  polygon: Point[];
  /** ความหนาแน่นของต้นไม้ 0..1 */
  density: number;
  species: 'mixed' | 'pine' | 'tropical' | 'palm';
}

export interface Map3dArea extends Map3dItemBase {
  kind: AreaKind;
  polygon: Point[];
}

export interface Map3dProp extends Map3dItemBase {
  type: PropType;
  x: number;
  y: number;
  /** องศา 0..359 */
  rot: number;
  /** โมเดล .glb เฉพาะของลาน (อัปโหลดผ่าน POST map3d/models) — ไม่มี = ใช้รูปทรงสำเร็จรูปตาม type */
  glbUrl?: string;
  /** ขนาดด้านที่ยาวที่สุดของโมเดลในฉาก (เมตร) — ไม่ระบุ = ใช้ขนาดตาม type */
  sizeM?: number;
  /** ผูกกับจุดกางเต็นท์ (CampPitch.id) — ย้ายจุดแล้วของตกแต่งย้ายตาม */
  pitchId?: string;
}

/** ชนิดที่พักที่วางเป็นกลุ่ม "แคมป์วงกลม" ได้ */
export type ClusterItemType = 'tent' | 'dome' | 'caravan' | 'cabin';

/**
 * กลุ่มของตกแต่งที่วางล้อมจุดศูนย์กลาง (แคมป์วงกลม) — ฝั่งแสดงผลขยายเป็นชิ้น ๆ เอง
 * เป็นของตกแต่งเท่านั้น ไม่ใช่จุดกางเต็นท์ที่จองได้
 */
export interface Map3dCluster {
  id: string;
  type: ClusterItemType;
  x: number;
  y: number;
  /** หมุนทั้งวง (องศา) */
  rot: number;
  count: number;
  /** รัศมีวง (เมตร) */
  radiusM: number;
  /** หันหน้าที่พักเข้ากลางวง */
  faceCenter: boolean;
  /** วางกองไฟกลางวง */
  campfire: boolean;
}

/**
 * ผลการปั้นพื้นด้วยแปรง — ตารางสี่เหลี่ยมจัตุรัส res×res บนพิกัด normalized (0..1)
 * ค่าเป็น Int16 little-endian หน่วยเซนติเมตร (บวก = ยกขึ้น) เข้ารหัส base64
 */
export interface Map3dSculpt {
  res: number;
  data: string;
}

export interface Map3dConfig {
  version: 1;
  scale: { widthM: number; depthM: number };
  /** ทิศเหนือของรูปแปลน (องศาตามเข็มจากด้านบนของรูป) */
  northDeg: number;
  ground: { imageUrl: string | null; mode: GroundMode };
  terrain: {
    preset: TerrainPreset;
    sculpt?: Map3dSculpt | null;
    /** ระดับน้ำทั้งฉาก (เมตร) — พื้นที่ต่ำกว่านี้เป็นน้ำ · null/ไม่ระบุ = ไม่มี */
    waterLevelM?: number | null;
    /** สีน้ำ #rrggbb */
    waterColor?: string;
  };
  water: Map3dWater[];
  rivers: Map3dRiver[];
  roads: Map3dRoad[];
  forests: Map3dForest[];
  areas: Map3dArea[];
  props: Map3dProp[];
  clusters?: Map3dCluster[];
}

export interface Map3dDraftWarning {
  /** id ของรายการในร่าง (ว่าง = เตือนทั้งฉาก) */
  itemId?: string;
  code:
    | 'LOW_CONFIDENCE'
    | 'SEGMENT_FALLBACK'
    | 'NOT_TOP_DOWN'
    | 'NOTHING_FOUND'
    | 'SEGMENT_UNAVAILABLE';
  message: string;
}

/** ผลของงาน extraction ที่เก็บใน CampMapExtraction.result */
export interface Map3dDraft {
  config: Map3dConfig;
  warnings: Map3dDraftWarning[];
  imageKind: string;
  notes: string;
  /** ป้ายโซน/ลานที่ AI อ่านได้ (ใช้ช่วยจับคู่กับ zone/pitch ในระบบภายหลัง) */
  labels: { text: string; x: number; y: number }[];
  segmentCalls: number;
}

export const MAP3D_STEPS = ['vision', 'segment', 'build', 'done'] as const;
export type Map3dStep = (typeof MAP3D_STEPS)[number];
