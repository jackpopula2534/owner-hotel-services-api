import { AiCallOutcome } from '../../ai-gateway/ai-gateway.service';
import { VISION_KINDS, VisionResult } from './map3d-config';
import { Point } from './map3d.types';

/**
 * ตัวเรียก AI ของงานร่างฉาก 3D — ฟังก์ชันล้วน รับคีย์ที่ AiGatewayService ถอดให้
 * (ห้ามเรียกตรงนอก gateway.run เพราะต้นทุนจะไม่ถูกบันทึก)
 */

const VISION_TIMEOUT_MS = 120_000;
const SEGMENT_TIMEOUT_MS = 90_000;
/** ไฟล์ไม่เกินนี้ส่งให้ fal เป็น data URI ได้ถ้าอัปโหลดขึ้น CDN ของ fal ไม่สำเร็จ */
const DATA_URI_FALLBACK_BYTES = 4 * 1024 * 1024;
/** ผล mask ต้องมาจากโดเมนของ fal เท่านั้น (กันถูกหลอกให้ server ไปดึง URL อื่น) */
const FAL_RESULT_HOST = /(^|\.)fal\.(media|ai|run)$/i;
const FAL_MODEL_ID = /^[a-z0-9-]+(\/[a-z0-9._-]+)+$/i;

const VISION_PROMPT = [
  'You read campground site plans and output the layout as JSON for a 3D scene.',
  'Coordinates are normalized: x from 0 (left edge) to 1 (right edge), y from 0 (top edge) to 1 (bottom edge) of the image.',
  'For each element give kind, a short label (copy any text written on the plan, e.g. zone or pitch names, in its original language),',
  'confidence 0..1, and geometry: "polygon" for areas (lake, pond, forest, field, parking, beach, pitch zones, wide rivers),',
  '"polyline" for roads, paths and narrow streams (trace the centre line), "point" for single structures (building, restroom).',
  'points: polygon outline (6-40 points, clockwise) or polyline centre line (2-40 points) or one point.',
  'samplePoints: 1-3 points clearly INSIDE each polygon area, away from its edge (used to prompt a segmentation model); empty for lines and points.',
  'widthM: estimated real width in metres for roads/rivers if a scale bar or obvious size exists, otherwise null.',
  'labels: every readable text label on the plan with its position.',
  'imageKind: top_down_plan (drawn map), satellite (aerial photo), perspective (angled photo or 3D render), sketch, or other.',
  'Only include elements you can actually see. Do not invent elements. Prefer fewer, accurate elements.',
].join(' ');

const pointList = { type: 'array', items: { type: 'array', items: { type: 'number' } } };

const VISION_SCHEMA = {
  name: 'campground_layout',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['imageKind', 'notes', 'features', 'labels'],
    properties: {
      imageKind: {
        type: 'string',
        enum: ['top_down_plan', 'satellite', 'perspective', 'sketch', 'other'],
      },
      notes: { type: 'string' },
      features: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'label', 'confidence', 'geometry', 'points', 'samplePoints', 'widthM'],
          properties: {
            kind: { type: 'string', enum: [...VISION_KINDS] },
            label: { type: 'string' },
            confidence: { type: 'number' },
            geometry: { type: 'string', enum: ['polygon', 'polyline', 'point'] },
            points: pointList,
            samplePoints: pointList,
            widthM: { type: ['number', 'null'] },
          },
        },
      },
      labels: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['text', 'x', 'y'],
          properties: { text: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' } },
        },
      },
    },
  },
} as const;

interface FetchJsonResult {
  status: number;
  ok: boolean;
  data: Record<string, unknown>;
}

async function fetchJson(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<FetchJsonResult> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, ok: res.ok, data };
}

function providerError(provider: string, status: number, data: Record<string, unknown>): Error {
  const err = data.error as { message?: string } | undefined;
  const detail = typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail ?? '');
  const message = err?.message || detail || '';
  return new Error(`${provider} ตอบกลับ ${status}: ${message.slice(0, 200)}`);
}

/** OpenAI vision อ่านแผนผัง → features + labels (structured output) */
export async function callVision(input: {
  apiKey: string;
  model: string;
  image: Buffer;
  mimeType: string;
  widthM: number;
  depthM: number;
}): Promise<AiCallOutcome<VisionResult>> {
  const dataUrl = `data:${input.mimeType};base64,${input.image.toString('base64')}`;
  const { ok, status, data } = await fetchJson(
    'https://api.openai.com/v1/chat/completions',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${input.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: input.model,
        messages: [
          { role: 'system', content: VISION_PROMPT },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Site plan of a campground about ${Math.round(input.widthM)} m wide and ${Math.round(input.depthM)} m deep. Extract its layout.`,
              },
              { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
            ],
          },
        ],
        response_format: { type: 'json_schema', json_schema: VISION_SCHEMA },
      }),
    },
    VISION_TIMEOUT_MS,
  );
  if (!ok) throw providerError('OpenAI', status, data);

  const choice = (
    data.choices as { message?: { content?: string; refusal?: string } }[] | undefined
  )?.[0];
  if (choice?.message?.refusal)
    throw new Error(`OpenAI ปฏิเสธการอ่านภาพ: ${choice.message.refusal.slice(0, 200)}`);
  let result: VisionResult;
  try {
    result = JSON.parse(choice?.message?.content || '');
  } catch {
    throw new Error('OpenAI ตอบกลับไม่เป็น JSON');
  }
  if (!Array.isArray(result.features) || !Array.isArray(result.labels)) {
    throw new Error('OpenAI ตอบกลับผิดรูปแบบ');
  }
  const usage = data.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;
  return {
    result,
    usage: { inputTokens: usage?.prompt_tokens ?? 0, outputTokens: usage?.completion_tokens ?? 0 },
  };
}

/** อัปโหลดรูปขึ้น CDN ของ fal ครั้งเดียว แล้วใช้ URL เดิมกับทุก prompt (ถ้าไม่ได้ ใช้ data URI แทน) */
export async function uploadToFal(
  apiKey: string,
  image: Buffer,
  mimeType: string,
): Promise<string> {
  try {
    const init = await fetchJson(
      'https://rest.alpha.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3',
      {
        method: 'POST',
        headers: { Authorization: `Key ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content_type: mimeType,
          file_name: `plan.${mimeType.split('/')[1] || 'png'}`,
        }),
      },
      30_000,
    );
    const uploadUrl = init.data.upload_url;
    const fileUrl = init.data.file_url;
    if (!init.ok || typeof uploadUrl !== 'string' || typeof fileUrl !== 'string') {
      throw providerError('fal.ai', init.status, init.data);
    }
    const put = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': mimeType },
      body: new Uint8Array(image),
      signal: AbortSignal.timeout(60_000),
    });
    if (!put.ok) throw new Error(`อัปโหลดรูปขึ้น fal.ai ไม่ได้ (${put.status})`);
    return fileUrl;
  } catch (err) {
    if (image.length > DATA_URI_FALLBACK_BYTES) throw err;
    return `data:${mimeType};base64,${image.toString('base64')}`;
  }
}

async function downloadMask(url: string, apiKey: string): Promise<Buffer> {
  const dataUri = /^data:image\/[a-z]+;base64,(.+)$/i.exec(url);
  if (dataUri) return Buffer.from(dataUri[1], 'base64');
  const host = new URL(url).hostname;
  if (!FAL_RESULT_HOST.test(host))
    throw new Error(`fal.ai ส่ง URL ผลลัพธ์จากโดเมนที่ไม่รู้จัก (${host})`);
  let res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (res.status === 401 || res.status === 403) {
    res = await fetch(url, {
      headers: { Authorization: `Key ${apiKey}` },
      signal: AbortSignal.timeout(30_000),
    });
  }
  if (!res.ok) throw new Error(`ดาวน์โหลด mask ไม่ได้ (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * SAM 2 ตัดขอบวัตถุ 1 ชิ้นจากจุด prompt (พิกัด pixel ของรูปต้นฉบับ) — คืน mask PNG
 * ใช้ endpoint แบบ sync ของ fal (รอผลในคำขอเดียว)
 */
export async function segmentOnce(input: {
  apiKey: string;
  model: string;
  imageUrl: string;
  points: Point[];
  imageWidth: number;
  imageHeight: number;
}): Promise<Buffer> {
  if (!FAL_MODEL_ID.test(input.model)) throw new Error('model ของ fal.ai ไม่ถูกต้อง');
  const prompts = input.points.map(([x, y]) => ({
    x: Math.round(x * (input.imageWidth - 1)),
    y: Math.round(y * (input.imageHeight - 1)),
    label: 1,
  }));
  const { ok, status, data } = await fetchJson(
    `https://fal.run/${input.model}`,
    {
      method: 'POST',
      headers: { Authorization: `Key ${input.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_url: input.imageUrl,
        prompts,
        apply_mask: false,
        output_format: 'png',
      }),
    },
    SEGMENT_TIMEOUT_MS,
  );
  if (!ok) throw providerError('fal.ai', status, data);
  const image = data.image as { url?: string } | undefined;
  if (!image?.url) throw new Error('fal.ai ไม่ได้ส่ง mask กลับมา');
  return downloadMask(image.url, input.apiKey);
}
