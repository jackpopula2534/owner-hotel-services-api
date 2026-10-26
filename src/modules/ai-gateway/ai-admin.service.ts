import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EncryptionService } from '../../common/services/encryption.service';
import {
  AI_FEATURES,
  AI_PROVIDER_LABELS,
  AI_PROVIDERS,
  AI_SETTINGS_ID,
  AI_TEST_TIMEOUT_MS,
  AiModelsConfig,
  AiProvider,
  AiTaskPricing,
  DEFAULT_MODELS,
} from './ai-gateway.constants';
import { AiGatewayService } from './ai-gateway.service';
import { aiLocalDate, aiPeriodRange, currentAiPeriod, isPricingSet } from './ai-pricing';
import { AiUsageLogsQueryDto, UpdateAiProviderDto, UpdateAiSettingsDto } from './dto/ai-admin.dto';

export interface AiProviderView {
  provider: AiProvider;
  label: string;
  hasKey: boolean;
  /** เช่น sk-…a91f — คีย์จริงไม่ถูกส่งออกจาก API เด็ดขาด */
  keyMasked: string | null;
  enabled: boolean;
  models: AiModelsConfig;
  /** task ที่เปิดอยู่แต่ยังไม่ได้ตั้งราคา (ต้นทุนจะบันทึกเป็น 0) */
  unpricedTasks: string[];
  lastTestedAt: Date | null;
  lastTestOk: boolean | null;
  lastTestMessage: string | null;
  lastTestLatencyMs: number | null;
  updatedAt: Date | null;
}

export interface AiProviderTestResult {
  ok: boolean;
  message: string;
  latencyMs: number;
  /** OpenAI: รายชื่อ model ที่คีย์นี้ใช้ได้ (ไว้เติม dropdown) */
  availableModels?: string[];
}

export interface AiSettingsView {
  monthlyBudgetUsd: number;
  hardStopOnBudget: boolean;
  alertThresholdPct: number;
  usdToThb: number;
  updatedAt: Date;
}

interface AiBucket {
  costUsd: number;
  requests: number;
}

const KEY_PREFIX: Record<AiProvider, string> = { openai: 'sk-', fal: '' };

@Injectable()
export class AiAdminService {
  private readonly logger = new Logger(AiAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
    private readonly gateway: AiGatewayService,
  ) {}

  // ─── Providers ──────────────────────────────────────────────────────────

  async listProviders(): Promise<AiProviderView[]> {
    const rows = await Promise.all(AI_PROVIDERS.map((p) => this.ensureProvider(p)));
    return rows.map((row) => this.toView(row));
  }

  async updateProvider(provider: AiProvider, dto: UpdateAiProviderDto, userId?: string): Promise<AiProviderView> {
    const current = await this.ensureProvider(provider);
    const data: Prisma.AiProviderConfigUpdateInput = { updatedBy: userId ?? null };

    if (dto.apiKey !== undefined) {
      const key = dto.apiKey.trim();
      if (key.length < 8 || /\s/.test(key)) {
        throw new BadRequestException({ code: 'AI_KEY_INVALID', message: 'รูปแบบ API key ไม่ถูกต้อง' });
      }
      data.apiKeyEnc = this.encryption.encrypt(key) as string;
      data.keyLast4 = key.slice(-4);
      // คีย์เปลี่ยน ผลทดสอบเก่าใช้ไม่ได้แล้ว
      data.lastTestedAt = null;
      data.lastTestOk = null;
      data.lastTestMessage = null;
      data.lastTestLatencyMs = null;
    }

    if (dto.models !== undefined) {
      data.models = this.validateModels(provider, dto.models) as unknown as Prisma.InputJsonValue;
    }

    if (dto.enabled !== undefined) {
      const willHaveKey = dto.apiKey !== undefined || Boolean(current.apiKeyEnc);
      if (dto.enabled && !willHaveKey) {
        throw new BadRequestException({ code: 'AI_KEY_REQUIRED', message: 'ต้องใส่ API key ก่อนเปิดใช้งาน' });
      }
      data.enabled = dto.enabled;
    }

    const updated = await this.prisma.aiProviderConfig.update({ where: { provider }, data });
    this.logger.log(`AI provider ${provider} updated by ${userId ?? 'unknown'} (keyChanged=${dto.apiKey !== undefined})`);
    return this.toView(updated);
  }

  async removeKey(provider: AiProvider, userId?: string): Promise<AiProviderView> {
    await this.ensureProvider(provider);
    const updated = await this.prisma.aiProviderConfig.update({
      where: { provider },
      data: {
        apiKeyEnc: null,
        keyLast4: null,
        enabled: false,
        lastTestedAt: null,
        lastTestOk: null,
        lastTestMessage: null,
        lastTestLatencyMs: null,
        updatedBy: userId ?? null,
      },
    });
    this.logger.log(`AI provider ${provider} key removed by ${userId ?? 'unknown'}`);
    return this.toView(updated);
  }

  /** ทดสอบคีย์กับ provider จริง — ไม่เสียเงิน (endpoint ที่ใช้ไม่คิดค่าบริการ) */
  async testProvider(provider: AiProvider, userId?: string): Promise<AiProviderTestResult> {
    const config = await this.ensureProvider(provider);
    if (!config.apiKeyEnc) {
      throw new BadRequestException({ code: 'AI_KEY_REQUIRED', message: 'ยังไม่ได้ใส่ API key' });
    }
    const apiKey = this.encryption.decrypt(config.apiKeyEnc) as string;
    const startedAt = Date.now();

    let result: AiProviderTestResult;
    try {
      const probe = provider === 'openai' ? await this.probeOpenAi(apiKey) : await this.probeFal(apiKey);
      result = { ...probe, latencyMs: Date.now() - startedAt };
    } catch (error) {
      const aborted = error instanceof Error && error.name === 'AbortError';
      result = {
        ok: false,
        message: aborted ? 'หมดเวลาเชื่อมต่อ' : `เชื่อมต่อไม่ได้: ${this.gateway.safeError(error, apiKey)}`,
        latencyMs: Date.now() - startedAt,
      };
    }

    const message = result.message.slice(0, 255);
    await this.prisma.aiProviderConfig.update({
      where: { provider },
      data: {
        lastTestedAt: new Date(),
        lastTestOk: result.ok,
        lastTestMessage: message,
        lastTestLatencyMs: result.latencyMs,
        updatedBy: userId ?? null,
      },
    });
    await this.gateway.log(
      { provider, feature: AI_FEATURES.ADMIN_TEST, task: 'test', tenantId: null, userId },
      'connection-test',
      result.ok ? 'success' : 'failed',
      { costUsd: 0, latencyMs: result.latencyMs, errorMessage: result.ok ? undefined : message },
    );
    return { ...result, message };
  }

  // ─── Settings ───────────────────────────────────────────────────────────

  async getSettings(): Promise<AiSettingsView> {
    return this.toSettingsView(await this.gateway.getSettings());
  }

  async updateSettings(dto: UpdateAiSettingsDto, userId?: string): Promise<AiSettingsView> {
    const data = {
      ...(dto.monthlyBudgetUsd !== undefined && { monthlyBudgetUsd: new Prisma.Decimal(dto.monthlyBudgetUsd) }),
      ...(dto.hardStopOnBudget !== undefined && { hardStopOnBudget: dto.hardStopOnBudget }),
      ...(dto.alertThresholdPct !== undefined && { alertThresholdPct: dto.alertThresholdPct }),
      ...(dto.usdToThb !== undefined && { usdToThb: new Prisma.Decimal(dto.usdToThb) }),
      updatedBy: userId ?? null,
    };
    const row = await this.prisma.aiPlatformSettings.upsert({
      where: { id: AI_SETTINGS_ID },
      create: { id: AI_SETTINGS_ID, ...data },
      update: data,
    });
    return this.toSettingsView(row);
  }

  // ─── Usage ──────────────────────────────────────────────────────────────

  /** สรุปต้นทุนของเดือน (เวลาไทย) — controller ติด @SkipTenantScope จึงเห็นทุก tenant */
  async getSummary(period: string = currentAiPeriod()) {
    const { start, end } = this.periodRangeOrThrow(period);
    const settings = await this.getSettings();
    const logs = await this.prisma.aiUsageLog.findMany({
      where: { createdAt: { gte: start, lt: end } },
      select: { tenantId: true, provider: true, feature: true, status: true, costUsd: true, createdAt: true },
    });

    const empty = (): AiBucket => ({ costUsd: 0, requests: 0 });
    const add = (map: Map<string, AiBucket>, key: string, cost: number): Map<string, AiBucket> => {
      const prev = map.get(key) ?? empty();
      return map.set(key, { costUsd: prev.costUsd + cost, requests: prev.requests + 1 });
    };

    const byProvider = new Map<string, AiBucket>();
    const byFeature = new Map<string, AiBucket>();
    const byTenant = new Map<string, AiBucket>();
    const byDay = new Map<string, AiBucket>();
    let totalUsd = 0;
    let failed = 0;
    let blocked = 0;
    let billable = 0;

    for (const log of logs) {
      const cost = Number(log.costUsd);
      totalUsd += cost;
      if (log.status === 'failed') failed += 1;
      if (log.status === 'blocked') blocked += 1;
      add(byProvider, log.provider, cost);
      add(byFeature, log.feature, cost);
      add(byDay, aiLocalDate(log.createdAt), cost);
      if (log.feature !== AI_FEATURES.ADMIN_TEST && log.status === 'success') billable += 1;
      if (log.tenantId) add(byTenant, log.tenantId, cost);
    }

    const tenantNames = await this.tenantNames([...byTenant.keys()]);
    const round = (n: number): number => Math.round(n * 1_000_000) / 1_000_000;
    const toList = (map: Map<string, AiBucket>) =>
      [...map.entries()]
        .map(([key, b]) => ({ key, costUsd: round(b.costUsd), requests: b.requests }))
        .sort((a, b) => b.costUsd - a.costUsd || b.requests - a.requests);

    const budgetPct = settings.monthlyBudgetUsd > 0 ? (totalUsd / settings.monthlyBudgetUsd) * 100 : 0;

    return {
      period,
      totalUsd: round(totalUsd),
      totalThb: Math.round(totalUsd * settings.usdToThb * 100) / 100,
      requests: logs.length,
      failed,
      blocked,
      avgCostPerRunUsd: billable > 0 ? round(totalUsd / billable) : 0,
      budget: {
        monthlyBudgetUsd: settings.monthlyBudgetUsd,
        usedPct: Math.round(budgetPct * 10) / 10,
        alert: settings.monthlyBudgetUsd > 0 && budgetPct >= settings.alertThresholdPct,
        exceeded: settings.monthlyBudgetUsd > 0 && totalUsd >= settings.monthlyBudgetUsd,
        hardStopOnBudget: settings.hardStopOnBudget,
        alertThresholdPct: settings.alertThresholdPct,
      },
      usdToThb: settings.usdToThb,
      byProvider: toList(byProvider),
      byFeature: toList(byFeature),
      byTenant: toList(byTenant).map((t) => ({ ...t, tenantName: tenantNames.get(t.key) ?? null })),
      daily: [...byDay.entries()]
        .map(([date, b]) => ({ date, costUsd: round(b.costUsd), requests: b.requests }))
        .sort((a, b) => a.date.localeCompare(b.date)),
    };
  }

  async listLogs(query: AiUsageLogsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const range = query.period ? this.periodRangeOrThrow(query.period) : null;

    const where: Prisma.AiUsageLogWhereInput = {
      ...(range && { createdAt: { gte: range.start, lt: range.end } }),
      ...(query.provider && { provider: query.provider }),
      ...(query.status && { status: query.status }),
      ...(query.tenantId && { tenantId: query.tenantId }),
      ...(query.feature && { feature: query.feature }),
    };

    const [items, total] = await Promise.all([
      this.prisma.aiUsageLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.aiUsageLog.count({ where }),
    ]);

    const names = await this.tenantNames(items.map((i) => i.tenantId).filter((id): id is string => Boolean(id)));
    return {
      items: items.map((i) => ({
        id: i.id,
        createdAt: i.createdAt,
        tenantId: i.tenantId,
        tenantName: i.tenantId ? names.get(i.tenantId) ?? null : null,
        provider: i.provider,
        model: i.model,
        feature: i.feature,
        task: i.task,
        status: i.status,
        inputTokens: i.inputTokens,
        outputTokens: i.outputTokens,
        units: i.units,
        costUsd: Number(i.costUsd),
        latencyMs: i.latencyMs,
        errorMessage: i.errorMessage,
      })),
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  // ─── Internals ──────────────────────────────────────────────────────────

  /** สร้างแถว provider พร้อม model default ถ้ายังไม่มี */
  private async ensureProvider(provider: AiProvider) {
    return this.prisma.aiProviderConfig.upsert({
      where: { provider },
      create: { provider, models: DEFAULT_MODELS[provider] as unknown as Prisma.InputJsonValue },
      update: {},
    });
  }

  private toView(row: Prisma.AiProviderConfigGetPayload<object>): AiProviderView {
    const provider = row.provider as AiProvider;
    const models = this.mergedModels(provider, row.models);
    return {
      provider,
      label: AI_PROVIDER_LABELS[provider] ?? provider,
      hasKey: Boolean(row.apiKeyEnc),
      keyMasked: row.apiKeyEnc ? `${KEY_PREFIX[provider] ?? ''}…${row.keyLast4 ?? '****'}` : null,
      enabled: row.enabled,
      models,
      unpricedTasks: Object.entries(models)
        .filter(([, p]) => p.model && !isPricingSet(p))
        .map(([task]) => task),
      lastTestedAt: row.lastTestedAt,
      lastTestOk: row.lastTestOk,
      lastTestMessage: row.lastTestMessage,
      lastTestLatencyMs: row.lastTestLatencyMs,
      updatedAt: row.updatedAt,
    };
  }

  /** ค่าที่บันทึก + task default ที่ยังไม่มีในแถว (เผื่อเพิ่ม task ใหม่ภายหลัง) */
  private mergedModels(provider: AiProvider, saved: Prisma.JsonValue): AiModelsConfig {
    const defaults = DEFAULT_MODELS[provider] ?? {};
    const tasks = new Set([...Object.keys(defaults), ...Object.keys((saved as object) ?? {})]);
    return Object.fromEntries(
      [...tasks].map((task) => [task, this.gateway.taskPricing(provider, saved, task) as AiTaskPricing]),
    );
  }

  /** รับเฉพาะ task ที่ provider รองรับ และตัวเลขราคาที่ไม่ติดลบ */
  validateModels(provider: AiProvider, input: Record<string, unknown>): AiModelsConfig {
    const allowed = Object.keys(DEFAULT_MODELS[provider]);
    const num = (task: string, field: string, v: unknown): number | undefined => {
      if (v === undefined || v === null || v === '') return undefined;
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 10_000) {
        throw new BadRequestException({
          code: 'AI_PRICING_INVALID',
          message: `${task}.${field} ต้องเป็นตัวเลข 0–10000`,
        });
      }
      return v;
    };

    return Object.fromEntries(
      Object.entries(input).map(([task, raw]) => {
        if (!allowed.includes(task)) {
          throw new BadRequestException({
            code: 'AI_TASK_UNKNOWN',
            message: `${AI_PROVIDER_LABELS[provider]} ไม่รองรับงาน "${task}" (รองรับ: ${allowed.join(', ')})`,
          });
        }
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
          throw new BadRequestException({ code: 'AI_PRICING_INVALID', message: `${task} ต้องเป็น object` });
        }
        const r = raw as Record<string, unknown>;
        const model = typeof r.model === 'string' ? r.model.trim() : '';
        if (model.length > 120 || !/^[\w./:@-]*$/.test(model)) {
          throw new BadRequestException({ code: 'AI_MODEL_INVALID', message: `ชื่อ model ของ ${task} ไม่ถูกต้อง` });
        }
        const pricing: AiTaskPricing = {
          model,
          ...(num(task, 'inputPer1M', r.inputPer1M) !== undefined && { inputPer1M: r.inputPer1M as number }),
          ...(num(task, 'outputPer1M', r.outputPer1M) !== undefined && { outputPer1M: r.outputPer1M as number }),
          ...(num(task, 'perUnit', r.perUnit) !== undefined && { perUnit: r.perUnit as number }),
        };
        return [task, pricing];
      }),
    );
  }

  private periodRangeOrThrow(period: string): { start: Date; end: Date } {
    try {
      return aiPeriodRange(period);
    } catch {
      throw new BadRequestException({ code: 'INVALID_PERIOD', message: 'period ต้องเป็น YYYY-MM' });
    }
  }

  private async tenantNames(ids: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = await this.prisma.tenants.findMany({
      where: { id: { in: unique } },
      select: { id: true, name: true },
    });
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  private toSettingsView(row: {
    monthlyBudgetUsd: Prisma.Decimal;
    hardStopOnBudget: boolean;
    alertThresholdPct: number;
    usdToThb: Prisma.Decimal;
    updatedAt: Date;
  }): AiSettingsView {
    return {
      monthlyBudgetUsd: Number(row.monthlyBudgetUsd),
      hardStopOnBudget: row.hardStopOnBudget,
      alertThresholdPct: row.alertThresholdPct,
      usdToThb: Number(row.usdToThb),
      updatedAt: row.updatedAt,
    };
  }

  private async probeOpenAi(apiKey: string): Promise<Omit<AiProviderTestResult, 'latencyMs'>> {
    const res = await this.fetchWithTimeout('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (res.status === 401 || res.status === 403) return { ok: false, message: 'คีย์ไม่ถูกต้องหรือถูกเพิกถอน' };
    if (res.status === 429) return { ok: false, message: 'ติด rate limit / เครดิตหมด' };
    if (!res.ok) return { ok: false, message: `OpenAI ตอบกลับ HTTP ${res.status}` };

    const body = (await res.json().catch(() => ({}))) as { data?: Array<{ id?: unknown }> };
    const availableModels = (body.data ?? [])
      .map((m) => (typeof m.id === 'string' ? m.id : ''))
      .filter((id) => /^(gpt-|o\d)/.test(id))
      .sort();
    return { ok: true, message: `เชื่อมต่อสำเร็จ · ใช้ได้ ${availableModels.length} models`, availableModels };
  }

  /**
   * fal ไม่มี endpoint ตรวจคีย์ฟรี — ถามสถานะของ request id ที่ไม่มีอยู่จริง
   * 401/403 = คีย์ผิด, 4xx อื่น (เช่น 404) = ผ่านการยืนยันตัวตนแล้ว
   */
  private async probeFal(apiKey: string): Promise<Omit<AiProviderTestResult, 'latencyMs'>> {
    const res = await this.fetchWithTimeout(
      'https://queue.fal.run/fal-ai/sam2/requests/00000000-0000-0000-0000-000000000000/status',
      { headers: { Authorization: `Key ${apiKey}` } },
    );
    if (res.status === 401 || res.status === 403) return { ok: false, message: 'คีย์ไม่ถูกต้องหรือถูกเพิกถอน' };
    if (res.status >= 500) return { ok: false, message: `fal.ai ตอบกลับ HTTP ${res.status}` };
    return { ok: true, message: 'เชื่อมต่อสำเร็จ · ยืนยันคีย์แล้ว' };
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AI_TEST_TIMEOUT_MS);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  assertProvider(provider: string): AiProvider {
    if (!(AI_PROVIDERS as readonly string[]).includes(provider)) {
      throw new NotFoundException({ code: 'AI_PROVIDER_NOT_FOUND', message: `ไม่รู้จัก provider "${provider}"` });
    }
    return provider as AiProvider;
  }
}
