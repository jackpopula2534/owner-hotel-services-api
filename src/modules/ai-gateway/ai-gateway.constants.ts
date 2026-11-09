/**
 * AI Gateway — ค่าคงที่ของผู้ให้บริการ AI ระดับแพลตฟอร์ม
 *
 * คีย์ทุกตัวเป็นของแพลตฟอร์ม (ตั้งที่หน้า /admin/ai-providers) ทุกการเรียก AI
 * ต้องผ่าน AiGatewayService เพื่อเช็กงบ + บันทึกต้นทุนลง ai_usage_logs
 */

export const AI_PROVIDERS = ['openai', 'fal'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

/** ราคาของงานหนึ่งงาน (USD) — แอดมินตั้งเอง ค่า 0 = ยังไม่ได้ตั้ง ต้นทุนจะถูกบันทึกเป็น 0 */
export interface AiTaskPricing {
  model: string;
  /** USD ต่อ 1 ล้าน input tokens */
  inputPer1M?: number;
  /** USD ต่อ 1 ล้าน output tokens */
  outputPer1M?: number;
  /** USD ต่อหน่วย (รูป/จุด/คำขอ) สำหรับ provider ที่คิดเงินต่อครั้ง */
  perUnit?: number;
}

/** { [task]: pricing } เก็บใน AiProviderConfig.models */
export type AiModelsConfig = Record<string, AiTaskPricing>;

/** งานที่แต่ละ provider รองรับ — model ว่าง = ปิดงานนั้น */
export const DEFAULT_MODELS: Record<AiProvider, AiModelsConfig> = {
  openai: {
    vision: { model: 'gpt-5-mini', inputPer1M: 0, outputPer1M: 0 },
  },
  fal: {
    segment: { model: 'fal-ai/sam2/image', perUnit: 0 },
    depth: { model: '', perUnit: 0 },
  },
};

export const AI_PROVIDER_LABELS: Record<AiProvider, string> = {
  openai: 'OpenAI',
  fal: 'fal.ai',
};

/** feature code ที่ใช้บันทึกใน ai_usage_logs */
export const AI_FEATURES = {
  ADMIN_TEST: 'ADMIN_TEST',
  CAMP_3D_EXTRACT: 'CAMP_3D_EXTRACT',
} as const;

export const AI_SETTINGS_ID = 'default';

/** เส้นแบ่งเดือนของรายงานต้นทุนใช้เวลาไทย (UTC+7) */
export const AI_REPORT_TZ_OFFSET_HOURS = 7;

export const AI_TEST_TIMEOUT_MS = 10_000;
