import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as https from 'https';
import { PrismaService } from '@/prisma/prisma.service';
import { EncryptionService } from '@/common/services/encryption.service';
import { ConnectLineDto, ConnectFacebookDto } from './dto/messaging.dto';

const LINE_INFO_URL = 'https://api.line.me/v2/bot/info';
const LINE_WEBHOOK_ENDPOINT_URL = 'https://api.line.me/v2/bot/channel/webhook/endpoint';
const FB_GRAPH = 'https://graph.facebook.com/v19.0';
// fields ที่ subscribe ให้ Meta ส่ง event ของเพจมาที่ app webhook
const FB_SUBSCRIBED_FIELDS = 'messages,messaging_postbacks,messaging_optins';

export type ChannelKind = 'LINE' | 'FACEBOOK' | 'INSTAGRAM';
export type IntegrationStatus = 'CONNECTED' | 'DISCONNECTED' | 'EXPIRED' | 'ERROR';

/** ค่า credential ที่ถอดรหัสแล้ว — ใช้ภายใน service เท่านั้น ห้ามส่งออก API */
export interface LineCredentials {
  channelAccessToken: string;
  channelSecret: string;
}

/** Facebook page credential (ถอดรหัสแล้ว) — ใช้ภายใน service เท่านั้น */
export interface FacebookCredentials {
  pageAccessToken: string;
}

/** ผลการ map webhook (pageId → tenant) — ใช้ใน FacebookMessagingService */
export interface FacebookRoute {
  tenantId: string;
  pageAccessToken: string;
}

/** รูปแบบที่ปลอดภัยสำหรับส่งออก API — ไม่มี token ดิบ */
export interface ChannelIntegrationView {
  channel: ChannelKind;
  status: IntegrationStatus;
  displayName: string | null;
  externalAccountId: string | null;
  statusMessage: string | null;
  webhookVerified: boolean;
  connectedAt: string | null;
  tokenPreview: string | null;
}

interface HttpResult {
  status: number;
  body: string;
}

@Injectable()
export class ChannelIntegrationService {
  private readonly logger = new Logger(ChannelIntegrationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly encryption: EncryptionService,
  ) {}

  // ─── Read ──────────────────────────────────────────────────────────────────

  /** รายการ integration ของ tenant (รูปแบบปลอดภัย — ไม่มี token ดิบ) */
  async list(tenantId: string): Promise<ChannelIntegrationView[]> {
    const rows = await this.prisma.channelIntegration.findMany({
      where: { tenantId },
      orderBy: { channel: 'asc' },
    });
    return rows.map((r) => this.toView(r));
  }

  /** integration เดี่ยวตาม channel (รูปแบบปลอดภัย) */
  async getOne(tenantId: string, channel: ChannelKind): Promise<ChannelIntegrationView | null> {
    const row = await this.prisma.channelIntegration.findFirst({
      where: { tenantId, channel },
    });
    return row ? this.toView(row) : null;
  }

  /**
   * โหลด LINE credential per-tenant (ถอดรหัสแล้ว) ให้ LineMessagingService ใช้
   * ถ้า tenant ยังไม่เชื่อมต่อ → fallback ไป ENV (backward compatible กับของเดิม)
   */
  async getLineCredentials(tenantId: string): Promise<LineCredentials | null> {
    const row = await this.prisma.channelIntegration.findFirst({
      where: { tenantId, channel: 'LINE' },
    });

    if (row?.accessToken && row.status === 'CONNECTED') {
      return {
        channelAccessToken: (this.encryption.decrypt(row.accessToken) as string) ?? '',
        channelSecret: (this.encryption.decrypt(row.channelSecret) as string) ?? '',
      };
    }

    // Fallback: ENV เดิม (รองรับ tenant เดียวแบบเก่า)
    const envToken = this.config.get<string>('LINE_CHANNEL_ACCESS_TOKEN', '');
    const envSecret = this.config.get<string>('LINE_CHANNEL_SECRET', '');
    if (envToken) {
      return { channelAccessToken: envToken, channelSecret: envSecret };
    }
    return null;
  }

  // ─── Connect LINE ────────────────────────────────────────────────────────────

  /**
   * เชื่อมต่อ LINE OA ของ tenant:
   *   1. validate access token ด้วย GET /v2/bot/info → ได้ basicId/displayName
   *   2. ตั้ง webhook endpoint อัตโนมัติ (PUT /v2/bot/channel/webhook/endpoint)
   *   3. เข้ารหัส token + secret แล้ว upsert ลง DB (status = CONNECTED)
   */
  async connectLine(tenantId: string, dto: ConnectLineDto): Promise<ChannelIntegrationView> {
    const token = dto.channelAccessToken.trim();
    const secret = dto.channelSecret.trim();

    // 1. Validate token
    const info = await this.fetchLineBotInfo(token);

    // 2. ตั้ง webhook endpoint (best-effort — ถ้า fail ยังเชื่อมต่อได้ แต่ webhookVerified=false)
    let webhookVerified = false;
    let statusMessage: string | null = null;
    const webhookUrl = this.buildLineWebhookUrl(tenantId);
    try {
      await this.setLineWebhookEndpoint(token, webhookUrl);
      webhookVerified = true;
    } catch (err) {
      statusMessage = `ตั้ง webhook อัตโนมัติไม่สำเร็จ — ตั้งเองที่ LINE Console: ${webhookUrl}`;
      this.logger.warn(
        `[LINE connect] tenant=${tenantId} auto-webhook failed: ${(err as Error).message}`,
      );
    }

    // 3. Encrypt + upsert
    const encToken = this.encryption.encrypt(token) as string;
    const encSecret = this.encryption.encrypt(secret) as string;

    const row = await this.prisma.channelIntegration.upsert({
      where: { tenantId_channel: { tenantId, channel: 'LINE' } },
      create: {
        tenantId,
        channel: 'LINE',
        externalAccountId: info.basicId ?? info.userId ?? null,
        displayName: info.displayName ?? null,
        accessToken: encToken,
        channelSecret: encSecret,
        status: 'CONNECTED',
        statusMessage,
        webhookVerified,
        connectedAt: new Date(),
      },
      update: {
        externalAccountId: info.basicId ?? info.userId ?? null,
        displayName: info.displayName ?? null,
        accessToken: encToken,
        channelSecret: encSecret,
        status: 'CONNECTED',
        statusMessage,
        webhookVerified,
        connectedAt: new Date(),
      },
    });

    this.logger.log(`[LINE connect] tenant=${tenantId} OA="${info.displayName}" webhook=${webhookVerified}`);
    return this.toView(row);
  }

  // ─── Facebook ────────────────────────────────────────────────────────────────

  /**
   * โหลด tenant + page token จาก pageId (ใช้ตอนรับ webhook ของ Meta ที่ส่งมา URL เดียว)
   * Meta ส่ง webhook ของทุกเพจมาที่ callback เดียว → ต้อง map ด้วย pageId (entry.id)
   * query นี้ "ข้าม tenant" โดยตั้งใจ — ChannelIntegration ไม่ได้อยู่ใน TENANT_SCOPED_MODELS
   */
  async getFacebookByPageId(pageId: string): Promise<FacebookRoute | null> {
    const row = await this.prisma.channelIntegration.findFirst({
      where: { channel: 'FACEBOOK', externalAccountId: pageId, status: 'CONNECTED' },
    });
    if (!row?.accessToken) return null;
    return {
      tenantId: row.tenantId,
      pageAccessToken: (this.encryption.decrypt(row.accessToken) as string) ?? '',
    };
  }

  /**
   * โหลด page token ของ tenant (ใช้ตอน staff ตอบกลับ) — fallback ENV ถ้ายังไม่เชื่อม
   */
  async getFacebookCredentials(tenantId: string): Promise<FacebookCredentials | null> {
    const row = await this.prisma.channelIntegration.findFirst({
      where: { tenantId, channel: 'FACEBOOK' },
    });
    if (row?.accessToken && row.status === 'CONNECTED') {
      return { pageAccessToken: (this.encryption.decrypt(row.accessToken) as string) ?? '' };
    }
    const envToken = this.config.get<string>('FB_PAGE_ACCESS_TOKEN', '');
    return envToken ? { pageAccessToken: envToken } : null;
  }

  /**
   * เชื่อมต่อ Facebook Page ของ tenant ด้วย Page Access Token:
   *   1. validate token + ดึง pageId/ชื่อเพจ (GET /me?fields=id,name)
   *   2. subscribe เพจเข้ากับ app webhook (POST /{pageId}/subscribed_apps)
   *   3. เข้ารหัส token แล้ว upsert (status = CONNECTED)
   * หมายเหตุ: app secret + verify token เป็นระดับ "แอป" (ตั้งครั้งเดียวใน Meta App ของผู้ให้บริการ)
   *           ไม่ได้เก็บต่อ tenant — ต่อ tenant เก็บแค่ page access token
   */
  async connectFacebook(tenantId: string, dto: ConnectFacebookDto): Promise<ChannelIntegrationView> {
    const token = dto.pageAccessToken.trim();

    // 1. Validate + ดึงข้อมูลเพจ
    const page = await this.fetchFacebookPageInfo(token);
    if (!page.id) {
      throw new BadRequestException('ดึง Page ID จาก token ไม่ได้ — ตรวจสอบว่าเป็น Page Access Token');
    }

    // 2. subscribe เพจเข้า app webhook (best-effort)
    let webhookVerified = false;
    let statusMessage: string | null = null;
    try {
      await this.subscribeFacebookPage(page.id, token);
      webhookVerified = true;
    } catch (err) {
      statusMessage = 'subscribe เพจเข้า webhook ไม่สำเร็จ — ตรวจสิทธิ์ pages_messaging ของ token';
      this.logger.warn(
        `[FB connect] tenant=${tenantId} subscribe failed: ${(err as Error).message}`,
      );
    }

    // 3. Encrypt + upsert
    const encToken = this.encryption.encrypt(token) as string;
    const row = await this.prisma.channelIntegration.upsert({
      where: { tenantId_channel: { tenantId, channel: 'FACEBOOK' } },
      create: {
        tenantId,
        channel: 'FACEBOOK',
        externalAccountId: page.id,
        displayName: page.name ?? null,
        accessToken: encToken,
        status: 'CONNECTED',
        statusMessage,
        webhookVerified,
        connectedAt: new Date(),
      },
      update: {
        externalAccountId: page.id,
        displayName: page.name ?? null,
        accessToken: encToken,
        status: 'CONNECTED',
        statusMessage,
        webhookVerified,
        connectedAt: new Date(),
      },
    });

    this.logger.log(`[FB connect] tenant=${tenantId} page="${page.name}" (${page.id}) webhook=${webhookVerified}`);
    return this.toView(row);
  }

  // ─── Test / Disconnect ─────────────────────────────────────────────────────

  /** ตรวจสุขภาพการเชื่อมต่อใหม่ (re-validate token + อัปเดต status) */
  async testConnection(tenantId: string, channel: ChannelKind): Promise<ChannelIntegrationView> {
    const row = await this.prisma.channelIntegration.findFirst({
      where: { tenantId, channel },
    });
    if (!row) throw new NotFoundException(`ยังไม่ได้เชื่อมต่อ ${channel}`);

    if (channel === 'INSTAGRAM') {
      throw new BadRequestException(`ยังไม่รองรับการทดสอบ ${channel} ใน Phase นี้`);
    }

    const token = this.encryption.decrypt(row.accessToken) as string;
    if (!token) throw new BadRequestException('ไม่พบ access token ที่บันทึกไว้');

    try {
      const displayName =
        channel === 'LINE'
          ? (await this.fetchLineBotInfo(token)).displayName
          : (await this.fetchFacebookPageInfo(token)).name;
      const updated = await this.prisma.channelIntegration.update({
        where: { id: row.id },
        data: {
          status: 'CONNECTED',
          statusMessage: null,
          displayName: displayName ?? row.displayName,
        },
      });
      return this.toView(updated);
    } catch (err) {
      const updated = await this.prisma.channelIntegration.update({
        where: { id: row.id },
        data: { status: 'ERROR', statusMessage: (err as Error).message },
      });
      return this.toView(updated);
    }
  }

  /** ยกเลิกการเชื่อมต่อ — ลบ credential ทิ้ง */
  async disconnect(tenantId: string, channel: ChannelKind): Promise<void> {
    const row = await this.prisma.channelIntegration.findFirst({
      where: { tenantId, channel },
    });
    if (!row) throw new NotFoundException(`ยังไม่ได้เชื่อมต่อ ${channel}`);
    await this.prisma.channelIntegration.delete({ where: { id: row.id } });
    this.logger.log(`[${channel} disconnect] tenant=${tenantId}`);
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private toView(row: {
    channel: string;
    status: string;
    displayName: string | null;
    externalAccountId: string | null;
    statusMessage: string | null;
    webhookVerified: boolean;
    connectedAt: Date | null;
    accessToken: string | null;
  }): ChannelIntegrationView {
    return {
      channel: row.channel as ChannelKind,
      status: row.status as IntegrationStatus,
      displayName: row.displayName,
      externalAccountId: row.externalAccountId,
      statusMessage: row.statusMessage,
      webhookVerified: row.webhookVerified,
      connectedAt: row.connectedAt ? row.connectedAt.toISOString() : null,
      tokenPreview: row.accessToken ? this.encryption.mask(row.accessToken, 6) : null,
    };
  }

  private buildLineWebhookUrl(tenantId: string): string {
    const base = (this.config.get<string>('APP_BASE_URL', '') || '').replace(/\/$/, '');
    return `${base}/api/v1/messaging/line/webhook/${tenantId}`;
  }

  // ─── LINE API calls ──────────────────────────────────────────────────────────

  private async fetchLineBotInfo(
    accessToken: string,
  ): Promise<{ userId?: string; basicId?: string; displayName?: string }> {
    const res = await this.lineRequest('GET', LINE_INFO_URL, accessToken);
    if (res.status === 200) {
      return JSON.parse(res.body);
    }
    if (res.status === 401) {
      throw new BadRequestException('Access token ไม่ถูกต้องหรือหมดอายุ');
    }
    throw new BadRequestException(`ตรวจสอบ token ไม่สำเร็จ (LINE ตอบ ${res.status})`);
  }

  private async setLineWebhookEndpoint(accessToken: string, endpoint: string): Promise<void> {
    const res = await this.lineRequest(
      'PUT',
      LINE_WEBHOOK_ENDPOINT_URL,
      accessToken,
      JSON.stringify({ endpoint }),
    );
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`LINE webhook endpoint API ตอบ ${res.status}: ${res.body}`);
    }
  }

  private lineRequest(
    method: 'GET' | 'PUT' | 'POST',
    url: string,
    accessToken: string,
    body?: string,
  ): Promise<HttpResult> {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const headers: Record<string, string> = {
        Authorization: `Bearer ${accessToken}`,
      };
      if (body) {
        headers['Content-Type'] = 'application/json';
        headers['Content-Length'] = String(Buffer.byteLength(body));
      }
      const req = https.request(
        {
          hostname: parsed.hostname,
          path: parsed.pathname + parsed.search,
          method,
          headers,
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
        },
      );
      req.on('error', reject);
      if (body) req.write(body);
      req.end();
    });
  }

  // ─── Facebook Graph API calls ─────────────────────────────────────────────────

  private async fetchFacebookPageInfo(
    pageAccessToken: string,
  ): Promise<{ id?: string; name?: string }> {
    // วิธีหลัก: ใช้ debug_token เพื่อ validate + ดึง Page ID
    // (ไม่ต้องใช้สิทธิ์ pages_read_engagement เหมือน /me?fields=name → token ที่มีแค่
    //  pages_messaging ก็ผ่านได้) — Page Access Token สามารถ debug ตัวเองได้
    const dbgUrl =
      `${FB_GRAPH}/debug_token` +
      `?input_token=${encodeURIComponent(pageAccessToken)}` +
      `&access_token=${encodeURIComponent(pageAccessToken)}`;
    const dbg = await this.graphRequest('GET', dbgUrl);

    if (dbg.status === 200) {
      const parsed = JSON.parse(dbg.body) as {
        data?: {
          is_valid?: boolean;
          type?: string;
          profile_id?: string;
          scopes?: string[];
          error?: { message?: string };
        };
      };
      const data = parsed.data;
      if (data?.is_valid && data.profile_id) {
        if (data.type && data.type !== 'PAGE') {
          throw new BadRequestException(
            'นี่ไม่ใช่ Page Access Token — ต้องใช้ token ของ "เพจ" (Page) ไม่ใช่ User Token',
          );
        }
        if (data.scopes && !data.scopes.includes('pages_messaging')) {
          throw new BadRequestException(
            'Token นี้ไม่มีสิทธิ์ pages_messaging — สร้าง Page Access Token ใหม่โดยให้สิทธิ์ pages_messaging',
          );
        }
        // ได้ Page ID แล้ว ลองดึงชื่อเพจแบบ best-effort (อาจไม่มีสิทธิ์ก็ไม่เป็นไร)
        const name = await this.tryFetchFacebookPageName(data.profile_id, pageAccessToken);
        return { id: data.profile_id, name };
      }
      // is_valid = false → token หมดอายุ/ถูกเพิกถอน
      throw new BadRequestException(
        data?.error?.message
          ? `Page Access Token ใช้ไม่ได้: ${data.error.message}`
          : 'Page Access Token ไม่ถูกต้องหรือหมดอายุ',
      );
    }

    // debug_token เองล้มเหลว → surface เหตุผลจริงจาก Facebook ออกมา
    throw new BadRequestException(this.facebookErrorMessage(dbg));
  }

  /** ดึงชื่อเพจแบบ best-effort — ถ้าไม่มีสิทธิ์ pages_read_engagement จะคืน undefined */
  private async tryFetchFacebookPageName(
    pageId: string,
    pageAccessToken: string,
  ): Promise<string | undefined> {
    try {
      const url = `${FB_GRAPH}/${pageId}?fields=name&access_token=${encodeURIComponent(pageAccessToken)}`;
      const res = await this.graphRequest('GET', url);
      if (res.status === 200) {
        return (JSON.parse(res.body) as { name?: string }).name;
      }
    } catch {
      /* best-effort — เพิกเฉย */
    }
    return undefined;
  }

  /** แปลง error body ของ Facebook Graph เป็นข้อความที่อ่านเข้าใจได้ */
  private facebookErrorMessage(res: HttpResult): string {
    try {
      const fbMsg = (JSON.parse(res.body) as { error?: { message?: string } }).error?.message;
      if (fbMsg) return `ตรวจสอบ token กับ Facebook ไม่สำเร็จ: ${fbMsg}`;
    } catch {
      /* body ไม่ใช่ JSON */
    }
    return `ตรวจสอบ token ไม่สำเร็จ (Facebook ตอบ ${res.status})`;
  }

  private async subscribeFacebookPage(pageId: string, pageAccessToken: string): Promise<void> {
    const url =
      `${FB_GRAPH}/${pageId}/subscribed_apps` +
      `?subscribed_fields=${FB_SUBSCRIBED_FIELDS}` +
      `&access_token=${encodeURIComponent(pageAccessToken)}`;
    const res = await this.graphRequest('POST', url);
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`subscribed_apps API ตอบ ${res.status}: ${res.body}`);
    }
  }

  private graphRequest(method: 'GET' | 'POST', url: string): Promise<HttpResult> {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const req = https.request(
        {
          hostname: parsed.hostname,
          path: parsed.pathname + parsed.search,
          method,
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
        },
      );
      req.on('error', reject);
      req.end();
    });
  }
}
