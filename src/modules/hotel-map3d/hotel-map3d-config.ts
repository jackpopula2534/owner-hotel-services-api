import { BadRequestException } from '@nestjs/common';
import {
  HOTEL_BUILDING_PRESETS,
  HOTEL_PROP_TYPES,
  HotelBuilding,
  HotelBuildingPreset,
  HotelMap3dConfig,
  HotelProp,
  HotelPropType,
} from './hotel-map3d.types';

export const MAX_BUILDINGS = 20;
export const MAX_PROPS = 300;
export const MAX_FLOORS = 60;
export const MAX_PER_ROW = 40;
export const MAX_SITE_M = 2000;

const HEX = /^#[0-9a-fA-F]{6}$/;
const ID = /^[A-Za-z0-9_-]{1,40}$/;

const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const int = (v: unknown, a: number, b: number, fallback: number) => clamp(Math.round(num(v, fallback)), a, b);
const round1 = (v: number) => Math.round(v * 10) / 10;

/** ช่องทั้งหมดของอาคารหนึ่งหลัง — ใช้ตรวจคีย์ slots และให้ฝั่งหน้าเว็บวาดตรงกัน */
export function buildingSlotKeys(b: Pick<HotelBuilding, 'id' | 'preset' | 'floors' | 'per' | 'sides' | 'lobby'>): string[] {
  const keys: string[] = [];
  if (b.preset === 'villas') {
    for (let i = 0; i < b.per; i++) keys.push(`${b.id}:1:0:${i}`);
    return keys;
  }
  for (let f = b.lobby ? 2 : 1; f <= b.floors; f++)
    for (let s = 0; s < b.sides; s++) for (let i = 0; i < b.per; i++) keys.push(`${b.id}:${f}:${s}:${i}`);
  return keys;
}

function sanitizeBuilding(raw: unknown, i: number, half: { w: number; d: number }): HotelBuilding | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const preset = (HOTEL_BUILDING_PRESETS as readonly string[]).includes(o.preset as string)
    ? (o.preset as HotelBuildingPreset)
    : 'bar';
  const villas = preset === 'villas';
  return {
    id: typeof o.id === 'string' && ID.test(o.id) ? o.id : `B${i + 1}`,
    name: (typeof o.name === 'string' && o.name.trim() ? o.name.trim() : `อาคาร ${i + 1}`).slice(0, 80),
    preset,
    x: round1(clamp(num(o.x, 0), -half.w, half.w)),
    z: round1(clamp(num(o.z, 0), -half.d, half.d)),
    rot: ((Math.round(num(o.rot, 0)) % 360) + 360) % 360,
    floors: villas ? 1 : int(o.floors, 1, MAX_FLOORS, 3),
    per: int(o.per, 1, MAX_PER_ROW, 6),
    sides: villas ? 1 : o.sides === 1 ? 1 : 2,
    lobby: villas ? false : Boolean(o.lobby),
    wall: typeof o.wall === 'string' && HEX.test(o.wall) ? o.wall.toLowerCase() : '#efe9df',
    roof: o.roof === 'gable' ? 'gable' : 'flat',
  };
}

function sanitizeProp(raw: unknown, i: number, half: { w: number; d: number }): HotelProp | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (!(HOTEL_PROP_TYPES as readonly string[]).includes(o.t as string)) return null;
  return {
    id: typeof o.id === 'string' && ID.test(o.id) ? o.id : `P${i + 1}`,
    t: o.t as HotelPropType,
    x: round1(clamp(num(o.x, 0), -half.w, half.w)),
    z: round1(clamp(num(o.z, 0), -half.d, half.d)),
    rot: ((Math.round(num(o.rot, 0)) % 360) + 360) % 360,
  };
}

/**
 * ตรวจและทำความสะอาดฉากที่หน้าเว็บส่งมา
 * — ค่าที่เกินขอบเขตถูกบีบเข้าช่วง ไม่ใช่โยน error (ฉากต้องบันทึกได้เสมอ)
 * — ช่องที่ไม่มีอยู่จริงบนอาคาร / ห้องที่ไม่ใช่ของโรงแรมนี้ / ห้องซ้ำ ถูกทิ้ง
 * ส่ง roomIds = null เพื่อข้ามการตรวจห้อง (ใช้ในเทสต์รูปทรง)
 */
export function sanitizeHotelMap3dConfig(raw: unknown, roomIds: ReadonlySet<string> | null): HotelMap3dConfig {
  if (!raw || typeof raw !== 'object') throw new BadRequestException('ฉาก 3D ไม่ถูกต้อง');
  const o = raw as Record<string, unknown>;
  const site = (o.site ?? {}) as Record<string, unknown>;
  const widthM = clamp(num(site.widthM, 120), 20, MAX_SITE_M);
  const depthM = clamp(num(site.depthM, 90), 20, MAX_SITE_M);
  const half = { w: widthM / 2, d: depthM / 2 };

  const seenB = new Set<string>();
  const buildings = (Array.isArray(o.buildings) ? o.buildings : [])
    .slice(0, MAX_BUILDINGS)
    .map((b, i) => sanitizeBuilding(b, i, half))
    .filter((b): b is HotelBuilding => {
      if (!b || seenB.has(b.id)) return false;
      seenB.add(b.id);
      return true;
    });

  const validKeys = new Set(buildings.flatMap(buildingSlotKeys));
  const slots: Record<string, string> = {};
  const usedRooms = new Set<string>();
  const rawSlots = o.slots && typeof o.slots === 'object' ? (o.slots as Record<string, unknown>) : {};
  for (const [key, roomId] of Object.entries(rawSlots)) {
    if (!validKeys.has(key) || typeof roomId !== 'string') continue;
    if (roomIds && !roomIds.has(roomId)) continue;
    if (usedRooms.has(roomId)) continue;
    usedRooms.add(roomId);
    slots[key] = roomId;
  }

  const seenP = new Set<string>();
  const props = (Array.isArray(o.props) ? o.props : [])
    .slice(0, MAX_PROPS)
    .map((p, i) => sanitizeProp(p, i, half))
    .filter((p): p is HotelProp => {
      if (!p) return false;
      if (seenP.has(p.id)) p.id = `${p.id}-${seenP.size}`;
      seenP.add(p.id);
      return true;
    });

  return { version: 1, site: { widthM, depthM }, buildings, slots, props };
}

/** สรุปย่อของเวอร์ชัน — แสดงในรายการประวัติโดยไม่ต้องโหลดฉากทั้งก้อน */
export function hotelMap3dSummary(c: HotelMap3dConfig) {
  return {
    buildings: c.buildings.length,
    floors: c.buildings.reduce((m, b) => Math.max(m, b.floors), 0),
    slots: c.buildings.reduce((n, b) => n + buildingSlotKeys(b).length, 0),
    mapped: Object.keys(c.slots).length,
    props: c.props.length,
  };
}
