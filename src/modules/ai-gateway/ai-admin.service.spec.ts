import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AiAdminService } from './ai-admin.service';
import { AiGatewayService } from './ai-gateway.service';
import { DEFAULT_MODELS } from './ai-gateway.constants';

const KEY = 'sk-proj-abcdefgh1234a91f';

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'r1',
    provider: 'openai',
    apiKeyEnc: null,
    keyLast4: null,
    enabled: false,
    models: DEFAULT_MODELS.openai,
    lastTestedAt: null,
    lastTestOk: null,
    lastTestMessage: null,
    lastTestLatencyMs: null,
    updatedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function setup(current = row()) {
  const prisma = {
    aiProviderConfig: {
      upsert: jest.fn().mockResolvedValue(current),
      update: jest.fn(({ data }) => Promise.resolve({ ...current, ...data })),
    },
    aiPlatformSettings: {
      upsert: jest.fn().mockResolvedValue({
        monthlyBudgetUsd: new Prisma.Decimal(10),
        hardStopOnBudget: true,
        alertThresholdPct: 80,
        usdToThb: new Prisma.Decimal(36),
        updatedAt: new Date(),
      }),
    },
    aiUsageLog: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0), create: jest.fn() },
    tenants: { findMany: jest.fn().mockResolvedValue([{ id: 't-1', name: 'ลานดอย' }]) },
  };
  const encryption = { encrypt: jest.fn((v: string) => `enc:${v.length}`), decrypt: jest.fn().mockReturnValue(KEY) };
  const gateway = new AiGatewayService(prisma as never, encryption as never, { runUnscoped: (fn: () => unknown) => fn() } as never);
  const service = new AiAdminService(prisma as never, encryption as never, gateway);
  return { service, prisma, encryption };
}

describe('AiAdminService', () => {
  it('ไม่ส่งคีย์จริง/ciphertext ออกไป — มีแค่ masked', async () => {
    const { service } = setup(row({ apiKeyEnc: 'enc:secret', keyLast4: 'a91f', enabled: true }));
    const [view] = await service.listProviders();
    expect(view.keyMasked).toBe('sk-…a91f');
    expect(view.hasKey).toBe(true);
    expect(JSON.stringify(view)).not.toContain('enc:secret');
    expect(view).not.toHaveProperty('apiKeyEnc');
  });

  it('เตือน task ที่ยังไม่ตั้งราคา', async () => {
    const { service } = setup();
    const [view] = await service.listProviders();
    expect(view.unpricedTasks).toEqual(['vision']);
  });

  it('บันทึกคีย์: trim + encrypt + เก็บ 4 ตัวท้าย + ล้างผลทดสอบเก่า', async () => {
    const { service, prisma, encryption } = setup(row({ lastTestOk: true }));
    const view = await service.updateProvider('openai', { apiKey: `  ${KEY}  ` }, 'admin-1');
    expect(encryption.encrypt).toHaveBeenCalledWith(KEY);
    const data = prisma.aiProviderConfig.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ keyLast4: 'a91f', lastTestOk: null, updatedBy: 'admin-1' });
    expect(view.keyMasked).toBe('sk-…a91f');
  });

  it('ปฏิเสธคีย์ที่มีช่องว่างตรงกลาง', async () => {
    const { service } = setup();
    await expect(service.updateProvider('openai', { apiKey: 'sk-abc def 123' })).rejects.toThrow(BadRequestException);
  });

  it('เปิดใช้งานโดยไม่มีคีย์ → 400', async () => {
    const { service } = setup();
    await expect(service.updateProvider('openai', { enabled: true })).rejects.toThrow(BadRequestException);
  });

  it('เปิดใช้งานพร้อมใส่คีย์ในคำขอเดียวกันได้', async () => {
    const { service } = setup();
    const view = await service.updateProvider('openai', { enabled: true, apiKey: KEY });
    expect(view.enabled).toBe(true);
  });

  describe('validateModels', () => {
    it('รับ task ที่รองรับ + ราคาถูกต้อง', () => {
      const { service } = setup();
      expect(service.validateModels('openai', { vision: { model: ' gpt-5 ', inputPer1M: 1.25, outputPer1M: 10 } })).toEqual({
        vision: { model: 'gpt-5', inputPer1M: 1.25, outputPer1M: 10 },
      });
    });

    it('ปฏิเสธ task แปลก, ราคาติดลบ, ชื่อ model แปลก', () => {
      const { service } = setup();
      expect(() => service.validateModels('openai', { segment: { model: 'x' } })).toThrow(BadRequestException);
      expect(() => service.validateModels('fal', { segment: { model: 'x', perUnit: -1 } })).toThrow(BadRequestException);
      expect(() => service.validateModels('fal', { segment: { model: 'x', perUnit: '1' } })).toThrow(BadRequestException);
      expect(() => service.validateModels('fal', { segment: { model: 'a b; drop' } })).toThrow(BadRequestException);
    });
  });

  it('ลบคีย์ → ปิด provider ด้วย', async () => {
    const { service } = setup(row({ apiKeyEnc: 'enc:x', keyLast4: '1234', enabled: true }));
    const view = await service.removeKey('openai');
    expect(view).toMatchObject({ hasKey: false, keyMasked: null, enabled: false });
  });

  it('ทดสอบโดยไม่มีคีย์ → 400', async () => {
    const { service } = setup();
    await expect(service.testProvider('openai')).rejects.toThrow(BadRequestException);
  });

  it('ทดสอบ OpenAI: 401 = คีย์ผิด, บันทึกผล + log ต้นทุน 0', async () => {
    const { service, prisma } = setup(row({ apiKeyEnc: 'enc:x', keyLast4: 'a91f' }));
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(new Response('{}', { status: 401 }));
    const result = await service.testProvider('openai', 'admin-1');
    expect(result.ok).toBe(false);
    expect(prisma.aiProviderConfig.update.mock.calls[0][0].data.lastTestOk).toBe(false);
    expect(Number(prisma.aiUsageLog.create.mock.calls[0][0].data.costUsd)).toBe(0);
    fetchSpy.mockRestore();
  });

  it('ทดสอบ OpenAI สำเร็จ: คืนรายชื่อ gpt models', async () => {
    const { service } = setup(row({ apiKeyEnc: 'enc:x', keyLast4: 'a91f' }));
    const body = JSON.stringify({ data: [{ id: 'gpt-5-mini' }, { id: 'whisper-1' }, { id: 'gpt-5' }] });
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(body, { status: 200 }));
    const result = await service.testProvider('openai');
    expect(result.ok).toBe(true);
    expect(result.availableModels).toEqual(['gpt-5', 'gpt-5-mini']);
    fetchSpy.mockRestore();
  });

  it('ทดสอบ fal: 404 ถือว่าคีย์ผ่าน', async () => {
    const { service } = setup(row({ provider: 'fal', models: DEFAULT_MODELS.fal, apiKeyEnc: 'enc:x', keyLast4: 'zzzz' }));
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(new Response('{}', { status: 404 }));
    await expect(service.testProvider('fal')).resolves.toMatchObject({ ok: true });
    fetchSpy.mockRestore();
  });

  it('สรุปต้นทุน: รวมยอด, แยก tenant พร้อมชื่อ, เตือนงบ', async () => {
    const { service, prisma } = setup();
    const at = new Date('2026-10-10T03:00:00Z');
    prisma.aiUsageLog.findMany.mockResolvedValue([
      { tenantId: 't-1', provider: 'openai', feature: 'CAMP_3D_EXTRACT', status: 'success', costUsd: new Prisma.Decimal(5), createdAt: at },
      { tenantId: 't-1', provider: 'fal', feature: 'CAMP_3D_EXTRACT', status: 'success', costUsd: new Prisma.Decimal(3.5), createdAt: at },
      { tenantId: null, provider: 'openai', feature: 'ADMIN_TEST', status: 'failed', costUsd: new Prisma.Decimal(0), createdAt: at },
    ]);
    const s = await service.getSummary('2026-10');
    expect(s.totalUsd).toBe(8.5);
    expect(s.totalThb).toBe(306);
    expect(s.failed).toBe(1);
    expect(s.avgCostPerRunUsd).toBe(4.25);
    expect(s.budget).toMatchObject({ usedPct: 85, alert: true, exceeded: false });
    expect(s.byTenant).toEqual([{ key: 't-1', costUsd: 8.5, requests: 2, tenantName: 'ลานดอย' }]);
    expect(s.daily).toEqual([{ date: '2026-10-10', costUsd: 8.5, requests: 3 }]);
  });

  it('assertProvider ไม่รู้จัก → 404', () => {
    const { service } = setup();
    expect(() => service.assertProvider('anthropic')).toThrow(NotFoundException);
  });
});
