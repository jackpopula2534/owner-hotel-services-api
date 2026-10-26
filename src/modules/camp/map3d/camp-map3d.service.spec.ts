import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { CampMap3dService } from './camp-map3d.service';
import { makeGlb } from './glb-test-helpers';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PNG } = require('pngjs');

const TENANT = 'tenant-1';
const CAMP = '11111111-1111-4111-8111-111111111111';

function pngOf(
  width: number,
  height: number,
  inside: (x: number, y: number) => boolean = () => false,
): Buffer {
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) {
    const v = inside(i % width, Math.floor(i / width)) ? 255 : 0;
    png.data.fill(v, i * 4, i * 4 + 3);
    png.data[i * 4 + 3] = 255;
  }
  return PNG.sync.write(png);
}

const PLAN = pngOf(400, 300);
// SAM ตอบ mask ของวงกลมรอบ (100, 100) บนรูปขนาดเดียวกัน
const MASK = pngOf(400, 300, (x, y) => (x - 100) ** 2 + (y - 100) ** 2 < 50 ** 2);

const VISION = {
  imageKind: 'top_down_plan',
  notes: '',
  labels: [],
  features: [
    {
      kind: 'lake',
      label: 'บึง',
      confidence: 0.9,
      geometry: 'polygon',
      points: [
        [0.2, 0.2],
        [0.3, 0.2],
        [0.3, 0.4],
      ],
      samplePoints: [[0.25, 0.33]],
      widthM: null,
    },
    {
      kind: 'road',
      label: 'ถนน',
      confidence: 0.9,
      geometry: 'polyline',
      points: [
        [0, 0.8],
        [1, 0.8],
      ],
      samplePoints: [],
      widthM: null,
    },
  ],
};

function json(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  );
}

interface FetchPlan {
  openai?: () => Promise<Response>;
  falRun?: () => Promise<Response>;
}

function installFetch(plan: FetchPlan = {}) {
  const calls: string[] = [];
  global.fetch = jest.fn((url: string | URL | Request) => {
    const u = String(url);
    calls.push(u);
    if (u.startsWith('https://api.openai.com/')) {
      return (
        plan.openai ??
        (() =>
          json({
            choices: [{ message: { content: JSON.stringify(VISION) } }],
            usage: { prompt_tokens: 1200, completion_tokens: 300 },
          }))
      )();
    }
    if (u.startsWith('https://rest.alpha.fal.ai/storage/upload/initiate')) {
      return json({
        upload_url: 'https://upload.fal.media/put',
        file_url: 'https://v3.fal.media/files/plan.png',
      });
    }
    if (u === 'https://upload.fal.media/put')
      return Promise.resolve(new Response(null, { status: 200 }));
    if (u.startsWith('https://fal.run/')) {
      return (
        plan.falRun ?? (() => json({ image: { url: 'https://v3.fal.media/files/mask.png' } }))
      )();
    }
    if (u === 'https://v3.fal.media/files/mask.png')
      return Promise.resolve(new Response(new Uint8Array(MASK), { status: 200 }));
    return Promise.reject(new Error(`unexpected fetch ${u}`));
  }) as unknown as typeof fetch;
  return calls;
}

function setup(opts: { entitled?: boolean } = {}) {
  const rows = new Map<string, Record<string, unknown>>();
  let job: Promise<unknown> = Promise.resolve();
  const prisma = {
    campground: {
      findFirst: jest.fn().mockResolvedValue({
        id: CAMP,
        map3dConfig: null,
        map3dUpdatedAt: null,
        mapImageUrl: null,
      }),
      update: jest.fn(({ data }) =>
        Promise.resolve({
          id: CAMP,
          map3dConfig: data.map3dConfig,
          map3dUpdatedAt: data.map3dUpdatedAt,
        }),
      ),
    },
    campReservation: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    campMap3dVersion: {
      create: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    user: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    $transaction: jest.fn(),
    campMapExtraction: {
      findFirst: jest.fn(({ where }) => {
        if (where.id) return Promise.resolve(rows.get(where.id) ?? null);
        const active = [...rows.values()].find((r) =>
          (where.status?.in ?? [r.status]).includes(r.status),
        );
        return Promise.resolve(active ?? null);
      }),
      create: jest.fn(({ data }) => {
        const row = {
          step: null,
          result: null,
          errorCode: null,
          errorMessage: null,
          finishedAt: null,
          createdAt: new Date(),
          ...data,
        };
        rows.set(data.id, row);
        return Promise.resolve(row);
      }),
      updateMany: jest.fn(({ where, data }) => {
        const row = rows.get(where.id);
        if (!row || (where.status && row.status !== where.status))
          return Promise.resolve({ count: 0 });
        Object.assign(row, data);
        return Promise.resolve({ count: 1 });
      }),
    },
  };
  const storage = {
    save: jest.fn().mockResolvedValue({ url: 'http://localhost:9011/uploads/camp/camp3d-x.png' }),
    isOwnUrl: jest.fn((url: string) => url.startsWith('http://localhost:9011/uploads/camp/')),
  };
  const tenantContext = {
    run: jest.fn((_store: unknown, fn: () => Promise<unknown>) => {
      job = fn();
      return job;
    }),
  };
  const addonService = { hasActiveAddon: jest.fn().mockResolvedValue(opts.entitled ?? true) };
  const gateway = {
    availability: jest.fn().mockResolvedValue(null),
    run: jest.fn(
      async (
        ctx: { provider: string },
        fn: (i: { apiKey: string; model: string }) => Promise<{ result: unknown }>,
      ) => {
        if (ctx.provider === 'openai' && gatewayBlock.openai) throw gatewayBlock.openai;
        if (ctx.provider === 'fal' && gatewayBlock.fal) throw gatewayBlock.fal;
        const out = await fn({
          apiKey: `test-${ctx.provider}-key`,
          model: ctx.provider === 'openai' ? 'gpt-5-mini' : 'fal-ai/sam2/image',
        });
        return out.result;
      },
    ),
  };
  const gatewayBlock: { openai?: Error; fal?: Error } = {};
  const quota = {
    reserve: jest.fn().mockResolvedValue({
      reservationId: 'res-1',
      source: 'paid',
      isOverage: false,
      remaining: 4,
    }),
    commit: jest.fn().mockResolvedValue(undefined),
    refund: jest.fn().mockResolvedValue(true),
  };
  // ธุรกรรม = เรียก callback ด้วย client เดียวกัน (mock)
  prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma));
  const service = new CampMap3dService(
    prisma as never,
    storage as never,
    tenantContext as never,
    addonService as never,
    gateway as never,
    quota as never,
  );
  return {
    service,
    prisma,
    storage,
    tenantContext,
    addonService,
    gateway,
    gatewayBlock,
    quota,
    rows,
    waitJob: () => job,
  };
}

const file = { originalname: 'plan.png', mimetype: 'image/png', size: PLAN.length, buffer: PLAN };

describe('CampMap3dService — AI draft pipeline', () => {
  it('reserves quota, runs vision → SAM → draft, then commits', async () => {
    const calls = installFetch();
    const t = setup();

    const view = await t.service.startExtraction(CAMP, TENANT, 'user-1', file, { widthM: 400 });
    expect(view.status).toBe('pending');
    expect(t.quota.reserve).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT,
        addonCode: 'CAMP_3D_MAP',
        refType: 'CampMapExtraction',
        refId: view.id,
      }),
    );
    expect(t.tenantContext.run).toHaveBeenCalledWith(
      { tenantId: TENANT, skipScope: false },
      expect.any(Function),
    );
    await t.waitJob();

    const done = await t.service.getExtraction(CAMP, view.id, TENANT);
    expect(done.status).toBe('succeeded');
    expect(done.step).toBe('done');
    // depth คำนวณจากสัดส่วนรูป 400x300
    expect(done.result?.config.scale).toEqual({ widthM: 400, depthM: 300 });
    const lake = done.result!.config.water[0];
    expect(lake.source).toBe('sam');
    // วงกลมรัศมี 50px รอบ (100,100) → ขอบซ้ายสุด ≈ 50/400
    expect(Math.min(...lake.polygon.map((p) => p[0]))).toBeCloseTo(0.125, 1);
    expect(done.result!.config.roads).toHaveLength(1);
    expect(done.result!.segmentCalls).toBe(1);
    expect(t.quota.commit).toHaveBeenCalledWith(TENANT, 'res-1');
    expect(t.quota.refund).not.toHaveBeenCalled();

    // คีย์ไปถึงแค่ provider — prompt SAM เป็นพิกัด pixel
    const falCall = (global.fetch as jest.Mock).mock.calls.find(([u]) =>
      String(u).startsWith('https://fal.run/'),
    );
    expect(falCall[1].headers.Authorization).toBe('Key test-fal-key');
    expect(JSON.parse(falCall[1].body).prompts).toEqual([{ x: 100, y: 99, label: 1 }]);
    expect(calls.filter((u) => u.startsWith('https://fal.run/'))).toHaveLength(1);
    expect(t.gateway.run).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'openai',
        task: 'vision',
        feature: 'CAMP_3D_EXTRACT',
        tenantId: TENANT,
      }),
      expect.any(Function),
    );
  });

  it('falls back to vision outlines when fal is unavailable and still succeeds', async () => {
    installFetch();
    const t = setup();
    t.gatewayBlock.fal = new ServiceUnavailableException({
      code: 'AI_PROVIDER_UNAVAILABLE',
      message: 'x',
    });

    const view = await t.service.startExtraction(CAMP, TENANT, 'user-1', file, {
      widthM: 400,
      depthM: 250,
    });
    await t.waitJob();
    const done = await t.service.getExtraction(CAMP, view.id, TENANT);
    expect(done.status).toBe('succeeded');
    expect(done.result!.config.water[0].source).toBe('vision');
    expect(done.result!.warnings.map((w) => w.code)).toContain('SEGMENT_UNAVAILABLE');
    expect(t.quota.commit).toHaveBeenCalled();
  });

  it('refunds and reports a tenant-safe message when vision is blocked', async () => {
    installFetch();
    const t = setup();
    t.gatewayBlock.openai = new ServiceUnavailableException({
      code: 'AI_PROVIDER_UNAVAILABLE',
      message: 'x',
    });

    const view = await t.service.startExtraction(CAMP, TENANT, 'user-1', file, { widthM: 400 });
    await t.waitJob();
    const done = await t.service.getExtraction(CAMP, view.id, TENANT);
    expect(done.status).toBe('failed');
    expect(done.errorCode).toBe('AI_PROVIDER_UNAVAILABLE');
    expect(done.errorMessage).toMatch(/ปิดให้บริการชั่วคราว/);
    expect(t.quota.refund).toHaveBeenCalledWith(
      TENANT,
      'res-1',
      expect.stringContaining('AI_PROVIDER_UNAVAILABLE'),
      false,
    );
    expect(t.quota.commit).not.toHaveBeenCalled();
  });

  it('does not leak raw provider errors to the tenant', async () => {
    installFetch({
      openai: () => json({ error: { message: 'Incorrect API key provided: sk-abc***' } }, 401),
    });
    const t = setup();
    const view = await t.service.startExtraction(CAMP, TENANT, 'user-1', file, { widthM: 400 });
    await t.waitJob();
    const done = await t.service.getExtraction(CAMP, view.id, TENANT);
    expect(done.errorCode).toBe('AI_EXTRACT_FAILED');
    expect(done.errorMessage).not.toMatch(/sk-|API key/);
    expect(t.quota.refund).toHaveBeenCalled();
  });

  it('refunds when the AI finds nothing usable', async () => {
    installFetch({
      openai: () =>
        json({ choices: [{ message: { content: JSON.stringify({ ...VISION, features: [] }) } }] }),
    });
    const t = setup();
    const view = await t.service.startExtraction(CAMP, TENANT, 'user-1', file, { widthM: 400 });
    await t.waitJob();
    const done = await t.service.getExtraction(CAMP, view.id, TENANT);
    expect(done.errorCode).toBe('NOTHING_FOUND');
    expect(t.quota.refund).toHaveBeenCalled();
    expect(t.quota.commit).not.toHaveBeenCalled();
  });

  it('refuses up front without reserving quota or storing the file when AI is off', async () => {
    installFetch();
    const t = setup();
    t.gateway.availability.mockResolvedValue('AI_PROVIDER_UNAVAILABLE');
    await expect(
      t.service.startExtraction(CAMP, TENANT, 'user-1', file, { widthM: 400 }),
    ).rejects.toMatchObject({
      response: { code: 'AI_PROVIDER_UNAVAILABLE', message: expect.stringMatching(/แปะภาพ/) },
    });
    expect(t.gateway.availability).toHaveBeenCalledWith('openai', 'vision');
    expect(t.quota.reserve).not.toHaveBeenCalled();
    expect(t.storage.save).not.toHaveBeenCalled();
  });

  it('stops before storing anything when the quota reservation is refused', async () => {
    installFetch();
    const t = setup();
    t.quota.reserve.mockRejectedValue(new ForbiddenException({ code: 'ADDON_NOT_ENTITLED' }));
    await expect(
      t.service.startExtraction(CAMP, TENANT, 'user-1', file, { widthM: 400 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(t.storage.save).not.toHaveBeenCalled();
    expect(t.prisma.campMapExtraction.create).not.toHaveBeenCalled();
  });

  it('rejects tiny or unreadable images before reserving', async () => {
    const t = setup();
    await expect(
      t.service.startExtraction(
        CAMP,
        TENANT,
        'u',
        { ...file, buffer: pngOf(100, 100) },
        { widthM: 50 },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      t.service.startExtraction(
        CAMP,
        TENANT,
        'u',
        { ...file, buffer: Buffer.from('nope') },
        { widthM: 50 },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      t.service.startExtraction(CAMP, TENANT, 'u', undefined, { widthM: 50 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(t.quota.reserve).not.toHaveBeenCalled();
  });

  it('blocks a second draft while one is running, and expires stale ones with a forced refund', async () => {
    const t = setup();
    t.rows.set('old', {
      id: 'old',
      tenantId: TENANT,
      campgroundId: CAMP,
      status: 'running',
      step: 'vision',
      reservationId: 'res-old',
      createdAt: new Date(),
      imageUrl: 'u',
      imageWidth: 1,
      imageHeight: 1,
      input: {},
      result: null,
      errorCode: null,
      errorMessage: null,
      finishedAt: null,
    });
    await expect(
      t.service.startExtraction(CAMP, TENANT, 'u', file, { widthM: 400 }),
    ).rejects.toBeInstanceOf(ConflictException);

    t.rows.get('old')!.createdAt = new Date(Date.now() - 16 * 60 * 1000);
    const view = await t.service.getExtraction(CAMP, 'old', TENANT);
    expect(view.status).toBe('failed');
    expect(view.errorCode).toBe('AI_TIMEOUT');
    expect(t.quota.refund).toHaveBeenCalledWith(TENANT, 'res-old', 'AI_TIMEOUT', true);
  });
});

describe('CampMap3dService — publish', () => {
  const config = {
    scale: { widthM: 300, depthM: 200 },
    ground: { imageUrl: 'http://localhost:9011/uploads/camp/a.png', mode: 'drape' },
  };

  it('requires the CAMP_3D_MAP add-on itself, not just camp access', async () => {
    const t = setup({ entitled: false });
    await expect(t.service.saveMap3d(CAMP, TENANT, config)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(t.service.uploadGround(CAMP, TENANT, file)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(t.prisma.campground.update).not.toHaveBeenCalled();
  });

  it('saves a sanitized config and refuses foreign ground images', async () => {
    const t = setup();
    const saved = await t.service.saveMap3d(CAMP, TENANT, config);
    expect(saved.config).toMatchObject({
      version: 1,
      northDeg: 0,
      terrain: { preset: 'gentle' },
      water: [],
    });

    await expect(
      t.service.saveMap3d(CAMP, TENANT, {
        ...config,
        ground: { imageUrl: 'https://evil.example/x.png', mode: 'drape' },
      }),
    ).rejects.toThrow(/อัปโหลดเข้าระบบ/);
    await expect(
      t.service.saveMap3d(CAMP, TENANT, { scale: { widthM: -1 } }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('CampMap3dService — campground models', () => {
  const glb = makeGlb({ asset: { version: '2.0' }, meshes: [{ primitives: [] }] });
  const model = {
    originalname: 'Lodge.GLB',
    mimetype: 'application/octet-stream',
    size: glb.length,
    buffer: glb,
  };
  const config = {
    scale: { widthM: 300, depthM: 200 },
    ground: { imageUrl: null, mode: 'procedural' },
  };
  const prop = { id: 'p1', type: 'custom', x: 0.5, y: 0.5, rot: 0 };

  it('validates the file and stores it under a forced .glb name', async () => {
    const t = setup();
    t.storage.save.mockResolvedValueOnce({ url: 'http://localhost:9011/uploads/camp/m.glb' });
    await expect(t.service.uploadModel(CAMP, TENANT, model)).resolves.toMatchObject({
      glbUrl: 'http://localhost:9011/uploads/camp/m.glb',
      meshes: 1,
    });
    expect(t.storage.save).toHaveBeenCalledWith(
      expect.objectContaining({
        folder: 'camp',
        file: expect.objectContaining({ originalname: 'model.glb', mimetype: 'model/gltf-binary' }),
      }),
    );
  });

  it('rejects fake models and requires the add-on', async () => {
    const t = setup();
    await expect(t.service.uploadModel(CAMP, TENANT, file)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(t.storage.save).not.toHaveBeenCalled();
    await expect(
      setup({ entitled: false }).service.uploadModel(CAMP, TENANT, model),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('publishes own model urls and refuses foreign ones', async () => {
    const t = setup();
    const own = { ...prop, glbUrl: 'http://localhost:9011/uploads/camp/m.glb' };
    const saved = await t.service.saveMap3d(CAMP, TENANT, { ...config, props: [own] });
    expect((saved.config as { props: unknown[] }).props[0]).toMatchObject({ glbUrl: own.glbUrl });
    await expect(
      t.service.saveMap3d(CAMP, TENANT, {
        ...config,
        props: [{ ...prop, glbUrl: 'https://evil.example/m.glb' }],
      }),
    ).rejects.toThrow(/อัปโหลดเข้าระบบ/);
  });
});

describe('CampMap3dService — occupancy layer', () => {
  it('requires the add-on', async () => {
    const t = setup({ entitled: false });
    await expect(t.service.getOccupancy(CAMP, TENANT, '2026-10-19', 14)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(t.prisma.campReservation.findMany).not.toHaveBeenCalled();
  });

  it('returns stays overlapping the window as UTC day keys without guest contact data', async () => {
    const t = setup();
    t.prisma.campReservation.findMany.mockResolvedValue([
      {
        id: 'r1',
        pitchId: 'p1',
        reservationNo: 'CR-1',
        guestFirstName: 'สมชาย',
        status: 'confirmed',
        checkIn: new Date('2026-10-18T00:00:00.000Z'),
        checkOut: new Date('2026-10-21T00:00:00.000Z'),
      },
    ]);
    const res = await t.service.getOccupancy(CAMP, TENANT, '2026-10-19', 14);

    const args = t.prisma.campReservation.findMany.mock.calls[0][0];
    expect(args.where).toMatchObject({
      tenantId: TENANT,
      campgroundId: CAMP,
      checkIn: { lt: new Date('2026-11-02T00:00:00.000Z') },
      checkOut: { gt: new Date('2026-10-19T00:00:00.000Z') },
    });
    expect(args.where.status.in).not.toContain('cancelled');
    expect(Object.keys(args.select)).not.toEqual(expect.arrayContaining(['guestPhone']));
    expect(res.stays).toEqual([
      {
        id: 'r1',
        pitchId: 'p1',
        reservationNo: 'CR-1',
        guestName: 'สมชาย',
        status: 'confirmed',
        checkIn: '2026-10-18',
        checkOut: '2026-10-21',
      },
    ]);
    expect(res.truncated).toBe(false);
  });
});

describe('CampMap3dService — scene versions', () => {
  const config = {
    scale: { widthM: 400, depthM: 200 },
    terrain: { preset: 'gentle', waterLevelM: 1 },
    clusters: [{ id: 'r1', type: 'tent', x: 0.5, y: 0.5, count: 6, radiusM: 10 }],
  };

  it('stores a snapshot with a summary on every publish and prunes past the cap', async () => {
    const t = setup();
    t.prisma.campMap3dVersion.findMany.mockResolvedValueOnce([{ id: 'old-1' }, { id: 'old-2' }]);
    await t.service.saveMap3d(CAMP, TENANT, config, 'user-1');
    expect(t.prisma.$transaction).toHaveBeenCalled();
    const created = t.prisma.campMap3dVersion.create.mock.calls[0][0].data;
    expect(created).toMatchObject({ tenantId: TENANT, campgroundId: CAMP, createdBy: 'user-1' });
    expect(created.summary).toMatchObject({ clusters: 1, waterLevel: true, sculpted: false, props: 0 });
    expect(t.prisma.campMap3dVersion.findMany.mock.calls[0][0]).toMatchObject({ skip: 30 });
    expect(t.prisma.campMap3dVersion.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['old-1', 'old-2'] } } });
  });

  it('lists versions newest first with the publisher name (same tenant only)', async () => {
    const t = setup();
    t.prisma.campMap3dVersion.findMany.mockResolvedValueOnce([
      { id: 'v2', summary: { props: 3 }, createdBy: 'user-1', createdAt: new Date('2026-10-22T10:00:00Z') },
      { id: 'v1', summary: { props: 1 }, createdBy: 'ghost', createdAt: new Date('2026-10-21T10:00:00Z') },
    ]);
    t.prisma.user.findMany.mockResolvedValueOnce([{ id: 'user-1', firstName: 'Jack', lastName: null, email: 'j@x.co' }]);
    const list = await t.service.listVersions(CAMP, TENANT);
    expect(t.prisma.user.findMany.mock.calls[0][0].where).toEqual({ id: { in: ['user-1', 'ghost'] }, tenantId: TENANT });
    expect(list).toEqual([
      expect.objectContaining({ id: 'v2', createdBy: 'Jack', current: true }),
      expect.objectContaining({ id: 'v1', createdBy: null, current: false }),
    ]);
  });

  it('returns one version scoped to the tenant/campground, 404 otherwise', async () => {
    const t = setup();
    t.prisma.campMap3dVersion.findFirst.mockResolvedValueOnce({ id: 'v1', config, createdAt: new Date() });
    await expect(t.service.getVersion(CAMP, TENANT, 'v1')).resolves.toMatchObject({ id: 'v1' });
    expect(t.prisma.campMap3dVersion.findFirst.mock.calls[0][0].where).toEqual({ id: 'v1', tenantId: TENANT, campgroundId: CAMP });
    await expect(t.service.getVersion(CAMP, TENANT, 'nope')).rejects.toBeInstanceOf(NotFoundException);
  });
});
