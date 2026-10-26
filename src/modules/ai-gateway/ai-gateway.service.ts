import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EncryptionService } from '../../common/services/encryption.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import {
  AI_SETTINGS_ID,
  AiModelsConfig,
  AiProvider,
  AiTaskPricing,
  DEFAULT_MODELS,
} from './ai-gateway.constants';
import { AiUsageAmounts, aiPeriodRange, computeAiCostUsd, currentAiPeriod } from './ai-pricing';

export interface AiCallContext {
  provider: AiProvider;
  /** งานในหน้าตั้งค่า เช่น vision / segment / depth */
  task: string;
  /** feature code เช่น CAMP_3D_EXTRACT */
  feature: string;
  /** null = เรียกจากฝั่งแอดมิน */
  tenantId: string | null;
  userId?: string | null;
  refType?: string;
  refId?: string;
}

export interface AiCallInput {
  apiKey: string;
  model: string;
}

export interface AiCallOutcome<T> {
  result: T;
  usage?: AiUsageAmounts;
}

export type AiBlockCode = 'AI_PROVIDER_UNAVAILABLE' | 'AI_TASK_DISABLED' | 'AI_BUDGET_EXCEEDED';

const AI_BLOCK_MESSAGES: Record<AiBlockCode, string> = {
  AI_PROVIDER_UNAVAILABLE: 'ระบบ AI ยังไม่พร้อมใช้งาน กรุณาติดต่อผู้ดูแลระบบ',
  AI_TASK_DISABLED: 'งาน AI นี้ถูกปิดอยู่',
  AI_BUDGET_EXCEEDED: 'ระบบ AI ใช้งบประจำเดือนครบแล้ว ใช้โหมดที่ไม่พึ่ง AI ไปก่อน',
};

export interface AiBudgetStatus {
  period: string;
  spentUsd: number;
  budgetUsd: number;
  hardStop: boolean;
  exceeded: boolean;
}

/**
 * AiGatewayService — ประตูเดียวของการเรียก AI ทั้งระบบ
 *
 * 1. ถอดรหัสคีย์ของแพลตฟอร์ม (คีย์ไม่ออกนอก service นี้)
 * 2. เช็กว่า provider/งานเปิดอยู่ และงบเดือนนี้ยังไม่หมด
 * 3. เรียก AI แล้วบันทึกต้นทุนลง ai_usage_logs ทุกครั้ง ทั้งสำเร็จ ล้มเหลว และโดนบล็อก
 */
@Injectable()
export class AiGatewayService {
  private readonly logger = new Logger(AiGatewayService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /**
   * เรียก AI ผ่าน gateway — `fn` ได้คีย์ + model แล้วต้องคืนผลพร้อม usage เพื่อคิดต้นทุน
   *
   * @throws ServiceUnavailableException AI_PROVIDER_UNAVAILABLE | AI_TASK_DISABLED | AI_BUDGET_EXCEEDED
   */
  async run<T>(ctx: AiCallContext, fn: (input: AiCallInput) => Promise<AiCallOutcome<T>>): Promise<T> {
    const config = await this.prisma.aiProviderConfig.findUnique({ where: { provider: ctx.provider } });
    const pricing = this.taskPricing(ctx.provider, config?.models, ctx.task);
    const model = pricing?.model ?? '';

    const blocked = await this.blockReason(config, model);
    if (blocked) {
      await this.log(ctx, model, 'blocked', { errorMessage: blocked });
      throw new ServiceUnavailableException({ code: blocked, message: AI_BLOCK_MESSAGES[blocked] });
    }

    const apiKey = this.encryption.decrypt(config!.apiKeyEnc as string) as string;
    const startedAt = Date.now();
    try {
      const outcome = await fn({ apiKey, model });
      await this.log(ctx, model, 'success', {
        usage: outcome.usage,
        costUsd: computeAiCostUsd(pricing, outcome.usage ?? {}),
        latencyMs: Date.now() - startedAt,
      });
      return outcome.result;
    } catch (error) {
      await this.log(ctx, model, 'failed', {
        latencyMs: Date.now() - startedAt,
        errorMessage: this.safeError(error, apiKey),
      });
      throw error;
    }
  }

  /**
   * เช็กก่อนเริ่มงานว่าเรียก provider/งานนี้ได้ไหม (ไม่บันทึก log ไม่เรียก AI)
   * ให้ฟีเจอร์บอกลูกค้าก่อนกด แทนที่จะจองโควตาแล้วล้มทุกครั้ง
   */
  async availability(provider: AiProvider, task: string): Promise<AiBlockCode | null> {
    const config = await this.prisma.aiProviderConfig.findUnique({ where: { provider } });
    return this.blockReason(config, this.taskPricing(provider, config?.models, task)?.model ?? '');
  }

  private async blockReason(
    config: { enabled: boolean; apiKeyEnc: string | null } | null,
    model: string,
  ): Promise<AiBlockCode | null> {
    if (!config || !config.enabled || !config.apiKeyEnc) return 'AI_PROVIDER_UNAVAILABLE';
    if (!model) return 'AI_TASK_DISABLED';
    const budget = await this.getBudgetStatus();
    if (budget.hardStop && budget.exceeded) return 'AI_BUDGET_EXCEEDED';
    return null;
  }

  /** ยอดใช้จ่ายของทั้งแพลตฟอร์มเดือนนี้เทียบงบ — รวมทุก tenant จึงต้องอ่านแบบ unscoped */
  async getBudgetStatus(period: string = currentAiPeriod()): Promise<AiBudgetStatus> {
    const settings = await this.getSettings();
    const { start, end } = aiPeriodRange(period);
    const agg = await this.tenantContext.runUnscoped(async () =>
      await this.prisma.aiUsageLog.aggregate({
        where: { createdAt: { gte: start, lt: end } },
        _sum: { costUsd: true },
      }),
    );
    const spentUsd = Number(agg._sum.costUsd ?? 0);
    const budgetUsd = Number(settings.monthlyBudgetUsd);
    return {
      period,
      spentUsd,
      budgetUsd,
      hardStop: settings.hardStopOnBudget,
      exceeded: budgetUsd > 0 ? spentUsd >= budgetUsd : false,
    };
  }

  /** แถวตั้งค่างบ (สร้างค่า default ถ้ายังไม่มี) */
  async getSettings() {
    return this.prisma.aiPlatformSettings.upsert({
      where: { id: AI_SETTINGS_ID },
      create: { id: AI_SETTINGS_ID },
      update: {},
    });
  }

  /** ราคาของงาน — ค่าที่แอดมินบันทึกทับ default ของ provider */
  taskPricing(provider: AiProvider, models: Prisma.JsonValue | undefined, task: string): AiTaskPricing | undefined {
    const saved = (models && typeof models === 'object' && !Array.isArray(models) ? models : {}) as unknown as AiModelsConfig;
    return saved[task] ?? DEFAULT_MODELS[provider][task];
  }

  /**
   * บันทึก ai_usage_logs — ห้ามทำให้งานหลักล้มเพราะเขียน log ไม่ได้
   * tenantId ส่งตรงจาก ctx; ถ้าอยู่ใน request ของ tenant middleware จะใส่ tenantId เดียวกันให้อยู่แล้ว
   */
  async log(
    ctx: AiCallContext,
    model: string,
    status: 'success' | 'failed' | 'blocked',
    extra: { usage?: AiUsageAmounts; costUsd?: number; latencyMs?: number; errorMessage?: string },
  ): Promise<void> {
    try {
      await this.prisma.aiUsageLog.create({
        data: {
          tenantId: ctx.tenantId,
          provider: ctx.provider,
          model: model || '-',
          feature: ctx.feature,
          task: ctx.task,
          status,
          inputTokens: extra.usage?.inputTokens ?? null,
          outputTokens: extra.usage?.outputTokens ?? null,
          units: extra.usage?.units ?? null,
          costUsd: new Prisma.Decimal(extra.costUsd ?? 0),
          latencyMs: extra.latencyMs ?? null,
          errorMessage: extra.errorMessage?.slice(0, 255) ?? null,
          refType: ctx.refType ?? null,
          refId: ctx.refId ?? null,
          createdBy: ctx.userId ?? null,
        },
      });
    } catch (error) {
      this.logger.error(`Failed to write ai_usage_log (${ctx.provider}/${ctx.feature}): ${String(error)}`);
    }
  }

  /** ข้อความ error ที่ปลอดภัยต่อการเก็บ — ตัดคีย์ออกเผื่อ provider สะท้อนคีย์กลับมาใน error */
  safeError(error: unknown, apiKey?: string): string {
    const raw = error instanceof Error ? error.message : String(error);
    const scrubbed = apiKey ? raw.split(apiKey).join('***') : raw;
    return scrubbed.slice(0, 255);
  }
}
