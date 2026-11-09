import { ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AiGatewayService, AiCallContext } from './ai-gateway.service';

const SECRET = 'sk-test-secret-key-1234';

function setup(opts: {
  config?: Record<string, unknown> | null;
  spentUsd?: number;
  budgetUsd?: number;
  hardStop?: boolean;
}) {
  const prisma = {
    aiProviderConfig: {
      findUnique: jest.fn().mockResolvedValue(
        opts.config === undefined
          ? {
              provider: 'openai',
              enabled: true,
              apiKeyEnc: 'enc:xxx',
              models: { vision: { model: 'gpt-5-mini', inputPer1M: 1, outputPer1M: 4 } },
            }
          : opts.config,
      ),
    },
    aiPlatformSettings: {
      upsert: jest.fn().mockResolvedValue({
        monthlyBudgetUsd: new Prisma.Decimal(opts.budgetUsd ?? 100),
        hardStopOnBudget: opts.hardStop ?? true,
      }),
    },
    aiUsageLog: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { costUsd: new Prisma.Decimal(opts.spentUsd ?? 0) } }),
      create: jest.fn().mockResolvedValue({}),
    },
  };
  const encryption = { decrypt: jest.fn().mockReturnValue(SECRET) };
  const tenantContext = { runUnscoped: jest.fn((fn: () => unknown) => fn()) };
  const service = new AiGatewayService(prisma as never, encryption as never, tenantContext as never);
  return { service, prisma, encryption, tenantContext };
}

const ctx: AiCallContext = { provider: 'openai', task: 'vision', feature: 'CAMP_3D_EXTRACT', tenantId: 't-1', userId: 'u-1' };

describe('AiGatewayService.run', () => {
  it('สำเร็จ: ส่งคีย์+model ให้ fn และบันทึกต้นทุน', async () => {
    const { service, prisma } = setup({});
    const fn = jest.fn().mockResolvedValue({ result: 'ok', usage: { inputTokens: 1000, outputTokens: 500 } });

    await expect(service.run(ctx, fn)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledWith({ apiKey: SECRET, model: 'gpt-5-mini' });
    const data = prisma.aiUsageLog.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ tenantId: 't-1', status: 'success', model: 'gpt-5-mini', inputTokens: 1000 });
    // 1000/1e6*1 + 500/1e6*4 = 0.003
    expect(Number(data.costUsd)).toBe(0.003);
  });

  it('provider ปิด → blocked + ไม่เรียก fn', async () => {
    const { service, prisma } = setup({ config: { provider: 'openai', enabled: false, apiKeyEnc: 'enc:x', models: {} } });
    const fn = jest.fn();
    await expect(service.run(ctx, fn)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(fn).not.toHaveBeenCalled();
    expect(prisma.aiUsageLog.create.mock.calls[0][0].data).toMatchObject({
      status: 'blocked',
      errorMessage: 'AI_PROVIDER_UNAVAILABLE',
    });
  });

  it('ไม่มีคีย์ → blocked', async () => {
    const { service } = setup({ config: { provider: 'openai', enabled: true, apiKeyEnc: null, models: {} } });
    await expect(service.run(ctx, jest.fn())).rejects.toThrow(ServiceUnavailableException);
  });

  it('งานที่ model ว่าง → AI_TASK_DISABLED', async () => {
    const { service, prisma } = setup({
      config: { provider: 'fal', enabled: true, apiKeyEnc: 'enc:x', models: {} },
    });
    await expect(service.run({ ...ctx, provider: 'fal', task: 'depth' }, jest.fn())).rejects.toThrow(
      ServiceUnavailableException,
    );
    expect(prisma.aiUsageLog.create.mock.calls[0][0].data.errorMessage).toBe('AI_TASK_DISABLED');
  });

  it('งบหมด + hard stop → blocked, ยอดรวมอ่านแบบ unscoped', async () => {
    const { service, prisma, tenantContext } = setup({ spentUsd: 100, budgetUsd: 100 });
    const fn = jest.fn();
    await expect(service.run(ctx, fn)).rejects.toThrow(ServiceUnavailableException);
    expect(fn).not.toHaveBeenCalled();
    expect(tenantContext.runUnscoped).toHaveBeenCalled();
    expect(prisma.aiUsageLog.create.mock.calls[0][0].data.errorMessage).toBe('AI_BUDGET_EXCEEDED');
  });

  it('งบหมดแต่ปิด hard stop → ยังเรียกได้', async () => {
    const { service } = setup({ spentUsd: 150, budgetUsd: 100, hardStop: false });
    await expect(service.run(ctx, jest.fn().mockResolvedValue({ result: 1 }))).resolves.toBe(1);
  });

  it('งบ 0 = ไม่จำกัด', async () => {
    const { service } = setup({ spentUsd: 999, budgetUsd: 0 });
    await expect(service.run(ctx, jest.fn().mockResolvedValue({ result: 1 }))).resolves.toBe(1);
  });

  it('fn ล้ม → log failed โดยตัดคีย์ออกจากข้อความ แล้ว throw ต่อ', async () => {
    const { service, prisma } = setup({});
    const err = new Error(`401 invalid key ${SECRET}`);
    await expect(service.run(ctx, jest.fn().mockRejectedValue(err))).rejects.toBe(err);
    const data = prisma.aiUsageLog.create.mock.calls[0][0].data;
    expect(data.status).toBe('failed');
    expect(data.errorMessage).not.toContain(SECRET);
    expect(data.errorMessage).toContain('***');
  });

  it('เขียน log ไม่ได้ ไม่ทำให้งานหลักล้ม', async () => {
    const { service, prisma } = setup({});
    prisma.aiUsageLog.create.mockRejectedValue(new Error('db down'));
    await expect(service.run(ctx, jest.fn().mockResolvedValue({ result: 'ok' }))).resolves.toBe('ok');
  });
});

describe('AiGatewayService.availability', () => {
  it('พร้อม → null และไม่บันทึก log', async () => {
    const { service, prisma } = setup({});
    await expect(service.availability('openai', 'vision')).resolves.toBeNull();
    expect(prisma.aiUsageLog.create).not.toHaveBeenCalled();
  });

  it('provider ปิด / งานปิด / งบหมด → รหัสเดียวกับที่ run จะโยน', async () => {
    const off = setup({ config: { provider: 'openai', enabled: false, apiKeyEnc: 'enc:x', models: {} } });
    await expect(off.service.availability('openai', 'vision')).resolves.toBe('AI_PROVIDER_UNAVAILABLE');
    const task = setup({ config: { provider: 'fal', enabled: true, apiKeyEnc: 'enc:x', models: {} } });
    await expect(task.service.availability('fal', 'depth')).resolves.toBe('AI_TASK_DISABLED');
    const budget = setup({ spentUsd: 100, budgetUsd: 100 });
    await expect(budget.service.availability('openai', 'vision')).resolves.toBe('AI_BUDGET_EXCEEDED');
    expect(off.prisma.aiUsageLog.create).not.toHaveBeenCalled();
  });
});
