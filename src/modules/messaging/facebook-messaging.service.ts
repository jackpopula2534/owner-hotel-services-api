import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/prisma/prisma.service';
import * as crypto from 'crypto';
import * as https from 'https';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { AutoReplyService } from './auto-reply.service';
import { ChannelIntegrationService } from './channel-integration.service';
import { MessagingGateway } from './messaging.gateway';

// ─── Facebook Graph API constants ────────────────────────────────────────────

const FB_SEND_API = 'https://graph.facebook.com/v19.0/me/messages';
const FB_PROFILE_API = 'https://graph.facebook.com/v19.0';
// โฟลเดอร์เก็บไฟล์แนบที่รับเข้ามา — เสิร์ฟผ่าน /uploads (ดู main.ts useStaticAssets) เหมือนฝั่ง LINE
const FB_UPLOAD_SUBDIR = path.join('messaging', 'facebook');
// จำกัดขนาดไฟล์ที่ดาวน์โหลด กัน memory spike / OOM (วิดีโอใหญ่)
const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024; // 25 MB

// ─── Webhook event types ──────────────────────────────────────────────────────

interface FbMessagingEntry {
  sender: { id: string };
  recipient: { id: string };
  timestamp: number;
  message?: {
    mid: string;
    text?: string;
    is_echo?: boolean;
    attachments?: { type: string; payload: { url?: string } }[];
  };
}

interface FbWebhookEntry {
  id: string; // Page ID — ใช้ map → tenant
  time: number;
  messaging: FbMessagingEntry[];
}

export interface FbWebhookBody {
  object: string; // "page"
  entry: FbWebhookEntry[];
}

@Injectable()
export class FacebookMessagingService {
  private readonly logger = new Logger(FacebookMessagingService.name);
  // app secret + verify token เป็นระดับ "แอป" (Meta App ของผู้ให้บริการ ตั้งครั้งเดียว) → ยังใช้ ENV
  private readonly appSecret: string;
  private readonly verifyToken: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly autoReplyService: AutoReplyService,
    private readonly channelIntegration: ChannelIntegrationService,
    private readonly gateway: MessagingGateway,
  ) {
    this.appSecret = this.configService.get<string>('FB_APP_SECRET', '');
    this.verifyToken = this.configService.get<string>('FB_VERIFY_TOKEN', '');
  }

  // ─── Webhook Verification (GET) ───────────────────────────────────────────────

  verifyWebhook(mode: string, token: string, challenge: string): string {
    if (mode === 'subscribe' && token === this.verifyToken) {
      this.logger.log('[FB] Webhook verified successfully');
      return challenge;
    }
    throw new BadRequestException('Facebook webhook verification failed');
  }

  // ─── Signature Verification ───────────────────────────────────────────────────

  verifySignature(rawBody: Buffer, signature: string): boolean {
    if (!this.appSecret) {
      this.logger.warn('FB_APP_SECRET not set — skipping signature check');
      return true;
    }
    // Facebook sends: sha256=<hash>
    const expected =
      'sha256=' + crypto.createHmac('sha256', this.appSecret).update(rawBody).digest('hex');
    const ok = expected === signature;
    if (!ok) {
      // สาเหตุที่พบบ่อย: FB_APP_SECRET ใน .env ไม่ตรงกับ App Secret จริงของ Meta App
      // → event จริงจาก Facebook จะถูกปฏิเสธ (400) และ "ข้อความไม่แสดง" ในกล่องแชต
      this.logger.warn(
        '[FB] ลายเซ็น webhook ไม่ตรง — ตรวจสอบว่า FB_APP_SECRET ใน .env ตรงกับ App Secret ของ Meta App',
      );
    }
    return ok;
  }

  // ─── Handle Incoming Webhook (POST) ──────────────────────────────────────────

  /**
   * Meta ส่ง webhook ของ "ทุกเพจ" มาที่ callback URL เดียว → map ด้วย pageId (entry.id)
   * @param fallbackTenantId  ใช้เฉพาะ legacy route ที่ยังมี tenantId ใน path (single-tenant ENV)
   */
  async handleWebhook(body: FbWebhookBody, fallbackTenantId?: string): Promise<void> {
    if (body.object !== 'page') return;

    for (const entry of body.entry) {
      const pageId = entry.id;
      const route = await this.resolveRoute(pageId, fallbackTenantId);
      if (!route) {
        this.logger.warn(`[FB] ไม่พบ tenant ที่ผูกกับ pageId=${pageId} — ข้าม ${entry.messaging?.length ?? 0} event`);
        continue;
      }

      for (const event of entry.messaging) {
        if (event.message) {
          await this.handleMessage(route.tenantId, route.pageAccessToken, event);
        }
      }
    }
  }

  /** หา tenant + page token จาก pageId; ถ้าไม่เจอแต่มี fallbackTenantId → ใช้ token ของ tenant นั้น (ENV) */
  private async resolveRoute(
    pageId: string,
    fallbackTenantId?: string,
  ): Promise<{ tenantId: string; pageAccessToken: string } | null> {
    const mapped = await this.channelIntegration.getFacebookByPageId(pageId);
    if (mapped) return mapped;

    if (fallbackTenantId) {
      const creds = await this.channelIntegration.getFacebookCredentials(fallbackTenantId);
      if (creds?.pageAccessToken) {
        return { tenantId: fallbackTenantId, pageAccessToken: creds.pageAccessToken };
      }
    }
    return null;
  }

  private async handleMessage(
    tenantId: string,
    pageAccessToken: string,
    event: FbMessagingEntry,
  ): Promise<void> {
    const psid = event.sender.id; // Page-Scoped User ID
    const msg = event.message;
    if (!msg) return;

    // Ignore echo (ข้อความที่เพจส่งเอง) และข้อความว่าง
    if (msg.is_echo) return;
    if (!msg.text && !msg.attachments?.length) return;

    const externalMsgId = msg.mid;

    try {
      const conversation = await this.upsertConversation(tenantId, pageAccessToken, psid);

      // เก็บ message + อัปเดต lastMessageAt + push realtime (ใช้ซ้ำทั้ง text และไฟล์แนบ)
      const persistAndEmit = async (messageType: string, content: string) => {
        const inbound = await this.prisma.message.create({
          data: {
            conversationId: conversation.id,
            tenantId,
            channel: 'FACEBOOK',
            direction: 'INBOUND',
            messageType,
            content,
            externalMsgId,
            isAutoReply: false,
          },
        });
        await this.prisma.conversation.update({
          where: { id: conversation.id },
          data: { lastMessageAt: new Date() },
        });
        // push เข้า inbox ของ staff แบบ real-time (ไม่ต้องรีเฟรช)
        this.gateway.emitNewMessage(tenantId, {
          conversationId: conversation.id,
          message: inbound,
        });
      };

      // 1) ข้อความตัวอักษร
      if (msg.text) {
        await persistAndEmit('text', msg.text);
      }

      // 2) ไฟล์แนบ (รูป/วิดีโอ/เสียง/ไฟล์) — FB ส่ง CDN URL มาให้
      //    ดาวน์โหลด binary เก็บลง uploads/messaging/facebook แล้วเก็บ content เป็น path (เหมือน LINE)
      //    ถ้าดาวน์โหลดล้มเหลว fallback เป็น '[attachment]' เพื่อไม่ให้ทั้งข้อความหาย
      for (const att of msg.attachments ?? []) {
        const messageType = this.mapFbAttachmentType(att.type);
        let content = '[attachment]';
        const url = att.payload?.url;
        if (url) {
          try {
            content = await this.downloadFbAttachment(url, externalMsgId, messageType);
          } catch (e) {
            this.logger.warn(
              `[FB] ดาวน์โหลดไฟล์แนบไม่สำเร็จ (type=${att.type}): ${(e as Error).message}`,
            );
          }
        }
        await persistAndEmit(messageType, content);
      }

      this.logger.log(
        `[FB] Inbound from psid=${psid} conversationId=${conversation.id} (text=${!!msg.text}, attachments=${msg.attachments?.length ?? 0})`,
      );

      // Auto-reply — only for text messages
      if (msg.text) {
        const replyText = await this.autoReplyService.findMatchingTemplate(
          tenantId,
          'FACEBOOK',
          msg.text,
        );
        if (replyText) {
          await this.fbSend(pageAccessToken, psid, replyText);
          const autoMsg = await this.prisma.message.create({
            data: {
              conversationId: conversation.id,
              tenantId,
              channel: 'FACEBOOK',
              direction: 'OUTBOUND',
              messageType: 'text',
              content: replyText,
              isAutoReply: true,
            },
          });
          this.gateway.emitNewMessage(tenantId, {
            conversationId: conversation.id,
            message: autoMsg,
          });
        }
      }
    } catch (err) {
      this.logger.error(`[FB] handleMessage error: ${(err as Error).message}`);
    }
  }

  // ─── Attachment handling ──────────────────────────────────────────────────────

  /** map ชนิดไฟล์แนบของ Messenger → messageType ที่ frontend รองรับ */
  private mapFbAttachmentType(type: string): string {
    switch (type) {
      case 'image':
        return 'image';
      case 'video':
        return 'video';
      case 'audio':
        return 'audio';
      default:
        // file, fallback (แชร์ลิงก์), location, template ฯลฯ → เก็บเป็นไฟล์ดาวน์โหลด
        return 'file';
    }
  }

  /** ดาวน์โหลดไฟล์แนบจาก FB CDN URL → เซฟลง uploads/messaging/facebook → คืน path สาธารณะ */
  private async downloadFbAttachment(
    url: string,
    mid: string,
    messageType: string,
  ): Promise<string> {
    const { buffer, contentType } = await this.downloadUrl(url);
    const dir = path.join(process.cwd(), 'uploads', FB_UPLOAD_SUBDIR);
    await fs.promises.mkdir(dir, { recursive: true });
    // mid อาจซ้ำเมื่อมีหลายไฟล์ใน message เดียว → ใส่ hash ของ url กันชนกัน
    const hash = crypto.createHash('md5').update(url).digest('hex').slice(0, 8);
    const ext = this.extFromContentType(contentType, messageType === 'file' ? 'bin' : messageType);
    const filename = `${mid || 'fb'}_${hash}.${ext}`;
    await fs.promises.writeFile(path.join(dir, filename), buffer);
    return `/uploads/messaging/facebook/${filename}`;
  }

  /** GET binary จาก URL — ตาม redirect (FB lookaside → scontent CDN) + size guard + timeout */
  private downloadUrl(
    url: string,
    redirects = 5,
  ): Promise<{ buffer: Buffer; contentType: string }> {
    return new Promise((resolve, reject) => {
      const u = new URL(url);
      const client = u.protocol === 'http:' ? http : https;
      const req = client.request(
        {
          hostname: u.hostname,
          path: u.pathname + u.search,
          method: 'GET',
          timeout: 30000,
        },
        (res) => {
          const status = res.statusCode ?? 0;
          // ตาม redirect
          if (status >= 300 && status < 400 && res.headers.location) {
            res.resume();
            if (redirects <= 0) {
              reject(new Error('too many redirects'));
              return;
            }
            const next = new URL(res.headers.location, url).toString();
            this.downloadUrl(next, redirects - 1).then(resolve, reject);
            return;
          }
          if (status !== 200) {
            res.resume();
            reject(new Error(`download failed: HTTP ${status}`));
            return;
          }
          const chunks: Buffer[] = [];
          let total = 0;
          res.on('data', (chunk: Buffer) => {
            total += chunk.length;
            if (total > MAX_DOWNLOAD_BYTES) {
              res.destroy();
              reject(new Error(`attachment exceeds ${MAX_DOWNLOAD_BYTES} bytes — aborted`));
              return;
            }
            chunks.push(chunk);
          });
          res.on('end', () =>
            resolve({
              buffer: Buffer.concat(chunks),
              contentType: res.headers['content-type'] ?? 'application/octet-stream',
            }),
          );
        },
      );
      req.on('timeout', () => req.destroy(new Error('download timeout')));
      req.on('error', reject);
      req.end();
    });
  }

  /** เดานามสกุลไฟล์จาก content-type (fallback เป็นชนิด message) */
  private extFromContentType(contentType: string, fallbackType: string): string {
    const map: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'video/mp4': 'mp4',
      'audio/mp4': 'm4a',
      'audio/x-m4a': 'm4a',
      'audio/aac': 'aac',
      'audio/mpeg': 'mp3',
      'application/pdf': 'pdf',
    };
    const ct = contentType.split(';')[0].trim().toLowerCase();
    if (map[ct]) return map[ct];
    const sub = ct.split('/')[1];
    if (sub) return sub.replace(/[^a-z0-9]/g, '') || fallbackType;
    return fallbackType;
  }

  // ─── Send Message (Staff Reply) ───────────────────────────────────────────────

  async sendReply(
    tenantId: string,
    conversationId: string,
    content: string,
    staffId: string,
  ): Promise<void> {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, tenantId, channel: 'FACEBOOK' },
    });
    if (!conversation) {
      throw new NotFoundException(`Conversation ${conversationId} not found`);
    }

    const creds = await this.channelIntegration.getFacebookCredentials(tenantId);
    if (!creds?.pageAccessToken) {
      throw new BadRequestException('ยังไม่ได้เชื่อมต่อ Facebook Page — ตั้งค่าที่หน้าเชื่อมต่อช่องทาง');
    }

    await this.fbSend(creds.pageAccessToken, conversation.externalId, content);

    await this.prisma.message.create({
      data: {
        conversationId,
        tenantId,
        channel: 'FACEBOOK',
        direction: 'OUTBOUND',
        messageType: 'text',
        content,
        staffId,
        isAutoReply: false,
      },
    });

    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: new Date() },
    });

    this.logger.log(`[FB] Outbound by staff=${staffId} to conversationId=${conversationId}`);
  }

  // ─── Helper: Upsert Conversation ─────────────────────────────────────────────

  private async upsertConversation(tenantId: string, pageAccessToken: string, psid: string) {
    const existing = await this.prisma.conversation.findUnique({
      where: {
        tenantId_channel_externalId: {
          tenantId,
          channel: 'FACEBOOK',
          externalId: psid,
        },
      },
    });
    if (existing) return existing;

    // Fetch FB user name
    let displayName: string | undefined;
    let pictureUrl: string | undefined;
    try {
      const profile = await this.getFbProfile(pageAccessToken, psid);
      displayName = profile.name;
      pictureUrl = profile.picture?.data?.url;
    } catch {
      this.logger.warn(`[FB] Could not fetch profile for psid=${psid}`);
    }

    return this.prisma.conversation.create({
      data: {
        tenantId,
        channel: 'FACEBOOK',
        externalId: psid,
        displayName,
        pictureUrl,
        isActive: true,
        lastMessageAt: new Date(),
      },
    });
  }

  // ─── Facebook Graph API calls ─────────────────────────────────────────────────

  private fbSend(pageAccessToken: string, recipientId: string, text: string): Promise<void> {
    const body = JSON.stringify({
      recipient: { id: recipientId },
      messaging_type: 'RESPONSE',
      message: { text },
    });
    return this.fbPost(`${FB_SEND_API}?access_token=${encodeURIComponent(pageAccessToken)}`, body);
  }

  private getFbProfile(
    pageAccessToken: string,
    psid: string,
  ): Promise<{ name: string; picture?: { data: { url: string } } }> {
    return new Promise((resolve, reject) => {
      const path = `/${psid}?fields=name,picture&access_token=${encodeURIComponent(pageAccessToken)}`;
      const parsed = new URL(`${FB_PROFILE_API}${path}`);
      const req = https.request(
        {
          hostname: parsed.hostname,
          path: parsed.pathname + parsed.search,
          method: 'GET',
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            if (res.statusCode === 200) {
              resolve(JSON.parse(data));
            } else {
              reject(new Error(`FB profile API: ${res.statusCode} ${data}`));
            }
          });
        },
      );
      req.on('error', reject);
      req.end();
    });
  }

  private fbPost(url: string, body: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const req = https.request(
        {
          hostname: parsed.hostname,
          path: parsed.pathname + parsed.search,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            if (res.statusCode && res.statusCode < 300) {
              resolve();
            } else {
              reject(new BadRequestException(`FB Send API error ${res.statusCode}: ${data}`));
            }
          });
        },
      );
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }
}
