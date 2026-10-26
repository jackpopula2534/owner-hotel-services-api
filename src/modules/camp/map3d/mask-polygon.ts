import { Point } from './map3d.types';

// pngjs มาพร้อม dependency อื่นและไม่มี type definitions — ใช้เฉพาะ PNG.sync.read
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PNG } = require('pngjs') as {
  PNG: { sync: { read(buf: Buffer): { width: number; height: number; data: Buffer } } };
};

/** ด้านยาวสุดของ grid ที่ใช้ trace — mask ใหญ่แค่ไหนก็ย่อลงมาเท่านี้ */
const GRID_MAX = 200;
/** component ที่เล็กกว่านี้ (จำนวน cell) ถือว่าเป็น noise */
const MIN_COMPONENT_CELLS = 12;
/** polygon ที่ส่งออกมีจุดไม่เกินนี้ (ฉาก 3D ไม่ต้องละเอียดกว่านี้) */
const MAX_POLYGON_POINTS = 120;

export interface MaskGrid {
  width: number;
  height: number;
  /** 1 = พื้นที่ของวัตถุ */
  cells: Uint8Array;
}

/**
 * ถอด mask PNG ของ SAM (ขาว = วัตถุ บนพื้นดำ/โปร่งใส) เป็น grid ขนาดไม่เกิน GRID_MAX
 * คืน null ถ้าไม่ใช่ PNG หรือ mask ว่าง/เต็มทั้งรูป (SAM จับอะไรไม่ได้)
 */
export function decodeMask(png: Buffer): MaskGrid | null {
  let image: { width: number; height: number; data: Buffer };
  try {
    image = PNG.sync.read(png);
  } catch {
    return null;
  }
  const { width: srcW, height: srcH, data } = image;
  if (!srcW || !srcH) return null;

  const factor = Math.max(1, Math.ceil(Math.max(srcW, srcH) / GRID_MAX));
  const width = Math.ceil(srcW / factor);
  const height = Math.ceil(srcH / factor);
  const hits = new Uint32Array(width * height);
  const totals = new Uint32Array(width * height);

  for (let y = 0; y < srcH; y++) {
    for (let x = 0; x < srcW; x++) {
      const i = (y * srcW + x) * 4;
      const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      const cell = Math.floor(y / factor) * width + Math.floor(x / factor);
      totals[cell] += 1;
      if (data[i + 3] >= 128 && lum >= 128) hits[cell] += 1;
    }
  }

  const cells = new Uint8Array(width * height);
  let filled = 0;
  for (let c = 0; c < cells.length; c++) {
    if (hits[c] * 2 >= totals[c]) {
      cells[c] = 1;
      filled += 1;
    }
  }
  const ratio = filled / cells.length;
  if (filled < MIN_COMPONENT_CELLS || ratio > 0.95) return null;
  return { width, height, cells };
}

/**
 * แยก component (4-connected) ที่ครอบจุด seed (normalized) ถ้า seed ตกในวัตถุ
 * ไม่อย่างนั้นใช้ component ที่ใหญ่สุด
 */
export function pickComponent(grid: MaskGrid, seed?: Point): Uint8Array | null {
  const { width, height, cells } = grid;
  const label = new Int32Array(cells.length).fill(-1);
  const sizes: number[] = [];
  const stack: number[] = [];

  for (let start = 0; start < cells.length; start++) {
    if (!cells[start] || label[start] !== -1) continue;
    const id = sizes.length;
    let size = 0;
    stack.push(start);
    label[start] = id;
    while (stack.length) {
      const c = stack.pop() as number;
      size += 1;
      const x = c % width;
      const y = (c - x) / width;
      const next = [
        x > 0 ? c - 1 : -1,
        x < width - 1 ? c + 1 : -1,
        y > 0 ? c - width : -1,
        y < height - 1 ? c + width : -1,
      ];
      for (const n of next) {
        if (n >= 0 && cells[n] && label[n] === -1) {
          label[n] = id;
          stack.push(n);
        }
      }
    }
    sizes.push(size);
  }
  if (!sizes.length) return null;

  let chosen = sizes.indexOf(Math.max(...sizes));
  if (seed) {
    const sx = Math.min(width - 1, Math.max(0, Math.floor(seed[0] * width)));
    const sy = Math.min(height - 1, Math.max(0, Math.floor(seed[1] * height)));
    const seedLabel = label[sy * width + sx];
    if (seedLabel >= 0 && sizes[seedLabel] >= MIN_COMPONENT_CELLS) chosen = seedLabel;
  }
  if (sizes[chosen] < MIN_COMPONENT_CELLS) return null;

  const out = new Uint8Array(cells.length);
  for (let c = 0; c < cells.length; c++) if (label[c] === chosen) out[c] = 1;
  return out;
}

// ตามเข็มนาฬิกาในพิกัดจอ (y ลงล่าง): W, NW, N, NE, E, SE, S, SW
const DIRS: Point[] = [
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
];

/** Moore-neighbor tracing — คืนขอบนอกของ component เป็นลำดับ cell */
export function traceContour(component: Uint8Array, width: number, height: number): Point[] {
  const at = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < width && y < height && component[y * width + x] === 1;
  const startIdx = component.indexOf(1);
  if (startIdx < 0) return [];
  const start: Point = [startIdx % width, Math.floor(startIdx / width)];

  const contour: Point[] = [start];
  let current = start;
  // cell แรกตามลำดับ raster จึงด้านซ้ายเป็นพื้นหลังเสมอ
  let backDir = 0;
  const limit = width * height * 4;

  for (let step = 0; step < limit; step++) {
    let found = -1;
    for (let k = 1; k <= 8; k++) {
      const d = (backDir + k) % 8;
      if (at(current[0] + DIRS[d][0], current[1] + DIRS[d][1])) {
        found = d;
        break;
      }
    }
    if (found < 0) break; // cell เดี่ยว
    const next: Point = [current[0] + DIRS[found][0], current[1] + DIRS[found][1]];
    // ทิศที่ชี้กลับไปหา cell พื้นหลังที่เพิ่งตรวจก่อนเจอ next (มองจาก next)
    const prev = (found + 7) % 8;
    const bg: Point = [current[0] + DIRS[prev][0], current[1] + DIRS[prev][1]];
    backDir = DIRS.findIndex(([dx, dy]) => next[0] + dx === bg[0] && next[1] + dy === bg[1]);
    if (backDir < 0) backDir = (found + 4) % 8;

    if (next[0] === start[0] && next[1] === start[1]) break;
    contour.push(next);
    current = next;
  }
  return contour;
}

function perpendicularDistance(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / len;
}

/** Douglas-Peucker ของเส้นเปิด (คงจุดแรกและจุดสุดท้าย) */
export function simplifyPolyline(points: Point[], epsilon: number): Point[] {
  if (points.length <= 2) return points.slice();
  let maxDist = 0;
  let index = 0;
  const last = points.length - 1;
  for (let i = 1; i < last; i++) {
    const d = perpendicularDistance(points[i], points[0], points[last]);
    if (d > maxDist) {
      maxDist = d;
      index = i;
    }
  }
  if (maxDist <= epsilon) return [points[0], points[last]];
  const left = simplifyPolyline(points.slice(0, index + 1), epsilon);
  const right = simplifyPolyline(points.slice(index), epsilon);
  return [...left.slice(0, -1), ...right];
}

/** ลดจุดของ polygon ปิด: ตัดเป็น 2 เส้นที่จุดไกลสุดจากจุดแรก แล้ว simplify ทีละครึ่ง */
export function simplifyPolygon(ring: Point[], epsilon: number): Point[] {
  if (ring.length <= 3) return ring.slice();
  let far = 0;
  let farDist = -1;
  ring.forEach((p, i) => {
    const d = Math.hypot(p[0] - ring[0][0], p[1] - ring[0][1]);
    if (d > farDist) {
      farDist = d;
      far = i;
    }
  });
  const first = simplifyPolyline(ring.slice(0, far + 1), epsilon);
  const second = simplifyPolyline([...ring.slice(far), ring[0]], epsilon);
  return [...first.slice(0, -1), ...second.slice(0, -1)];
}

/** พื้นที่ของ polygon (shoelace) ในหน่วยของพิกัดที่ส่งเข้ามา */
export function polygonArea(ring: Point[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

const round4 = (n: number) => Math.round(n * 10000) / 10000;

/**
 * mask PNG → polygon normalized 0..1 (null = ใช้ไม่ได้ ให้ fallback เป็นรูปทรงจาก vision)
 *
 * @param seed จุด normalized ที่ใช้ prompt SAM — เลือก component ที่ครอบจุดนี้
 */
export function maskToPolygon(png: Buffer, seed?: Point): Point[] | null {
  const grid = decodeMask(png);
  if (!grid) return null;
  const component = pickComponent(grid, seed);
  if (!component) return null;
  const contour = traceContour(component, grid.width, grid.height);
  if (contour.length < 4) return null;

  let epsilon = 1;
  let ring = simplifyPolygon(contour, epsilon);
  while (ring.length > MAX_POLYGON_POINTS) {
    epsilon *= 1.5;
    ring = simplifyPolygon(contour, epsilon);
  }
  if (ring.length < 3) return null;
  return ring.map(
    ([x, y]) => [round4((x + 0.5) / grid.width), round4((y + 0.5) / grid.height)] as Point,
  );
}
