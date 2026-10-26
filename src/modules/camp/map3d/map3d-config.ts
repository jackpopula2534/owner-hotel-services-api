import { randomUUID } from 'crypto';
import {
  AreaKind,
  ClusterItemType,
  GeometrySource,
  Map3dCluster,
  Map3dConfig,
  Map3dDraft,
  Map3dDraftWarning,
  Map3dSculpt,
  Point,
  PropType,
  RoadSurface,
  TerrainPreset,
  WaterKind,
} from './map3d.types';

/** ต่ำกว่านี้ขึ้นคำเตือนในขั้นตรวจทาน (ผู้ใช้ตัดสินใจเองว่าจะเก็บไว้ไหม) */
export const LOW_CONFIDENCE = 0.6;
export const MAX_ITEMS_PER_LAYER = 200;
export const MAX_POINTS_PER_SHAPE = 500;

export const VISION_KINDS = [
  'lake',
  'pond',
  'river',
  'road',
  'path',
  'forest',
  'building',
  'pitch',
  'parking',
  'field',
  'beach',
  'restroom',
  'other',
] as const;
export type VisionKind = (typeof VISION_KINDS)[number];

/** สิ่งที่ OpenAI vision ตอบกลับ (ตาม json_schema ใน map3d-ai.client.ts) */
export interface VisionFeature {
  kind: VisionKind;
  label: string;
  confidence: number;
  geometry: 'polygon' | 'polyline' | 'point';
  points: number[][];
  samplePoints: number[][];
  widthM: number | null;
}

export interface VisionResult {
  imageKind: string;
  notes: string;
  features: VisionFeature[];
  labels: { text: string; x: number; y: number }[];
}

export interface DraftInput {
  widthM: number;
  depthM: number;
  northDeg: number;
  imageUrl: string;
}

/** ผลตัดขอบของแต่ละ feature (index ใน vision.features) — null = SAM ใช้ไม่ได้ */
export type SegmentResults = Map<number, Point[] | null>;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const round4 = (n: number) => Math.round(n * 10000) / 10000;

function toPoints(raw: number[][]): Point[] {
  return raw
    .filter(
      (p) => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]),
    )
    .map((p) => [round4(clamp01(p[0])), round4(clamp01(p[1]))] as Point);
}

function centroid(points: Point[]): Point {
  const sum = points.reduce((acc, [x, y]) => [acc[0] + x, acc[1] + y], [0, 0]);
  return [round4(sum[0] / points.length), round4(sum[1] / points.length)];
}

/** feature ที่เป็นพื้นที่และควรส่งให้ SAM ตัดขอบ */
export function isSegmentable(f: VisionFeature): boolean {
  if (f.geometry !== 'polygon') return false;
  return ['lake', 'pond', 'forest', 'field', 'beach', 'parking', 'river'].includes(f.kind);
}

/**
 * จุด prompt ของ SAM (normalized) — ใช้ samplePoints ถ้ามี ไม่งั้น centroid ของ polygon
 */
export function promptPoints(f: VisionFeature): Point[] {
  const samples = toPoints(f.samplePoints);
  if (samples.length) return samples.slice(0, 4);
  const poly = toPoints(f.points);
  return poly.length ? [centroid(poly)] : [];
}

/**
 * รวมผล vision + SAM เป็นร่าง map3dConfig พร้อมคำเตือน
 * ทุกชิ้นมี id + confidence + source เพื่อให้หน้าตรวจทานติ๊กออกได้
 */
export function buildDraft(
  vision: VisionResult,
  segments: SegmentResults,
  input: DraftInput,
  segmentCalls: number,
  segmentUnavailable: boolean,
): Map3dDraft {
  const config = emptyConfig(input);
  const warnings: Map3dDraftWarning[] = [];

  if (segmentUnavailable) {
    warnings.push({
      code: 'SEGMENT_UNAVAILABLE',
      message: 'ระบบตัดขอบละเอียดไม่พร้อมใช้งาน ขอบพื้นที่ทั้งหมดมาจากการอ่านภาพแบบคร่าว ๆ',
    });
  }
  if (vision.imageKind !== 'top_down_plan' && vision.imageKind !== 'satellite') {
    warnings.push({
      code: 'NOT_TOP_DOWN',
      message: 'รูปนี้อาจไม่ใช่มุมมองจากด้านบน ตำแหน่งในฉากอาจคลาดเคลื่อน',
    });
  }

  vision.features.forEach((f, index) => {
    const id = randomUUID();
    const confidence = round4(clamp01(Number(f.confidence) || 0));
    const label = (f.label || '').slice(0, 80) || undefined;
    const visionPoints = toPoints(f.points);
    const segmented = segments.get(index);
    let source: GeometrySource = 'vision';
    let shape = visionPoints;
    if (segmented && segmented.length >= 3) {
      shape = segmented;
      source = 'sam';
    } else if (segments.has(index)) {
      warnings.push({
        itemId: id,
        code: 'SEGMENT_FALLBACK',
        message: `${label ?? f.kind}: ตัดขอบละเอียดไม่สำเร็จ ใช้ขอบคร่าว ๆ แทน`,
      });
    }
    const base = { id, label, confidence, source };

    const pushed = addFeature(config, f, shape, base, input);
    if (!pushed) return;
    if (confidence < LOW_CONFIDENCE) {
      warnings.push({
        itemId: id,
        code: 'LOW_CONFIDENCE',
        message: `${label ?? f.kind}: AI ไม่แน่ใจ (${Math.round(confidence * 100)}%) ตรวจดูก่อนเผยแพร่`,
      });
    }
  });

  const total =
    config.water.length +
    config.rivers.length +
    config.roads.length +
    config.forests.length +
    config.areas.length +
    config.props.length;
  if (total === 0) {
    warnings.push({
      code: 'NOTHING_FOUND',
      message: 'AI ไม่พบองค์ประกอบในรูป ลองใช้รูปแปลนที่ชัดกว่านี้ หรือแปะภาพเป็นพื้นแทน',
    });
  }

  return {
    config,
    warnings,
    imageKind: vision.imageKind,
    notes: (vision.notes || '').slice(0, 500),
    labels: vision.labels
      .filter((l) => l.text && Number.isFinite(l.x) && Number.isFinite(l.y))
      .slice(0, MAX_ITEMS_PER_LAYER)
      .map((l) => ({
        text: l.text.slice(0, 80),
        x: round4(clamp01(l.x)),
        y: round4(clamp01(l.y)),
      })),
    segmentCalls,
  };
}

function addFeature(
  config: Map3dConfig,
  f: VisionFeature,
  shape: Point[],
  base: { id: string; label?: string; confidence: number; source: GeometrySource },
  input: DraftInput,
): boolean {
  const widthM = f.widthM && f.widthM > 0 ? Math.min(f.widthM, 200) : undefined;
  const asPolygon = f.geometry === 'polygon' && shape.length >= 3;
  const asLine = shape.length >= 2;

  switch (f.kind) {
    case 'lake':
    case 'pond':
      if (!asPolygon) return false;
      config.water.push({ ...base, kind: f.kind, polygon: shape });
      return true;
    case 'river':
      if (asPolygon) {
        config.water.push({ ...base, kind: 'river', polygon: shape });
        return true;
      }
      if (!asLine) return false;
      config.rivers.push({
        ...base,
        polyline: shape,
        widthM: widthM ?? Math.max(3, input.widthM * 0.02),
      });
      return true;
    case 'road':
    case 'path': {
      if (!asLine) return false;
      const surface: RoadSurface = f.kind === 'road' ? 'gravel' : 'dirt';
      config.roads.push({
        ...base,
        polyline: shape,
        widthM: widthM ?? (f.kind === 'road' ? 5 : 2),
        surface,
      });
      return true;
    }
    case 'forest':
      if (!asPolygon) return false;
      config.forests.push({ ...base, polygon: shape, density: 0.6, species: 'mixed' });
      return true;
    case 'pitch':
    case 'parking':
    case 'field':
    case 'beach':
    case 'building':
      if (asPolygon) {
        config.areas.push({ ...base, kind: f.kind as AreaKind, polygon: shape });
        return true;
      }
      if (!shape.length) return false;
      config.props.push({
        ...base,
        type: f.kind === 'building' ? 'building' : f.kind === 'pitch' ? 'tent' : 'custom',
        ...pointOf(shape),
        rot: 0,
      });
      return true;
    case 'restroom':
      if (!shape.length) return false;
      config.props.push({ ...base, type: 'restroom', ...pointOf(shape), rot: 0 });
      return true;
    default:
      if (!shape.length) return false;
      config.props.push({ ...base, type: 'custom', ...pointOf(shape), rot: 0 });
      return true;
  }
}

function pointOf(shape: Point[]): { x: number; y: number } {
  const [x, y] = shape.length === 1 ? shape[0] : centroid(shape);
  return { x, y };
}

export function emptyConfig(input: DraftInput): Map3dConfig {
  return {
    version: 1,
    scale: { widthM: input.widthM, depthM: input.depthM },
    northDeg: input.northDeg,
    ground: { imageUrl: input.imageUrl, mode: 'drape' },
    terrain: { preset: 'gentle' },
    water: [],
    rivers: [],
    roads: [],
    forests: [],
    areas: [],
    props: [],
  };
}

// ─────────── validate ฉากที่ผู้ใช้ส่งมาบันทึก ───────────

export class Map3dConfigError extends Error {}

const GROUND_MODES = ['drape', 'procedural'] as const;
const TERRAIN_PRESETS: TerrainPreset[] = ['flat', 'gentle', 'hilly', 'valley'];
const WATER_KINDS: WaterKind[] = ['lake', 'pond', 'river'];
const SURFACES: RoadSurface[] = ['asphalt', 'gravel', 'dirt'];
const AREA_KINDS: AreaKind[] = ['pitch', 'parking', 'field', 'beach', 'building'];
const PROP_TYPES: PropType[] = [
  'restroom',
  'dome',
  'bridge',
  'building',
  'tent',
  'custom',
  'cabin',
  'caravan',
  'car',
  'lamp',
  'campfire',
  'dock',
  'tree',
  'picnic',
];
const SPECIES = ['mixed', 'pine', 'tropical', 'palm'] as const;
const CLUSTER_TYPES: ClusterItemType[] = ['tent', 'dome', 'caravan', 'cabin'];
/** ความละเอียดตารางปั้นพื้นที่ยอมรับ (ต้องตรงกับฝั่งหน้าเว็บ) */
export const SCULPT_RESOLUTIONS = [33, 65, 129] as const;
export const MAX_CLUSTERS = 100;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

function sculpt(v: unknown): Map3dSculpt | null {
  if (v === undefined || v === null) return null;
  if (!isObj(v)) throw new Map3dConfigError('terrain.sculpt ไม่ถูกต้อง');
  const res = v.res;
  if (typeof res !== 'number' || !(SCULPT_RESOLUTIONS as readonly number[]).includes(res)) {
    throw new Map3dConfigError(`terrain.sculpt.res ต้องเป็นหนึ่งใน ${SCULPT_RESOLUTIONS.join(', ')}`);
  }
  const data = v.data;
  const bytes = res * res * 2;
  if (
    typeof data !== 'string' ||
    data.length !== Math.ceil(bytes / 3) * 4 ||
    !BASE64.test(data) ||
    Buffer.from(data, 'base64').length !== bytes
  ) {
    throw new Map3dConfigError('terrain.sculpt.data ไม่ตรงกับขนาดตาราง');
  }
  return { res, data };
}
const SOURCES: GeometrySource[] = ['sam', 'vision', 'manual'];

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function num(v: unknown, path: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) {
    throw new Map3dConfigError(`${path} ต้องเป็นตัวเลข ${min}..${max}`);
  }
  return v;
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], path: string): T {
  if (typeof v !== 'string' || !allowed.includes(v as T)) {
    throw new Map3dConfigError(`${path} ต้องเป็นหนึ่งใน ${allowed.join(', ')}`);
  }
  return v as T;
}

function points(v: unknown, path: string, min: number): Point[] {
  if (!Array.isArray(v) || v.length < min || v.length > MAX_POINTS_PER_SHAPE) {
    throw new Map3dConfigError(`${path} ต้องมี ${min}..${MAX_POINTS_PER_SHAPE} จุด`);
  }
  return v.map((p, i) => {
    if (!Array.isArray(p) || p.length !== 2)
      throw new Map3dConfigError(`${path}[${i}] ต้องเป็น [x, y]`);
    return [
      round4(num(p[0], `${path}[${i}].x`, 0, 1)),
      round4(num(p[1], `${path}[${i}].y`, 0, 1)),
    ] as Point;
  });
}

function layer<T>(v: unknown, path: string, map: (item: Obj, path: string) => T): T[] {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > MAX_ITEMS_PER_LAYER) {
    throw new Map3dConfigError(`${path} ต้องเป็นรายการไม่เกิน ${MAX_ITEMS_PER_LAYER} ชิ้น`);
  }
  return v.map((item, i) => {
    if (!isObj(item)) throw new Map3dConfigError(`${path}[${i}] ไม่ถูกต้อง`);
    return map(item, `${path}[${i}]`);
  });
}

function base(
  item: Obj,
  path: string,
): { id: string; label?: string; confidence?: number; source?: GeometrySource } {
  const id =
    typeof item.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(item.id) ? item.id : randomUUID();
  const out: { id: string; label?: string; confidence?: number; source?: GeometrySource } = { id };
  if (item.label !== undefined) {
    if (typeof item.label !== 'string') throw new Map3dConfigError(`${path}.label ต้องเป็นข้อความ`);
    out.label = item.label.slice(0, 80);
  }
  if (item.confidence !== undefined)
    out.confidence = num(item.confidence, `${path}.confidence`, 0, 1);
  if (item.source !== undefined) out.source = oneOf(item.source, SOURCES, `${path}.source`);
  return out;
}

/**
 * ตรวจ + ทำความสะอาดฉากที่ client ส่งมา — คืนเฉพาะ field ที่รู้จัก (ตัดของแปลกปลอมทิ้ง)
 * ground.imageUrl และ props[].glbUrl ต้องให้ service ตรวจต่อว่าเป็นไฟล์ในระบบเราเอง
 *
 * @throws Map3dConfigError ข้อความภาษาไทยบอก path ที่ผิด
 */
export function sanitizeMap3dConfig(raw: unknown): Map3dConfig {
  if (!isObj(raw)) throw new Map3dConfigError('config ต้องเป็น object');
  const scale = isObj(raw.scale) ? raw.scale : {};
  const ground = isObj(raw.ground) ? raw.ground : {};
  const terrain = isObj(raw.terrain) ? raw.terrain : {};
  const imageUrl = ground.imageUrl;
  if (
    imageUrl !== null &&
    imageUrl !== undefined &&
    (typeof imageUrl !== 'string' || imageUrl.length > 500)
  ) {
    throw new Map3dConfigError('ground.imageUrl ไม่ถูกต้อง');
  }

  return {
    version: 1,
    scale: {
      widthM: num(scale.widthM, 'scale.widthM', 1, 20000),
      depthM: num(scale.depthM, 'scale.depthM', 1, 20000),
    },
    northDeg: raw.northDeg === undefined ? 0 : num(raw.northDeg, 'northDeg', 0, 360),
    ground: {
      imageUrl: typeof imageUrl === 'string' ? imageUrl : null,
      mode: ground.mode === undefined ? 'drape' : oneOf(ground.mode, GROUND_MODES, 'ground.mode'),
    },
    terrain: {
      preset:
        terrain.preset === undefined
          ? 'gentle'
          : oneOf(terrain.preset, TERRAIN_PRESETS, 'terrain.preset'),
      ...(terrain.sculpt === undefined || terrain.sculpt === null ? {} : { sculpt: sculpt(terrain.sculpt) }),
      ...(terrain.waterLevelM === undefined || terrain.waterLevelM === null
        ? {}
        : { waterLevelM: num(terrain.waterLevelM, 'terrain.waterLevelM', -500, 500) }),
      ...(terrain.waterColor === undefined
        ? {}
        : {
            waterColor: (() => {
              if (typeof terrain.waterColor !== 'string' || !HEX_COLOR.test(terrain.waterColor)) {
                throw new Map3dConfigError('terrain.waterColor ต้องเป็นสี #rrggbb');
              }
              return terrain.waterColor.toLowerCase();
            })(),
          }),
    },
    water: layer(raw.water, 'water', (it, p) => ({
      ...base(it, p),
      kind: oneOf(it.kind, WATER_KINDS, `${p}.kind`),
      polygon: points(it.polygon, `${p}.polygon`, 3),
    })),
    rivers: layer(raw.rivers, 'rivers', (it, p) => ({
      ...base(it, p),
      polyline: points(it.polyline, `${p}.polyline`, 2),
      widthM: num(it.widthM, `${p}.widthM`, 0.5, 500),
    })),
    roads: layer(raw.roads, 'roads', (it, p) => ({
      ...base(it, p),
      polyline: points(it.polyline, `${p}.polyline`, 2),
      widthM: num(it.widthM, `${p}.widthM`, 0.5, 100),
      surface: oneOf(it.surface, SURFACES, `${p}.surface`),
    })),
    forests: layer(raw.forests, 'forests', (it, p) => ({
      ...base(it, p),
      polygon: points(it.polygon, `${p}.polygon`, 3),
      density: num(it.density, `${p}.density`, 0, 1),
      species: oneOf(it.species, SPECIES, `${p}.species`),
    })),
    areas: layer(raw.areas, 'areas', (it, p) => ({
      ...base(it, p),
      kind: oneOf(it.kind, AREA_KINDS, `${p}.kind`),
      polygon: points(it.polygon, `${p}.polygon`, 3),
    })),
    props: layer(raw.props, 'props', (it, p) => {
      const hasPitch = it.pitchId !== undefined && it.pitchId !== null;
      if (hasPitch && (typeof it.pitchId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(it.pitchId))) {
        throw new Map3dConfigError(`${p}.pitchId ไม่ถูกต้อง`);
      }
      const prop = {
        ...base(it, p),
        type: oneOf(it.type, PROP_TYPES, `${p}.type`),
        x: round4(num(it.x, `${p}.x`, 0, 1)),
        y: round4(num(it.y, `${p}.y`, 0, 1)),
        rot: it.rot === undefined ? 0 : num(it.rot, `${p}.rot`, 0, 360),
        // ผูกกับจุดกางเต็นท์ — ย้ายจุดแล้วของตกแต่งย้ายตาม
        ...(hasPitch ? { pitchId: it.pitchId as string } : {}),
      };
      // glbUrl = โมเดลเฉพาะของลาน — service ต้องตรวจต่อว่าเป็นไฟล์ที่อัปโหลดเข้าระบบเราเอง
      if (it.glbUrl === undefined || it.glbUrl === null) return prop;
      if (typeof it.glbUrl !== 'string' || it.glbUrl.length > 500 || !/\.glb$/i.test(it.glbUrl)) {
        throw new Map3dConfigError(`${p}.glbUrl ไม่ถูกต้อง`);
      }
      return {
        ...prop,
        glbUrl: it.glbUrl,
        ...(it.sizeM === undefined ? {} : { sizeM: num(it.sizeM, `${p}.sizeM`, 0.5, 500) }),
      };
    }),
    ...(raw.clusters === undefined ? {} : { clusters: clusters(raw.clusters) }),
  };
}

function clusters(v: unknown): Map3dCluster[] {
  if (!Array.isArray(v) || v.length > MAX_CLUSTERS) {
    throw new Map3dConfigError(`clusters ต้องเป็นรายการไม่เกิน ${MAX_CLUSTERS} วง`);
  }
  return v.map((it, i) => {
    const p = `clusters[${i}]`;
    if (!isObj(it)) throw new Map3dConfigError(`${p} ไม่ถูกต้อง`);
    const count = num(it.count, `${p}.count`, 2, 40);
    if (!Number.isInteger(count)) throw new Map3dConfigError(`${p}.count ต้องเป็นจำนวนเต็ม`);
    return {
      id: base(it, p).id,
      type: oneOf(it.type, CLUSTER_TYPES, `${p}.type`),
      x: round4(num(it.x, `${p}.x`, 0, 1)),
      y: round4(num(it.y, `${p}.y`, 0, 1)),
      rot: it.rot === undefined ? 0 : num(it.rot, `${p}.rot`, 0, 360),
      count,
      radiusM: num(it.radiusM, `${p}.radiusM`, 1, 200),
      faceCenter: it.faceCenter !== false,
      campfire: it.campfire === true,
    };
  });
}

/** จำนวนองค์ประกอบโดยย่อของฉาก — เก็บคู่กับประวัติเวอร์ชัน แสดงในรายการได้โดยไม่ต้องโหลด config */
export interface Map3dSummary {
  water: number;
  rivers: number;
  roads: number;
  forests: number;
  areas: number;
  props: number;
  clusters: number;
  sculpted: boolean;
  waterLevel: boolean;
}

export function map3dSummary(config: Map3dConfig): Map3dSummary {
  return {
    water: config.water.length,
    rivers: config.rivers.length,
    roads: config.roads.length,
    forests: config.forests.length,
    areas: config.areas.length,
    props: config.props.length,
    clusters: config.clusters?.length ?? 0,
    sculpted: Boolean(config.terrain.sculpt),
    waterLevel: typeof config.terrain.waterLevelM === 'number',
  };
}
