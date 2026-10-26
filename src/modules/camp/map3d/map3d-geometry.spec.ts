import { readImageSize } from './image-size';
import { maskToPolygon, polygonArea, simplifyPolyline } from './mask-polygon';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PNG } = require('pngjs') as {
  PNG: new (o: { width: number; height: number }) => { data: Buffer } & Record<string, unknown>;
} & { sync: { write(png: unknown): Buffer } };

/** สร้าง mask PNG: inside(x, y) = true → ขาว */
function makeMask(
  width: number,
  height: number,
  inside: (x: number, y: number) => boolean,
): Buffer {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const v = inside(x, y) ? 255 : 0;
      png.data[i] = v;
      png.data[i + 1] = v;
      png.data[i + 2] = v;
      png.data[i + 3] = 255;
    }
  }
  return (PNG as unknown as { sync: { write(p: unknown): Buffer } }).sync.write(png);
}

describe('readImageSize', () => {
  it('reads PNG dimensions from IHDR', () => {
    expect(readImageSize(makeMask(640, 480, () => false))).toEqual({ width: 640, height: 480 });
  });

  it('reads JPEG dimensions from the SOF0 marker', () => {
    const jpeg = Buffer.from([
      0xff,
      0xd8,
      0xff,
      0xe0,
      0x00,
      0x04,
      0x00,
      0x00, // APP0 length 4
      0xff,
      0xc0,
      0x00,
      0x11,
      0x08,
      0x01,
      0xe0,
      0x02,
      0x80,
      0x03, // SOF0 h=480 w=640
      ...new Array(16).fill(0),
    ]);
    expect(readImageSize(jpeg)).toEqual({ width: 640, height: 480 });
  });

  it('returns null for unknown data', () => {
    expect(readImageSize(Buffer.alloc(40, 7))).toBeNull();
  });
});

describe('maskToPolygon', () => {
  it('traces a square mask into a normalized polygon that covers the square', () => {
    // สี่เหลี่ยม x 100..299, y 50..149 บนรูป 400x200
    const png = makeMask(400, 200, (x, y) => x >= 100 && x < 300 && y >= 50 && y < 150);
    const poly = maskToPolygon(png);
    expect(poly).not.toBeNull();
    const xs = poly!.map((p) => p[0]);
    const ys = poly!.map((p) => p[1]);
    expect(Math.min(...xs)).toBeCloseTo(0.25, 1);
    expect(Math.max(...xs)).toBeCloseTo(0.75, 1);
    expect(Math.min(...ys)).toBeCloseTo(0.25, 1);
    expect(Math.max(...ys)).toBeCloseTo(0.75, 1);
    // สี่เหลี่ยมควรเหลือไม่กี่มุม และพื้นที่ ≈ 0.5 × 0.5
    expect(poly!.length).toBeLessThanOrEqual(8);
    expect(polygonArea(poly!)).toBeCloseTo(0.25, 1);
  });

  it('keeps a circle smooth but under the point cap', () => {
    const png = makeMask(600, 600, (x, y) => (x - 300) ** 2 + (y - 300) ** 2 < 200 ** 2);
    const poly = maskToPolygon(png)!;
    expect(poly.length).toBeGreaterThan(8);
    expect(poly.length).toBeLessThanOrEqual(120);
    expect(polygonArea(poly)).toBeCloseTo(Math.PI / 9, 1);
  });

  it('picks the component under the seed point instead of the largest one', () => {
    const png = makeMask(
      400,
      400,
      (x, y) => (x < 150 && y < 150) || (x > 300 && x < 360 && y > 300 && y < 360),
    );
    const poly = maskToPolygon(png, [0.82, 0.82])!;
    expect(Math.min(...poly.map((p) => p[0]))).toBeGreaterThan(0.7);
  });

  it('rejects empty or full masks and non-PNG data', () => {
    expect(maskToPolygon(makeMask(100, 100, () => false))).toBeNull();
    expect(maskToPolygon(makeMask(100, 100, () => true))).toBeNull();
    expect(maskToPolygon(Buffer.from('not a png'))).toBeNull();
  });
});

describe('simplifyPolyline', () => {
  it('drops collinear points', () => {
    expect(
      simplifyPolyline(
        [
          [0, 0],
          [1, 0.01],
          [2, 0],
          [3, 0],
        ],
        0.1,
      ),
    ).toEqual([
      [0, 0],
      [3, 0],
    ]);
  });
});
