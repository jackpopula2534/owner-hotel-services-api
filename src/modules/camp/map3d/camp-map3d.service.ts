import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { StorageService } from '../../../common/storage/storage.service';
import { TenantContextService } from '../../../common/tenant/tenant-context.service';
import { AddonService } from '../../addons/addon.service';
import { AiGatewayService } from '../../ai-gateway/ai-gateway.service';
import { AI_FEATURES } from '../../ai-gateway/ai-gateway.constants';
import { AddonQuotaService } from '../../addon-quotas/addon-quota.service';
import { GlbValidationError, validateGlb } from './glb-validate';
import { readImageSize } from './image-size';
import { maskToPolygon } from './mask-polygon';
import {
  Map3dConfigError,
  SegmentResults,
  VisionResult,
  buildDraft,
  isSegmentable,
  map3dSummary,
  promptPoints,
  sanitizeMap3dConfig,
} from './map3d-config';
import { callVision, segmentOnce, uploadToFal } from './map3d-ai.client';
import { Map3dConfig, Map3dDraft, Map3dStep, Point } from './map3d.types';

export const CAMP_3D_ADDON = 'CAMP_3D_MAP';
const REF_TYPE = 'CampMapExtraction';
/** เก็บประวัติฉากที่เผยแพร่ล่าสุดกี่เวอร์ชันต่อลาน */
export const MAX_MAP3D_VERSIONS = 30;
/** ส่งให้ SAM ตัดขอบไม่เกินกี่ชิ้นต่อการร่าง 1 ครั้ง (คุมต้นทุน fal) */
const MAX_SEGMENTS = 8;
/** เวลารวมสูงสุดของขั้นตัดขอบ — ชิ้นที่เหลือใช้ขอบจาก vision แทน (งานต้องจบก่อน STALE_AFTER_MS) */
const SEGMENT_BUDGET_MS = 5 * 60 * 1000;
/** งานที่ค้าง running นานกว่านี้ถือว่าตาย (server รีสตาร์ตกลางทาง) → ล้มเหลว + คืนโควตา */
const STALE_AFTER_MS = 15 * 60 * 1000;
const MIN_IMAGE_SIDE = 256;
/** การจองที่นับว่าใช้จุด (ยกเลิก/ไม่มาไม่นับ) — checked_out ใช้ดูย้อนหลังบนแถบวันที่ */
const OCCUPANCY_STATUSES = ['pending', 'confirmed', 'checked_in', 'checked_out'] as const;
/** กันลานใหญ่ที่จองยาวทั้งเดือนส่งแถวมหาศาล — 62 วัน × 300 จุดยังพอดี */
const MAX_OCCUPANCY_ROWS = 5000;
const MAX_IMAGE_SIDE = 8192;

export interface UploadedImage {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export interface StartExtractionInput {
  widthM: number;
  depthM?: number;
  northDeg?: number;
}

export interface Map3dExtractionView {
  id: string;
  campgroundId: string;
  status: string;
  step: string | null;
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  input: Prisma.JsonValue;
  result: Map3dDraft | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: Date;
  finishedAt: Date | null;
}

/** ข้อความที่ tenant เห็นเมื่อร่างไม่สำเร็จ (ข้อความดิบของ provider อยู่ใน log/ai_usage_logs เท่านั้น) */
const FAILURE_MESSAGES: Record<string, string> = {
  AI_PROVIDER_UNAVAILABLE: 'AI ร่างฉากปิดให้บริการชั่วคราว ใช้โหมดแปะภาพเป็นพื้นไปก่อน',
  AI_TASK_DISABLED: 'งานอ่านแผนผังด้วย AI ถูกปิดอยู่ชั่วคราว',
  AI_BUDGET_EXCEEDED: 'ระบบ AI ใช้งบประจำเดือนครบแล้ว ใช้โหมดแปะภาพเป็นพื้นไปก่อน',
  NOTHING_FOUND: 'AI ไม่พบองค์ประกอบในรูป ลองใช้รูปแปลนที่ชัดกว่านี้ หรือแปะภาพเป็นพื้นแทน',
  AI_TIMEOUT: 'การร่างฉากใช้เวลานานผิดปกติและถูกยกเลิก',
  AI_EXTRACT_FAILED: 'AI ร่างฉากไม่สำเร็จ ลองใหม่อีกครั้ง',
};

function errorCodeOf(err: unknown): string {
  if (err instanceof HttpException) {
    const res = err.getResponse();
    if (typeof res === 'object' && res && typeof (res as { code?: unknown }).code === 'string') {
      return (res as { code: string }).code;
    }
  }
  return 'AI_EXTRACT_FAILED';
}

/**
 * ฉาก 3D ของลาน (add-on CAMP_3D_MAP) — Level 1: AI ร่างฉากจากรูปแปลน
 *
 * 1. OpenAI vision อ่านองค์ประกอบ + จุดตัวอย่าง (task vision)
 * 2. fal SAM 2 ตัดขอบพื้นที่ละเอียดจากจุดตัวอย่าง (task segment) — ล้มก็ใช้ขอบจาก vision
 * 3. แปลง mask → polygon normalized 0..1 → ร่าง map3dConfig + คำเตือน
 *
 * ร่าง 1 ครั้ง = โควตา 1 ครั้ง: จองก่อนตอบ 202 (ไม่มีสิทธิ์/โควตาหมดรู้ทันที)
 * แล้ว commit เมื่อได้ร่าง / refund เมื่อล้มเหลว — ร่างยังไม่เผยแพร่จนผู้ใช้กด PUT
 *
 * สิทธิ์เช็กจาก AddonService ตรง ๆ ไม่ผ่าน AddonGuard (guard ปล่อย role admin ผ่าน)
 */
@Injectable()
export class CampMap3dService {
  private readonly logger = new Logger(CampMap3dService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly tenantContext: TenantContextService,
    private readonly addonService: AddonService,
    private readonly gateway: AiGatewayService,
    private readonly quota: AddonQuotaService,
  ) {}

  async getMap3d(campgroundId: string, tenantId: string) {
    const campground = await this.findCampground(campgroundId, tenantId);
    const entitled = await this.addonService.hasActiveAddon(tenantId, CAMP_3D_ADDON);
    const latest = await this.prisma.campMapExtraction.findFirst({
      where: { tenantId, campgroundId },
      orderBy: { createdAt: 'desc' },
    });
    return {
      campgroundId,
      entitled,
      config: (campground.map3dConfig as unknown as Map3dConfig | null) ?? null,
      updatedAt: campground.map3dUpdatedAt,
      mapImageUrl: campground.mapImageUrl,
      latestExtraction: latest ? this.toView(await this.expireIfStale(latest)) : null,
      aiUnavailable: await this.aiUnavailable(),
    };
  }

  /**
   * การเข้าพักที่ทับช่วงวัน [from, from+days) — ข้อมูลของชั้น "การจอง/แม่บ้าน" ในฉาก 3D
   * ส่งเฉพาะที่ต้องใช้ระบายสีหมุด (ไม่มีเบอร์/อีเมล/ยอดเงินของแขก)
   * checkIn/checkOut เก็บเป็นเที่ยงคืน UTC ของวันที่เลือก → คีย์วันใช้วันที่ UTC
   */
  async getOccupancy(campgroundId: string, tenantId: string, from: string, days: number) {
    await this.findCampground(campgroundId, tenantId);
    await this.assertEntitled(tenantId);
    const start = new Date(`${from}T00:00:00.000Z`);
    if (Number.isNaN(start.getTime())) throw new BadRequestException('from ไม่ใช่วันที่ที่ถูกต้อง');
    const end = new Date(start.getTime() + days * 86_400_000);

    const rows = await this.prisma.campReservation.findMany({
      where: {
        tenantId,
        campgroundId,
        status: { in: [...OCCUPANCY_STATUSES] },
        checkIn: { lt: end },
        checkOut: { gt: start },
      },
      orderBy: { checkIn: 'asc' },
      take: MAX_OCCUPANCY_ROWS,
      select: {
        id: true,
        pitchId: true,
        reservationNo: true,
        guestFirstName: true,
        status: true,
        checkIn: true,
        checkOut: true,
      },
    });
    const dayKey = (d: Date) => d.toISOString().slice(0, 10);
    return {
      from,
      days,
      truncated: rows.length === MAX_OCCUPANCY_ROWS,
      stays: rows.map((r) => ({
        id: r.id,
        pitchId: r.pitchId,
        reservationNo: r.reservationNo,
        guestName: r.guestFirstName,
        status: r.status,
        checkIn: dayKey(r.checkIn),
        checkOut: dayKey(r.checkOut),
      })),
    };
  }

  /** เริ่มร่างฉาก — คืน 202 ทันที งานจริงรันเบื้องหลัง (client poll getExtraction) */
  async startExtraction(
    campgroundId: string,
    tenantId: string,
    userId: string | undefined,
    file: UploadedImage | undefined,
    input: StartExtractionInput,
  ): Promise<Map3dExtractionView> {
    if (!file) throw new BadRequestException('ไม่พบไฟล์รูปแปลน');
    const size = readImageSize(file.buffer);
    if (!size) throw new BadRequestException('อ่านขนาดรูปไม่ได้ ใช้ไฟล์ jpg, png, webp หรือ gif');
    if (
      Math.min(size.width, size.height) < MIN_IMAGE_SIDE ||
      Math.max(size.width, size.height) > MAX_IMAGE_SIDE
    ) {
      throw new BadRequestException(`รูปต้องมีด้านละ ${MIN_IMAGE_SIDE}–${MAX_IMAGE_SIDE} px`);
    }
    await this.findCampground(campgroundId, tenantId);

    const running = await this.prisma.campMapExtraction.findFirst({
      where: { tenantId, campgroundId, status: { in: ['pending', 'running'] } },
      orderBy: { createdAt: 'desc' },
    });
    if (running && (await this.expireIfStale(running)).status !== 'failed') {
      throw new ConflictException({
        code: 'EXTRACTION_IN_PROGRESS',
        message: 'กำลังร่างฉากของลานนี้อยู่ รอให้เสร็จก่อน',
        extractionId: running.id,
      });
    }

    const widthM = input.widthM;
    const depthM = input.depthM ?? Math.round((widthM * size.height * 100) / size.width) / 100;
    const northDeg = input.northDeg ?? 0;
    const id = randomUUID();

    // AI ปิด/งบหมด = ล้มแน่นอน — ตอบทันที ไม่จองโควตา ไม่อัปโหลดไฟล์
    const aiUnavailable = await this.aiUnavailable();
    if (aiUnavailable) throw new ServiceUnavailableException(aiUnavailable);

    // จองโควตาก่อน — 403/402/429 ตอบกลับทันทีโดยยังไม่มีไฟล์หรือแถวใดถูกสร้าง
    const reservation = await this.quota.reserve({
      tenantId,
      addonCode: CAMP_3D_ADDON,
      userId,
      refType: REF_TYPE,
      refId: id,
    });

    let row;
    try {
      const saved = await this.storage.save({
        folder: 'camp',
        file,
        prefix: `camp3d-${campgroundId}`,
      });
      row = await this.prisma.campMapExtraction.create({
        data: {
          id,
          tenantId,
          campgroundId,
          imageUrl: saved.url,
          imageWidth: size.width,
          imageHeight: size.height,
          input: { widthM, depthM, northDeg },
          status: 'pending',
          reservationId: reservation.reservationId,
          createdBy: userId ?? null,
        },
      });
    } catch (err) {
      await this.refundQuietly(tenantId, reservation.reservationId, 'บันทึกรูปแปลนไม่สำเร็จ');
      throw err;
    }

    const job = {
      id,
      tenantId,
      userId,
      image: file.buffer,
      mimeType: file.mimetype,
      size,
      widthM,
      depthM,
      northDeg,
      imageUrl: row.imageUrl,
    };
    // งานเบื้องหลังต้องมี tenant context ของตัวเอง (ไม่พึ่ง context ของ request ที่จบไปแล้ว)
    void this.tenantContext.run({ tenantId, skipScope: false }, () => this.process(job));
    return this.toView(row);
  }

  async getExtraction(
    campgroundId: string,
    extractionId: string,
    tenantId: string,
  ): Promise<Map3dExtractionView> {
    const row = await this.prisma.campMapExtraction.findFirst({
      where: { id: extractionId, tenantId, campgroundId },
    });
    if (!row) throw new NotFoundException('ไม่พบงานร่างฉากนี้');
    return this.toView(await this.expireIfStale(row));
  }

  /** เผยแพร่ฉาก (จากร่างที่ตรวจทานแล้ว หรือโหมดแปะภาพเป็นพื้นที่ไม่ใช้ AI) */
  async saveMap3d(campgroundId: string, tenantId: string, raw: unknown, userId?: string) {
    await this.assertEntitled(tenantId);
    await this.findCampground(campgroundId, tenantId);
    let config: Map3dConfig;
    try {
      config = sanitizeMap3dConfig(raw);
    } catch (err) {
      if (err instanceof Map3dConfigError) throw new BadRequestException(err.message);
      throw err;
    }
    if (config.ground.imageUrl && !this.storage.isOwnUrl(config.ground.imageUrl, 'camp')) {
      throw new BadRequestException('ground.imageUrl ต้องเป็นรูปที่อัปโหลดเข้าระบบ');
    }
    const foreignModel = config.props.find(
      (prop) => prop.glbUrl && !this.storage.isOwnUrl(prop.glbUrl, 'camp'),
    );
    if (foreignModel) {
      throw new BadRequestException('โมเดล 3D ต้องเป็นไฟล์ที่อัปโหลดเข้าระบบ');
    }
    const json = config as unknown as Prisma.InputJsonValue;
    // เผยแพร่ + เก็บ snapshot เป็นเวอร์ชันในธุรกรรมเดียว แล้วตัดเวอร์ชันเก่าเกินเพดานทิ้ง
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.campground.update({
        where: { id: campgroundId },
        data: { map3dConfig: json, map3dUpdatedAt: new Date() },
        select: { id: true, map3dConfig: true, map3dUpdatedAt: true },
      });
      await tx.campMap3dVersion.create({
        data: {
          tenantId,
          campgroundId,
          config: json,
          summary: map3dSummary(config) as unknown as Prisma.InputJsonValue,
          createdBy: userId ?? null,
        },
      });
      const stale = await tx.campMap3dVersion.findMany({
        where: { tenantId, campgroundId },
        orderBy: { createdAt: 'desc' },
        skip: MAX_MAP3D_VERSIONS,
        select: { id: true },
      });
      if (stale.length) {
        await tx.campMap3dVersion.deleteMany({ where: { id: { in: stale.map((v) => v.id) } } });
      }
      return row;
    });
    return {
      campgroundId: updated.id,
      config: updated.map3dConfig,
      updatedAt: updated.map3dUpdatedAt,
    };
  }

  /** ประวัติการเผยแพร่ฉาก (ใหม่ → เก่า) — ไม่ส่ง config ทั้งก้อน ใช้ summary แทน */
  async listVersions(campgroundId: string, tenantId: string) {
    await this.findCampground(campgroundId, tenantId);
    const rows = await this.prisma.campMap3dVersion.findMany({
      where: { tenantId, campgroundId },
      orderBy: { createdAt: 'desc' },
      take: MAX_MAP3D_VERSIONS,
      select: { id: true, summary: true, createdBy: true, createdAt: true },
    });
    // ชื่อผู้เผยแพร่ — กรอง tenant ด้วย ไม่ให้อ่านชื่อคนข้าม tenant ได้
    const ids = [...new Set(rows.map((r) => r.createdBy).filter((v): v is string => Boolean(v)))];
    const users = ids.length
      ? await this.prisma.user.findMany({
          where: { id: { in: ids }, tenantId },
          select: { id: true, firstName: true, lastName: true, email: true },
        })
      : [];
    const names = new Map(
      users.map((u) => [u.id, [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email]),
    );
    return rows.map((r, i) => ({
      id: r.id,
      createdAt: r.createdAt,
      createdBy: r.createdBy ? (names.get(r.createdBy) ?? null) : null,
      summary: r.summary,
      current: i === 0,
    }));
  }

  /** เวอร์ชันเดียวพร้อม config — หน้าปรับแต่งฉากโหลดมาแก้ต่อ (ยังไม่เผยแพร่จนกดบันทึก) */
  async getVersion(campgroundId: string, tenantId: string, versionId: string) {
    await this.findCampground(campgroundId, tenantId);
    const row = await this.prisma.campMap3dVersion.findFirst({
      where: { id: versionId, tenantId, campgroundId },
      select: { id: true, config: true, createdAt: true },
    });
    if (!row) throw new NotFoundException('ไม่พบเวอร์ชันฉากนี้');
    return row;
  }

  /** อัปโหลดรูปพื้นสำหรับโหมด "แปะภาพเป็นพื้น" — ไม่ใช้ AI ไม่กินโควตา */
  async uploadGround(campgroundId: string, tenantId: string, file: UploadedImage | undefined) {
    await this.assertEntitled(tenantId);
    await this.findCampground(campgroundId, tenantId);
    if (!file) throw new BadRequestException('ไม่พบไฟล์รูปภาพ');
    const size = readImageSize(file.buffer);
    if (!size) throw new BadRequestException('อ่านขนาดรูปไม่ได้ ใช้ไฟล์ jpg, png, webp หรือ gif');
    const saved = await this.storage.save({
      folder: 'camp',
      file,
      prefix: `camp3d-${campgroundId}`,
    });
    return { imageUrl: saved.url, width: size.width, height: size.height };
  }

  /** อัปโหลดโมเดล .glb เฉพาะของลาน (อาคาร/จุดเด่น) — ตรวจโครงไฟล์ก่อนเก็บ ไม่ใช้ AI ไม่กินโควตา */
  async uploadModel(campgroundId: string, tenantId: string, file: UploadedImage | undefined) {
    await this.assertEntitled(tenantId);
    await this.findCampground(campgroundId, tenantId);
    if (!file) throw new BadRequestException('ไม่พบไฟล์โมเดล');
    let summary: { meshes: number; nodes: number };
    try {
      summary = validateGlb(file.buffer);
    } catch (err) {
      if (err instanceof GlbValidationError) throw new BadRequestException(err.message);
      throw err;
    }
    // บังคับนามสกุล/ชนิดเอง — ไม่เชื่อชื่อไฟล์และ mimetype ที่ client ส่งมา
    const saved = await this.storage.save({
      folder: 'camp',
      file: { ...file, originalname: 'model.glb', mimetype: 'model/gltf-binary' },
      prefix: `camp3d-model-${campgroundId}`,
    });
    return { glbUrl: saved.url, size: file.size, meshes: summary.meshes };
  }

  // ─────────── pipeline ───────────

  private async process(job: {
    id: string;
    tenantId: string;
    userId?: string;
    image: Buffer;
    mimeType: string;
    size: { width: number; height: number };
    widthM: number;
    depthM: number;
    northDeg: number;
    imageUrl: string;
  }): Promise<void> {
    const ctx = {
      tenantId: job.tenantId,
      userId: job.userId ?? null,
      feature: AI_FEATURES.CAMP_3D_EXTRACT,
      refType: REF_TYPE,
      refId: job.id,
    };
    const row = await this.prisma.campMapExtraction.findFirst({
      where: { id: job.id, tenantId: job.tenantId },
    });
    if (!row?.reservationId) return;
    const reservationId = row.reservationId;

    try {
      await this.setStep(job, 'running', 'vision', { startedAt: new Date() });
      const vision: VisionResult = await this.gateway.run(
        { ...ctx, provider: 'openai', task: 'vision' },
        ({ apiKey, model }) =>
          callVision({
            apiKey,
            model,
            image: job.image,
            mimeType: job.mimeType,
            widthM: job.widthM,
            depthM: job.depthM,
          }),
      );

      await this.setStep(job, 'running', 'segment');
      const { segments, calls, unavailable } = await this.segment(job, ctx, vision);

      await this.setStep(job, 'running', 'build');
      const draft = buildDraft(
        vision,
        segments,
        { widthM: job.widthM, depthM: job.depthM, northDeg: job.northDeg, imageUrl: job.imageUrl },
        calls,
        unavailable,
      );
      if (draft.warnings.some((w) => w.code === 'NOTHING_FOUND')) {
        // ไม่ได้อะไรให้ใช้เลย — ไม่คิดโควตา
        throw Object.assign(new Error('AI ไม่พบองค์ประกอบในรูป'), { code: 'NOTHING_FOUND' });
      }

      await this.quota.commit(job.tenantId, reservationId);
      // status: running — ถ้าโดนตัดสินว่าค้าง (expireIfStale) ไปแล้ว อย่าเขียนทับ
      await this.prisma.campMapExtraction.updateMany({
        where: { id: job.id, tenantId: job.tenantId, status: 'running' },
        data: {
          status: 'succeeded',
          step: 'done',
          result: draft as unknown as Prisma.InputJsonValue,
          finishedAt: new Date(),
        },
      });
    } catch (err) {
      const code =
        (err as { code?: unknown }).code === 'NOTHING_FOUND' ? 'NOTHING_FOUND' : errorCodeOf(err);
      const raw = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Map3d extraction ${job.id} failed (${code}): ${raw}`);
      await this.refundQuietly(job.tenantId, reservationId, `${code}: ${raw}`.slice(0, 250));
      await this.prisma.campMapExtraction
        .updateMany({
          where: { id: job.id, tenantId: job.tenantId },
          data: {
            status: 'failed',
            errorCode: code,
            errorMessage: FAILURE_MESSAGES[code] ?? FAILURE_MESSAGES.AI_EXTRACT_FAILED,
            finishedAt: new Date(),
          },
        })
        .catch((e: unknown) =>
          this.logger.error(
            `Cannot mark extraction ${job.id} failed: ${e instanceof Error ? e.message : String(e)}`,
          ),
        );
    }
  }

  /**
   * ตัดขอบพื้นที่ด้วย SAM — ทุกความล้มเหลวที่นี่ไม่ทำให้งานล้ม แค่ถอยไปใช้ขอบจาก vision
   * เรียก gateway ครั้งเดียว (units = จำนวนครั้งที่ fal ตอบสำเร็จ) เพื่ออัปโหลดรูปครั้งเดียว
   */
  private async segment(
    job: { id: string; image: Buffer; mimeType: string; size: { width: number; height: number } },
    ctx: {
      tenantId: string;
      userId: string | null;
      feature: string;
      refType: string;
      refId: string;
    },
    vision: VisionResult,
  ): Promise<{ segments: SegmentResults; calls: number; unavailable: boolean }> {
    const segments: SegmentResults = new Map();
    const targets = vision.features
      .map((f, index) => ({ f, index, points: promptPoints(f) }))
      .filter((t) => isSegmentable(t.f) && t.points.length > 0)
      .slice(0, MAX_SEGMENTS);
    if (!targets.length) return { segments, calls: 0, unavailable: false };

    try {
      const calls = await this.gateway.run(
        { ...ctx, provider: 'fal', task: 'segment' },
        async ({ apiKey, model }) => {
          const imageUrl = await uploadToFal(apiKey, job.image, job.mimeType);
          let ok = 0;
          let lastError: unknown = null;
          const deadline = Date.now() + SEGMENT_BUDGET_MS;
          for (const t of targets) {
            if (Date.now() > deadline) {
              segments.set(t.index, null);
              continue;
            }
            try {
              const mask = await segmentOnce({
                apiKey,
                model,
                imageUrl,
                points: t.points,
                imageWidth: job.size.width,
                imageHeight: job.size.height,
              });
              ok += 1;
              segments.set(t.index, maskToPolygon(mask, t.points[0] as Point));
            } catch (err) {
              lastError = err;
              segments.set(t.index, null);
            }
          }
          // ไม่สำเร็จเลยสักชิ้น = provider มีปัญหา ให้ gateway บันทึกเป็น failed
          if (ok === 0 && lastError) throw lastError;
          return { result: ok, usage: { units: ok } };
        },
      );
      return { segments, calls, unavailable: false };
    } catch (err) {
      this.logger.warn(
        `Map3d segment step skipped for ${job.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { segments: new Map(), calls: 0, unavailable: true };
    }
  }

  // ─────────── helpers ───────────

  private async setStep(
    job: { id: string; tenantId: string },
    status: string,
    step: Map3dStep,
    extra: Prisma.CampMapExtractionUpdateManyMutationInput = {},
  ): Promise<void> {
    await this.prisma.campMapExtraction.updateMany({
      where: { id: job.id, tenantId: job.tenantId },
      data: { status, step, ...extra },
    });
  }

  private async expireIfStale<
    T extends {
      id: string;
      tenantId: string;
      status: string;
      createdAt: Date;
      reservationId: string | null;
    },
  >(row: T): Promise<T> {
    const active = row.status === 'pending' || row.status === 'running';
    if (!active || Date.now() - row.createdAt.getTime() < STALE_AFTER_MS) return row;
    // งานค้างเป็นความผิดฝั่งเรา คืนโควตาเสมอไม่สนค่า refundOnFailure
    if (row.reservationId)
      await this.refundQuietly(row.tenantId, row.reservationId, 'AI_TIMEOUT', true);
    const data = {
      status: 'failed',
      errorCode: 'AI_TIMEOUT',
      errorMessage: FAILURE_MESSAGES.AI_TIMEOUT,
      finishedAt: new Date(),
    };
    await this.prisma.campMapExtraction.updateMany({
      where: { id: row.id, tenantId: row.tenantId, status: row.status },
      data,
    });
    return { ...row, ...data };
  }

  private async refundQuietly(
    tenantId: string,
    reservationId: string,
    reason: string,
    force = false,
  ): Promise<void> {
    await this.quota
      .refund(tenantId, reservationId, reason, force)
      .catch((err: unknown) =>
        this.logger.error(
          `Refund failed for reservation ${reservationId}: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
  }

  /** ขั้นอ่านแผนผัง (vision) ขาดไม่ได้ — ขั้นตัดขอบ (fal) ข้ามได้จึงไม่นับ */
  private async aiUnavailable(): Promise<{ code: string; message: string } | null> {
    const code = await this.gateway.availability('openai', 'vision');
    return code ? { code, message: FAILURE_MESSAGES[code] } : null;
  }

  private async assertEntitled(tenantId: string): Promise<void> {
    if (!(await this.addonService.hasActiveAddon(tenantId, CAMP_3D_ADDON))) {
      throw new ForbiddenException({
        code: 'ADDON_NOT_ENTITLED',
        message: 'ยังไม่ได้ซื้อหรือทดลองใช้ add-on แผนที่ 3D',
        addonCode: CAMP_3D_ADDON,
      });
    }
  }

  private async findCampground(id: string, tenantId: string) {
    const campground = await this.prisma.campground.findFirst({
      where: { id, tenantId },
      select: { id: true, map3dConfig: true, map3dUpdatedAt: true, mapImageUrl: true },
    });
    if (!campground) throw new NotFoundException(`Campground ${id} not found`);
    return campground;
  }

  private toView(row: {
    id: string;
    campgroundId: string;
    status: string;
    step: string | null;
    imageUrl: string;
    imageWidth: number;
    imageHeight: number;
    input: Prisma.JsonValue;
    result: Prisma.JsonValue;
    errorCode: string | null;
    errorMessage: string | null;
    createdAt: Date;
    finishedAt: Date | null;
  }): Map3dExtractionView {
    return {
      id: row.id,
      campgroundId: row.campgroundId,
      status: row.status,
      step: row.step,
      imageUrl: row.imageUrl,
      imageWidth: row.imageWidth,
      imageHeight: row.imageHeight,
      input: row.input,
      result: (row.result as unknown as Map3dDraft | null) ?? null,
      errorCode: row.errorCode,
      errorMessage: row.errorMessage,
      createdAt: row.createdAt,
      finishedAt: row.finishedAt,
    };
  }
}
