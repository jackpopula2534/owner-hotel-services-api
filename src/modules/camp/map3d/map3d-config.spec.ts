import {
  VisionResult,
  buildDraft,
  isSegmentable,
  promptPoints,
  sanitizeMap3dConfig,
  Map3dConfigError,
} from './map3d-config';
import { Point } from './map3d.types';

const input = { widthM: 300, depthM: 200, northDeg: 15, imageUrl: '/uploads/camp/plan.png' };

const vision: VisionResult = {
  imageKind: 'top_down_plan',
  notes: 'plan',
  labels: [{ text: 'โซน A', x: 0.2, y: 0.3 }],
  features: [
    {
      kind: 'lake',
      label: 'ทะเลสาบ',
      confidence: 0.9,
      geometry: 'polygon',
      points: [
        [0.1, 0.1],
        [0.3, 0.1],
        [0.3, 0.3],
        [0.1, 0.3],
      ],
      samplePoints: [[0.2, 0.2]],
      widthM: null,
    },
    {
      kind: 'road',
      label: 'ถนนหลัก',
      confidence: 0.8,
      geometry: 'polyline',
      points: [
        [0, 0.5],
        [1, 0.5],
      ],
      samplePoints: [],
      widthM: 6,
    },
    {
      kind: 'forest',
      label: 'ป่า',
      confidence: 0.4,
      geometry: 'polygon',
      points: [
        [0.6, 0.6],
        [0.9, 0.6],
        [0.9, 0.9],
      ],
      samplePoints: [],
      widthM: null,
    },
    {
      kind: 'restroom',
      label: 'ห้องน้ำ',
      confidence: 0.95,
      geometry: 'point',
      points: [[0.5, 0.2]],
      samplePoints: [],
      widthM: null,
    },
    {
      kind: 'river',
      label: 'ลำธาร',
      confidence: 0.7,
      geometry: 'polyline',
      points: [
        [0.1, 0.9],
        [1.4, 0.95],
      ],
      samplePoints: [],
      widthM: null,
    },
  ],
};

describe('buildDraft', () => {
  it('maps vision features into scene layers, preferring SAM outlines', () => {
    const sam: Point[] = [
      [0.11, 0.11],
      [0.29, 0.12],
      [0.28, 0.29],
      [0.12, 0.28],
    ];
    const draft = buildDraft(
      vision,
      new Map([
        [0, sam],
        [2, null],
      ]),
      input,
      2,
      false,
    );
    const c = draft.config;

    expect(c.scale).toEqual({ widthM: 300, depthM: 200 });
    expect(c.northDeg).toBe(15);
    expect(c.ground).toEqual({ imageUrl: '/uploads/camp/plan.png', mode: 'drape' });
    expect(c.water[0]).toMatchObject({ kind: 'lake', polygon: sam, source: 'sam' });
    expect(c.roads[0]).toMatchObject({ widthM: 6, surface: 'gravel', source: 'vision' });
    expect(c.forests[0]).toMatchObject({ density: 0.6, source: 'vision' });
    expect(c.props[0]).toMatchObject({ type: 'restroom', x: 0.5, y: 0.2 });
    // พิกัดที่หลุดกรอบถูก clamp ไว้ใน 0..1
    expect(c.rivers[0].polyline[1]).toEqual([1, 0.95]);
    expect(draft.labels).toEqual([{ text: 'โซน A', x: 0.2, y: 0.3 }]);
    expect(draft.segmentCalls).toBe(2);

    const codes = draft.warnings.map((w) => w.code).sort();
    expect(codes).toEqual(['LOW_CONFIDENCE', 'SEGMENT_FALLBACK']);
    expect(draft.warnings.find((w) => w.code === 'LOW_CONFIDENCE')?.itemId).toBe(c.forests[0].id);
  });

  it('warns about non top-down images, missing segmentation and empty results', () => {
    const draft = buildDraft(
      { ...vision, imageKind: 'perspective', features: [] },
      new Map(),
      input,
      0,
      true,
    );
    expect(draft.warnings.map((w) => w.code)).toEqual([
      'SEGMENT_UNAVAILABLE',
      'NOT_TOP_DOWN',
      'NOTHING_FOUND',
    ]);
  });
});

describe('segment helpers', () => {
  it('only segments area polygons and prompts with sample points or the centroid', () => {
    expect(vision.features.map(isSegmentable)).toEqual([true, false, true, false, false]);
    expect(promptPoints(vision.features[0])).toEqual([[0.2, 0.2]]);
    expect(promptPoints(vision.features[2])).toEqual([[0.8, 0.7]]);
  });
});

describe('sanitizeMap3dConfig', () => {
  const draft = buildDraft(vision, new Map(), input, 0, false).config;

  it('accepts a draft round-trip and strips unknown fields', () => {
    const clean = sanitizeMap3dConfig({
      ...draft,
      evil: '<script>',
      props: [{ ...draft.props[0], evil: 1 }],
    });
    expect(clean).not.toHaveProperty('evil');
    expect(clean.props[0]).not.toHaveProperty('evil');
    expect(clean.props[0]).not.toHaveProperty('glbUrl');
    expect(clean.water).toHaveLength(1);
  });

  describe('custom map editor fields', () => {
    const sculptData = (res: number) => Buffer.alloc(res * res * 2, 1).toString('base64');

    it('keeps sculpt, water level, water colour and clusters', () => {
      const clean = sanitizeMap3dConfig({
        ...draft,
        terrain: { preset: 'hilly', sculpt: { res: 65, data: sculptData(65) }, waterLevelM: -1.5, waterColor: '#3D8FBF' },
        clusters: [
          { id: 'ring-1', type: 'tent', x: 0.4, y: 0.6, count: 8, radiusM: 18, faceCenter: true, campfire: true, evil: 1 },
        ],
      });
      expect(clean.terrain).toEqual({
        preset: 'hilly',
        sculpt: { res: 65, data: sculptData(65) },
        waterLevelM: -1.5,
        waterColor: '#3d8fbf',
      });
      expect(clean.clusters).toEqual([
        { id: 'ring-1', type: 'tent', x: 0.4, y: 0.6, rot: 0, count: 8, radiusM: 18, faceCenter: true, campfire: true },
      ]);
    });

    it('leaves old scenes untouched (no new keys)', () => {
      const clean = sanitizeMap3dConfig(draft);
      expect(clean.terrain).toEqual({ preset: draft.terrain.preset });
      expect(clean).not.toHaveProperty('clusters');
    });

    it('rejects a sculpt grid of the wrong size or resolution', () => {
      expect(() =>
        sanitizeMap3dConfig({ ...draft, terrain: { preset: 'flat', sculpt: { res: 65, data: sculptData(33) } } }),
      ).toThrow(/sculpt\.data/);
      expect(() =>
        sanitizeMap3dConfig({ ...draft, terrain: { preset: 'flat', sculpt: { res: 64, data: sculptData(64) } } }),
      ).toThrow(/sculpt\.res/);
      expect(() =>
        sanitizeMap3dConfig({ ...draft, terrain: { preset: 'flat', sculpt: { res: 33, data: '!'.repeat(sculptData(33).length) } } }),
      ).toThrow(/sculpt\.data/);
    });

    it('keeps decor attached to a pitch and rejects odd pitch ids', () => {
      const prop = { id: 'd1', type: 'campfire', x: 0.5, y: 0.5, pitchId: 'b1f8c1d2-0000-4c4c-9e9e-1234567890ab' };
      expect(sanitizeMap3dConfig({ ...draft, props: [prop] }).props[0].pitchId).toBe(prop.pitchId);
      expect(() => sanitizeMap3dConfig({ ...draft, props: [{ ...prop, pitchId: 'x y' }] })).toThrow(/pitchId/);
    });

    it('rejects bad clusters and colours', () => {
      const ring = { type: 'dome', x: 0.5, y: 0.5, count: 6, radiusM: 10 };
      expect(() => sanitizeMap3dConfig({ ...draft, clusters: [{ ...ring, type: 'car' }] })).toThrow(/clusters\[0\]\.type/);
      expect(() => sanitizeMap3dConfig({ ...draft, clusters: [{ ...ring, count: 2.5 }] })).toThrow(/count/);
      expect(() => sanitizeMap3dConfig({ ...draft, clusters: [{ ...ring, radiusM: 0 }] })).toThrow(/radiusM/);
      expect(() =>
        sanitizeMap3dConfig({ ...draft, terrain: { preset: 'flat', waterColor: 'red' } }),
      ).toThrow(/waterColor/);
    });
  });

  it('keeps a prop model url + size and rejects non-glb urls', () => {
    const prop = { ...draft.props[0], glbUrl: '/uploads/camp/m.glb', sizeM: 12 };
    expect(sanitizeMap3dConfig({ ...draft, props: [prop] }).props[0]).toMatchObject({
      glbUrl: '/uploads/camp/m.glb',
      sizeM: 12,
    });
    expect(() =>
      sanitizeMap3dConfig({ ...draft, props: [{ ...prop, glbUrl: '/uploads/camp/x.js' }] }),
    ).toThrow(/props\[0\]\.glbUrl/);
    expect(() => sanitizeMap3dConfig({ ...draft, props: [{ ...prop, sizeM: 0 }] })).toThrow(
      /sizeM/,
    );
  });

  it('accepts the template scene prop types and rejects unknown ones', () => {
    const types = ['cabin', 'caravan', 'car', 'lamp', 'campfire', 'dock', 'tree', 'picnic'];
    const props = types.map((type, i) => ({ id: `t-prop-${i}`, type, x: 0.5, y: 0.5 }));
    expect(sanitizeMap3dConfig({ ...draft, props }).props.map((p) => p.type)).toEqual(types);
    expect(() =>
      sanitizeMap3dConfig({ ...draft, props: [{ type: 'spaceship', x: 0.5, y: 0.5 }] }),
    ).toThrow(/props\[0\]\.type/);
  });

  it('rejects out-of-range coordinates and bad enums with a path', () => {
    expect(() =>
      sanitizeMap3dConfig({
        ...draft,
        water: [
          {
            kind: 'lake',
            polygon: [
              [0, 0],
              [2, 0],
              [0, 1],
            ],
          },
        ],
      }),
    ).toThrow(/water\[0\]\.polygon\[1\]\.x/);
    expect(() =>
      sanitizeMap3dConfig({
        ...draft,
        roads: [
          {
            polyline: [
              [0, 0],
              [1, 1],
            ],
            widthM: 4,
            surface: 'lava',
          },
        ],
      }),
    ).toThrow(Map3dConfigError);
    expect(() => sanitizeMap3dConfig({ scale: { widthM: 0, depthM: 10 } })).toThrow(
      /scale\.widthM/,
    );
  });

  it('caps layer size', () => {
    const many = Array.from({ length: 201 }, () => ({ type: 'tent', x: 0.5, y: 0.5 }));
    expect(() => sanitizeMap3dConfig({ ...draft, props: many })).toThrow(/props/);
  });
});
